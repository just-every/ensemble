/**
 * OpenAI API Compatibility Layer
 * 
 * Provides drop-in replacements for OpenAI's chat.completions.create, responses.create,
 * and completions.create methods, allowing easy migration from OpenAI SDK to ensemble.
 */

import { request } from './index.js';
import type { 
    ResponseInput, 
    EnsembleStreamEvent,
    ToolFunction,
    ModelSettings,
    ToolDefinition,
    MessageEvent,
    ToolEvent,
    CostUpdateEvent,
    StreamEvent,
    ExecutableFunction,
    ToolParameter
} from './types.js';
import OpenAI from 'openai';

// Type aliases for easier usage
export type OpenAIMessage = OpenAI.Chat.ChatCompletionMessageParam;
export type OpenAITool = OpenAI.Chat.ChatCompletionTool;
export type ChatCompletion = OpenAI.Chat.ChatCompletion;
export type ChatCompletionChunk = OpenAI.Chat.ChatCompletionChunk;
export type ChatCompletionCreateParams = OpenAI.Chat.ChatCompletionCreateParams;
export type CompletionCreateParams = OpenAI.Completions.CompletionCreateParams;

/**
 * Convert OpenAI messages to ensemble format
 */
function convertMessages(messages: OpenAI.Chat.ChatCompletionMessageParam[]): ResponseInput {
    return messages.map(msg => {
        // Handle role mapping
        let role: 'user' | 'assistant' | 'developer';
        if (msg.role === 'system' || msg.role === 'developer') {
            role = 'developer';
        } else if (msg.role === 'user' || msg.role === 'assistant') {
            role = msg.role;
        } else if (msg.role === 'function' || msg.role === 'tool') {
            // Handle function/tool responses
            if ('tool_call_id' in msg) {
                // Tool message
                return {
                    type: 'function_call_output' as const,
                    id: msg.tool_call_id,
                    call_id: msg.tool_call_id,
                    name: msg.tool_call_id,
                    output: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)
                };
            } else if ('name' in msg && msg.role === 'function') {
                // Function message
                return {
                    type: 'function_call_output' as const,
                    id: msg.name || 'unknown',
                    call_id: msg.name || 'unknown',
                    name: msg.name || 'unknown',
                    output: typeof msg.content === 'string' ? msg.content : ''
                };
            }
            return {
                type: 'function_call_output' as const,
                id: 'unknown',
                call_id: 'unknown',
                name: 'unknown',
                output: ''
            };
        } else {
            role = 'user'; // Default fallback
        }

        // Handle tool calls in assistant messages
        if (msg.role === 'assistant' && 'tool_calls' in msg && msg.tool_calls && msg.tool_calls.length > 0) {
            // Return multiple messages for tool calls
            const messages: ResponseInput = [];
            
            // Add the assistant message if it has content
            if (msg.content) {
                // Handle content for assistant message with tool calls
                let content: string = '';
                if (typeof msg.content === 'string') {
                    content = msg.content;
                } else if (msg.content === null || msg.content === undefined) {
                    content = '';
                } else if (Array.isArray(msg.content)) {
                    content = msg.content.map(part => {
                        if ('text' in part) return part.text;
                        if ('refusal' in part) return `[Refusal: ${part.refusal}]`;
                        return JSON.stringify(part);
                    }).join('');
                } else {
                    content = JSON.stringify(msg.content);
                }
                
                messages.push({
                    type: 'message' as const,
                    role: 'assistant',
                    content,
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
        if (msg.role === 'assistant' && 'function_call' in msg && msg.function_call) {
            return {
                type: 'function_call' as const,
                id: (msg.function_call as any).name,
                call_id: (msg.function_call as any).name,
                name: (msg.function_call as any).name,
                arguments: (msg.function_call as any).arguments
            };
        }

        // Regular message - handle various content types
        let content: string = '';
        if (typeof msg.content === 'string') {
            content = msg.content;
        } else if (msg.content === null || msg.content === undefined) {
            content = '';
        } else if (Array.isArray(msg.content)) {
            // Handle content parts array
            content = msg.content.map(part => {
                if ('text' in part) return part.text;
                if ('refusal' in part) return `[Refusal: ${part.refusal}]`;
                return JSON.stringify(part);
            }).join('');
        } else {
            content = JSON.stringify(msg.content);
        }
        
        return {
            type: 'message' as const,
            role,
            content,
            status: 'completed' as const
        };
    }).flat(); // Flatten because tool calls might create multiple messages
}

/**
 * Convert OpenAI tools to ensemble format
 */
function convertTools(tools?: OpenAI.Chat.ChatCompletionTool[]): ToolFunction[] | undefined {
    if (!tools) return undefined;
    
    return tools.map(tool => ({
        // We don't have the actual function implementation, so we create a placeholder
        function: async (args: any) => {
            throw new Error(`Tool ${tool.function.name} not implemented. Use processToolCall option to handle tool execution.`);
        },
        definition: {
            type: 'function' as const,
            function: {
                name: tool.function.name,
                description: tool.function.description || `Function ${tool.function.name}`,
                parameters: tool.function.parameters || {
                    type: 'object',
                    properties: {},
                    required: []
                }
            }
        } as ToolDefinition
    }));
}

/**
 * Convert model settings
 */
function convertModelSettings(params: any): ModelSettings {
    const settings: ModelSettings = {};
    
    if ('temperature' in params && params.temperature !== undefined) {
        settings.temperature = params.temperature;
    }
    if ('max_tokens' in params && params.max_tokens !== undefined) {
        settings.max_tokens = params.max_tokens;
    }
    if ('top_p' in params && params.top_p !== undefined) {
        settings.top_p = params.top_p;
    }
    if ('seed' in params && params.seed !== undefined) {
        settings.seed = params.seed;
    }
    
    // Handle response format for ChatCompletionCreateParams
    if ('response_format' in params && params.response_format) {
        if (params.response_format.type === 'json_object') {
            settings.force_json = true;
        }
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
        async create(params: OpenAI.Chat.ChatCompletionCreateParams): Promise<OpenAI.Chat.ChatCompletion | AsyncIterable<OpenAI.Chat.ChatCompletionChunk>> {
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
 * OpenAI responses.create parameters (newer stateful API)
 */
export interface ResponsesCreateParams {
    model: string;
    input: string | OpenAI.Chat.ChatCompletionMessageParam[];
    instructions?: string;
    previous_response_id?: string;
    tools?: Array<{
        name: 'web_search' | 'file_search' | 'computer_use' | string;
        config?: Record<string, any>;
    }>;
    temperature?: number;
    max_tokens?: number;
    stream?: boolean;
    metadata?: Record<string, any>;
}

/**
 * OpenAI responses.create response format
 */
export interface ResponsesCreateResponse {
    id: string;
    object: 'response';
    created: number;
    model: string;
    content: string;
    tool_uses?: Array<{
        name: string;
        input: any;
        output: any;
    }>;
    usage: {
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
    };
    metadata?: Record<string, any>;
}

/**
 * OpenAI responses.create streaming chunk
 */
export interface ResponsesCreateChunk {
    id: string;
    object: 'response.chunk';
    created: number;
    delta: {
        content?: string;
        tool_uses?: Array<{
            index: number;
            name?: string;
            input?: string;
            output?: string;
        }>;
    };
}

/**
 * Responses namespace (newer stateful API)
 */
export const responses = {
    /**
     * Create a response - OpenAI's newer stateful API
     */
    async create(params: ResponsesCreateParams): Promise<ResponsesCreateResponse | AsyncIterable<ResponsesCreateChunk>> {
        const {
            model,
            input,
            instructions,
            previous_response_id,
            tools,
            stream = false,
            metadata,
            ...restParams
        } = params;

        // Convert input to messages format
        let messages: ResponseInput;
        if (typeof input === 'string') {
            messages = [
                {
                    type: 'message',
                    role: 'user',
                    content: input,
                    status: 'completed'
                }
            ];
        } else {
            messages = convertMessages(input);
        }

        // Add instructions as a system message if provided
        if (instructions) {
            messages.unshift({
                type: 'message',
                role: 'developer',
                content: instructions,
                status: 'completed'
            });
        }

        // Convert tools to ensemble format if provided
        let ensembleTools: ToolFunction[] | undefined;
        if (tools && tools.length > 0) {
            ensembleTools = tools.map(tool => {
                // Create a built-in tool handler
                let toolFunction: ExecutableFunction;
                let description: string;
                
                switch (tool.name) {
                    case 'web_search':
                        description = 'Search the web for information';
                        toolFunction = async (query: string) => {
                            // In a real implementation, this would call an actual web search API
                            return `Web search results for "${query}": [simulated results]`;
                        };
                        break;
                    case 'file_search':
                        description = 'Search for files in the workspace';
                        toolFunction = async (query: string) => {
                            // In a real implementation, this would search actual files
                            return `File search results for "${query}": [simulated results]`;
                        };
                        break;
                    case 'computer_use':
                        description = 'Control computer applications';
                        toolFunction = async (command: string) => {
                            // In a real implementation, this would execute computer commands
                            return `Computer command "${command}" executed: [simulated result]`;
                        };
                        break;
                    default:
                        description = `Custom tool: ${tool.name}`;
                        toolFunction = async (args: any) => {
                            throw new Error(`Tool ${tool.name} not implemented`);
                        };
                }

                return {
                    function: toolFunction,
                    definition: {
                        type: 'function' as const,
                        function: {
                            name: tool.name,
                            description,
                            parameters: (tool.config && typeof tool.config === 'object' && 'type' in tool.config) 
                                ? tool.config as { type: 'object'; properties: Record<string, ToolParameter>; required: string[]; }
                                : {
                                    type: 'object',
                                    properties: {
                                        input: { type: 'string' as const, description: 'Input for the tool' }
                                    },
                                    required: ['input']
                                } as { type: 'object'; properties: Record<string, ToolParameter>; required: string[]; }
                        }
                    }
                };
            });
        }

        const modelSettings = convertModelSettings(restParams as any);

        if (stream) {
            // Return async iterable for streaming
            return createResponsesStreamingResponse(model, messages, {
                tools: ensembleTools,
                modelSettings,
                metadata,
                previousResponseId: previous_response_id
            });
        } else {
            // Non-streaming response
            return createResponsesNonStreamingResponse(model, messages, {
                tools: ensembleTools,
                modelSettings,
                metadata,
                previousResponseId: previous_response_id
            });
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
    async create(params: OpenAI.Completions.CompletionCreateParams): Promise<any> {
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
 * Check if event is a message event with content
 */
function isMessageEvent(event: EnsembleStreamEvent): event is MessageEvent {
    return event.type === 'message_delta' && 'content' in event;
}

/**
 * Check if event is a tool event
 */
function isToolEvent(event: EnsembleStreamEvent): event is ToolEvent {
    return event.type === 'tool_start' && 'tool_calls' in event;
}

/**
 * Check if event is a cost update event
 */
function isCostUpdateEvent(event: EnsembleStreamEvent): event is CostUpdateEvent {
    return event.type === 'cost_update' && 'usage' in event;
}

/**
 * Create non-streaming chat completion response
 */
async function createNonStreamingResponse(
    model: string, 
    messages: ResponseInput,
    options: any
): Promise<OpenAI.Chat.ChatCompletion> {
    const id = generateId();
    const created = Math.floor(Date.now() / 1000);
    
    let content = '';
    let toolCalls: any[] = [];
    let finishReason: 'stop' | 'length' | 'tool_calls' | 'content_filter' | 'function_call' = 'stop';
    let usage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };

    // Collect the full response
    for await (const event of request(model, messages, options)) {
        if (isMessageEvent(event)) {
            content += event.content;
        } else if (isToolEvent(event)) {
            toolCalls = event.tool_calls.map(tc => ({
                id: tc.id,
                type: 'function' as const,
                function: {
                    name: tc.function.name,
                    arguments: tc.function.arguments
                }
            }));
            finishReason = 'tool_calls';
        } else if (isCostUpdateEvent(event)) {
            usage = {
                prompt_tokens: event.usage.input_tokens,
                completion_tokens: event.usage.output_tokens,
                total_tokens: event.usage.total_tokens
            };
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
                refusal: null,
                tool_calls: toolCalls.length > 0 ? toolCalls : undefined
            } as OpenAI.Chat.ChatCompletion['choices'][0]['message'],
            finish_reason: finishReason,
            logprobs: null
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
): AsyncIterable<OpenAI.Chat.ChatCompletionChunk> {
    const id = generateId();
    const created = Math.floor(Date.now() / 1000);
    let isFirst = true;

    for await (const event of request(model, messages, options)) {
        if (isMessageEvent(event)) {
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
                        content: event.content
                    },
                    finish_reason: null
                }]
            };
        } else if (isToolEvent(event)) {
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
        } else if (event.type === 'stream_end') {
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
        if (isMessageEvent(event)) {
            text += event.content;
        } else if (isCostUpdateEvent(event)) {
            usage = {
                prompt_tokens: event.usage.input_tokens,
                completion_tokens: event.usage.output_tokens,
                total_tokens: event.usage.total_tokens
            };
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
        if (isMessageEvent(event)) {
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
        } else if (event.type === 'stream_end') {
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
        }
    }
}

/**
 * Create non-streaming responses.create response
 */
async function createResponsesNonStreamingResponse(
    model: string,
    messages: ResponseInput,
    options: any
): Promise<ResponsesCreateResponse> {
    const id = `resp_${Date.now()}${Math.random().toString(36).substr(2, 9)}`;
    const created = Math.floor(Date.now() / 1000);
    
    let content = '';
    let toolUses: any[] = [];
    let usage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };

    // Collect the full response
    for await (const event of request(model, messages, options)) {
        if (isMessageEvent(event)) {
            content += event.content;
        } else if (isToolEvent(event)) {
            // Track tool uses for responses API
            for (const toolCall of event.tool_calls) {
                toolUses.push({
                    name: toolCall.function.name,
                    input: JSON.parse(toolCall.function.arguments),
                    output: event.results?.find(r => r.call_id === toolCall.id)?.output || null
                });
            }
        } else if (isCostUpdateEvent(event)) {
            usage = {
                prompt_tokens: event.usage.input_tokens,
                completion_tokens: event.usage.output_tokens,
                total_tokens: event.usage.total_tokens
            };
        }
    }

    return {
        id,
        object: 'response',
        created,
        model,
        content,
        tool_uses: toolUses.length > 0 ? toolUses : undefined,
        usage,
        metadata: options.metadata
    };
}

/**
 * Create streaming responses.create response
 */
async function* createResponsesStreamingResponse(
    model: string,
    messages: ResponseInput,
    options: any
): AsyncIterable<ResponsesCreateChunk> {
    const id = `resp_${Date.now()}${Math.random().toString(36).substr(2, 9)}`;
    const created = Math.floor(Date.now() / 1000);
    let toolIndex = 0;

    for await (const event of request(model, messages, options)) {
        if (isMessageEvent(event)) {
            // Send content chunk
            yield {
                id,
                object: 'response.chunk',
                created,
                delta: {
                    content: event.content
                }
            };
        } else if (isToolEvent(event)) {
            for (const toolCall of event.tool_calls) {
                // Send tool use chunk
                yield {
                    id,
                    object: 'response.chunk',
                    created,
                    delta: {
                        tool_uses: [{
                            index: toolIndex++,
                            name: toolCall.function.name,
                            input: toolCall.function.arguments,
                            output: event.results?.find(r => r.call_id === toolCall.id)?.output || undefined
                        }]
                    }
                };
            }
        }
    }
}

/**
 * OpenAIEnsemble - OpenAI-compatible client using ensemble's multi-provider support
 */
const OpenAIEnsemble = {
    chat,
    completions,
    responses
};

export default OpenAIEnsemble;