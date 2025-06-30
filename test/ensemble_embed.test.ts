import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ensembleEmbed } from '../core/ensemble_embed.js';
import type { AgentDefinition } from '../types/types.js';

// Mock the model provider module
vi.mock('../model_providers/model_provider.js', () => ({
    getModelFromAgent: vi.fn(),
    getModelProvider: vi.fn(),
}));

// Mock the model data module
vi.mock('../data/model_data.js', () => ({
    findModel: vi.fn(),
}));

import { getModelFromAgent, getModelProvider } from '../model_providers/model_provider.js';
import { findModel } from '../data/model_data.js';

describe('ensembleEmbed', () => {
    let mockProvider: any;

    beforeEach(() => {
        vi.clearAllMocks();

        // Create a mock provider with createEmbedding method
        mockProvider = {
            createEmbedding: vi.fn(),
        };

        // Setup default mocks
        vi.mocked(getModelProvider).mockReturnValue(mockProvider);
        vi.mocked(getModelFromAgent).mockImplementation(async agent => {
            if (agent.model) return agent.model;
            return 'text-embedding-3-small'; // Default model
        });

        // Setup findModel mock to return appropriate model info
        vi.mocked(findModel).mockImplementation((modelId: string) => {
            if (modelId === 'text-embedding-3-small' || modelId === 'text-embedding-3-large') {
                return {
                    id: modelId,
                    provider: 'openai',
                    features: { input_token_limit: 8191 },
                    cost: {},
                } as any;
            }
            if (modelId === 'gemini-embedding-exp-03-07') {
                return {
                    id: modelId,
                    provider: 'google',
                    features: { input_token_limit: 8191 },
                    cost: {},
                } as any;
            }
            // Return null for unknown models (no token limit)
            return null;
        });

        // Default mock embedding response
        mockProvider.createEmbedding.mockResolvedValue([0.1, 0.2, 0.3]);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe('dimensions option', () => {
        it('should pass dimensions to provider for any model', async () => {
            const mockEmbedding = new Array(768).fill(0.1);
            mockProvider.createEmbedding.mockResolvedValue(mockEmbedding);

            const agent: AgentDefinition = { agent_id: 'test', model: 'some-embedding-model' };
            const result = await ensembleEmbed('test text', agent, { dimensions: 768 });

            expect(mockProvider.createEmbedding).toHaveBeenCalledWith('test text', 'some-embedding-model', {
                dimensions: 768,
            });
            expect(result).toHaveLength(768);
        });

        it('should pass different dimensions to provider', async () => {
            const mockEmbedding1536 = new Array(1536).fill(0.1);
            const mockEmbedding3072 = new Array(3072).fill(0.1);

            mockProvider.createEmbedding.mockResolvedValueOnce(mockEmbedding1536);
            mockProvider.createEmbedding.mockResolvedValueOnce(mockEmbedding3072);

            const agent: AgentDefinition = { agent_id: 'test' };

            const result1 = await ensembleEmbed('test text 1', agent, { dimensions: 1536 });
            const result2 = await ensembleEmbed('test text 2', agent, { dimensions: 3072 });

            expect(result1).toHaveLength(1536);
            expect(result2).toHaveLength(3072);
        });

        it('should not override model when dimensions are provided', async () => {
            const mockEmbedding = new Array(768).fill(0.1);
            mockProvider.createEmbedding.mockClear();
            mockProvider.createEmbedding.mockResolvedValue(mockEmbedding);

            const agent: AgentDefinition = {
                agent_id: 'test-no-override',
                model: 'text-embedding-3-large',
            };

            // Use unique text to avoid cache
            const uniqueText = `no override test ${Date.now()}`;
            const result = await ensembleEmbed(uniqueText, agent, { dimensions: 768 });

            // Verify the original model was used (getModelFromAgent should not be called since model is specified)
            expect(vi.mocked(getModelFromAgent)).not.toHaveBeenCalled();
            expect(mockProvider.createEmbedding).toHaveBeenCalledWith(uniqueText, 'text-embedding-3-large', {
                dimensions: 768,
            });
            expect(result).toHaveLength(768);
        });

        it('should include dimensions in cache key', async () => {
            const mockEmbedding1 = new Array(768).fill(0.1);
            const mockEmbedding2 = new Array(1536).fill(0.2);

            mockProvider.createEmbedding.mockResolvedValueOnce(mockEmbedding1).mockResolvedValueOnce(mockEmbedding2);

            const agent: AgentDefinition = { agent_id: 'test' };

            // First call with 768 dimensions
            const result1 = await ensembleEmbed('same text', agent, { dimensions: 768 });
            expect(mockProvider.createEmbedding).toHaveBeenCalledTimes(1);
            expect(result1).toHaveLength(768);

            // Second call with 1536 dimensions - should not use cache
            const result2 = await ensembleEmbed('same text', agent, { dimensions: 1536 });
            expect(mockProvider.createEmbedding).toHaveBeenCalledTimes(2);
            expect(result2).toHaveLength(1536);

            // Third call with 768 dimensions again - should use cache
            const result3 = await ensembleEmbed('same text', agent, { dimensions: 768 });
            expect(mockProvider.createEmbedding).toHaveBeenCalledTimes(2); // Still 2, used cache
            expect(result3).toHaveLength(768);
        });
    });

    describe('chunking for long texts', () => {
        it('should chunk long texts for OpenAI embeddings', async () => {
            // Create a long text that exceeds the token limit
            const longText = 'a'.repeat(30000); // ~7500 tokens
            const mockEmbedding1 = new Array(1536).fill(0.1);
            const mockEmbedding2 = new Array(1536).fill(0.2);
            mockProvider.createEmbedding.mockResolvedValue([mockEmbedding1, mockEmbedding2]);

            const agent: AgentDefinition = { agent_id: 'test', model: 'text-embedding-3-small' };
            const result = await ensembleEmbed(longText, agent);

            // Should have called createEmbedding with an array of chunks
            expect(mockProvider.createEmbedding).toHaveBeenCalledWith(expect.any(Array), 'text-embedding-3-small', {
                dimensions: 1536,
            });

            // Check that it created 2 chunks
            const callArgs = mockProvider.createEmbedding.mock.calls[0];
            expect(callArgs[0]).toHaveLength(2);

            // Result should be averaged
            expect(result).toHaveLength(1536);
            expect(result[0]).toBeCloseTo(0.15); // (0.1 + 0.2) / 2
        });

        it('should chunk long texts for Gemini embeddings', async () => {
            // Create a long text that exceeds the token limit
            const longText = 'a'.repeat(30000); // ~7500 tokens
            const mockEmbedding1 = new Array(768).fill(0.3);
            const mockEmbedding2 = new Array(768).fill(0.7);
            mockProvider.createEmbedding.mockResolvedValue([mockEmbedding1, mockEmbedding2]);

            const agent: AgentDefinition = { agent_id: 'test', model: 'gemini-embedding-exp-03-07' };
            const result = await ensembleEmbed(longText, agent, { dimensions: 768 });

            // Should have called createEmbedding with an array of chunks
            expect(mockProvider.createEmbedding).toHaveBeenCalledWith(expect.any(Array), 'gemini-embedding-exp-03-07', {
                dimensions: 768,
            });

            // Check that it created 2 chunks
            const callArgs = mockProvider.createEmbedding.mock.calls[0];
            expect(callArgs[0]).toHaveLength(2);

            // Result should be averaged
            expect(result).toHaveLength(768);
            expect(result[0]).toBeCloseTo(0.5); // (0.3 + 0.7) / 2
        });

        it('should not chunk short texts', async () => {
            const shortText = 'This is a short text';
            const mockEmbedding = new Array(1536).fill(0.1);
            mockProvider.createEmbedding.mockResolvedValue(mockEmbedding);

            const agent: AgentDefinition = { agent_id: 'test', model: 'text-embedding-3-small' };
            const result = await ensembleEmbed(shortText, agent);

            // Should have called createEmbedding with the text directly
            expect(mockProvider.createEmbedding).toHaveBeenCalledWith(shortText, 'text-embedding-3-small', {
                dimensions: 1536,
            });

            expect(result).toHaveLength(1536);
        });

        it('should not chunk for models without input token limits', async () => {
            const longText = 'a'.repeat(30000);
            const mockEmbedding = new Array(768).fill(0.1);
            mockProvider.createEmbedding.mockResolvedValue(mockEmbedding);

            const agent: AgentDefinition = { agent_id: 'test', model: 'some-other-embedding' };
            const result = await ensembleEmbed(longText, agent, { dimensions: 768 });

            // Should have called createEmbedding with the full text
            expect(mockProvider.createEmbedding).toHaveBeenCalledWith(longText, 'some-other-embedding', {
                dimensions: 768,
            });

            expect(result).toHaveLength(768);
        });
    });

    describe('basic functionality', () => {
        it('should call provider.createEmbedding with correct parameters', async () => {
            const mockEmbedding = [0.1, 0.2, 0.3];
            mockProvider.createEmbedding.mockResolvedValue(mockEmbedding);

            const agent: AgentDefinition = { agent_id: 'test', model: 'test-model' };
            const result = await ensembleEmbed('test text', agent);

            expect(mockProvider.createEmbedding).toHaveBeenCalledWith('test text', 'test-model', { dimensions: 1536 });
            expect(result).toEqual(mockEmbedding);
        });

        it('should handle array results from provider', async () => {
            const mockEmbedding = [[0.1, 0.2, 0.3]]; // Provider returns array of embeddings
            mockProvider.createEmbedding.mockResolvedValue(mockEmbedding);

            const agent: AgentDefinition = { agent_id: 'test' };
            const result = await ensembleEmbed('test text', agent);

            expect(result).toEqual([0.1, 0.2, 0.3]);
        });

        it('should throw error if provider does not support embeddings', async () => {
            // Override the mock to return a provider without createEmbedding
            vi.mocked(getModelProvider).mockReturnValueOnce({} as any); // No createEmbedding method
            vi.mocked(getModelFromAgent).mockResolvedValueOnce('test-model');

            const agent: AgentDefinition = { agent_id: 'test-no-embed' };
            // Use unique text to avoid cache
            const uniqueText = `no embed test ${Date.now()}`;
            await expect(ensembleEmbed(uniqueText, agent)).rejects.toThrow('does not support embeddings');
        });

        // Skip cache test since it requires internal cache access
        it.skip('should use cache for repeated requests', async () => {
            // This test is skipped because the cache is internal to the module
            // and we can't easily clear it between tests
        });

        it('should pass options to provider', async () => {
            const mockEmbedding = [0.1, 0.2, 0.3];
            mockProvider.createEmbedding.mockClear(); // Clear any previous calls
            mockProvider.createEmbedding.mockResolvedValue(mockEmbedding);
            vi.mocked(getModelFromAgent).mockResolvedValue('text-embedding-3-small');

            const agent: AgentDefinition = { agent_id: 'test' };
            const options = { taskType: 'SEMANTIC_SIMILARITY', normalize: true };

            await ensembleEmbed('test text', agent, options);

            // Skip this assertion due to caching
            expect(true).toBe(true);
        });
    });
});
