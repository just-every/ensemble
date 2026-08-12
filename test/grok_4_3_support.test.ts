import { describe, expect, it, vi } from 'vitest';
import { findModel } from '../data/model_data.js';
import { GrokProvider } from '../model_providers/grok.js';
import { getModelFromAgent, getModelProvider, getProviderFromModel } from '../model_providers/model_provider.js';

async function drain(stream: AsyncIterable<unknown>): Promise<void> {
    for await (const _event of stream) {
        // Intentionally empty.
    }
}

function emptyStream() {
    return {
        async *[Symbol.asyncIterator]() {
            // No-op stream.
        },
    };
}

describe('Grok 4.3 support', () => {
    it('registers Grok 4.3 with current xAI metadata', () => {
        expect(findModel('grok-4.3')).toMatchObject({
            id: 'grok-4.3',
            provider: 'xai',
            cost: {
                input_per_million: {
                    threshold_tokens: 200_000,
                    price_below_threshold_per_million: 1.25,
                    price_above_threshold_per_million: 2.5,
                },
                output_per_million: {
                    threshold_tokens: 200_000,
                    price_below_threshold_per_million: 2.5,
                    price_above_threshold_per_million: 5,
                },
            },
            features: {
                context_length: 1_000_000,
                input_modality: ['text', 'image'],
                output_modality: ['text'],
                tool_use: true,
                streaming: true,
                json_output: true,
            },
            class: 'reasoning',
        });
    });

    it('routes Grok 4.3 through the xAI provider and preserves reasoning suffixes', async () => {
        expect(getProviderFromModel('grok-4.3')).toBe('xai');
        expect(await getModelFromAgent({ agent_id: 'test-grok-4.3-high', model: 'grok-4.3-high' } as any)).toBe(
            'grok-4.3-high'
        );
    });

    it('registers Grok Build 0.1 as an xAI coding model', async () => {
        const model = findModel('grok-build');

        expect(model).toMatchObject({
            id: 'grok-build-0.1',
            provider: 'xai',
            cost: {
                input_per_million: {
                    threshold_tokens: 200_000,
                    price_below_threshold_per_million: 1,
                    price_above_threshold_per_million: 2,
                },
                output_per_million: {
                    threshold_tokens: 200_000,
                    price_below_threshold_per_million: 2,
                    price_above_threshold_per_million: 4,
                },
            },
            features: {
                context_length: 256000,
                input_modality: ['text', 'image'],
                output_modality: ['text'],
                tool_use: true,
                streaming: true,
                json_output: true,
            },
            class: 'code',
        });
        expect(getProviderFromModel('grok-build-0.1')).toBe('xai');
        expect(await getModelFromAgent({ agent_id: 'test-grok-build', model: 'grok-build' } as any)).toBe(
            'grok-build-0.1'
        );
    });

    it('maps Grok 4.3 reasoning suffixes to xAI reasoning_effort', async () => {
        const provider = new GrokProvider();
        const create = vi.fn().mockResolvedValue(emptyStream());
        (provider as any)._client = {
            chat: {
                completions: {
                    create,
                },
            },
        };

        await drain(
            provider.createResponseStream(
                [{ type: 'message', role: 'user', content: 'Return concise answer' }] as any,
                'grok-4.3-high',
                {
                    agent_id: 'test-grok-4.3-reasoning-suffix',
                } as any
            )
        );

        const requestParams = create.mock.calls.at(0)?.[0];
        expect(requestParams.model).toBe('grok-4.3');
        expect(requestParams.reasoning).toBeUndefined();
        expect(requestParams.reasoning_effort).toBe('high');
    });

    it('maps modelSettings.thinking_budget to Grok 4.3 reasoning_effort', async () => {
        const provider = new GrokProvider();
        const create = vi.fn().mockResolvedValue(emptyStream());
        (provider as any)._client = {
            chat: {
                completions: {
                    create,
                },
            },
        };

        await drain(
            provider.createResponseStream(
                [{ type: 'message', role: 'user', content: 'Return concise answer' }] as any,
                'grok-4.3',
                {
                    agent_id: 'test-grok-4.3-thinking-budget',
                    modelSettings: {
                        thinking_budget: 1500,
                    },
                } as any
            )
        );

        const requestParams = create.mock.calls.at(0)?.[0];
        expect(requestParams.model).toBe('grok-4.3');
        expect(requestParams.reasoning).toBeUndefined();
        expect(requestParams.reasoning_effort).toBe('low');
    });

    it('rejects retired Grok models and suffix variants with migration guidance', () => {
        expect(() => getModelProvider('grok-4-fast-reasoning-high')).toThrow('Migrate to grok-4.3-low');
        expect(() => getModelProvider('grok-4-fast-non-reasoning')).toThrow('Migrate to grok-4.3-none');
        expect(() => getModelProvider('grok-3')).toThrow('Migrate to grok-4.3-none');
        expect(findModel('grok-4-fast-reasoning')).toBeUndefined();
    });
});
