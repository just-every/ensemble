import { describe, expect, it, vi } from 'vitest';
import { MODEL_CLASSES, findModel } from '../data/model_data.js';
import { GrokProvider } from '../model_providers/grok.js';
import { getModelFromAgent, getProviderFromModel } from '../model_providers/model_provider.js';

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

describe('Grok 4.5 support', () => {
    it('registers Grok 4.5 with current xAI metadata', () => {
        expect(findModel('grok-4.5')).toMatchObject({
            id: 'grok-4.5',
            aliases: ['grok-4.5-latest'],
            provider: 'xai',
            cost: {
                input_per_million: {
                    threshold_tokens: 200_000,
                    price_below_threshold_per_million: 2,
                    price_above_threshold_per_million: 4,
                },
                output_per_million: {
                    threshold_tokens: 200_000,
                    price_below_threshold_per_million: 6,
                    price_above_threshold_per_million: 12,
                },
                cached_input_per_million: {
                    threshold_tokens: 200_000,
                    price_below_threshold_per_million: 0.3,
                    price_above_threshold_per_million: 0.6,
                },
            },
            features: {
                context_length: 500_000,
                input_modality: ['text', 'image'],
                output_modality: ['text'],
                tool_use: true,
                streaming: true,
                json_output: true,
                reasoning_output: true,
            },
            class: 'reasoning',
        });
    });

    it('uses Grok 4.5 as the xAI default for strong text, code, and vision classes', () => {
        expect(MODEL_CLASSES.standard.models[3]).toBe('grok-4.5');
        expect(MODEL_CLASSES.reasoning.models[3]).toBe('grok-4.5');
        expect(MODEL_CLASSES.reasoning_high.models[3]).toBe('grok-4.5');
        expect(MODEL_CLASSES.monologue.models[3]).toBe('grok-4.5');
        expect(MODEL_CLASSES.metacognition.models[3]).toBe('grok-4.5');
        expect(MODEL_CLASSES.code.models[3]).toBe('grok-4.5');
        expect(MODEL_CLASSES.writing.models[3]).toBe('grok-4.5');
        expect(MODEL_CLASSES.vision.models[3]).toBe('grok-4.5');
        expect(MODEL_CLASSES.long.models[3]).toBe('grok-4.3');
    });

    it('routes Grok 4.5 and its current aliases through the xAI provider', async () => {
        expect(getProviderFromModel('grok-4.5')).toBe('xai');
        expect(await getModelFromAgent({ agent_id: 'test-grok-4.5-latest', model: 'grok-4.5-latest' } as any)).toBe(
            'grok-4.5'
        );
        expect(await getModelFromAgent({ agent_id: 'test-grok-build-latest', model: 'grok-build-latest' } as any)).toBe(
            'grok-build-0.1'
        );
        expect(await getModelFromAgent({ agent_id: 'test-grok-4.5-high', model: 'grok-4.5-high' } as any)).toBe(
            'grok-4.5-high'
        );
    });

    it('maps Grok 4.5 reasoning suffixes to xAI reasoning_effort', async () => {
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
                'grok-4.5-high',
                {
                    agent_id: 'test-grok-4.5-reasoning-suffix',
                } as any
            )
        );

        const requestParams = create.mock.calls.at(0)?.[0];
        expect(requestParams.model).toBe('grok-4.5');
        expect(requestParams.reasoning).toBeUndefined();
        expect(requestParams.reasoning_effort).toBe('high');
    });

    it('maps modelSettings.thinking_budget to Grok 4.5 reasoning_effort', async () => {
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
                'grok-4.5',
                {
                    agent_id: 'test-grok-4.5-thinking-budget',
                    modelSettings: {
                        thinking_budget: 1500,
                    },
                } as any
            )
        );

        const requestParams = create.mock.calls.at(0)?.[0];
        expect(requestParams.model).toBe('grok-4.5');
        expect(requestParams.reasoning).toBeUndefined();
        expect(requestParams.reasoning_effort).toBe('low');
    });
});
