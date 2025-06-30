import type { AgentDefinition, EmbedOpts } from '../types/types.js';
import { getModelProvider } from '../model_providers/model_provider.js';

const EMBEDDING_TTL_MS = 1000 * 60 * 60; // 1 hour
const EMBEDDING_CACHE_MAX = 1000;

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
 * Defaults to OpenAI's text-embedding-3-small model with 1536 dimensions
 * for consistent embeddings across applications.
 *
 * @param text - Text to embed
 * @param agent - Agent configuration (optional - defaults to text-embedding-3-small)
 * @param options - Optional configuration
 * @returns Promise that resolves to a normalized embedding vector
 *
 * @example
 * ```typescript
 * // Simple embedding
 * const embedding = await ensembleEmbed('Hello, world!');
 * console.log(`Embedding dimension: ${embedding.length}`);
 *
 * // With specific model
 * const embedding = await ensembleEmbed('Search query', {
 *   model: 'text-embedding-3-large'
 * });
 *
 * // With model class
 * const embedding = await ensembleEmbed('Document text', {
 *   modelClass: 'embedding'
 * });
 *
 * // Default is text-embedding-3-small with 1536 dimensions
 * const embedding = await ensembleEmbed('Default embedding', {});
 *
 * // Force specific dimensions (provider must support the requested dimensions)
 * const embedding768d = await ensembleEmbed('Compact embedding', agent, {
 *   dimensions: 768
 * });
 *
 * const embedding3072d = await ensembleEmbed('Large embedding', agent, {
 *   dimensions: 3072
 * });
 * ```
 */
export async function ensembleEmbed(text: string, agent: AgentDefinition, options?: EmbedOpts): Promise<number[]> {
    // Default to 1536 dimensions for text-embedding-3-small
    const dimensions = options?.dimensions || 1536;

    // Use a hash of the text and model as the cache key
    const cacheKey = `${agent.model || agent.modelClass}:${text}:${dimensions}`;

    // Check if we have a cached embedding
    const cached = embeddingCache.get(cacheKey);
    if (cached) {
        if (Date.now() - cached.timestamp.getTime() < EMBEDDING_TTL_MS) {
            return cached.embedding;
        }
        embeddingCache.delete(cacheKey);
    }

    // Determine which model to use - default to text-embedding-3-small if not specified
    const model = agent.model || 'text-embedding-3-small';

    // Get the provider for this model
    const provider = getModelProvider(model);

    if (!provider.createEmbedding) {
        throw new Error(`Provider for model ${model} does not support embeddings`);
    }

    // Generate the embedding using the provider with dimensions
    const result = await provider.createEmbedding(text, model, { ...options, dimensions });

    // Handle array result (single text input should return single vector)
    const embedding = Array.isArray(result[0]) ? result[0] : (result as number[]);

    // Cache the result with simple LRU eviction
    if (embeddingCache.size >= EMBEDDING_CACHE_MAX) {
        const oldestKey = embeddingCache.keys().next().value;
        if (oldestKey) embeddingCache.delete(oldestKey);
    }
    embeddingCache.set(cacheKey, {
        embedding,
        timestamp: new Date(),
    });

    return embedding;
}
