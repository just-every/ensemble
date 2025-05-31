// Export all types
export * from './types.js';

// Export specific functions from model_providers to avoid conflicts
export {
    getModelProvider,
    getProviderFromModel,
    getModelFromClass,
    isProviderKeyValid,
    ModelProvider, // This is the extended interface from model_provider.ts
    EmbedOpts
} from './model_providers/model_provider.js';

// Export external model registration functions
export {
    registerExternalModel,
    getExternalModel,
    getAllExternalModels,
    getExternalProvider,
    isExternalModel,
    clearExternalRegistrations,
    overrideModelClass,
    getModelClassOverride
} from './external_models.js';

// Export all model data (excluding ModelClassID to avoid conflict)
export {
    MODEL_REGISTRY,
    MODEL_CLASSES,
    findModel,
    ModelProviderID,
    ModelUsage,
    TieredPrice,
    TimeBasedPrice,
    ModelEntry
} from './model_data.js';


// Export individual model providers
export * from './model_providers/claude.js';
export * from './model_providers/openai.js';
export * from './model_providers/openai_chat.js';
export * from './model_providers/deepseek.js';
export * from './model_providers/gemini.js';
export * from './model_providers/grok.js';
export * from './model_providers/openrouter.js';
export * from './model_providers/test_provider.js';

// Export all utils
export * from './utils/async_queue.js';
export * from './utils/communication.js';
export * from './utils/cost_tracker.js';
export * from './utils/delta_buffer.js';
export * from './utils/image_to_text.js';
export * from './utils/image_utils.js';
export * from './utils/llm_logger.js';
export * from './utils/quota_tracker.js';
export { convertStreamToMessages, chainRequests } from './utils/stream_converter.js';
export type { ConversionOptions, ConversionResult } from './utils/stream_converter.js';

import {
    ModelSettings,
    ToolFunction,
    ToolCall,
    ResponseInput,
    ResponseInputFunctionCall,
    ResponseInputFunctionCallOutput,
    EnsembleStreamEvent,
    ModelClassID,
    EnsembleAgent,
} from './types.js';
import {
    getModelProvider,
} from './model_providers/model_provider.js';

/**
 * Options for making requests to LLM providers
 */
export interface RequestOptions {
    /** Unique identifier for the agent making the request */
    agentId?: string;
    /** Array of tools/functions available to the model */
    tools?: ToolFunction[];
    /** Model-specific settings like temperature, max_tokens, etc */
    modelSettings?: ModelSettings;
    /** Model class to use for automatic model selection */
    modelClass?: ModelClassID;
}

/**
 * Options for requestWithTools that includes tool execution
 */
export interface RequestWithToolsOptions extends RequestOptions {
    /** Whether to automatically execute tools (default: true) */
    executeTools?: boolean;
    
    /** Maximum number of tool call rounds (default: 10) */
    maxToolCalls?: number;
    
    /** Handler for tool execution */
    processToolCall?: (toolCalls: ToolCall[]) => Promise<any>;
}

class RequestAgent implements EnsembleAgent {
    agent_id: string;
    modelSettings?: ModelSettings;
    modelClass?: ModelClassID;
    private tools: ToolFunction[];
    constructor(options: RequestOptions) {
        this.agent_id = options.agentId || 'ensemble';
        this.modelSettings = options.modelSettings;
        this.modelClass = options.modelClass;
        this.tools = options.tools || [];
    }
    async getTools(): Promise<ToolFunction[]> {
        return this.tools;
    }
}


/**
 * Make a streaming request to an LLM provider
 * 
 * @param model - The model identifier (e.g., 'gpt-4o', 'claude-3.5-sonnet')
 * @param messages - Array of messages in the conversation
 * @param options - Optional configuration for the request
 * @returns AsyncGenerator yielding streaming events
 * 
 * @example
 * ```typescript
 * // Simple text generation
 * for await (const event of request('gpt-4o-mini', [
 *   { type: 'message', role: 'user', content: 'Hello!', status: 'completed' }
 * ])) {
 *   if (event.type === 'text') {
 *     console.log(event.text);
 *   }
 * }
 * 
 * // With tools
 * const tools = [{
 *   function: async (city: string) => `Weather in ${city}: Sunny, 72°F`,
 *   definition: {
 *     type: 'function',
 *     function: {
 *       name: 'get_weather',
 *       description: 'Get weather for a city',
 *       parameters: {
 *         type: 'object',
 *         properties: {
 *           city: { type: 'string', description: 'City name' }
 *         },
 *         required: ['city']
 *       }
 *     }
 *   }
 * }];
 * 
 * for await (const event of request('claude-3.5-sonnet', messages, { tools })) {
 *   // Handle events
 * }
 * ```
 */
export async function* request(
    model: string,
    messages: ResponseInput,
    options: RequestOptions = {}
): AsyncGenerator<EnsembleStreamEvent> {
    const provider = getModelProvider(model);
    const agent = new RequestAgent(options);

    // Get the stream from the provider
    const stream = provider.createResponseStream(model, messages, agent as any);
    
    // Yield all events from the stream
    for await (const event of stream) {
        yield event;
    }
    
    // Emit stream_end event
    yield { type: 'stream_end', timestamp: new Date().toISOString() } as EnsembleStreamEvent;
}

/**
 * Make a streaming request to an LLM provider with automatic tool execution.
 * This function will automatically execute tools when the model requests them
 * and feed the results back to continue the conversation.
 * 
 * @param model - The model identifier (e.g., 'gpt-4o', 'claude-3.5-sonnet')
 * @param messages - Array of messages in the conversation
 * @param options - Configuration including tools and execution options
 * @returns Promise resolving to the final response text
 * 
 * @example
 * ```typescript
 * const tools = [{
 *   function: async (city: string) => `Weather in ${city}: Sunny, 72°F`,
 *   definition: {
 *     type: 'function',
 *     function: {
 *       name: 'get_weather',
 *       description: 'Get weather for a city',
 *       parameters: {
 *         type: 'object',
 *         properties: {
 *           city: { type: 'string', description: 'City name' }
 *         },
 *         required: ['city']
 *       }
 *     }
 *   }
 * }];
 * 
 * const response = await requestWithTools('claude-3.5-sonnet', [
 *   { type: 'message', role: 'user', content: 'What\'s the weather in Paris?' }
 * ], { tools });
 * 
 * console.log(response); // "Based on the current weather data, Paris is experiencing sunny weather with a temperature of 72°F..."
 * ```
 */
export async function requestWithTools(
    model: string,
    messages: ResponseInput,
    options: RequestWithToolsOptions = {}
): Promise<string> {
    const {
        executeTools = true,
        maxToolCalls = 10,
        processToolCall,
        ...requestOptions
    } = options;
    
    let fullResponse = '';
    let currentMessages = [...messages];
    let toolCallCount = 0;
    
    // Main loop for handling tool calls
    while (true) {
        const collectedToolCalls: ToolCall[] = [];
        const toolResults: Array<{ id: string; call_id: string; output: string }> = [];
        let hasMessage = false;
        
        // Stream the response
        const stream = request(model, currentMessages, requestOptions);
        
        for await (const event of stream) {
            switch (event.type) {
                case 'message_complete': {
                    const messageEvent = event as any;
                    
                    if (messageEvent.content) {
                        fullResponse = messageEvent.content;
                        hasMessage = true;
                        
                        // Add assistant message to history
                        currentMessages.push({
                            type: 'message',
                            role: 'assistant',
                            content: messageEvent.content,
                            status: 'completed',
                        });
                    }
                    break;
                }
                
                case 'tool_start': {
                    if (!executeTools) continue;
                    
                    const toolEvent = event as any;
                    if (!toolEvent.tool_calls || toolEvent.tool_calls.length === 0) {
                        continue;
                    }
                    
                    // Collect tool calls
                    collectedToolCalls.push(...toolEvent.tool_calls);
                    
                    // Execute tools if handler provided
                    if (processToolCall) {
                        try {
                            const results = await processToolCall(toolEvent.tool_calls);
                            
                            // Convert results to array format
                            const resultsArray = Array.isArray(results) 
                                ? results 
                                : [results];
                            
                            // Store results
                            for (let i = 0; i < toolEvent.tool_calls.length; i++) {
                                const toolCall = toolEvent.tool_calls[i];
                                const result = resultsArray[i] || resultsArray[0];
                                
                                toolResults.push({
                                    id: toolCall.id,
                                    call_id: toolCall.call_id || toolCall.id,
                                    output: typeof result === 'string' 
                                        ? result 
                                        : JSON.stringify(result),
                                });
                            }
                        } catch (error) {
                            // Handle tool execution errors
                            const errorResult = {
                                error: `Tool execution failed: ${error instanceof Error ? error.message : String(error)}`,
                            };
                            
                            for (const toolCall of toolEvent.tool_calls) {
                                toolResults.push({
                                    id: toolCall.id,
                                    call_id: toolCall.call_id || toolCall.id,
                                    output: JSON.stringify(errorResult),
                                });
                            }
                        }
                    } else if (options.tools) {
                        // Execute tools from the tools array
                        for (const toolCall of toolEvent.tool_calls) {
                            const tool = options.tools.find(
                                t => t.definition.function.name === toolCall.function.name
                            );
                            
                            if (tool) {
                                try {
                                    // Parse arguments
                                    const args = toolCall.function.arguments 
                                        ? JSON.parse(toolCall.function.arguments)
                                        : {};
                                    
                                    // Execute the tool
                                    const result = await tool.function(args);
                                    
                                    toolResults.push({
                                        id: toolCall.id,
                                        call_id: toolCall.call_id || toolCall.id,
                                        output: typeof result === 'string' 
                                            ? result 
                                            : JSON.stringify(result),
                                    });
                                } catch (error) {
                                    toolResults.push({
                                        id: toolCall.id,
                                        call_id: toolCall.call_id || toolCall.id,
                                        output: JSON.stringify({
                                            error: `Tool execution failed: ${error instanceof Error ? error.message : String(error)}`,
                                        }),
                                    });
                                }
                            } else {
                                toolResults.push({
                                    id: toolCall.id,
                                    call_id: toolCall.call_id || toolCall.id,
                                    output: JSON.stringify({
                                        error: `Tool ${toolCall.function.name} not found`,
                                    }),
                                });
                            }
                        }
                    }
                    break;
                }
            }
        }
        
        // If no tool calls were made, we're done
        if (collectedToolCalls.length === 0 || !executeTools) {
            break;
        }
        
        // Check if we've hit the max tool calls limit
        toolCallCount++;
        if (toolCallCount >= maxToolCalls) {
            console.warn(`[requestWithTools] Reached maximum tool calls limit (${maxToolCalls})`);
            
            // Force a final response without tools
            const finalOptions = {
                ...requestOptions,
                modelSettings: {
                    ...requestOptions.modelSettings,
                    tool_choice: 'none' as const,
                },
            };
            
            const finalStream = request(model, currentMessages, finalOptions);
            
            for await (const event of finalStream) {
                if (event.type === 'message_complete') {
                    const messageEvent = event as any;
                    if (messageEvent.content) {
                        fullResponse = messageEvent.content;
                    }
                }
            }
            break;
        }
        
        // Add tool calls and results to the message history
        for (const toolCall of collectedToolCalls) {
            // Add function call
            currentMessages.push({
                type: 'function_call',
                id: toolCall.id,
                call_id: toolCall.call_id || toolCall.id,
                name: toolCall.function.name,
                arguments: toolCall.function.arguments,
            });
            
            // Add function result
            const result = toolResults.find(r => 
                r.call_id === (toolCall.call_id || toolCall.id)
            );
            
            if (result) {
                currentMessages.push({
                    type: 'function_call_output',
                    id: toolCall.id,
                    call_id: toolCall.call_id || toolCall.id,
                    name: toolCall.function.name,
                    output: result.output,
                });
            }
        }
        
        // Continue the conversation with tool results
        // The loop will make another request with the updated message history
    }
    
    return fullResponse;
}

