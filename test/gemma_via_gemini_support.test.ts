import { describe, expect, it, vi } from 'vitest';
import { findModel } from '../data/model_data.js';
import { GeminiProvider } from '../model_providers/gemini.js';
import { getModelFromAgent, getModelProvider, getProviderFromModel } from '../model_providers/model_provider.js';
import { geminiProvider } from '../model_providers/gemini.js';

function makeTextStream(text = 'ok') {
    return {
        async *[Symbol.asyncIterator]() {
            yield {
                candidates: [
                    {
                        content: {
                            parts: [{ text }],
                        },
                    },
                ],
                usageMetadata: {
                    promptTokenCount: 4,
                    candidatesTokenCount: 1,
                    totalTokenCount: 5,
                },
            };
        },
    };
}

describe('Gemma via Gemini API support', () => {
    it('registers hosted Gemma 4 models with Google provider metadata', async () => {
        const fast = findModel('gemma-4-26b-a4b-it');
        const fastAlias = findModel('models/gemma-4-26b-a4b-it');
        const dense = findModel('gemma-4-31b-it');

        expect(fast?.id).toBe('gemma-4-26b-a4b-it');
        expect(fastAlias?.id).toBe('gemma-4-26b-a4b-it');
        expect(dense?.id).toBe('gemma-4-31b-it');
        expect(fast?.provider).toBe('google');
        expect(dense?.provider).toBe('google');
        expect(fast?.cost).toMatchObject({
            input_per_million: 0,
            output_per_million: 0,
            cached_input_per_million: 0,
        });
        expect(fast?.features).toMatchObject({
            context_length: 262144,
            max_output_tokens: 32768,
            input_modality: ['text', 'image'],
            output_modality: ['text'],
            tool_use: true,
            streaming: true,
            json_output: true,
        });

        await expect(
            getModelFromAgent({ agent_id: 'test-gemma', model: 'models/gemma-4-26b-a4b-it' } as any)
        ).resolves.toBe('gemma-4-26b-a4b-it');
    });

    it('routes Gemma model IDs to the Gemini provider', () => {
        process.env.GOOGLE_API_KEY = process.env.GOOGLE_API_KEY || 'test-key';

        expect(getProviderFromModel('gemma-4-26b-a4b-it')).toBe('google');
        expect(getProviderFromModel('gemma-4-31b-it')).toBe('google');
        expect(getModelProvider('gemma-4-26b-a4b-it')).toBe(geminiProvider);
    });

    it('omits thinkingConfig for plain Gemma text requests', async () => {
        const provider = new GeminiProvider('test-key');
        const generateContentStream = vi.fn().mockResolvedValue(makeTextStream());

        (provider as any)._client = {
            models: {
                generateContentStream,
            },
        };

        const stream = provider.createResponseStream(
            [{ type: 'message', role: 'user', content: 'Say ok.' }] as any,
            'gemma-4-26b-a4b-it',
            { agent_id: 'test-gemma-plain' } as any,
            'req-gemma-plain'
        );

        for await (const _event of stream) {
            // Drain stream.
        }

        const requestArg = generateContentStream.mock.calls.at(0)?.[0] as any;
        expect(requestArg?.model).toBe('gemma-4-26b-a4b-it');
        expect(requestArg?.config?.thinkingConfig).toBeUndefined();
    });

    it('maps Gemma high thinking suffix to Gemini thinkingLevel high', async () => {
        const provider = new GeminiProvider('test-key');
        const generateContentStream = vi.fn().mockResolvedValue(makeTextStream());

        (provider as any)._client = {
            models: {
                generateContentStream,
            },
        };

        const stream = provider.createResponseStream(
            [{ type: 'message', role: 'user', content: 'Say ok.' }] as any,
            'gemma-4-26b-a4b-it-high',
            { agent_id: 'test-gemma-high' } as any,
            'req-gemma-high'
        );

        for await (const _event of stream) {
            // Drain stream.
        }

        const requestArg = generateContentStream.mock.calls.at(0)?.[0] as any;
        expect(requestArg?.model).toBe('gemma-4-26b-a4b-it');
        expect(requestArg?.config?.thinkingConfig).toEqual({ thinkingLevel: 'HIGH' });
    });
});
