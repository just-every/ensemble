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

describe('Grok 4.3 support', () => {
    it('registers Grok 4.3 with current xAI metadata', () => {
        expect(findModel('grok-4.3')).toMatchObject({
            id: 'grok-4.3',
            provider: 'xai',
            cost: {
                input_per_million: 1.25,
                output_per_million: 2.5,
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

    it('uses Grok 4.3 as the xAI default for strong text and vision classes', () => {
        expect(MODEL_CLASSES.standard.models[3]).toBe('grok-4.3');
        expect(MODEL_CLASSES.reasoning.models[3]).toBe('grok-4.3');
        expect(MODEL_CLASSES.reasoning_high.models[3]).toBe('grok-4.3');
        expect(MODEL_CLASSES.monologue.models[3]).toBe('grok-4.3');
        expect(MODEL_CLASSES.metacognition.models[3]).toBe('grok-4.3');
        expect(MODEL_CLASSES.code.models[3]).toBe('grok-4.3');
        expect(MODEL_CLASSES.writing.models[3]).toBe('grok-4.3');
        expect(MODEL_CLASSES.vision.models[3]).toBe('grok-4.3');
        expect(MODEL_CLASSES.long.models[3]).toBe('grok-4.3');
    });

    it('routes Grok 4.3 through the xAI provider and preserves reasoning suffixes', async () => {
        expect(getProviderFromModel('grok-4.3')).toBe('xai');
        expect(await getModelFromAgent({ agent_id: 'test-grok-4.3-high', model: 'grok-4.3-high' } as any)).toBe(
            'grok-4.3-high'
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

    it('keeps legacy Grok reasoning request shape unchanged', async () => {
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
                'grok-4-fast-reasoning-high',
                {
                    agent_id: 'test-grok-legacy-reasoning-suffix',
                } as any
            )
        );

        const requestParams = create.mock.calls.at(0)?.[0];
        expect(requestParams.model).toBe('grok-4-fast-reasoning');
        expect(requestParams.reasoning).toEqual({ effort: 'high' });
        expect(requestParams.reasoning_effort).toBeUndefined();
    });
});
