/**
 * OpenAI API Compatibility Layer
 * 
 * Provides drop-in replacements for OpenAI's chat.completions.create and
 * completions.create methods, allowing easy migration from OpenAI SDK to ensemble.
 */

import { request } from './index.js';
import type { 
    ResponseInput, 
    EnsembleStreamEvent,
    ToolFunction,
    ModelSettings 
} from './types.js';

/**
 * OpenAI-compatible message format
 */
export interface OpenAIMessage {
    role: 'system' | 'user' | 'assistant' | 'function' | 'tool';
    content: string | null;
    name?: string;
    function_call?: {
        name: string;
        arguments: string;
    };
    tool_calls?: Array<{
        id: string;
        type: 'function';
        function: {
            name: string;
            arguments: string;
        };
    }>;
}

/**
 * OpenAI-compatible tool/function format
 */
export interface OpenAITool {
    type: 'function';
    function: {
        name: string;
        description?: string;
        parameters?: any;
    };
}

/**
 * OpenAI chat completion parameters
 */
export interface ChatCompletionCreateParams {
    messages: OpenAIMessage[];
    model: string;
    temperature?: number;
    top_p?: number;
    n?: number;
    stream?: boolean;
    stop?: string | string[];
    max_tokens?: number;
    presence_penalty?: number;
    frequency_penalty?: number;
    logit_bias?: Record<string, number>;
    user?: string;
    response_format?: { type: 'json_object' | 'text' };
    seed?: number;
    tools?: OpenAITool[];
    tool_choice?: 'none' | 'auto' | 'required' | { type: 'function'; function: { name: string } };
    logprobs?: boolean;
    top_logprobs?: number;
}

/**
 * OpenAI legacy completion parameters
 */
export interface CompletionCreateParams {
    model: string;
    prompt: string | string[];
    suffix?: string;
    max_tokens?: number;
    temperature?: number;
    top_p?: number;
    n?: number;
    stream?: boolean;
    logprobs?: number;
    echo?: boolean;
    stop?: string | string[];
    presence_penalty?: number;
    frequency_penalty?: number;
    best_of?: number;
    logit_bias?: Record<string, number>;
    user?: string;
}

/**
 * OpenAI-compatible response format
 */
export interface ChatCompletionResponse {
    id: string;
    object: 'chat.completion';
    created: number;
    model: string;
    choices: Array<{
        index: number;
        message: {
            role: 'assistant';
            content: string | null;
            tool_calls?: Array<{
                id: string;
                type: 'function';
                function: {
                    name: string;
                    arguments: string;
                };
            }>;
        };
        logprobs?: any;
        finish_reason: 'stop' | 'length' | 'tool_calls' | 'content_filter' | 'function_call';
    }>;
    usage?: {
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
    };
}

/**
 * OpenAI-compatible streaming chunk
 */
export interface ChatCompletionChunk {
    id: string;
    object: 'chat.completion.chunk';
    created: number;
    model: string;
    choices: Array<{
        index: number;
        delta: {
            role?: 'assistant';
            content?: string | null;
            tool_calls?: Array<{
                index: number;
                id?: string;
                type?: 'function';
                function?: {
                    name?: string;
                    arguments?: string;
                };
            }>;
        };
        logprobs?: any;
        finish_reason?: 'stop' | 'length' | 'tool_calls' | 'content_filter' | 'function_call' | null;
    }>;
}

/**
 * Convert OpenAI messages to ensemble format
 */
function convertMessages(messages: OpenAIMessage[]): ResponseInput {
    return messages.map(msg => {
        // Handle role mapping
        let role: 'user' | 'assistant' | 'developer';
        if (msg.role === 'system') {
            role = 'developer';
        } else if (msg.role === 'user' || msg.role === 'assistant') {
            role = msg.role;
        } else if (msg.role === 'function' || msg.role === 'tool') {
            // Handle function/tool responses
            return {
                type: 'function_call_output' as const,
                id: msg.name || 'unknown',
                call_id: msg.name || 'unknown',
                name: msg.name || 'unknown',
                output: msg.content || ''
            };
        } else {
            role = 'user'; // Default fallback
        }

        // Handle tool calls in assistant messages
        if (msg.tool_calls && msg.tool_calls.length > 0) {
            // Return multiple messages for tool calls
            const messages: ResponseInput = [];
            
            // Add the assistant message if it has content
            if (msg.content) {
                messages.push({
                    type: 'message' as const,
                    role: 'assistant',
                    content: msg.content,
                    status: 'completed' as const
                });
            }
            
            // Add tool calls
            for (const toolCall of msg.tool_calls) {
                messages.push({
                    type: 'function_call' as const,
                    id: toolCall.id,
                    call_id: toolCall.id,
                    name: toolCall.function.name,
                    arguments: toolCall.function.arguments
                });
            }
            
            return messages;
        }

        // Handle function calls (legacy format)
        if (msg.function_call) {
            return {
                type: 'function_call' as const,
                id: msg.function_call.name,
                call_id: msg.function_call.name,
                name: msg.function_call.name,
                arguments: msg.function_call.arguments
            };
        }

        // Regular message
        return {
            type: 'message' as const,
            role,
            content: msg.content || '',
            status: 'completed' as const
        };
    }).flat(); // Flatten because tool calls might create multiple messages
}

/**
 * Convert OpenAI tools to ensemble format
 */
function convertTools(tools?: OpenAITool[]): ToolFunction[] | undefined {
    if (!tools) return undefined;
    
    return tools.map(tool => ({
        // We don't have the actual function implementation, so we create a placeholder
        function: async (args: any) => {
            throw new Error(`Tool ${tool.function.name} not implemented. Use processToolCall option to handle tool execution.`);
        },
        definition: tool
    }));
}

/**
 * Convert model settings
 */
function convertModelSettings(params: ChatCompletionCreateParams | CompletionCreateParams): ModelSettings {
    const settings: ModelSettings = {};
    
    if ('temperature' in params && params.temperature !== undefined) {
        settings.temperature = params.temperature;
    }
    if ('max_tokens' in params && params.max_tokens !== undefined) {
        settings.maxTokens = params.max_tokens;
    }
    if ('top_p' in params && params.top_p !== undefined) {
        settings.topP = params.top_p;
    }
    if ('stop' in params && params.stop !== undefined) {
        settings.stop = Array.isArray(params.stop) ? params.stop : [params.stop];
    }
    if ('presence_penalty' in params && params.presence_penalty !== undefined) {
        settings.presencePenalty = params.presence_penalty;
    }
    if ('frequency_penalty' in params && params.frequency_penalty !== undefined) {
        settings.frequencyPenalty = params.frequency_penalty;
    }
    if ('seed' in params && params.seed !== undefined) {
        settings.seed = params.seed;
    }
    if ('response_format' in params && params.response_format) {
        settings.responseFormat = params.response_format;
    }
    
    return settings;
}

/**
 * Generate a unique ID for responses
 */
function generateId(): string {
    return `chatcmpl-${Date.now()}${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Chat completions namespace (modern API)
 */
export const chat = {
    completions: {
        /**
         * Create a chat completion - OpenAI-compatible interface
         */
        async create(params: ChatCompletionCreateParams): Promise<ChatCompletionResponse | AsyncIterable<ChatCompletionChunk>> {
            const {
                messages,
                model,
                stream = false,
                tools,
                tool_choice,
                ...restParams
            } = params;

            // Convert inputs to ensemble format
            const ensembleMessages = convertMessages(messages);
            const ensembleTools = convertTools(tools);
            const modelSettings = convertModelSettings(params);

            if (stream) {
                // Return async iterable for streaming
                return createStreamingResponse(model, ensembleMessages, {
                    tools: ensembleTools,
                    toolChoice: tool_choice,
                    modelSettings
                });
            } else {
                // Non-streaming response
                return createNonStreamingResponse(model, ensembleMessages, {
                    tools: ensembleTools,
                    toolChoice: tool_choice,
                    modelSettings
                });
            }
        }
    }
};

/**
 * Legacy completions namespace
 */
export const completions = {
    /**
     * Create a completion - OpenAI-compatible interface for legacy API
     */
    async create(params: CompletionCreateParams): Promise<any> {
        const {
            model,
            prompt,
            stream = false,
            suffix,
            ...restParams
        } = params;

        // Convert prompt to messages
        const promptText = Array.isArray(prompt) ? prompt.join('\n') : prompt;
        const fullPrompt = suffix ? `${promptText}${suffix}` : promptText;
        
        const messages: ResponseInput = [
            {
                type: 'message',
                role: 'user',
                content: fullPrompt,
                status: 'completed'
            }
        ];

        const modelSettings = convertModelSettings(params);

        if (stream) {
            // Return async iterable for streaming
            return createLegacyStreamingResponse(model, messages, modelSettings);
        } else {
            // Non-streaming response
            return createLegacyNonStreamingResponse(model, messages, modelSettings, promptText);
        }
    }
};

/**
 * Create non-streaming chat completion response
 */
async function createNonStreamingResponse(
    model: string, 
    messages: ResponseInput,
    options: any
): Promise<ChatCompletionResponse> {
    const id = generateId();
    const created = Math.floor(Date.now() / 1000);
    
    let content = '';
    let toolCalls: any[] = [];
    let finishReason: ChatCompletionResponse['choices'][0]['finish_reason'] = 'stop';
    let usage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };

    // Collect the full response
    for await (const event of request(model, messages, options)) {
        switch (event.type) {
            case 'text_delta':
                content += event.delta;
                break;
            case 'message_delta':
                content += event.content;
                break;
            case 'tool_start':
                if (event.tool_calls) {
                    toolCalls = event.tool_calls.map(tc => ({
                        id: tc.id,
                        type: 'function' as const,
                        function: {
                            name: tc.function.name,
                            arguments: tc.function.arguments
                        }
                    }));
                    finishReason = 'tool_calls';
                }
                break;
            case 'cost_update':
                usage = {
                    prompt_tokens: event.usage.input_tokens,
                    completion_tokens: event.usage.output_tokens,
                    total_tokens: event.usage.total_tokens
                };
                break;
        }
    }

    return {
        id,
        object: 'chat.completion',
        created,
        model,
        choices: [{
            index: 0,
            message: {
                role: 'assistant',
                content: content || null,
                tool_calls: toolCalls.length > 0 ? toolCalls : undefined
            },
            finish_reason: finishReason
        }],
        usage
    };
}

/**
 * Create streaming chat completion response
 */
async function* createStreamingResponse(
    model: string,
    messages: ResponseInput,
    options: any
): AsyncIterable<ChatCompletionChunk> {
    const id = generateId();
    const created = Math.floor(Date.now() / 1000);
    let isFirst = true;

    for await (const event of request(model, messages, options)) {
        switch (event.type) {
            case 'text_delta':
            case 'message_delta':
                // Get the content from either event type
                const content = event.type === 'text_delta' ? event.delta : event.content;
                
                if (isFirst) {
                    // Send initial chunk with role
                    yield {
                        id,
                        object: 'chat.completion.chunk',
                        created,
                        model,
                        choices: [{
                            index: 0,
                            delta: {
                                role: 'assistant'
                            },
                            finish_reason: null
                        }]
                    };
                    isFirst = false;
                }
                
                // Send content chunk
                yield {
                    id,
                    object: 'chat.completion.chunk',
                    created,
                    model,
                    choices: [{
                        index: 0,
                        delta: {
                            content
                        },
                        finish_reason: null
                    }]
                };
                break;
                
            case 'tool_start':
                if (event.tool_calls) {
                    for (let i = 0; i < event.tool_calls.length; i++) {
                        const tc = event.tool_calls[i];
                        
                        // Send initial tool call chunk
                        yield {
                            id,
                            object: 'chat.completion.chunk',
                            created,
                            model,
                            choices: [{
                                index: 0,
                                delta: {
                                    tool_calls: [{
                                        index: i,
                                        id: tc.id,
                                        type: 'function',
                                        function: {
                                            name: tc.function.name,
                                            arguments: tc.function.arguments
                                        }
                                    }]
                                },
                                finish_reason: null
                            }]
                        };
                    }
                }
                break;
                
            case 'stream_end':
                // Send final chunk with finish reason
                yield {
                    id,
                    object: 'chat.completion.chunk',
                    created,
                    model,
                    choices: [{
                        index: 0,
                        delta: {},
                        finish_reason: 'stop'
                    }]
                };
                break;
        }
    }
}

/**
 * Create non-streaming legacy completion response
 */
async function createLegacyNonStreamingResponse(
    model: string,
    messages: ResponseInput,
    modelSettings: ModelSettings,
    originalPrompt: string
): Promise<any> {
    const id = generateId();
    const created = Math.floor(Date.now() / 1000);
    
    let text = '';
    let usage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };

    // Collect the full response
    for await (const event of request(model, messages, { modelSettings })) {
        switch (event.type) {
            case 'text_delta':
                text += event.delta;
                break;
            case 'message_delta':
                text += event.content;
                break;
            case 'cost_update':
                usage = {
                    prompt_tokens: event.usage.input_tokens,
                    completion_tokens: event.usage.output_tokens,
                    total_tokens: event.usage.total_tokens
                };
                break;
        }
    }

    return {
        id,
        object: 'text_completion',
        created,
        model,
        choices: [{
            text,
            index: 0,
            logprobs: null,
            finish_reason: 'stop'
        }],
        usage
    };
}

/**
 * Create streaming legacy completion response
 */
async function* createLegacyStreamingResponse(
    model: string,
    messages: ResponseInput,
    modelSettings: ModelSettings
): AsyncIterable<any> {
    const id = generateId();
    const created = Math.floor(Date.now() / 1000);

    for await (const event of request(model, messages, { modelSettings })) {
        switch (event.type) {
            case 'text_delta':
                yield {
                    id,
                    object: 'text_completion',
                    created,
                    model,
                    choices: [{
                        text: event.delta,
                        index: 0,
                        logprobs: null,
                        finish_reason: null
                    }]
                };
                break;
            case 'message_delta':
                yield {
                    id,
                    object: 'text_completion',
                    created,
                    model,
                    choices: [{
                        text: event.content,
                        index: 0,
                        logprobs: null,
                        finish_reason: null
                    }]
                };
                break;
                
            case 'stream_end':
                // Send final chunk
                yield {
                    id,
                    object: 'text_completion',
                    created,
                    model,
                    choices: [{
                        text: '',
                        index: 0,
                        logprobs: null,
                        finish_reason: 'stop'
                    }]
                };
                break;
        }
    }
}

/**
 * Default export mimicking OpenAI client structure
 */
export default {
    chat,
    completions
};