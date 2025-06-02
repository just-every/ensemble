/**
 * Examples of enhanced tool handling for different use cases
 */

import { request, RequestOptions } from '../index.js';
import { 
    createRequestContext, 
    ToolCallAction,
    EnhancedToolFunction 
} from '../types/tool_types.js';

/**
 * MAGI Integration Example
 * Agent-centric tool handling with lifecycle hooks
 */
export async function magiIntegration(agent: any, messages: any[], handlers: any) {
    const { sendComms, allowedEvents, processToolCall } = handlers;
    
    const stream = request(agent.selectedModel, messages, {
        // Tool handler with agent context
        toolHandler: {
            context: agent,
            
            // Custom executor using existing processToolCall
            executor: async (tool, args, context) => {
                return processToolCall(
                    { tool_calls: [{ function: tool, args }] },
                    context,
                    handlers
                );
            },
            
            // Lifecycle hooks for status updates
            onToolCall: async (toolCall, context) => {
                sendComms({
                    type: 'agent_status',
                    agent_id: context.agent_id,
                    status: 'tool_start',
                    meta_data: { 
                        name: toolCall.function.name,
                        args: toolCall.function.arguments 
                    }
                });
                
                // Check if tool should be executed
                if (toolCall.function.name === 'dangerous_operation' && !context.allowDangerous) {
                    return ToolCallAction.SKIP;
                }
                
                return ToolCallAction.EXECUTE;
            },
            
            onToolComplete: async (toolCall, result, context) => {
                sendComms({
                    type: 'agent_status',
                    agent_id: context.agent_id,
                    status: 'tool_done',
                    meta_data: { 
                        name: toolCall.function.name,
                        result: typeof result === 'string' ? result : JSON.stringify(result)
                    }
                });
            },
            
            onToolError: async (toolCall, error, context) => {
                sendComms({
                    type: 'agent_status',
                    agent_id: context.agent_id,
                    status: 'tool_error',
                    meta_data: { 
                        name: toolCall.function.name,
                        error: error.message 
                    }
                });
                
                // Return custom error message for the model
                return `Tool ${toolCall.function.name} failed: ${error.message}. Please try a different approach.`;
            },
            
            errorStrategy: 'retry',
            retryConfig: {
                maxAttempts: 3,
                backoff: 'exponential',
                initialDelay: 1000
            }
        },
        
        // Tool limits from agent config
        maxToolCallsPerTurn: agent.maxToolCallRoundsPerTurn || 5,
        maxToolCalls: agent.maxToolCalls || 20,
        
        // Dynamic tool choice strategy
        toolChoiceStrategy: (callCount, turnCount, context) => {
            // First call: let agent choose
            if (callCount === 0) {
                return context.modelSettings?.tool_choice || 'auto';
            }
            
            // Approaching limits: restrict tool use
            if (callCount >= context.maxToolCalls - 2) {
                return 'none';
            }
            
            // After multiple turns: be more selective
            if (turnCount > 3) {
                return 'auto';
            }
            
            return 'auto';
        },
        
        // Filter events for MAGI
        allowedEvents: allowedEvents,
        
        // Custom event emitter
        eventEmitter: async (event, context) => {
            // Send all allowed events through comms
            if (allowedEvents.includes(event.type)) {
                sendComms(event);
            }
            
            // Track specific events
            if (event.type === 'tool_start') {
                context.activeTools = (context.activeTools || 0) + 1;
            } else if (event.type === 'tool_done') {
                context.activeTools = Math.max(0, (context.activeTools || 1) - 1);
            }
        },
        
        // Tool filtering by agent capabilities
        toolFilter: (tool) => {
            const enhancedTool = tool as EnhancedToolFunction;
            
            // Filter by agent ID if specified
            if (enhancedTool.agentId && enhancedTool.agentId !== agent.agent_id) {
                return false;
            }
            
            // Check required context
            if (enhancedTool.requiresContext) {
                for (const field of enhancedTool.requiresContext) {
                    if (!agent[field]) {
                        return false;
                    }
                }
            }
            
            return true;
        },
        
        // Parallel execution for independent tools
        parallelExecution: 3,
        
        // Cache results for idempotent tools
        cacheToolResults: true,
        
        // Debug configuration
        debug: {
            logToolCalls: true,
            logToolResults: false,
            logMessages: false,
            logMetrics: true
        }
    });
    
    return stream;
}

/**
 * MECH Integration Example
 * Control-flow oriented with loop management
 */
export async function mechIntegration(model: string, messages: any[], config: any) {
    const context = createRequestContext({
        metadata: {
            taskId: config.taskId,
            startTime: Date.now()
        }
    });
    
    const controlTools: EnhancedToolFunction[] = [
        {
            definition: {
                type: 'function',
                function: {
                    name: 'task_complete',
                    description: 'Mark the current task as complete',
                    parameters: {
                        type: 'object',
                        properties: {
                            result: { type: 'string', description: 'Task result' },
                            confidence: { type: 'number', description: 'Confidence score 0-1' }
                        },
                        required: ['result']
                    }
                }
            },
            function: async ({ result, confidence }) => {
                context.setMetadata('outcome', {
                    status: 'complete',
                    result,
                    confidence: confidence || 1.0,
                    duration: Date.now() - context.startTime
                });
                context.halt();
                return `Task completed: ${result}`;
            },
            category: 'control',
            priority: 1,
            sideEffects: true
        },
        {
            definition: {
                type: 'function',
                function: {
                    name: 'task_fatal_error',
                    description: 'Report a fatal error that prevents task completion',
                    parameters: {
                        type: 'object',
                        properties: {
                            error: { type: 'string', description: 'Error description' },
                            context: { type: 'string', description: 'Error context' }
                        },
                        required: ['error']
                    }
                }
            },
            function: async ({ error, context: errorContext }) => {
                context.setMetadata('outcome', {
                    status: 'error',
                    error,
                    context: errorContext,
                    duration: Date.now() - context.startTime
                });
                context.halt();
                return `Fatal error reported: ${error}`;
            },
            category: 'control',
            priority: 1,
            sideEffects: true
        },
        {
            definition: {
                type: 'function',
                function: {
                    name: 'request_clarification',
                    description: 'Request clarification from the user',
                    parameters: {
                        type: 'object',
                        properties: {
                            question: { type: 'string', description: 'Clarification question' },
                            options: { 
                                type: 'array', 
                                items: { type: 'string' },
                                description: 'Suggested options'
                            }
                        },
                        required: ['question']
                    }
                }
            },
            function: async ({ question, options }) => {
                context.setMetadata('pendingClarification', { question, options });
                context.pause();
                return 'Clarification requested. Waiting for user response.';
            },
            category: 'control',
            priority: 2
        }
    ];
    
    const stream = request(model, messages, {
        // Add control tools to existing tools
        tools: [...controlTools, ...(config.tools || [])],
        
        // Tool handler for MECH-specific behavior
        toolHandler: {
            context: context,
            
            onToolComplete: async (toolCall, result, ctx) => {
                // Track tool metrics
                const metrics = ctx.getMetadata('toolMetrics') || {};
                metrics[toolCall.function.name] = (metrics[toolCall.function.name] || 0) + 1;
                ctx.setMetadata('toolMetrics', metrics);
                
                // Special handling for control tools
                if (['task_complete', 'task_fatal_error'].includes(toolCall.function.name)) {
                    console.log(`Task outcome: ${toolCall.function.name}`, result);
                }
            },
            
            executionMode: 'sequential', // Control tools should run in order
            errorStrategy: 'return-error' // Let the model handle errors
        },
        
        // Loop configuration for iterative refinement
        loop: {
            maxIterations: config.maxIterations || 100,
            maxDuration: config.maxDuration || 300000, // 5 minutes
            
            continueCondition: (ctx) => {
                // Stop if outcome is set
                if (ctx.getMetadata('outcome')) {
                    return false;
                }
                
                // Stop if paused for clarification
                if (ctx.isPaused) {
                    return false;
                }
                
                // Continue otherwise
                return true;
            },
            
            onIteration: async (iteration, ctx) => {
                // Run meta-cognition every N iterations
                if (config.metaCognition && iteration % config.metaCognitionInterval === 0) {
                    await runMetaCognition(ctx, config);
                }
                
                // Check for stuck detection
                const toolMetrics = ctx.getMetadata('toolMetrics') || {};
                const recentTools = Object.entries(toolMetrics)
                    .filter(([name, count]) => count > 5)
                    .map(([name]) => name);
                    
                if (recentTools.length > 0) {
                    console.warn('Potential stuck pattern detected:', recentTools);
                    
                    // Add guidance message
                    ctx.addMessage({
                        type: 'message',
                        role: 'system',
                        content: `You seem to be repeatedly using ${recentTools.join(', ')}. Consider trying a different approach or marking the task as complete/failed if you cannot make progress.`
                    });
                }
            },
            
            breakOnError: false // Continue on errors
        },
        
        // Tool categories for MECH
        toolCategories: ['control', 'utility', 'meta'],
        
        // Result transformation for metrics
        toolResultTransformer: {
            augment: (toolName, result, metrics) => {
                // Add metrics to control tool outputs
                if (['task_complete', 'task_fatal_error'].includes(toolName)) {
                    const formattedMetrics = `
=== EXECUTION METRICS ===
Duration: ${metrics.duration}ms
Tool Calls: ${metrics.toolCallCount}
Model Calls: ${metrics.modelCalls}
Errors: ${metrics.errors}
Token Count: ${metrics.tokenCount}
`;
                    return result + formattedMetrics;
                }
                return result;
            },
            
            validate: (toolName, result) => {
                // Validate control tool outputs
                if (toolName === 'task_complete') {
                    try {
                        const parsed = typeof result === 'string' ? result : JSON.stringify(result);
                        return parsed.length > 0;
                    } catch {
                        return false;
                    }
                }
                return true;
            }
        },
        
        // Dynamic tool choice based on context
        toolChoiceStrategy: (callCount, turnCount, ctx) => {
            // First few calls: explore with tools
            if (callCount < 3) {
                return 'auto';
            }
            
            // After many calls: encourage completion
            if (callCount > 10) {
                return {
                    type: 'function',
                    function: { name: 'task_complete' }
                };
            }
            
            // If stuck, suggest clarification
            const toolMetrics = ctx.getMetadata('toolMetrics') || {};
            const totalCalls = Object.values(toolMetrics).reduce((a, b) => a + b, 0);
            if (totalCalls > 20 && !ctx.getMetadata('clarificationRequested')) {
                ctx.setMetadata('clarificationRequested', true);
                return {
                    type: 'function',
                    function: { name: 'request_clarification' }
                };
            }
            
            return 'auto';
        },
        
        // Stream completion handler
        onStreamComplete: async (response, ctx) => {
            // Check if task is complete
            if (ctx.getMetadata('outcome')) {
                return false; // Stop iteration
            }
            
            // Check for empty responses
            if (!response.messageContent && response.toolCalls.length === 0) {
                ctx.setMetadata('emptyResponses', (ctx.getMetadata('emptyResponses') || 0) + 1);
                
                if (ctx.getMetadata('emptyResponses') > 3) {
                    console.warn('Multiple empty responses detected');
                    return false; // Stop iteration
                }
            }
            
            return true; // Continue
        }
    }, context);
    
    return { stream, context };
}

/**
 * Meta-cognition helper for MECH
 */
async function runMetaCognition(context: any, config: any) {
    const history = context.getHistory();
    const toolMetrics = context.getMetadata('toolMetrics') || {};
    
    // Analyze recent messages and tool usage
    const recentMessages = history.slice(-10);
    const analysis = {
        messageCount: recentMessages.length,
        toolUsage: toolMetrics,
        duration: Date.now() - context.startTime,
        hasProgress: recentMessages.some(m => 
            m.type === 'function_call_output' && 
            !m.output.includes('error')
        )
    };
    
    // Add meta-cognition prompt
    context.addMessage({
        type: 'message',
        role: 'system',
        content: `META-COGNITION CHECK:
- Messages processed: ${analysis.messageCount}
- Tools used: ${Object.entries(analysis.toolUsage).map(([k,v]) => `${k}(${v})`).join(', ')}
- Time elapsed: ${Math.round(analysis.duration / 1000)}s
- Progress detected: ${analysis.hasProgress ? 'Yes' : 'No'}

Please assess your progress and adjust your approach if needed. Consider:
1. Are you making meaningful progress toward the goal?
2. Are you stuck in a loop or pattern?
3. Do you need clarification or additional tools?
4. Is it time to complete the task or report an error?`
    });
}

/**
 * Simple example with minimal configuration
 */
export async function simpleExample() {
    const messages = [
        {
            type: 'message',
            role: 'user',
            content: 'Calculate the weather forecast for next week'
        }
    ];
    
    const tools = [
        {
            definition: {
                type: 'function',
                function: {
                    name: 'get_weather',
                    description: 'Get weather forecast',
                    parameters: {
                        type: 'object',
                        properties: {
                            location: { type: 'string' },
                            days: { type: 'number' }
                        },
                        required: ['location', 'days']
                    }
                }
            },
            function: async ({ location, days }) => {
                // Simulate weather API call
                return `Weather forecast for ${location} (${days} days): Sunny with occasional clouds`;
            }
        }
    ];
    
    const stream = request('gpt-4o-mini', messages, {
        tools,
        toolHandler: {
            onToolCall: async (toolCall) => {
                console.log('Calling tool:', toolCall.function.name);
                return ToolCallAction.EXECUTE;
            },
            onToolComplete: async (toolCall, result) => {
                console.log('Tool completed:', toolCall.function.name, result);
            }
        },
        maxToolCalls: 5
    });
    
    // Process the stream
    for await (const event of stream) {
        if (event.type === 'message_delta') {
            process.stdout.write(event.content);
        } else if (event.type === 'tool_start') {
            console.log('\n[Tool Call]', event.tool_calls[0].function.name);
        }
    }
}