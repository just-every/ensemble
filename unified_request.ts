/**
 * Unified request implementation that combines standard and enhanced features
 */

import { 
    EnsembleStreamEvent, 
    ResponseInput, 
    ToolCall,
    RequestOptions as BaseRequestOptions,
    ModelSettings,
    ToolFunction,
    ModelClassID,
    EnsembleAgent
} from './types.js';
import { 
    EnhancedRequestOptions,
    RequestContext,
    createRequestContext,
    ToolCallAction
} from './types/tool_types.js';
import { getModelProvider } from './model_providers/model_provider.js';
import { MessageHistory } from './utils/message_history.js';
import { EnsembleErrorHandler, ErrorCode } from './utils/error_handler.js';

// Track if we're currently executing within a tool to detect recursive calls
let isExecutingTool = false;

// Request agent implementation
class RequestAgent implements EnsembleAgent {
    agent_id: string;
    modelSettings?: ModelSettings;
    modelClass?: ModelClassID;
    private tools: ToolFunction[];
    
    constructor(options: BaseRequestOptions) {
        this.agent_id = options.agentId || 'ensemble';
        this.modelSettings = options.modelSettings;
        this.modelClass = options.modelClass;
        this.tools = options.tools || [];
    }
    
    async getTools(): Promise<ToolFunction[]> {
        return this.tools;
    }
}

// Unified request options that combine base and enhanced features
interface UnifiedRequestOptions extends BaseRequestOptions, Partial<EnhancedRequestOptions> {
    // Simplified options that work for both standard and enhanced modes
    useEnhancedMode?: boolean;  // Explicitly opt into enhanced features
    messageHistory?: MessageHistory;  // Use the new message history manager
    preserveToolChoice?: boolean;  // Explicitly preserve tool_choice in recursive calls
}

/**
 * Unified request function that handles both standard and enhanced modes
 */
export async function* request(
    model: string,
    messages: ResponseInput,
    options: UnifiedRequestOptions = {}
): AsyncGenerator<EnsembleStreamEvent> {
    // Determine if we should use enhanced mode
    const useEnhanced = options.useEnhancedMode || 
        options.toolHandler || 
        options.loop || 
        options.toolCategories ||
        options.toolFilter ||
        options.toolResultTransformer;
    
    // Use message history manager
    const history = options.messageHistory || new MessageHistory(messages, {
        compactToolCalls: true,
        preserveSystemMessages: true
    });
    
    // Create context if using enhanced mode
    const context = useEnhanced ? createRequestContext({
        messages: history.getMessages()
    }) : undefined;
    
    try {
        // Main execution loop
        let iteration = 0;
        const maxIterations = getMaxIterations(options);
        
        while (true) {
            // Check if we should continue
            if (!(await shouldContinue(context, iteration, maxIterations, options))) {
                break;
            }
            
            // Get current messages
            const currentMessages = history.getMessages();
            
            // Execute one round of request/response
            const result = await executeRound(
                model, 
                currentMessages, 
                options, 
                context,
                history,
                iteration
            );
            
            // Yield all events from this round
            for (const event of result.events) {
                yield event;
            }
            
            // Check if we're done
            if (result.done || (!options.loop && !result.hasToolCalls)) {
                break;
            }
            
            iteration++;
        }
        
        // Emit final metrics if debug enabled
        if (options.debug) {
            yield createMetricsEvent(context, history);
        }
        
    } catch (error) {
        // Use unified error handler
        yield EnsembleErrorHandler.toStreamEvent(error);
    } finally {
        // Emit stream end
        yield { 
            type: 'stream_end', 
            timestamp: new Date().toISOString() 
        } as EnsembleStreamEvent;
    }
}

/**
 * Execute one round of request/response
 */
async function executeRound(
    model: string,
    messages: ResponseInput,
    options: UnifiedRequestOptions,
    context: RequestContext | undefined,
    history: MessageHistory,
    iteration: number
): Promise<{ events: EnsembleStreamEvent[], done: boolean, hasToolCalls: boolean }> {
    const events: EnsembleStreamEvent[] = [];
    const collectedToolCalls: ToolCall[] = [];
    const toolResults: Array<{ id: string; call_id: string; output: string }> = [];
    let messageContent = '';
    let hasMessage = false;
    
    // Create provider and agent with fresh settings
    const provider = getModelProvider(model);
    
    // Create a copy of options to avoid mutating the original
    const roundOptions = { ...options };
    
    // Clear tool_choice in these scenarios to prevent infinite loops:
    // 1. After the first iteration of a multi-turn conversation (iteration > 0)
    // 2. When inside a tool execution (recursive call) unless explicitly preserved
    // 3. Never clear if using a dynamic toolChoiceStrategy
    const isRecursiveCall = isExecutingTool && !options.preserveToolChoice;
    const shouldClearToolChoice = (iteration > 0 || isRecursiveCall) && !options.toolChoiceStrategy;
    
    if (shouldClearToolChoice && roundOptions.modelSettings?.tool_choice) {
        // Create a new modelSettings object without tool_choice
        roundOptions.modelSettings = { ...roundOptions.modelSettings };
        delete roundOptions.modelSettings.tool_choice;
    }
    
    const agent = new RequestAgent(roundOptions as BaseRequestOptions);
    
    // Apply dynamic tool choice if available
    if (options.toolChoiceStrategy && context) {
        const toolChoice = options.toolChoiceStrategy(
            context.toolCallCount,
            context.turnCount,
            context
        );
        agent.modelSettings = {
            ...agent.modelSettings,
            tool_choice: toolChoice
        };
    }
    
    // Stream the response
    const stream = provider.createResponseStream(model, messages, agent as any);
    
    for await (const event of stream) {
        // Apply event filtering
        if (options.allowedEvents && !options.allowedEvents.includes(event.type)) {
            continue;
        }
        
        // Emit to custom handler if provided
        if (options.eventEmitter) {
            await options.eventEmitter(event, context);
        }
        
        events.push(event);
        
        // Handle different event types
        switch (event.type) {
            case 'message_complete':
                if ('content' in event) {
                    messageContent = event.content;
                    hasMessage = true;
                }
                break;
                
            case 'tool_start':
                if ('tool_calls' in event && event.tool_calls) {
                    // Process tool calls with enhanced features if available
                    const processedCalls = await processToolCalls(
                        event.tool_calls,
                        options,
                        context
                    );
                    
                    collectedToolCalls.push(...processedCalls.calls);
                    toolResults.push(...processedCalls.results);
                }
                break;
                
            case 'error':
                if (context) {
                    context.halt();
                }
                break;
        }
    }
    
    // Update message history
    if (hasMessage || collectedToolCalls.length > 0) {
        history.addAssistantResponse(
            messageContent,
            collectedToolCalls.map((call, i) => ({
                ...call,
                result: toolResults[i]?.output
            }))
        );
    }
    
    // Update context if available
    if (context) {
        context.messages = history.getMessages();
        context.toolCallCount += collectedToolCalls.length;
    }
    
    return {
        events,
        done: context?.isHalted || false,
        hasToolCalls: collectedToolCalls.length > 0
    };
}

/**
 * Process tool calls with enhanced features
 */
async function processToolCalls(
    toolCalls: ToolCall[],
    options: UnifiedRequestOptions,
    context?: RequestContext
): Promise<{ calls: ToolCall[], results: any[] }> {
    const processedCalls: ToolCall[] = [];
    const results: any[] = [];
    
    for (const toolCall of toolCalls) {
        // Apply tool handler lifecycle if available
        if (options.toolHandler?.onToolCall) {
            const action = await options.toolHandler.onToolCall(
                toolCall,
                options.toolHandler.context || context
            );
            
            if (action === ToolCallAction.SKIP) {
                continue;
            }
            
            if (action === ToolCallAction.HALT && context) {
                context.halt();
                break;
            }
        }
        
        processedCalls.push(toolCall);
        
        // Execute tool
        try {
            let result: any;
            
            if (options.processToolCall) {
                // Use legacy processToolCall
                isExecutingTool = true;
                try {
                    result = await options.processToolCall([toolCall]);
                } finally {
                    isExecutingTool = false;
                }
            } else if (options.toolHandler?.executor) {
                // Use enhanced executor
                const tool = options.tools?.find(
                    t => t.definition.function.name === toolCall.function.name
                );
                if (tool) {
                    isExecutingTool = true;
                    try {
                        result = await options.toolHandler.executor(
                            tool,
                            JSON.parse(toolCall.function.arguments || '{}'),
                            options.toolHandler.context || context
                        );
                    } finally {
                        isExecutingTool = false;
                    }
                }
            } else if (options.tools) {
                // Standard tool execution
                const tool = options.tools.find(
                    t => t.definition.function.name === toolCall.function.name
                );
                if (tool && 'function' in tool) {
                    result = await tool.function(
                        JSON.parse(toolCall.function.arguments || '{}')
                    );
                }
            }
            
            // Apply result transformation
            if (result !== undefined && options.toolResultTransformer?.transform) {
                result = options.toolResultTransformer.transform(
                    toolCall.function.name,
                    result,
                    options.toolHandler?.context || context
                );
            }
            
            // Auto-stringify tool results with proper handling
            let output: string;
            if (typeof result === 'string') {
                output = result;
            } else if (result === undefined) {
                output = 'undefined';
            } else if (result === null) {
                output = 'null';
            } else if (typeof result === 'object') {
                // Pretty-print objects for readability
                output = JSON.stringify(result, null, 2);
            } else {
                output = String(result);
            }
            
            results.push({
                id: toolCall.id,
                call_id: toolCall.call_id || toolCall.id,
                output
            });
            
            // Call completion hook
            if (options.toolHandler?.onToolComplete) {
                await options.toolHandler.onToolComplete(
                    toolCall,
                    result,
                    options.toolHandler.context || context
                );
            }
            
        } catch (error) {
            // Handle tool error
            let errorResult = `Tool execution failed: ${error}`;
            
            if (options.toolHandler?.onToolError) {
                errorResult = await options.toolHandler.onToolError(
                    toolCall,
                    error as Error,
                    options.toolHandler.context || context
                ) || errorResult;
            }
            
            results.push({
                id: toolCall.id,
                call_id: toolCall.call_id || toolCall.id,
                output: errorResult
            });
        }
    }
    
    return { calls: processedCalls, results };
}

/**
 * Helper functions
 */
async function shouldContinue(
    context: RequestContext | undefined,
    iteration: number,
    maxIterations: number,
    options: UnifiedRequestOptions
): Promise<boolean> {
    if (context?.isHalted) return false;
    if (iteration >= maxIterations) return false;
    
    if (options.loop && typeof options.loop === 'object' && options.loop.continueCondition) {
        return await Promise.resolve(options.loop.continueCondition(context!));
    }
    
    return true;
}

function getMaxIterations(options: UnifiedRequestOptions): number {
    if (!options.loop) return 1;
    if (typeof options.loop === 'boolean') return options.loop ? Infinity : 1;
    return options.loop.maxIterations || Infinity;
}

function createMetricsEvent(
    context: RequestContext | undefined,
    history: MessageHistory
): EnsembleStreamEvent {
    return {
        type: 'system_update',
        data: {
            type: 'metrics',
            messageCount: history.count(),
            toolCallCount: context?.toolCallCount || 0,
            duration: context ? Date.now() - context.startTime : 0,
            summary: history.getSummary()
        },
        timestamp: new Date().toISOString()
    } as EnsembleStreamEvent;
}

// Export RequestAgent and UnifiedRequestOptions
export { RequestAgent, UnifiedRequestOptions };