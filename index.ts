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

// Export unified request function as the main request API
export { unifiedRequest as request, RequestAgent, UnifiedRequestOptions } from './unified_request.js';

// Export utility classes
export { MessageHistory } from './utils/message_history.js';
export { EnsembleErrorHandler, ErrorCode, EnsembleError } from './utils/error_handler.js';
export { tool, ToolBuilder, createControlTools, createToolBatch } from './utils/tool_builder.js';

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
export { convertStreamToMessages, chainRequests } from './utils/stream_converter.js';
export * from './utils/delta_buffer.js';
export * from './utils/cost_tracker.js';
export * from './utils/quota_tracker.js';
export * from './utils/image_utils.js';
export * from './utils/llm_logger.js';
export { createToolFunction } from './utils/create_tool_function.js';
export type { ToolParameter, ToolParameterMap, ToolParameterType } from './utils/create_tool_function.js';

// Re-export singleton instances
import { costTracker as _costTracker } from './utils/cost_tracker.js';
import { quotaTracker as _quotaTracker } from './utils/quota_tracker.js';
export const costTracker = _costTracker;
export const quotaTracker = _quotaTracker;

// Core API imports for embed and image functions
import type {
    ResponseInput,
    ModelClassID,
    EnsembleStreamEvent,
    ImageGenerationOpts,
    ImageGenerationResult
} from './types.js';
import { getModelProvider, getModelFromClass, type EmbedOpts } from './model_providers/model_provider.js';

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

/**
 * Generate images from text prompts
 * 
 * @param prompt - Text description of the image to generate
 * @param options - Optional configuration for image generation
 * @returns Promise that resolves to an array of generated image data (base64 or URLs)
 * 
 * @example
 * ```typescript
 * // Simple image generation
 * const result = await image('A beautiful sunset over mountains');
 * console.log(`Generated ${result.images.length} image(s)`);
 * 
 * // With specific model and options
 * const result = await image('A robot holding a skateboard', {
 *   model: 'dall-e-3',
 *   size: 'landscape',
 *   quality: 'hd',
 *   n: 2
 * });
 * 
 * // Using Google Imagen
 * const result = await image('A serene lake at dawn', {
 *   model: 'imagen-3.0-generate-002',
 *   size: 'portrait'
 * });
 * 
 * // Get URLs instead of base64
 * const result = await image('Abstract art', {
 *   response_format: 'url'
 * });
 * ```
 */
export async function image(
    prompt: string,
    options: ImageGenerationOpts = {}
): Promise<ImageGenerationResult> {
    // Determine which model to use
    const modelToUse = options.model || await getModelFromClass('image_generation');
    
    // Get the provider for this model
    const provider = getModelProvider(modelToUse);
    
    if (!provider.generateImage) {
        throw new Error(
            `Provider for model ${modelToUse} does not support image generation`
        );
    }
    
    // Generate the image using the provider
    const result = await provider.generateImage(prompt, {
        ...options,
        model: modelToUse
    });
    
    return result;
}



// Export tool handling types
export * from './types/tool_types.js';
