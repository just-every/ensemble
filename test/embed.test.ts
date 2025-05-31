import { describe, it, expect, beforeEach, vi } from 'vitest';
import { embed } from '../index.js';
import { getModelProvider } from '../model_providers/model_provider.js';

// Mock the model provider
vi.mock('../model_providers/model_provider.js', () => ({
    getModelProvider: vi.fn(),
    getModelFromClass: vi.fn(() => 'test-embedding-model')
}));

describe('Embedding Functions', () => {
    let mockProvider: any;

    beforeEach(() => {
        // Clear mocks and cache
        vi.clearAllMocks();
        
        // Create mock provider
        mockProvider = {
            createEmbedding: vi.fn()
        };
        
        // Setup getModelProvider mock
        (getModelProvider as any).mockReturnValue(mockProvider);
    });

    describe('embed', () => {
        it('should generate an embedding for text', async () => {
            const mockEmbedding = new Array(384).fill(0).map(() => Math.random());
            mockProvider.createEmbedding.mockResolvedValue(mockEmbedding);

            const result = await embed('Hello, world!');

            expect(result).toEqual(mockEmbedding);
            expect(mockProvider.createEmbedding).toHaveBeenCalledWith(
                'test-embedding-model',
                'Hello, world!',
                undefined
            );
        });

        it('should use specific model when provided', async () => {
            const mockEmbedding = new Array(1536).fill(0).map(() => Math.random());
            mockProvider.createEmbedding.mockResolvedValue(mockEmbedding);

            const result = await embed('Test text', { model: 'text-embedding-3-small' });

            expect(result).toEqual(mockEmbedding);
            expect(mockProvider.createEmbedding).toHaveBeenCalledWith(
                'text-embedding-3-small',
                'Test text',
                undefined
            );
        });

        it('should cache embeddings', async () => {
            const mockEmbedding = new Array(384).fill(0).map(() => Math.random());
            mockProvider.createEmbedding.mockResolvedValue(mockEmbedding);

            // First call
            const result1 = await embed('Cached text');
            // Second call (should use cache)
            const result2 = await embed('Cached text');

            expect(result1).toEqual(result2);
            expect(mockProvider.createEmbedding).toHaveBeenCalledTimes(1);
        });

        it('should handle array results from provider', async () => {
            const mockEmbedding = new Array(384).fill(0).map(() => Math.random());
            // Provider returns array of arrays
            mockProvider.createEmbedding.mockResolvedValue([mockEmbedding]);

            const result = await embed('Array result');

            expect(result).toEqual(mockEmbedding);
        });

        it('should throw error if provider does not support embeddings', async () => {
            // Remove createEmbedding method
            delete mockProvider.createEmbedding;

            await expect(embed('No support')).rejects.toThrow(
                'Provider for model test-embedding-model does not support embeddings'
            );
        });

        it('should pass through embedding options', async () => {
            const mockEmbedding = new Array(768).fill(0).map(() => Math.random());
            mockProvider.createEmbedding.mockResolvedValue(mockEmbedding);

            const opts = { taskType: 'SEMANTIC_SIMILARITY', dimensions: 768 };
            await embed('With options', { opts });

            expect(mockProvider.createEmbedding).toHaveBeenCalledWith(
                'test-embedding-model',
                'With options',
                opts
            );
        });
    });

});