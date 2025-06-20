// ================================================================
// Types for the Ensemble package - Self-contained
// ================================================================

export type ToolParameterType =
    | 'string'
    | 'number'
    | 'boolean'
    | 'object'
    | 'array'
    | 'null';

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

export type ExecutableFunction = (
    ...args: unknown[]
) => Promise<string> | string;

/**
 * Definition for a tool that can be used by an agent
 */
export interface ToolFunction {
    function: ExecutableFunction;
    definition: ToolDefinition;
    injectAgentId?: boolean;
    injectAbortSignal?: boolean;
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
    tool_choice?:
        | 'auto'
        | 'none'
        | 'required'
        | { type: string; function: { name: string } };
    sequential_tools?: boolean; // Run tools sequentially instead of in parallel
    json_schema?: ResponseJSONSchema; // JSON schema for structured output
    force_json?: boolean; // Force JSON output even if model doesn't natively support it
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
export type ResponseContent =
    | string
    | Array<
          ResponseContentText | ResponseContentImage | ResponseContentFileInput
      >;

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
    | 'agent_start'
    | 'agent_updated'
    | 'agent_done'
    | 'agent_status'
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
    type: 'task_complete' | 'task_fatal_error';
    result?: string;
}

/**
 * Cost update streaming event
 */
export interface CostUpdateEvent extends StreamEventBase {
    type: 'cost_update';
    usage: {
        input_tokens: number;
        output_tokens: number;
        total_tokens?: number;
        cached_tokens?: number;
    };
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
export interface AgentEvent extends StreamEventBase {
    type: 'agent_start' | 'agent_status' | 'agent_done';
    agent: AgentExportDefinition;
    input?: string;
    output?: string;
    status?: string;
    parent_id?: string;
}

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
        agent: AgentDefinition
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
        opts?: EmbedOpts
    ): Promise<number[] | number[][]>;

    /**
     * Generates images from text prompts
     * @param prompt Text description of the image to generate
     * @param opts Optional parameters for image generation
     * @returns Promise resolving to generated image data
     */
    createImage?(
        prompt: string,
        model?: string,
        opts?: ImageGenerationOpts
    ): Promise<string[]>;

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
        opts?: VoiceGenerationOpts
    ): Promise<ReadableStream<Uint8Array> | ArrayBuffer>;

    /**
     * Transcribes audio to text (Speech-to-Text)
     * @param audio Audio input to transcribe
     * @param model Model ID for STT (e.g., 'whisper-1')
     * @param opts Optional parameters for transcription
     * @returns AsyncGenerator that yields transcription events
     */
    createTranscription?(
        audio: TranscriptionAudioSource,
        model: string,
        opts?: TranscriptionOpts
    ): AsyncGenerator<TranscriptionEvent>;
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
    | 'search'
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

// Represents the cost structure for a model, potentially tiered or time-based
export interface ModelCost {
    // Cost components can be flat rate, token-tiered, or time-based
    input_per_million?: number | TieredPrice | TimeBasedPrice;
    output_per_million?: number | TieredPrice | TimeBasedPrice;
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
    streaming?: boolean; // Whether the model supports streaming responses
    json_output?: boolean; // Whether the model reliably outputs JSON
    max_output_tokens?: number; // Maximum output tokens for the model
    reasoning_output?: boolean; // Whether the model outputs reasoning steps
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
    model: string; // The ID of the model used (e.g., 'gemini-2.0-flash')
    cost?: number; // Calculated cost (optional, will be calculated if missing)
    input_tokens?: number; // Number of input tokens
    output_tokens?: number; // Number of output tokens
    cached_tokens?: number; // Number of cached input tokens
    image_count?: number; // Number of images generated (for models like Imagen)
    metadata?: Record<string, unknown>; // Additional metadata for usage tracking
    timestamp?: Date; // Timestamp of the usage, crucial for time-based pricing
    isFreeTierUsage?: boolean; // Flag for free tier usage override
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
        timestamp?: Date
    ): string;
    log_llm_response(
        requestId: string | undefined,
        responseData: unknown,
        timestamp?: Date
    ): void;
    log_llm_error(
        requestId: string | undefined,
        errorData: unknown,
        timestamp?: Date
    ): void;
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

// ================================================================
// Speech Transcription Types
// ================================================================

/**
 * Options for speech transcription (Speech-to-Text)
 */
export interface TranscriptionOpts {
    /** Language of the input audio in ISO-639-1 format (e.g., 'en', 'es', 'fr') */
    language?: string;

    /** Context prompt to guide the transcription */
    prompt?: string;

    /** Response format for the transcription */
    response_format?: 'json' | 'text' | 'srt' | 'verbose_json' | 'vtt';

    /** Temperature for sampling (0-1) */
    temperature?: number;

    /** Timestamp granularities to include */
    timestamp_granularities?: ('word' | 'segment')[];

    /** Whether to stream transcription results */
    stream?: boolean;

    /** Voice Activity Detection configuration */
    vad?: {
        /** Enable VAD (default: true for streaming) */
        enabled?: boolean;
        /** VAD mode: 'server_vad' (faster) or 'semantic_vad' (waits for complete thoughts) */
        mode?: 'server_vad' | 'semantic_vad';
        /** Threshold for detecting speech (0-1, default: 0.5) */
        threshold?: number;
        /** Milliseconds of audio to include before speech detection */
        prefix_padding_ms?: number;
        /** Milliseconds of silence before considering speech ended */
        silence_duration_ms?: number;
    };

    /** Audio format of the input stream */
    audio_format?: {
        /** Sample rate in Hz (e.g., 16000, 24000, 44100) */
        sampleRate?: number;
        /** Number of channels (1 for mono, 2 for stereo) */
        channels?: number;
        /** Bit depth (e.g., 16, 24, 32) */
        bitDepth?: number;
        /** Encoding format */
        encoding?: 'pcm' | 'opus' | 'flac';
    };

    /** Whether to include speaker diarization */
    diarization?: boolean;

    /** Maximum number of speakers to detect */
    max_speakers?: number;

    /** Whether to transcribe non-speech audio events */
    audio_events?: boolean;
}

/**
 * Audio source for transcription
 */
export type TranscriptionAudioSource =
    | ReadableStream<Uint8Array> // Browser MediaStream
    | ArrayBuffer // Complete audio buffer
    | Blob // Audio file blob
    | string; // Base64 encoded audio or URL

/**
 * Transcription event types
 */
export type TranscriptionEventType =
    | 'transcription_start'
    | 'transcription_delta'
    | 'transcription_complete'
    | 'vad_speech_start'
    | 'vad_speech_end'
    | 'speaker_change'
    | 'audio_event'
    | 'error'
    | 'cost_update';

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
    format: TranscriptionOpts['response_format'];
    language?: string;
    audio_format?: TranscriptionOpts['audio_format'];
}

/**
 * Transcription delta event (for streaming)
 */
export interface TranscriptionDeltaEvent extends TranscriptionEventBase {
    type: 'transcription_delta';
    delta: string;
    segment_id?: string;
    speaker_id?: string;
    start_time?: number;
    end_time?: number;
    confidence?: number;
}

/**
 * Transcription complete event
 */
export interface TranscriptionCompleteEvent extends TranscriptionEventBase {
    type: 'transcription_complete';
    text: string;
    segments?: TranscriptionSegment[];
    duration?: number;
    language?: string;
    speakers?: SpeakerInfo[];
}

/**
 * VAD speech events
 */
export interface VADSpeechEvent extends TranscriptionEventBase {
    type: 'vad_speech_start' | 'vad_speech_end';
    audio_ms?: number;
}

/**
 * Speaker change event
 */
export interface SpeakerChangeEvent extends TranscriptionEventBase {
    type: 'speaker_change';
    previous_speaker?: string;
    current_speaker: string;
    timestamp_ms: number;
}

/**
 * Audio event (non-speech sounds)
 */
export interface AudioEventDetection extends TranscriptionEventBase {
    type: 'audio_event';
    event_type: string; // e.g., 'laughter', 'applause', 'music'
    start_time: number;
    end_time: number;
    confidence: number;
}

/**
 * Transcription segment
 */
export interface TranscriptionSegment {
    id: string;
    text: string;
    start: number;
    end: number;
    speaker_id?: string;
    confidence?: number;
    words?: WordTimestamp[];
}

/**
 * Word-level timestamp
 */
export interface WordTimestamp {
    word: string;
    start: number;
    end: number;
    confidence?: number;
}

/**
 * Speaker information
 */
export interface SpeakerInfo {
    id: string;
    segments: number;
    total_duration: number;
}

/**
 * Union type for all transcription events
 */
export type TranscriptionEvent =
    | TranscriptionStartEvent
    | TranscriptionDeltaEvent
    | TranscriptionCompleteEvent
    | VADSpeechEvent
    | SpeakerChangeEvent
    | AudioEventDetection
    | ErrorEvent
    | CostUpdateEvent;

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
