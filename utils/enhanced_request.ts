/**
 * Enhanced request implementation with comprehensive tool handling
 */

import {
    EnsembleStreamEvent,
    ResponseInput,
    ToolCall,
    ToolFunction,
    RequestOptions as BaseRequestOptions,
    ModelSettings
} from '../types.js';
import {
    EnhancedRequestOptions,
    RequestContext,
    ToolCallAction,
    ExecutionMetrics,
    EnhancedToolFunction,
    createRequestContext,
    isLoopConfig
} from '../types/tool_types.js';
import { getModelProvider } from '../model_providers/model_provider.js';
import { RequestAgent } from '../index.js';

/**
 * Combined request options
 */
export interface RequestOptions extends BaseRequestOptions, EnhancedRequestOptions {}

/**
 * Internal state for tracking tool execution
 */
interface ToolExecutionState {
    executions: Map<string, number>;  // Tool name -> execution count
    lastExecution: Map<string, number>; // Tool name -> timestamp
    metrics: ExecutionMetrics;
    cache: Map<string, any>; // Cache for tool results
}

/**
 * Enhanced request function with comprehensive tool handling
 */
export async function* enhancedRequest(
    model: string,
    messages: ResponseInput,
    options: RequestOptions = {},
    context?: RequestContext
): AsyncGenerator<EnsembleStreamEvent> {
    // Initialize context if not provided
    const ctx = context || createRequestContext({
        messages: [...messages]
    });
    
    // Extract enhanced options
    const {
        toolHandler,
        toolCategories,
        toolFilter,
        toolPriority,
        loop = false,
        maxToolCalls = 10,
        maxToolCallsPerTurn,
        toolChoiceStrategy,
        toolResultTransformer,
        allowedEvents,
        eventEmitter,
        onStreamComplete,
        cacheToolResults = false,
        parallelExecution = 1,
        debug = false,
        ...baseOptions
    } = options;
    
    // Initialize execution state
    const executionState: ToolExecutionState = {
        executions: new Map(),
        lastExecution: new Map(),
        metrics: {
            duration: 0,
            tokenCount: 0,
            toolCallCount: 0,
            modelCalls: 0,
            errors: 0,
            timestamp: Date.now()
        },
        cache: new Map()
    };
    
    // Filter and organize tools
    let availableTools = baseOptions.tools || [];
    if (toolCategories && toolCategories.length > 0) {
        availableTools = availableTools.filter(tool => 
            toolCategories.includes((tool as EnhancedToolFunction).category || 'custom')
        );
    }
    if (toolFilter) {
        availableTools = availableTools.filter(toolFilter);
    }
    if (toolPriority) {
        availableTools = toolPriority(availableTools);
    }
    
    // Main execution loop
    let iteration = 0;
    const loopConfig = isLoopConfig(loop) ? loop : { maxIterations: loop ? Infinity : 1 };
    
    while (ctx.shouldContinue && iteration < (loopConfig.maxIterations || 1)) {
        // Check loop duration
        if (loopConfig.maxDuration && Date.now() - ctx.startTime > loopConfig.maxDuration) {
            yield createEvent('error', { error: 'Loop duration exceeded' });
            break;
        }
        
        // Run iteration hook
        if (loopConfig.onIteration) {
            await loopConfig.onIteration(iteration, ctx);
        }
        
        // Check continue condition
        if (loopConfig.continueCondition) {
            const shouldContinue = await loopConfig.continueCondition(ctx);
            if (!shouldContinue) {
                break;
            }
        }
        
        // Prepare for this iteration
        const iterationMessages = ctx.getHistory();
        const collectedToolCalls: ToolCall[] = [];
        const toolResults: Array<{ id: string; call_id: string; output: string }> = [];
        let hasMessage = false;
        let messageContent = '';
        
        // Update metrics
        executionState.metrics.modelCalls++;
        
        // Determine tool choice for this iteration
        let toolChoice: ModelSettings['tool_choice'];
        if (toolChoiceStrategy) {
            toolChoice = toolChoiceStrategy(
                ctx.toolCallCount,
                ctx.turnCount,
                toolHandler?.context || ctx
            );
        }
        
        // Create provider and agent
        const provider = getModelProvider(model);
        const requestOptions: BaseRequestOptions = {
            ...baseOptions,
            tools: availableTools,
            modelSettings: {
                ...baseOptions.modelSettings,
                tool_choice: toolChoice
            }
        };
        const agent = new RequestAgent(requestOptions);
        
        // Stream the response
        const stream = provider.createResponseStream(model, iterationMessages, agent as any);
        
        try {
            for await (const event of stream) {
                // Filter events if needed
                if (allowedEvents && !allowedEvents.includes(event.type)) {
                    continue;
                }
                
                // Emit event if handler provided
                if (eventEmitter) {
                    await eventEmitter(event, toolHandler?.context || ctx);
                }
                
                // Always yield events to maintain streaming
                yield event;
                
                // Handle different event types
                switch (event.type) {
                    case 'message_complete':
                        if ('content' in event) {
                            messageContent = event.content;
                            hasMessage = true;
                            ctx.addMessage({
                                type: 'message',
                                role: 'assistant',
                                content: event.content,
                                status: 'completed'
                            });
                        }
                        break;
                    
                    case 'tool_start':
                        if ('tool_calls' in event && event.tool_calls) {
                            // Process each tool call
                            for (const toolCall of event.tool_calls) {
                                // Check tool execution limits
                                const tool = availableTools.find(
                                    t => t.definition.function.name === toolCall.function.name
                                ) as EnhancedToolFunction;
                                
                                if (tool) {
                                    // Check execution constraints
                                    if (!checkToolConstraints(tool, executionState)) {
                                        toolResults.push({
                                            id: toolCall.id,
                                            call_id: toolCall.call_id || toolCall.id,
                                            output: JSON.stringify({
                                                error: 'Tool execution constraints violated'
                                            })
                                        });
                                        continue;
                                    }
                                    
                                    // Run lifecycle hook
                                    let action = ToolCallAction.EXECUTE;
                                    if (toolHandler?.onToolCall) {
                                        const result = await toolHandler.onToolCall(
                                            toolCall,
                                            toolHandler.context || ctx
                                        );
                                        if (typeof result === 'object' && 'action' in result) {
                                            action = result.action;
                                            if (result.replacement) {
                                                toolResults.push({
                                                    id: toolCall.id,
                                                    call_id: toolCall.call_id || toolCall.id,
                                                    output: typeof result.replacement === 'string'
                                                        ? result.replacement
                                                        : JSON.stringify(result.replacement)
                                                });
                                            }
                                        } else {
                                            action = result;
                                        }
                                    }
                                    
                                    // Execute based on action
                                    switch (action) {
                                        case ToolCallAction.EXECUTE:
                                            collectedToolCalls.push(toolCall);
                                            const result = await executeToolCall(
                                                tool,
                                                toolCall,
                                                toolHandler,
                                                executionState,
                                                ctx
                                            );
                                            toolResults.push(result);
                                            break;
                                        
                                        case ToolCallAction.SKIP:
                                            // Skip this tool call
                                            break;
                                        
                                        case ToolCallAction.HALT:
                                            ctx.halt();
                                            break;
                                        
                                        case ToolCallAction.REPLACE:
                                            // Already handled above
                                            break;
                                    }
                                }
                            }
                        }
                        break;
                    
                    case 'cost_update':
                        if ('usage' in event && event.usage) {
                            executionState.metrics.tokenCount += 
                                (event.usage.input_tokens || 0) + 
                                (event.usage.output_tokens || 0);
                        }
                        break;
                    
                    case 'error':
                        executionState.metrics.errors++;
                        if (loopConfig.breakOnError) {
                            ctx.halt();
                        }
                        break;
                }
                
                // Check if we should halt
                if (ctx.isHalted) {
                    break;
                }
            }
        } catch (error) {
            executionState.metrics.errors++;
            yield createEvent('error', { 
                error: error instanceof Error ? error.message : String(error) 
            });
            
            if (loopConfig.breakOnError) {
                break;
            }
        }
        
        // Add tool messages to history if any
        if (collectedToolCalls.length > 0) {
            // Add empty assistant message if needed
            if (!hasMessage) {
                ctx.addMessage({
                    type: 'message',
                    role: 'assistant',
                    content: '',
                    status: 'completed'
                });
            }
            
            // Add tool call and result messages
            for (const toolCall of collectedToolCalls) {
                ctx.addMessage({
                    type: 'function_call',
                    id: toolCall.id,
                    call_id: toolCall.call_id || toolCall.id,
                    name: toolCall.function.name,
                    arguments: toolCall.function.arguments
                });
                
                const result = toolResults.find(r => 
                    r.call_id === (toolCall.call_id || toolCall.id)
                );
                
                if (result) {
                    // Transform result if needed
                    let output = result.output;
                    if (toolResultTransformer) {
                        if (toolResultTransformer.transform) {
                            output = toolResultTransformer.transform(
                                toolCall.function.name,
                                output,
                                toolHandler?.context || ctx
                            );
                        }
                        if (toolResultTransformer.augment) {
                            output = toolResultTransformer.augment(
                                toolCall.function.name,
                                output,
                                executionState.metrics
                            );
                        }
                        if (toolResultTransformer.format) {
                            output = toolResultTransformer.format(
                                toolCall.function.name,
                                output
                            );
                        }
                    }
                    
                    ctx.addMessage({
                        type: 'function_call_output',
                        id: toolCall.id,
                        call_id: toolCall.call_id || toolCall.id,
                        name: toolCall.function.name,
                        output: typeof output === 'string' ? output : JSON.stringify(output)
                    });
                }
            }
            
            // Update counters
            ctx.toolCallCount += collectedToolCalls.length;
            executionState.metrics.toolCallCount += collectedToolCalls.length;
        }
        
        // Check tool call limits
        if (maxToolCallsPerTurn && collectedToolCalls.length >= maxToolCallsPerTurn) {
            ctx.turnCount++;
        }
        
        if (ctx.toolCallCount >= maxToolCalls) {
            yield createEvent('error', { 
                error: `Maximum tool calls (${maxToolCalls}) reached` 
            });
            break;
        }
        
        // Run stream complete handler
        if (onStreamComplete) {
            const shouldContinue = await onStreamComplete(
                { messageContent, toolCalls: collectedToolCalls },
                toolHandler?.context || ctx
            );
            if (!shouldContinue) {
                break;
            }
        }
        
        // No tool calls and not in loop mode, we're done
        if (collectedToolCalls.length === 0 && !loop) {
            break;
        }
        
        iteration++;
    }
    
    // Calculate final metrics
    executionState.metrics.duration = Date.now() - executionState.metrics.timestamp;
    
    // Emit final metrics if debug enabled
    if (debug && (typeof debug === 'object' ? debug.logMetrics : true)) {
        yield createEvent('system_update', { 
            type: 'metrics',
            data: executionState.metrics 
        });
    }
    
    // Emit stream end
    yield createEvent('stream_end', {});
}

/**
 * Execute a tool call with error handling and lifecycle hooks
 */
async function executeToolCall(
    tool: EnhancedToolFunction,
    toolCall: ToolCall,
    toolHandler: EnhancedRequestOptions['toolHandler'],
    executionState: ToolExecutionState,
    ctx: RequestContext
): Promise<{ id: string; call_id: string; output: string }> {
    const startTime = Date.now();
    
    try {
        // Parse arguments
        const args = toolCall.function.arguments 
            ? JSON.parse(toolCall.function.arguments)
            : {};
        
        // Check cache if enabled
        const cacheKey = `${tool.definition.function.name}:${JSON.stringify(args)}`;
        if (executionState.cache.has(cacheKey)) {
            return {
                id: toolCall.id,
                call_id: toolCall.call_id || toolCall.id,
                output: executionState.cache.get(cacheKey)
            };
        }
        
        // Execute the tool
        let result: any;
        if (toolHandler?.executor) {
            result = await toolHandler.executor(
                tool,
                args,
                toolHandler.context || ctx
            );
        } else if ('function' in tool) {
            result = await tool.function(args);
        } else {
            throw new Error('No executor available for tool');
        }
        
        // Update execution tracking
        executionState.executions.set(
            tool.definition.function.name,
            (executionState.executions.get(tool.definition.function.name) || 0) + 1
        );
        executionState.lastExecution.set(
            tool.definition.function.name,
            Date.now()
        );
        
        // Cache result if enabled
        if (executionState.cache) {
            executionState.cache.set(cacheKey, result);
        }
        
        // Run completion hook
        if (toolHandler?.onToolComplete) {
            await toolHandler.onToolComplete(
                toolCall,
                result,
                toolHandler.context || ctx
            );
        }
        
        return {
            id: toolCall.id,
            call_id: toolCall.call_id || toolCall.id,
            output: typeof result === 'string' ? result : JSON.stringify(result)
        };
        
    } catch (error) {
        // Run error hook
        if (toolHandler?.onToolError) {
            const errorResult = await toolHandler.onToolError(
                toolCall,
                error as Error,
                toolHandler.context || ctx
            );
            
            if (errorResult !== undefined) {
                return {
                    id: toolCall.id,
                    call_id: toolCall.call_id || toolCall.id,
                    output: typeof errorResult === 'string' 
                        ? errorResult 
                        : JSON.stringify(errorResult)
                };
            }
        }
        
        // Default error handling
        return {
            id: toolCall.id,
            call_id: toolCall.call_id || toolCall.id,
            output: JSON.stringify({
                error: `Tool execution failed: ${error instanceof Error ? error.message : String(error)}`
            })
        };
    }
}

/**
 * Check if tool execution constraints are satisfied
 */
function checkToolConstraints(
    tool: EnhancedToolFunction,
    state: ToolExecutionState
): boolean {
    // Check max executions
    if (tool.maxExecutions) {
        const execCount = state.executions.get(tool.definition.function.name) || 0;
        if (execCount >= tool.maxExecutions) {
            return false;
        }
    }
    
    // Check cooldown
    if (tool.cooldown) {
        const lastExec = state.lastExecution.get(tool.definition.function.name);
        if (lastExec && Date.now() - lastExec < tool.cooldown) {
            return false;
        }
    }
    
    return true;
}

/**
 * Create a stream event
 */
function createEvent(type: string, data: any): EnsembleStreamEvent {
    return {
        type: type as any,
        timestamp: new Date().toISOString(),
        ...data
    } as EnsembleStreamEvent;
}