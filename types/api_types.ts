/**
 * Type definitions for various API responses to replace 'any' types
 */

// OpenAI API Types
export interface OpenAIStreamChunk {
    id: string;
    object: string;
    created: number;
    model: string;
    choices: OpenAIChoice[];
    usage?: {
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
    };
}

export interface OpenAIChoice {
    index: number;
    delta: {
        role?: string;
        content?: string;
        tool_calls?: OpenAIToolCall[];
    };
    finish_reason?: string;
}

export interface OpenAIToolCall {
    index: number;
    id?: string;
    type?: string;
    function?: {
        name?: string;
        arguments?: string;
    };
}

export interface OpenAITool {
    type: 'function';
    function: {
        name: string;
        description?: string;
        parameters: Record<string, unknown>;
    };
}

export interface OpenAIMessage {
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: string | OpenAIMessageContent[];
    tool_calls?: OpenAIToolCall[];
    tool_call_id?: string;
}

export interface OpenAIMessageContent {
    type: 'text' | 'image_url';
    text?: string;
    image_url?: {
        url: string;
        detail?: 'low' | 'high' | 'auto';
    };
}

// Claude API Types
export interface ClaudeStreamEvent {
    type: string;
    index?: number;
    delta?: {
        type: string;
        text?: string;
        partial_json?: string;
        stop_reason?: string;
        stop_sequence?: string;
    };
    content_block?: {
        type: string;
        id?: string;
        name?: string;
        input?: Record<string, unknown>;
    };
    message?: {
        id: string;
        type: string;
        role: string;
        content: ClaudeContent[];
        model: string;
        stop_reason?: string;
        stop_sequence?: string;
        usage: {
            input_tokens: number;
            output_tokens: number;
        };
    };
    usage?: {
        input_tokens: number;
        output_tokens: number;
    };
    error?: {
        type: string;
        message: string;
    };
}

export interface ClaudeContent {
    type: 'text' | 'tool_use';
    text?: string;
    id?: string;
    name?: string;
    input?: Record<string, unknown>;
}

export interface ClaudeMessage {
    role: 'user' | 'assistant';
    content: string | ClaudeMessageContent[];
}

export interface ClaudeMessageContent {
    type: 'text' | 'image' | 'tool_use' | 'tool_result';
    text?: string;
    source?: {
        type: 'base64';
        media_type: string;
        data: string;
    };
    id?: string;
    name?: string;
    input?: Record<string, unknown>;
    tool_use_id?: string;
    content?: string | ClaudeMessageContent[];
    is_error?: boolean;
}

export interface ClaudeTool {
    name: string;
    description?: string;
    input_schema: Record<string, unknown>;
}

// Gemini API Types
export interface GeminiStreamChunk {
    candidates?: GeminiCandidate[];
    usageMetadata?: {
        promptTokenCount: number;
        candidatesTokenCount: number;
        totalTokenCount: number;
    };
}

export interface GeminiCandidate {
    content: {
        parts: GeminiPart[];
        role: string;
    };
    finishReason?: string;
    index: number;
    safetyRatings?: unknown[];
}

export interface GeminiPart {
    text?: string;
    functionCall?: {
        name: string;
        args: Record<string, unknown>;
    };
}

export interface GeminiContent {
    role: 'user' | 'model' | 'function';
    parts: GeminiContentPart[];
}

export interface GeminiContentPart {
    text?: string;
    inlineData?: {
        mimeType: string;
        data: string;
    };
    functionCall?: {
        name: string;
        args: Record<string, unknown>;
    };
    functionResponse?: {
        name: string;
        response: Record<string, unknown>;
    };
}

export interface GeminiTool {
    functionDeclarations: GeminiFunctionDeclaration[];
}

export interface GeminiFunctionDeclaration {
    name: string;
    description?: string;
    parameters: Record<string, unknown>;
}

// DeepSeek API Types (similar to OpenAI)
export type DeepSeekStreamChunk = OpenAIStreamChunk;
export type DeepSeekMessage = OpenAIMessage;
export type DeepSeekTool = OpenAITool;

// Grok API Types (similar to OpenAI)
export type GrokStreamChunk = OpenAIStreamChunk;
export type GrokMessage = OpenAIMessage;
export type GrokTool = OpenAITool;

// OpenRouter API Types
export interface OpenRouterStreamChunk extends OpenAIStreamChunk {
    openrouter?: {
        usage?: {
            prompt_tokens: number;
            completion_tokens: number;
            total_tokens: number;
        };
    };
}

// Common API Error Response
export interface APIErrorResponse {
    error?: {
        message: string;
        type?: string;
        code?: string;
        param?: string;
    };
    message?: string;
    status?: number;
    statusText?: string;
}

// Tool Parameter Types
export interface ToolParameterProperty {
    type: string;
    description?: string;
    enum?: unknown[];
    items?: ToolParameterProperty;
    properties?: Record<string, ToolParameterProperty>;
    required?: string[];
    default?: unknown;
    minimum?: number;
    maximum?: number;
    minLength?: number;
    maxLength?: number;
    pattern?: string;
}

export interface ToolParameterSchema {
    type: 'object';
    properties: Record<string, ToolParameterProperty>;
    required?: string[];
    additionalProperties?: boolean;
}

// Request Configuration Types
export interface RequestHeaders {
    'Content-Type': string;
    Authorization: string;
    'anthropic-version'?: string;
    'anthropic-beta'?: string;
    'x-api-key'?: string;
    [key: string]: string | undefined;
}

export interface RequestBody {
    model: string;
    messages: unknown[];
    temperature?: number;
    max_tokens?: number;
    top_p?: number;
    stream?: boolean;
    tools?: unknown[];
    tool_choice?: unknown;
    system?: string;
    [key: string]: unknown;
}

// Response parsing types
export interface ParsedToolCall {
    id: string;
    name: string;
    arguments: Record<string, unknown>;
}

export interface ParsedUsage {
    inputTokens: number;
    outputTokens: number;
    totalTokens?: number;
}
