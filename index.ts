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

// Export OpenAI compatibility layer
export { chat, completions, responses, default as OpenAIEnsemble } from './openai-compat.js';
export type {
    ResponsesCreateParams,
    ResponsesCreateResponse,
    ResponsesCreateChunk
} from './openai-compat.js';

// Re-export OpenAI types from our compatibility layer
export type {
    ChatCompletion,
    ChatCompletionChunk,
    ChatCompletionCreateParams,
    OpenAIMessage,
    OpenAITool,
    CompletionCreateParams
} from './openai-compat.js';

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
export * from './utils/stream_converter.js';
export * from './utils/delta_buffer.js';
export * from './utils/cost_tracker.js';
export * from './utils/quota_tracker.js';
export * from './utils/image_utils.js';
export * from './utils/llm_logger.js';

// Re-export singleton instances
import { costTracker as _costTracker } from './utils/cost_tracker.js';
import { quotaTracker as _quotaTracker } from './utils/quota_tracker.js';
export const costTracker = _costTracker;
export const quotaTracker = _quotaTracker;

// Core API
import type {
    RequestOptions,
    ResponseInput,
    ModelSettings,
    ToolFunction,
    ModelClassID,
    EnsembleAgent,
    EnsembleStreamEvent,
    ToolCall
} from './types.js';
import { getModelProvider, getModelFromClass, type EmbedOpts } from './model_providers/model_provider.js';

// Type guard for tool calls in events
function hasToolCalls(event: any): event is { type: string; tool_calls: ToolCall[] } {
    return event && Array.isArray(event.tool_calls) && event.tool_calls.length > 0;
}

// Type guard for message complete events
function isMessageComplete(event: any): event is { type: 'message_complete'; content: string } {
    return event && event.type === 'message_complete' && typeof event.content === 'string';
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
 * Make a streaming request to an LLM provider with automatic tool execution support
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
 *   { type: 'message', role: 'user', content: 'Hello!' }
 * ])) {
 *   if (event.type === 'text_delta') {
 *     process.stdout.write(event.delta);
 *   }
 * }
 * 
 * // With tools (automatically executed)
 * const tools = [{
 *   function: async ({ city }) => `Weather in ${city}: Sunny, 72°F`,
 *   definition: {
 *     type: 'function',
 *     function: {
 *       name: 'get_weather',
 *       description: 'Get weather for a city',
 *       parameters: {
 *         type: 'object',
 *         properties: {
 *           city: { type: 'string' }
 *         },
 *         required: ['city']
 *       }
 *     }
 *   }
 * }];
 * 
 * for await (const event of request('claude-3.5-sonnet', [
 *   { type: 'message', role: 'user', content: 'What\'s the weather in Paris?' }
 * ], { tools })) {
 *   if (event.type === 'text_delta') {
 *     process.stdout.write(event.delta);
 *   }
 * }
 * 
 * // Disable tool execution
 * for await (const event of request('claude-3.5-sonnet', messages, { 
 *   tools,
 *   maxToolCalls: 0  // Tools sent to model but not executed
 * })) {
 *   // Handle events including tool_start without execution
 * }
 * ```
 */
// Main request function that handles tool execution
export async function* request(
    model: string,
    messages: ResponseInput,
    options: RequestOptions = {}
): AsyncGenerator<EnsembleStreamEvent> {
    const {
        maxToolCalls = 10,
        processToolCall,
        ...requestOptions
    } = options;
    
    let currentMessages = [...messages];
    let toolCallCount = 0;
    
    // Main loop for handling tool calls
    while (true) {
        const collectedToolCalls: ToolCall[] = [];
        const toolResults: Array<{ id: string; call_id: string; output: string }> = [];
        let hasMessage = false;
        let messageContent = '';
        
        // Create provider and agent for this round
        const provider = getModelProvider(model);
        const agent = new RequestAgent(requestOptions);
        
        // Stream the response
        const stream = provider.createResponseStream(model, currentMessages, agent as any);
        
        for await (const event of stream) {
            // Always yield events to maintain streaming behavior
            yield event;
            
            switch (event.type) {
                case 'message_complete': {
                    if (isMessageComplete(event)) {
                        messageContent = event.content;
                        hasMessage = true;
                        
                        // Add assistant message to history
                        currentMessages.push({
                            type: 'message',
                            role: 'assistant',
                            content: event.content,
                            status: 'completed',
                        });
                    }
                    break;
                }
                
                case 'tool_start': {
                    
                    if (hasToolCalls(event)) {
                        // Collect tool calls
                        collectedToolCalls.push(...event.tool_calls);
                        
                        // Execute tools if handler provided
                        if (processToolCall) {
                            try {
                                const results = await processToolCall(event.tool_calls);
                                
                                // Convert results to array format
                                const resultsArray = Array.isArray(results) 
                                    ? results 
                                    : [results];
                                
                                // Store results
                                for (let i = 0; i < event.tool_calls.length; i++) {
                                    const toolCall = event.tool_calls[i];
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
                                
                                for (const toolCall of event.tool_calls) {
                                    toolResults.push({
                                        id: toolCall.id,
                                        call_id: toolCall.call_id || toolCall.id,
                                        output: JSON.stringify(errorResult),
                                    });
                                }
                            }
                        } else if (requestOptions.tools) {
                            // Execute tools from the tools array
                            for (const toolCall of event.tool_calls) {
                                const tool = requestOptions.tools.find(
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
                    }
                    break;
                }
            }
        }
        
        // If no tool calls were made, we're done
        if (collectedToolCalls.length === 0) {
            yield { type: 'stream_end', timestamp: new Date().toISOString() } as EnsembleStreamEvent;
            break;
        }
        
        // Check if we've hit the max tool calls limit
        toolCallCount++;
        if (toolCallCount >= maxToolCalls) {
            yield { 
                type: 'error', 
                error: new Error(`Maximum tool calls (${maxToolCalls}) reached`),
                timestamp: new Date().toISOString() 
            } as EnsembleStreamEvent;
            break;
        }
        
        // Add tool call messages to history
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
}

// Cache to avoid repeated embedding calls for the same text
const embeddingCache = new Map<
    string,
    {
        embedding: number[];
        timestamp: Date;
    }
>();

/**
 * Generate an embedding vector for the given text
 * 
 * @param text - Text to embed
 * @param options - Optional configuration
 * @returns Promise that resolves to a normalized embedding vector
 * 
 * @example
 * ```typescript
 * // Simple embedding
 * const embedding = await embed('Hello, world!');
 * console.log(`Embedding dimension: ${embedding.length}`);
 * 
 * // With specific model
 * const embedding = await embed('Search query', { 
 *   model: 'text-embedding-3-large' 
 * });
 * 
 * // With model class
 * const embedding = await embed('Document text', { 
 *   modelClass: 'embedding' 
 * });
 * ```
 */
export async function embed(
    text: string, 
    options: {
        model?: string;
        modelClass?: ModelClassID;
        agentId?: string;
        opts?: EmbedOpts;
    } = {}
): Promise<number[]> {
    const { 
        model, 
        modelClass = 'embedding', 
        agentId = 'ensemble',
        opts 
    } = options;
    
    // Determine which model to use
    const modelToUse = model || await getModelFromClass(modelClass);
    
    // Use a hash of the text and model as the cache key
    const cacheKey = `${modelToUse}:${text}`;
    
    // Check if we have a cached embedding
    if (embeddingCache.has(cacheKey)) {
        const cached = embeddingCache.get(cacheKey)!;
        return cached.embedding;
    }
    
    // Get the provider for this model
    const provider = getModelProvider(modelToUse);
    
    if (!provider.createEmbedding) {
        throw new Error(
            `Provider for model ${modelToUse} does not support embeddings`
        );
    }
    
    // Generate the embedding using the provider
    const result = await provider.createEmbedding(modelToUse, text, opts);
    
    // Handle array result (single text input should return single vector)
    const embedding = Array.isArray(result[0]) ? result[0] : result as number[];
    
    // Cache the result
    embeddingCache.set(cacheKey, {
        embedding,
        timestamp: new Date(),
    });
    
    return embedding;
}

