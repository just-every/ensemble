// ================================================================
// Types for the Ensemble package - Self-contained
// ================================================================

export type ToolParameterType = 'string' | 'number' | 'boolean' | 'object' | 'array' | 'null';

/**
 * Tool parameter type definitions using strict schema format for OpenAI function calling
 */
export interface ToolParameter {
    type?: ToolParameterType;
    description?: string | (() => string);
    enum?: string[] | (() => Promise<string[]>);
    items?:
        | ToolParameter
        | {
              type: ToolParameterType;
              enum?: string[] | (() => Promise<string[]>);
          };
    properties?: Record<string, ToolParameter>;
    required?: string[];
    optional?: boolean;
    minItems?: number;

    additionalProperties?: boolean;
    default?: unknown;
    minimum?: number;
    maximum?: number;
    minLength?: number;
    maxLength?: number;
    pattern?: string;
}

export type ExecutableFunction = (...args: unknown[]) => Promise<string> | string;

/**
 * Definition for a tool that can be used by an agent
 */
export interface ToolFunction {
    function: ExecutableFunction;
    definition: ToolDefinition;
    injectAgentId?: boolean;
    injectAbortSignal?: boolean;
    allow_summary?: boolean;
}

/**
 * Definition for a tool that can be used by an agent
 */
export interface ToolDefinition {
    type: 'function';
    function: {
        name: string;
        description: string;
        parameters: {
            type: 'object';
            properties: Record<string, ToolParameter>;
            required: string[];
        };
    };
}

export interface ResponseJSONSchema {
    /**
     * The name of the response format. Must be a-z, A-Z, 0-9, or contain underscores
     * and dashes, with a maximum length of 64.
     */
    name: string;

    /**
     * The schema for the response format, described as a JSON Schema object. Learn how
     * to build JSON schemas [here](https://json-schema.org/).
     */
    schema: Record<string, unknown>;

    /**
     * The type of response format being defined. Always `json_schema`.
     */
    type: 'json_schema';

    /**
     * A description of what the response format is for, used by the model to determine
     * how to respond in the format.
     */
    description?: string;

    /**
     * Whether to enable strict schema adherence when generating the output. If set to
     * true, the model will always follow the exact schema defined in the `schema`
     * field. Only a subset of JSON Schema is supported when `strict` is `true`. To
     * learn more, read the
     * [Structured Outputs guide](https://platform.openai.com/docs/guides/structured-outputs).
     */
    strict?: boolean | null;
}

/**
 * Model settings for the OpenAI API
 */
export interface ModelSettings {
    temperature?: number;
    top_p?: number;
    top_k?: number;
    max_tokens?: number;
    stop_sequence?: string;
    seed?: number;
    text?: { format: string };
    tool_choice?: 'auto' | 'none' | 'required' | { type: string; function: { name: string } };
    sequential_tools?: boolean; // Run tools sequentially instead of in parallel
    json_schema?: ResponseJSONSchema; // JSON schema for structured output
}

/**
 * Tool call data structure
 */
export interface ToolCall {
    id: string;
    type: 'function';
    call_id?: string;
    function: {
        name: string;
        arguments: string;
        arguments_formatted?: string;
    };
}

/**
 * Tool call data structure
 */
export interface ToolCallResult {
    toolCall: ToolCall;
    id: string;
    call_id: string;
    output?: string;
    error?: string;
}

/**
 * Handler interface for tool calls
 */
export interface ToolCallHandler {
    onToolCall?: (toolCall: ToolCall) => void;
    onToolResult?: (toolCall: ToolCall, result: string) => void;
}

export interface ResponseContentText {
    type: 'input_text';
    text: string;
}

export interface ResponseContentImage {
    type: 'input_image';
    detail: 'high' | 'low' | 'auto';
    file_id?: string;
    image_url?: string;
}

export interface ResponseContentFileInput {
    type: 'input_file';
    file_data?: string;
    file_id?: string;
    filename?: string;
}

/**
 * ResponseContent
 */
export type ResponseContent = string | Array<ResponseContentText | ResponseContentImage | ResponseContentFileInput>;

/**
 * ResponseInput
 */
export type ResponseInput = Array<ResponseInputItem>;
export type ResponseInputItem =
    | ResponseInputMessage
    | ResponseThinkingMessage
    | ResponseOutputMessage
    | ResponseInputFunctionCall
    | ResponseInputFunctionCallOutput;

export interface ResponseBaseMessage {
    type: string;
    id?: string; // Optional unique identifier for the message
    model?: string;
    timestamp?: number; // Timestamp for the event, shared by all event types
}

/**
 * ResponseInputMessage
 */
export interface ResponseInputMessage extends ResponseBaseMessage {
    type: 'message';
    name?: string; // deprecated
    content: ResponseContent;
    role: 'user' | 'system' | 'developer';
    status?: 'in_progress' | 'completed' | 'incomplete';
}

/**
 * ResponseThinkingMessage
 */
export interface ResponseThinkingMessage extends ResponseBaseMessage {
    type: 'thinking';
    content: ResponseContent;
    signature?: ResponseContent;
    thinking_id?: string;
    role: 'assistant';
    status?: 'in_progress' | 'completed' | 'incomplete';
}

/**
 * ResponseOutputMessage
 */
export interface ResponseOutputMessage extends ResponseBaseMessage {
    id?: string;
    type: 'message';
    content: ResponseContent;
    role: 'assistant';
    status: 'in_progress' | 'completed' | 'incomplete';
}

/**
 * Tool call data structure
 */
export interface ResponseInputFunctionCall extends ResponseBaseMessage {
    type: 'function_call';
    call_id: string;
    name: string;
    arguments: string;
    id?: string;
    status?: 'in_progress' | 'completed' | 'incomplete';
}

/**
 * Tool call data structure
 */
export interface ResponseInputFunctionCallOutput extends ResponseBaseMessage {
    type: 'function_call_output';
    call_id: string;
    name?: string;
    output: string;
    id?: string;
    status?: 'in_progress' | 'completed' | 'incomplete';
}

/**
 * Streaming event types
 */
export type StreamEventType =
    | 'connected'
    | 'command_start'
    | 'command_done'
    | 'project_create'
    | 'project_update'
    | 'process_start'
    | 'process_running'
    | 'process_updated'
    | 'process_done'
    | 'process_failed'
    | 'process_waiting'
    | 'process_terminated'
    | 'message_start'
    | 'message_delta'
    | 'message_complete'
    | 'audio_stream'
    | 'tool_start'
    | 'tool_delta'
    | 'tool_done'
    | 'file_start'
    | 'file_delta'
    | 'file_complete'
    | 'cost_update'
    | 'system_status'
    | 'system_update'
    | 'quota_update'
    | 'screenshot'
    | 'design_grid'
    | 'console'
    | 'error'
    | 'response_output'
    // New types for waiting on tools
    | 'tool_wait_start'
    | 'tool_waiting'
    | 'tool_wait_complete'
    // New types for waiting on tasks
    | 'task_wait_start'
    | 'task_waiting'
    | 'task_wait_complete'
    | 'task_start'
    | 'task_complete'
    | 'task_fatal_error'
    // Git-related events
    | 'git_pull_request'
    // Stream termination event
    | 'stream_end'
    // Agent lifecycle events
    | 'agent_start'
    | 'agent_status'
    | 'agent_done';

/**
 * Base streaming event interface
 */
export interface StreamEventBase {
    type: StreamEventType;
    timestamp?: string; // Timestamp for the event, shared by all event types
    agent?: AgentExportDefinition; // Optional agent context
    request_id?: string; // Optional request ID to tie events to agent_start/agent_done blocks
}

/**
 * Message streaming event
 */
export interface MessageEventBase extends StreamEventBase {
    type: StreamEventType;
    content: string;
    message_id: string; // Added message_id for tracking deltas and completes
    order?: number; // Optional order property for message sorting
    thinking_content?: string;
    thinking_signature?: string;
}

/**
 * Message streaming event
 */
export interface MessageEvent extends MessageEventBase {
    type: 'message_start' | 'message_delta' | 'message_complete';
}

/**
 * Message streaming event
 */
export interface FileEvent extends StreamEventBase {
    type: 'file_start' | 'file_delta' | 'file_complete';
    message_id: string; // Added message_id for tracking deltas and completes
    mime_type?: string;
    data_format: 'base64';
    data: string;
    order?: number; // Optional order property for message sorting
}

/**
 * Tool call streaming event
 */
export interface ToolEvent extends StreamEventBase {
    type: 'tool_start' | 'tool_delta' | 'tool_done';
    tool_call: ToolCall;
    result?: { call_id: string; output: string; error?: string };
}

/**
 * Error streaming event
 */
export interface ErrorEvent extends StreamEventBase {
    type: 'error';
    error: string;
}

/**
 * Error streaming event
 */
export interface TaskEvent extends StreamEventBase {
    type: 'task_start' | 'task_complete' | 'task_fatal_error';
    task_id?: string;
    result?: string;
    finalState?: any;
}

/**
 * Cost update streaming event
 */
export interface CostUpdateEvent extends StreamEventBase {
    type: 'cost_update';
    usage: ModelUsage;
    thought_delay?: number;
}

/**
 * Error streaming event
 */
export interface ResponseOutputEvent extends StreamEventBase {
    type: 'response_output';
    message: ResponseInputItem;
}

/**
 * Agent lifecycle streaming events
 */
export interface AgentStartEvent extends StreamEventBase {
    type: 'agent_start';
    agent: AgentExportDefinition;
    request_id?: string; // UUID to tie agent events together
    input?: string;
}
/**
 * Agent lifecycle streaming events
 */
export interface AgentStatusEvent extends StreamEventBase {
    type: 'agent_status';
    agent: AgentExportDefinition;
    request_id?: string; // UUID to tie agent events together
    status?: string;
}
/**
 * Agent lifecycle streaming events
 */
export interface AgentDoneEvent extends StreamEventBase {
    type: 'agent_done';
    agent: AgentExportDefinition;
    request_id?: string; // UUID to tie agent events together
    request_cost?: number; // Calculated cost of LLM request
    request_duration?: number; // Duration in ms of the request only
    duration_with_tools?: number; // Total duration including tool execution
}

/**
 * Union type for all agent events
 */
export type AgentEvent = AgentStartEvent | AgentStatusEvent | AgentDoneEvent;

/**
 * Union type for all ensemble streaming events
 */
export type ProviderStreamEvent =
    | StreamEventBase
    | MessageEvent
    | FileEvent
    | ToolEvent
    | ErrorEvent
    | CostUpdateEvent
    | ResponseOutputEvent
    | AgentEvent;

/**
 * Model provider interface
 */
export interface ModelProvider {
    provider_id: string;

    createResponseStream(
        messages: ResponseInput,
        model: string,
        agent: AgentDefinition,
        requestId?: string
    ): AsyncGenerator<ProviderStreamEvent>;

    /**
     * Creates embeddings for text input
     * @param modelId ID of the embedding model to use
     * @param input Text to embed (string or array of strings)
     * @param opts Optional parameters for embedding generation
     * @returns Promise resolving to embedding vector(s)
     */
    createEmbedding?(
        input: string | string[],
        model: string,
        agent: AgentDefinition,
        opts?: EmbedOpts
    ): Promise<number[] | number[][]>;

    /**
     * Generates images from text prompts
     * @param prompt Text description of the image to generate
     * @param opts Optional parameters for image generation
     * @returns Promise resolving to generated image data
     */
    createImage?(prompt: string, model: string, agent: AgentDefinition, opts?: ImageGenerationOpts): Promise<string[]>;

    /**
     * Generates speech audio from text (Text-to-Speech)
     * @param text Text to convert to speech
     * @param model Model ID for TTS (e.g., 'tts-1', 'tts-1-hd')
     * @param opts Optional parameters for voice generation
     * @returns Promise resolving to audio stream or buffer
     */
    createVoice?(
        text: string,
        model: string,
        agent: AgentDefinition,
        opts?: VoiceGenerationOpts
    ): Promise<ReadableStream<Uint8Array> | ArrayBuffer>;

    /**
     * Transcribes audio to text (Speech-to-Text)
     * @param audio Audio input to transcribe
     * @param model Model ID for STT (e.g., 'gemini-live-2.5-flash-preview')
     * @param opts Optional parameters for transcription
     * @returns AsyncGenerator that yields transcription events
     */
    createTranscription?(
        audio: TranscriptionAudioSource,
        agent: AgentDefinition,
        model: string,
        opts?: TranscriptionOpts
    ): AsyncGenerator<TranscriptionEvent>;

    /**
     * Creates a Live API session for real-time interaction
     * @param config Live API configuration
     * @param agent Agent definition with tools and settings
     * @param opts Optional parameters for the live session
     * @returns Promise resolving to a LiveSession object
     */
    createLiveSession?(
        config: LiveConfig,
        agent: AgentDefinition,
        model: string,
        opts?: LiveOptions
    ): Promise<LiveSession>;
}

/**
 * Live API session interface
 */
export interface LiveSession {
    /** Unique session ID */
    sessionId: string;

    /** Send audio input to the session */
    sendAudio(audio: LiveAudioBlob): Promise<void>;

    /** Send text content to the session */
    sendText(text: string, role?: 'user' | 'assistant'): Promise<void>;

    /** Send tool response to the session */
    sendToolResponse(toolResults: ToolCallResult[]): Promise<void>;

    /** Get event stream from the session */
    getEventStream(): AsyncIterable<LiveEvent>;

    /** Close the session */
    close(): Promise<void>;

    /** Check if session is active */
    isActive(): boolean;
}

/**
 * Model class identifier
 */
export type ModelClassID =
    | 'standard'
    | 'mini'
    | 'reasoning'
    | 'reasoning_mini'
    | 'monologue'
    | 'metacognition'
    | 'code'
    | 'writing'
    | 'summary'
    | 'vision'
    | 'vision_mini'
    | 'long'
    | 'image_generation'
    | 'embedding'
    | 'voice'
    | 'transcription';

// Available model providers
export type ModelProviderID =
    | 'openai'
    | 'anthropic'
    | 'google'
    | 'xai'
    | 'deepseek'
    | 'openrouter'
    | 'elevenlabs'
    | 'test';

// ================================================================
// Model Registry Types
// ================================================================

// Represents a tiered pricing structure based on token count
export interface TieredPrice {
    threshold_tokens: number; // The token count threshold for the price change
    price_below_threshold_per_million: number; // Price per million tokens <= threshold
    price_above_threshold_per_million: number; // Price per million tokens > threshold
}

// Structure for time-based pricing (Peak/Off-Peak)
export interface TimeBasedPrice {
    peak_price_per_million: number;
    off_peak_price_per_million: number;
    // Define UTC time boundaries for peak hours (inclusive start, exclusive end)
    peak_utc_start_hour: number; // e.g., 0 for 00:30
    peak_utc_start_minute: number; // e.g., 30 for 00:30
    peak_utc_end_hour: number; // e.g., 16 for 16:30
    peak_utc_end_minute: number; // e.g., 30 for 16:30
}

// Represents modality-specific pricing (e.g., for models that charge differently for text vs audio)
export interface ModalityPrice {
    text?: number | TieredPrice | TimeBasedPrice;
    audio?: number | TieredPrice | TimeBasedPrice;
    video?: number | TieredPrice | TimeBasedPrice;
    image?: number | TieredPrice | TimeBasedPrice;
}

// Represents the cost structure for a model, potentially tiered or time-based
export interface ModelCost {
    // Cost components can be flat rate, token-tiered, time-based, or modality-specific
    input_per_million?: number | TieredPrice | TimeBasedPrice | ModalityPrice;
    output_per_million?: number | TieredPrice | TimeBasedPrice | ModalityPrice;
    cached_input_per_million?: number | TieredPrice | TimeBasedPrice;

    // Cost per image (for image generation models like Imagen)
    per_image?: number;
}

// Represents the feature set of a model
export interface ModelFeatures {
    context_length?: number; // Maximum context length in tokens
    input_modality?: ('text' | 'image' | 'audio' | 'video')[]; // Supported input types
    output_modality?: ('text' | 'image' | 'audio' | 'embedding')[]; // Supported output types
    tool_use?: boolean; // Whether the model supports tool/function calling
    simulate_tools?: boolean; // Whether to use simulated tool calls instead of native ones
    streaming?: boolean; // Whether the model supports streaming responses
    json_output?: boolean; // Whether the model reliably outputs JSON
    max_output_tokens?: number; // Maximum output tokens for the model
    reasoning_output?: boolean; // Whether the model outputs reasoning steps
    input_token_limit?: number; // Maximum tokens for a single input (e.g., for embedding models)
}

// Represents a single model entry in the registry
export interface ModelEntry {
    id: string; // Model identifier used in API calls
    aliases?: string[]; // Alternative names for the model
    provider: ModelProviderID; // Provider (openai, anthropic, google, xai, deepseek)
    cost: ModelCost; // Cost information using the updated structure
    features: ModelFeatures; // Feature information for the model
    class?: string; // Model class as a string to avoid strict typing issues
    description?: string; // Short description of the model's capabilities
    rate_limit_fallback?: string; // Fallback model ID in case of rate limit errors
    openrouter_id?: string; // OpenRouter model ID for this model (if available)
    embedding?: boolean; // Whether this is an embedding model
    dim?: number; // Dimension of the embedding vector (for embedding models)
    score?: number; // Legacy overall MECH model score (0-100)
    scores?: {
        // Class-specific scores from artificialanalysis.ai benchmarks
        monologue?: number; // Humanity's Last Exam (Reasoning & Knowledge) score
        code?: number; // HumanEval (Coding) score
        reasoning?: number; // GPQA Diamond (Scientific Reasoning) score
        // Add more class-specific scores as needed
    };
}

// Represents usage data for cost calculation
export interface ModelUsage {
    model?: string; // The ID of the model used (e.g., 'gemini-2.0-flash')
    cost?: number; // Calculated cost (optional, will be calculated if missing)
    input_tokens?: number; // Number of input tokens
    output_tokens?: number; // Number of output tokens
    total_tokens?: number; // Total number of tokens (input + output)
    cached_tokens?: number; // Number of cached input tokens
    image_count?: number; // Number of images generated (for models like Imagen)
    metadata?: Record<string, unknown>; // Additional metadata for usage tracking
    timestamp?: Date; // Timestamp of the usage, crucial for time-based pricing
    isFreeTierUsage?: boolean; // Flag for free tier usage override
    input_modality?: 'text' | 'audio' | 'video' | 'image'; // Modality of input tokens
    output_modality?: 'text' | 'audio' | 'video' | 'image'; // Modality of output tokens
}

// Interface for grouping models by class/capability
export interface ModelClass {
    models: string[];
    random?: boolean;
}

// ================================================================
// Quota Tracking Types
// ================================================================

// Interface for tracking model-specific quota information
export interface ModelSpecificQuota {
    // Model identifier
    model: string;
    // Daily limits in tokens
    dailyTokenLimit: number;
    dailyTokensUsed: number;
    // Daily limits in requests
    dailyRequestLimit: number;
    dailyRequestsUsed: number;
    // Rate limits
    rateLimit?: {
        requestsPerMinute: number;
        tokensPerMinute: number;
    };
    // Reset dates/tracking
    lastResetDate?: Date;
}

// Main interface for tracking provider-level quota information
export interface ProviderQuota {
    provider: ModelProviderID;
    // Provider-level limits and credits
    creditBalance?: number;
    creditLimit?: number;
    // Provider-specific information (like OpenAI free tier quotas)
    info?: Record<string, unknown>;
    // Model-specific quotas
    models: Record<string, ModelSpecificQuota>;
    // Last reset date for the provider (used to trigger daily reset check)
    lastResetDate?: Date;
}

// ================================================================
// Logging Types
// ================================================================

export interface EnsembleLogger {
    log_llm_request(
        agentId: string,
        providerName: string,
        model: string,
        requestData: unknown,
        timestamp?: Date,
        requestId?: string,
        tags?: string[]
    ): string;
    log_llm_response(requestId: string | undefined, responseData: unknown, timestamp?: Date): void;
    log_llm_error(requestId: string | undefined, errorData: unknown, timestamp?: Date): void;
}

// ================================================================
// Image Processing Types
// ================================================================

/**
 * Result type for extractBase64Image function
 */
export interface ExtractBase64ImageResult {
    found: boolean; // Whether at least one image was found
    originalContent: string; // Original content unchanged
    replaceContent: string; // Content with images replaced by placeholders
    image_id: string | null; // ID of the first image found (for backwards compatibility)
    images: Record<string, string>; // Map of image IDs to their base64 data
}

// ================================================================
// Embedding Types
// ================================================================

/**
 * Optional parameters for embeddings
 */
export interface EmbedOpts {
    /**
     * A task-specific hint to the model for optimization
     * For Gemini models: 'SEMANTIC_SIMILARITY', 'CLASSIFICATION', 'CLUSTERING', 'RETRIEVAL_DOCUMENT', etc.
     */
    taskType?: string;

    /** Dimension of vector if model supports variable dimensions */
    dimensions?: number;

    /** Whether to normalize vectors to unit length */
    normalize?: boolean;
}

// ================================================================
// Image Generation Types
// ================================================================

/**
 * Options for image generation
 */
export interface ImageGenerationOpts {
    /** Number of images to generate (default: 1) */
    n?: number;

    /** Size/aspect ratio of the generated image */
    size?:
        | 'square'
        | 'landscape'
        | 'portrait'
        | '1024x1024'
        | '1536x1024'
        | '1024x1536'
        | '1792x1024'
        | '1024x1792'
        | '512x512'
        | '256x256';

    /** Quality of the generated image */
    quality?: 'standard' | 'hd' | 'low' | 'medium' | 'high';

    /** Style of the generated image (OpenAI specific) */
    style?: 'vivid' | 'natural';

    /** Response format */
    response_format?: 'url' | 'b64_json';

    /** Source images for editing/variations (URLs or base64 data) */
    source_images?: string | string[];

    /** Mask for inpainting (base64 data) - areas to edit should be transparent */
    mask?: string;

    /** Background transparency */
    background?: 'transparent' | 'opaque' | 'auto';
}

// ================================================================
// Voice Generation Types
// ================================================================

/**
 * Options for voice/speech generation (Text-to-Speech)
 */
export interface VoiceGenerationOpts {
    /** Voice to use for synthesis (OpenAI voices or ElevenLabs voice ID) */
    voice?:
        | 'alloy'
        | 'echo'
        | 'fable'
        | 'onyx'
        | 'nova'
        | 'shimmer'
        | 'rachel'
        | 'domi'
        | 'bella'
        | 'antoni'
        | 'elli'
        | 'josh'
        | 'arnold'
        | 'adam'
        | 'sam'
        | 'george'
        | string; // Also accepts ElevenLabs voice IDs directly

    /** Speed of speech (OpenAI: 0.25 to 4.0, default 1.0) */
    speed?: number;

    /** Output format for the audio */
    response_format?:
        | 'mp3'
        | 'opus'
        | 'aac'
        | 'flac'
        | 'wav'
        | 'pcm'
        | 'mp3_low'
        | 'mp3_high'
        | 'pcm_16000'
        | 'pcm_22050'
        | 'pcm_24000'
        | 'pcm_44100'
        | 'ulaw';

    /** Whether to stream the audio response */
    stream?: boolean;

    /** ElevenLabs-specific voice settings */
    voice_settings?: {
        stability?: number; // 0-1, default 0.5
        similarity_boost?: number; // 0-1, default 0.75
        style?: number; // 0-1, default 0.0
        use_speaker_boost?: boolean; // default true
        speed?: number; //default 1.0
    };

    /** Additional instructions to alter how the voice sounds */
    affect?: string;
    instructions?: string;
}

export type WorkerFunction = (...args: any[]) => AgentDefinition;

/**
 * Definition-exportable version of the agent
 */
export interface AgentExportDefinition {
    agent_id?: string;
    name?: string;
    parent_id?: string;
    model?: string;
    modelClass?: string;
    cwd?: string; // Working directory for model providers that need a real shell context
    modelScores?: Record<string, number>; // Model-specific scores for weighted selection (0-100)
    disabledModels?: string[]; // Models to exclude from selection
    tags?: string[]; // Optional tags for categorizing or grouping agents
}

/**
 * Definition of an agent with model and tool settings
 */
export interface AgentDefinition {
    agent_id?: string;
    name?: string;
    description?: string;
    instructions?: string;
    parent_id?: string;
    workers?: WorkerFunction[];
    tools?: ToolFunction[];
    model?: string;
    modelClass?: ModelClassID;
    modelSettings?: ModelSettings;
    intelligence?: 'low' | 'standard' | 'high'; // Used to select the model
    maxToolCalls?: number; // Maximum total number of tool calls allowed (default: 200)
    maxToolCallRoundsPerTurn?: number; // Maximum number of sequential tool call rounds per turn. Each round can have multiple parallel tool calls. Default: Infinity (no limit)
    verifier?: AgentDefinition;
    maxVerificationAttempts?: number;
    args?: any;
    jsonSchema?: ResponseJSONSchema; // JSON schema for structured output
    historyThread?: ResponseInput | undefined;
    cwd?: string; // Working directory for the agent (used by model providers that need a real shell)
    modelScores?: Record<string, number>; // Model-specific scores for weighted selection (0-100)
    disabledModels?: string[]; // Models to exclude from selection
    tags?: string[]; // Optional tags for categorizing or grouping agents

    /** Optional callback for processing tool calls */
    getTools?: () => Promise<ToolFunction[]>;
    onToolCall?: (toolCall: ToolCall) => Promise<void>;
    processToolCall?: (toolCalls: ToolCall[]) => Promise<Record<string, any>>;
    onToolResult?: (toolCallResult: ToolCallResult) => Promise<void>;
    onToolError?: (toolCallResult: ToolCallResult) => Promise<void>;
    onRequest?: (
        agent: AgentDefinition, // Reverted back to AgentInterface
        messages: ResponseInput
    ) => Promise<[any, ResponseInput]>; // Reverted back to AgentInterface
    onResponse?: (message: ResponseOutputMessage) => Promise<void>;
    onThinking?: (message: ResponseThinkingMessage) => Promise<void>;
    onToolEvent?: (event: ProviderStreamEvent) => void | Promise<void>;

    params?: ToolParameterMap; // Map of parameter names to their definitions
    processParams?: (
        agent: AgentDefinition,
        params: Record<string, any>
    ) => Promise<{
        prompt: string;
        intelligence?: 'low' | 'standard' | 'high';
    }>;

    /** Optional abort signal to cancel operations */
    abortSignal?: AbortSignal;

    /** Optional retry configuration for handling network errors and transient failures */
    retryOptions?: {
        /** Maximum number of retry attempts (default: 3) */
        maxRetries?: number;
        /** Initial delay in milliseconds before first retry (default: 1000) */
        initialDelay?: number;
        /** Maximum delay in milliseconds between retries (default: 30000) */
        maxDelay?: number;
        /** Backoff multiplier for exponential backoff (default: 2) */
        backoffMultiplier?: number;
        /** Additional error codes to consider retryable */
        additionalRetryableErrors?: string[];
        /** Additional HTTP status codes to consider retryable */
        additionalRetryableStatusCodes?: number[];
        /** Callback when a retry occurs */
        onRetry?: (error: any, attempt: number) => void;
    };
}

export interface ToolParameter {
    type?: ToolParameterType;
    description?: string | (() => string);
    enum?: string[] | (() => Promise<string[]>);
    items?:
        | ToolParameter
        | {
              type: ToolParameterType;
              enum?: string[] | (() => Promise<string[]>);
          };
    properties?: Record<string, ToolParameter>;
    required?: string[];
    optional?: boolean;
    minItems?: number;
    additionalProperties?: boolean;
    default?: unknown;
    minimum?: number;
    maximum?: number;
    minLength?: number;
    maxLength?: number;
    pattern?: string;
}

export type ToolParameterMap = Record<string, string | ToolParameter>;

// ================================================================
// Speech Transcription Types
// ================================================================

/**
 * Options for speech transcription (Speech-to-Text)
 */
export interface TranscriptionOpts {
    /** Audio format of the input stream */
    audioFormat?: {
        /** Sample rate in Hz (e.g., 16000, 24000, 44100) */
        sampleRate?: number;
        /** Number of channels (1 for mono, 2 for stereo) */
        channels?: number;
        /** Encoding format */
        encoding?: 'pcm' | 'opus' | 'flac';
    };

    /** Gemini-specific real-time configuration */
    realtimeInputConfig?: any;

    /** Gemini-specific real-time configuration */
    speechConfig?: any;

    /** Buffering configuration */
    bufferConfig?: {
        /** Size of audio chunks to send (default: 8000 bytes for 250ms at 16kHz) */
        chunkSize?: number;
        /** Milliseconds to wait before flushing partial buffer (default: 500) */
        flushInterval?: number;
    };

    /** Whether to stream transcription results */
    stream?: boolean;

    /** Transcription prompt/context (OpenAI) */
    prompt?: string;

    /** Language code (e.g., 'en', 'fr') for better accuracy (OpenAI) */
    language?: string;

    /** Voice Activity Detection - false to disable (OpenAI) */
    vad?: boolean;

    /** Noise reduction type (OpenAI) */
    noiseReduction?: 'near_field' | 'far_field' | null;
}

/**
 * Audio source for transcription
 */
export type TranscriptionAudioSource =
    | ReadableStream<Uint8Array> // Primary: server-side stream
    | AsyncIterable<Uint8Array> // Custom async iterators
    | (() => AsyncIterable<Uint8Array>) // Factory function
    | ArrayBuffer // Complete audio buffer
    | Uint8Array; // Raw audio data

/**
 * Transcription event types
 */
export type TranscriptionEventType =
    | 'transcription_start'
    | 'transcription_turn_delta'
    | 'transcription_turn_start'
    | 'transcription_turn_complete'
    | 'transcription_complete'
    | 'error';

/**
 * Base transcription event
 */
export interface TranscriptionEventBase {
    type: TranscriptionEventType;
    timestamp: string;
    agent?: AgentExportDefinition;
}

/**
 * Transcription start event
 */
export interface TranscriptionStartEvent extends TranscriptionEventBase {
    type: 'transcription_start';
    format: string;
    language?: string;
    audioFormat?: TranscriptionOpts['audioFormat'];
}

/**
 * Transcription delta event (for streaming)
 */
export interface TranscriptionTurnDeltaEvent extends TranscriptionEventBase {
    type: 'transcription_turn_delta';
    delta: string;
    partial?: boolean; // Always false for Gemini Live
}

/**
 * Transcription turn event (indicates end of a speaking turn)
 */
export interface TranscriptionTurnEvent extends TranscriptionEventBase {
    type: 'transcription_turn_start' | 'transcription_turn_complete';
    text?: string; // Cumulative text for the completed turn (added by ensembleListen)
}

/**
 * Transcription complete event
 */
export interface TranscriptionCompleteEvent extends TranscriptionEventBase {
    type: 'transcription_complete';
    text?: string;
    duration?: number;
}

/**
 * Transcription error event
 */
export interface TranscriptionErrorEvent extends TranscriptionEventBase {
    type: 'error';
    error: string;
}

/**
 * Union type for all transcription events
 */
export type TranscriptionEvent =
    | TranscriptionStartEvent
    | TranscriptionTurnDeltaEvent
    | TranscriptionTurnEvent
    | TranscriptionCompleteEvent
    | TranscriptionErrorEvent;

// ================================================================
// Live API Types
// ================================================================

/**
 * Response modality for Live API
 */
export type LiveResponseModality = 'TEXT' | 'AUDIO';

/**
 * Voice configuration for Live API
 */
export interface LiveVoiceConfig {
    /** Voice name to use for synthesis */
    voiceName?: string;
}

/**
 * Speech configuration for Live API
 */
export interface LiveSpeechConfig {
    /** Voice configuration */
    voiceConfig?: {
        prebuiltVoiceConfig?: LiveVoiceConfig;
    };
    /** Language code (e.g., 'en-US') */
    languageCode?: string;
}

/**
 * Voice Activity Detection configuration
 */
export interface LiveVADConfig {
    /** Whether VAD is disabled */
    disabled?: boolean;
    /** Sensitivity for detecting start of speech */
    startOfSpeechSensitivity?: 'START_SENSITIVITY_LOW' | 'START_SENSITIVITY_MEDIUM' | 'START_SENSITIVITY_HIGH';
    /** Sensitivity for detecting end of speech */
    endOfSpeechSensitivity?: 'END_SENSITIVITY_LOW' | 'END_SENSITIVITY_MEDIUM' | 'END_SENSITIVITY_HIGH';
    /** Milliseconds of audio to include before speech detection */
    prefixPaddingMs?: number;
    /** Milliseconds of silence before considering speech ended */
    silenceDurationMs?: number;
}

/**
 * Real-time input configuration for Live API
 */
export interface LiveRealtimeInputConfig {
    /** Voice Activity Detection configuration */
    automaticActivityDetection?: LiveVADConfig;
}

/**
 * Configuration for Live API session
 */
export interface LiveConfig {
    /** Response modality (TEXT or AUDIO) */
    responseModalities: [LiveResponseModality];
    /** Speech configuration for audio output */
    speechConfig?: LiveSpeechConfig;
    /** Real-time input configuration */
    realtimeInputConfig?: LiveRealtimeInputConfig;
    /** Whether to enable audio transcription for model output */
    outputAudioTranscription?: boolean | Record<string, never>;
    /** Whether to enable audio transcription for user input */
    inputAudioTranscription?: boolean | Record<string, never>;
    /** Tools available for the session */
    tools?: Array<{
        functionDeclarations?: ToolDefinition['function'][];
        codeExecution?: boolean | Record<string, never>;
        googleSearch?: boolean | Record<string, never>;
    }>;
    /** Media resolution for video input */
    mediaResolution?: 'MEDIA_RESOLUTION_LOW' | 'MEDIA_RESOLUTION_MEDIUM' | 'MEDIA_RESOLUTION_HIGH';
    /** Whether to enable affective dialog (native audio only) */
    enableAffectiveDialog?: boolean;
    /** Proactivity configuration (native audio only) */
    proactivity?: {
        proactiveAudio?: boolean;
    };
}

/**
 * Options for Live API
 */
export interface LiveOptions {
    /** Initial message history to establish context */
    messageHistory?: ResponseInput;
    /** Abort signal for cancelling the session */
    abortSignal?: AbortSignal;
    /** Whether to use sequential tool execution */
    sequentialTools?: boolean;
    /** Maximum number of tool calls allowed */
    maxToolCalls?: number;
    /** Maximum number of tool call rounds per turn */
    maxToolCallRoundsPerTurn?: number;
    /** API version (e.g., 'v1alpha' for experimental features) */
    apiVersion?: string;
}

/**
 * Audio blob for Live API
 */
export interface LiveAudioBlob {
    /** Base64-encoded audio data */
    data: string;
    /** MIME type with sample rate (e.g., 'audio/pcm;rate=16000') */
    mimeType: string;
}

/**
 * Live event types
 */
export type LiveEventType =
    | 'live_start'
    | 'live_ready'
    | 'audio_input'
    | 'audio_output'
    | 'text_delta'
    | 'message_delta'
    | 'tool_start'
    | 'tool_call'
    | 'tool_result'
    | 'tool_done'
    | 'turn_start'
    | 'turn_complete'
    | 'interrupted'
    | 'transcription_input'
    | 'transcription_output'
    | 'cost_update'
    | 'error'
    | 'live_end';

/**
 * Base Live event
 */
export interface LiveEventBase {
    type: LiveEventType;
    timestamp: string;
}

/**
 * Live start event
 */
export interface LiveStartEvent extends LiveEventBase {
    type: 'live_start';
    sessionId: string;
    config: LiveConfig;
}

/**
 * Live ready event (connection established)
 */
export interface LiveReadyEvent extends LiveEventBase {
    type: 'live_ready';
}

/**
 * Audio input event
 */
export interface LiveAudioInputEvent extends LiveEventBase {
    type: 'audio_input';
    /** Audio chunk size in bytes */
    size: number;
}

/**
 * Audio output event
 */
export interface LiveAudioOutputEvent extends LiveEventBase {
    type: 'audio_output';
    /** Base64-encoded audio data */
    data: string;
    /** Audio format info */
    format?: {
        sampleRate: number;
        channels: number;
        encoding: string;
    };
}

/**
 * Text delta event (for streaming text responses)
 */
export interface LiveTextDeltaEvent extends LiveEventBase {
    type: 'text_delta';
    delta: string;
}

/**
 * Message delta event (wrapper for compatibility)
 */
export interface LiveMessageDeltaEvent extends LiveEventBase {
    type: 'message_delta';
    delta: string;
}

/**
 * Turn start event
 */
export interface LiveTurnStartEvent extends LiveEventBase {
    type: 'turn_start';
    role: 'user' | 'model';
}

/**
 * Turn complete event
 */
export interface LiveTurnCompleteEvent extends LiveEventBase {
    type: 'turn_complete';
    role: 'user' | 'model';
    /** Complete message for the turn */
    message?: ResponseInputMessage | ResponseOutputMessage;
}

/**
 * Interrupted event (when user interrupts model)
 */
export interface LiveInterruptedEvent extends LiveEventBase {
    type: 'interrupted';
    /** IDs of cancelled tool calls */
    cancelledToolCalls?: string[];
}

/**
 * Input transcription event
 */
export interface LiveTranscriptionInputEvent extends LiveEventBase {
    type: 'transcription_input';
    text: string;
}

/**
 * Output transcription event
 */
export interface LiveTranscriptionOutputEvent extends LiveEventBase {
    type: 'transcription_output';
    text: string;
}

/**
 * Live tool events (reuse existing tool event types)
 */
export interface LiveToolStartEvent extends LiveEventBase {
    type: 'tool_start';
    toolCall: ToolCall;
}

export interface LiveToolCallEvent extends LiveEventBase {
    type: 'tool_call';
    toolCalls: ToolCall[];
}

export interface LiveToolResultEvent extends LiveEventBase {
    type: 'tool_result';
    toolCallResult: ToolCallResult;
}

export interface LiveToolDoneEvent extends LiveEventBase {
    type: 'tool_done';
    totalCalls: number;
}

/**
 * Live cost update event
 */
export interface LiveCostUpdateEvent extends LiveEventBase {
    type: 'cost_update';
    usage: {
        inputTokens: number;
        outputTokens: number;
        totalTokens: number;
        inputCost?: number;
        outputCost?: number;
        totalCost?: number;
    };
}

/**
 * Live error event
 */
export interface LiveErrorEvent extends LiveEventBase {
    type: 'error';
    error: string;
    code?: string;
    recoverable?: boolean;
}

/**
 * Live end event
 */
export interface LiveEndEvent extends LiveEventBase {
    type: 'live_end';
    reason?: string;
    duration?: number;
    totalTokens?: number;
    totalCost?: number;
}

/**
 * Union type for all Live events
 */
export type LiveEvent =
    | LiveStartEvent
    | LiveReadyEvent
    | LiveAudioInputEvent
    | LiveAudioOutputEvent
    | LiveTextDeltaEvent
    | LiveMessageDeltaEvent
    | LiveTurnStartEvent
    | LiveTurnCompleteEvent
    | LiveInterruptedEvent
    | LiveTranscriptionInputEvent
    | LiveTranscriptionOutputEvent
    | LiveToolStartEvent
    | LiveToolCallEvent
    | LiveToolResultEvent
    | LiveToolDoneEvent
    | LiveCostUpdateEvent
    | LiveErrorEvent
    | LiveEndEvent;
