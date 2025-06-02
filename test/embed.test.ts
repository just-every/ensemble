import { describe, it, expect, beforeEach } from 'vitest';
import { embed } from '../index.js';
import { testProviderConfig, resetTestProviderConfig } from '../model_providers/test_provider.js';

describe('Embedding Functions', () => {
    beforeEach(() => {
        // Reset test provider config before each test
        resetTestProviderConfig();
    });

    describe('embed', () => {
        it('should generate an embedding for text', async () => {
            const result = await embed('Hello, world!', { model: 'test-model' });

            expect(result).toBeDefined();
            expect(Array.isArray(result)).toBe(true);
            expect(result.length).toBe(384); // Default dimension
            expect(result.every(val => typeof val === 'number')).toBe(true);
            expect(result.every(val => val >= 0 && val <= 1)).toBe(true);
        });

        it('should generate embeddings for multiple texts sequentially', async () => {
            const texts = ['Hello', 'World', 'Test'];
            const results = [];
            
            for (const text of texts) {
                const embedding = await embed(text, { model: 'test-model' });
                results.push(embedding);
            }

            expect(results).toBeDefined();
            expect(Array.isArray(results)).toBe(true);
            expect(results.length).toBe(3);
            expect(results.every(embedding => Array.isArray(embedding))).toBe(true);
            expect(results.every(embedding => embedding.length === 384)).toBe(true);
        });

        it('should respect custom dimensions', async () => {
            const result = await embed('Test text', { 
                model: 'test-model', 
                opts: { dimension: 1536 }
            });

            expect(result).toBeDefined();
            expect(Array.isArray(result)).toBe(true);
            expect(result.length).toBe(1536);
        });

        it('should produce deterministic embeddings for the same input', async () => {
            const text = 'Deterministic test';
            const result1 = await embed(text, { model: 'test-model' });
            const result2 = await embed(text, { model: 'test-model' });

            expect(result1).toEqual(result2);
        });

        it('should produce different embeddings for different inputs', async () => {
            const result1 = await embed('First text', { model: 'test-model' });
            const result2 = await embed('Second text', { model: 'test-model' });

            expect(result1).not.toEqual(result2);
        });

        it('should handle empty string input', async () => {
            const result = await embed('', { model: 'test-model' });

            expect(result).toBeDefined();
            expect(Array.isArray(result)).toBe(true);
            expect(result.length).toBe(384);
            // Should still produce valid embeddings even for empty input
            expect(result.every(val => typeof val === 'number')).toBe(true);
        });
    });
});