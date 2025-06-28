import type { AgentDefinition, EmbedOpts } from '../types/types.js';
import { getModelFromAgent, getModelProvider } from '../model_providers/model_provider.js';

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
 * @param text - Text to embed
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
 * // Force specific dimensions (auto-selects appropriate model)
 * const embedding768d = await ensembleEmbed('Compact embedding', {}, {
 *   dimensions: 768  // Uses gemini-embedding-exp-03-07
 * });
 *
 * const embedding1536d = await ensembleEmbed('Standard embedding', {}, {
 *   dimensions: 1536  // Uses text-embedding-3-small
 * });
 * ```
 */
export async function ensembleEmbed(text: string, agent: AgentDefinition, options?: EmbedOpts): Promise<number[]> {
    // If dimensions are specified, override the agent to use a model with matching dimensions
    let effectiveAgent = agent;
    if (options?.dimensions) {
        // Map dimensions to specific models
        const dimensionModelMap: Record<number, string> = {
            768: 'gemini-embedding-exp-03-07',
            1536: 'text-embedding-3-small',
            3072: 'text-embedding-3-large',
        };

        const modelForDimension = dimensionModelMap[options.dimensions];
        if (modelForDimension) {
            // Override the agent with the specific model
            effectiveAgent = { ...agent, model: modelForDimension };
        } else {
            throw new Error(
                `No embedding model available with ${options.dimensions} dimensions. Available: 768, 1536, 3072`
            );
        }
    }

    // Use a hash of the text and model as the cache key
    const cacheKey = `${effectiveAgent.model || effectiveAgent.modelClass}:${text}:${options?.dimensions || ''}`;

    // Check if we have a cached embedding
    const cached = embeddingCache.get(cacheKey);
    if (cached) {
        if (Date.now() - cached.timestamp.getTime() < EMBEDDING_TTL_MS) {
            return cached.embedding;
        }
        embeddingCache.delete(cacheKey);
    }

    // Determine which model to use
    const model = await getModelFromAgent(effectiveAgent, 'embedding');

    // Get the provider for this model
    const provider = getModelProvider(model);

    if (!provider.createEmbedding) {
        throw new Error(`Provider for model ${model} does not support embeddings`);
    }

    // Generate the embedding using the provider
    const result = await provider.createEmbedding(text, model, options);

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
