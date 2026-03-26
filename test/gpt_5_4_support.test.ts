import { describe, expect, it, vi } from 'vitest';
import { MODEL_CLASSES, findModel } from '../data/model_data.js';
import { getModelFromAgent } from '../model_providers/model_provider.js';
import { OpenAIProvider } from '../model_providers/openai.js';

async function drain(stream: AsyncIterable<unknown>): Promise<void> {
    for await (const _event of stream) {
        // Intentionally empty: we only need the provider to build the request.
    }
}

function emptyStream() {
    return {
        async *[Symbol.asyncIterator]() {
            // No-op
        },
    };
}

describe('GPT-5.4 support', () => {
    it('registers the GPT-5.4 family with current aliases and metadata', () => {
        const flagship = findModel('gpt-5.4');
        const flagshipAlias = findModel('gpt-5.4-2026-03-05');
        const pro = findModel('gpt-5.4-pro');
        const proAlias = findModel('gpt-5.4-pro-2026-03-05');
        const mini = findModel('gpt-5.4-mini');
        const miniAlias = findModel('gpt-5.4-mini-2026-03-17');
        const nano = findModel('gpt-5.4-nano');
        const nanoAlias = findModel('gpt-5.4-nano-2026-03-17');

        expect(flagship?.id).toBe('gpt-5.4');
        expect(flagshipAlias?.id).toBe('gpt-5.4');
        expect(flagship?.features?.context_length).toBe(1050000);
        expect(flagship?.features?.max_output_tokens).toBe(128000);
        expect(flagship?.cost?.input_per_million).toBe(2.5);
        expect(flagship?.cost?.cached_input_per_million).toBe(0.25);
        expect(flagship?.cost?.output_per_million).toBe(15.0);

        expect(pro?.id).toBe('gpt-5.4-pro');
        expect(proAlias?.id).toBe('gpt-5.4-pro');
        expect(pro?.features?.context_length).toBe(1050000);
        expect(pro?.features?.max_output_tokens).toBe(128000);
        expect(pro?.features?.json_output).toBe(false);
        expect(pro?.cost?.input_per_million).toBe(30.0);
        expect(pro?.cost?.output_per_million).toBe(180.0);

        expect(mini?.id).toBe('gpt-5.4-mini');
        expect(miniAlias?.id).toBe('gpt-5.4-mini');
        expect(mini?.features?.context_length).toBe(400000);
        expect(mini?.features?.max_output_tokens).toBe(128000);
        expect(mini?.cost?.input_per_million).toBe(0.75);
        expect(mini?.cost?.cached_input_per_million).toBe(0.075);
        expect(mini?.cost?.output_per_million).toBe(4.5);

        expect(nano?.id).toBe('gpt-5.4-nano');
        expect(nanoAlias?.id).toBe('gpt-5.4-nano');
        expect(nano?.features?.context_length).toBe(400000);
        expect(nano?.features?.max_output_tokens).toBe(128000);
        expect(nano?.cost?.input_per_million).toBe(0.2);
        expect(nano?.cost?.cached_input_per_million).toBe(0.02);
        expect(nano?.cost?.output_per_million).toBe(1.25);
    });

    it('updates the OpenAI defaults across GPT-5.4 family model classes', () => {
        expect(MODEL_CLASSES.mini.models[0]).toBe('gpt-5.4-nano');
        expect(MODEL_CLASSES.reasoning.models[0]).toBe('gpt-5.4');
        expect(MODEL_CLASSES.reasoning_high.models[0]).toBe('gpt-5.4-pro');
        expect(MODEL_CLASSES.reasoning_mini.models[0]).toBe('gpt-5.4-mini');
        expect(MODEL_CLASSES.metacognition.models[0]).toBe('gpt-5.4');
        expect(MODEL_CLASSES.vision.models[0]).toBe('gpt-5.4');
        expect(MODEL_CLASSES.vision_mini.models[0]).toBe('gpt-5.4-mini');
        expect(MODEL_CLASSES.long.models[0]).toBe('gpt-5.4');
    });

    it('normalizes dated GPT-5.4 aliases back to their canonical model IDs', async () => {
        const flagship = await getModelFromAgent({
            agent_id: 'test-gpt-5.4-alias',
            model: 'gpt-5.4-2026-03-05',
        } as any);
        const pro = await getModelFromAgent({
            agent_id: 'test-gpt-5.4-pro-alias',
            model: 'gpt-5.4-pro-2026-03-05',
        } as any);
        const mini = await getModelFromAgent({
            agent_id: 'test-gpt-5.4-mini-alias',
            model: 'gpt-5.4-mini-2026-03-17',
        } as any);
        const nano = await getModelFromAgent({
            agent_id: 'test-gpt-5.4-nano-alias',
            model: 'gpt-5.4-nano-2026-03-17',
        } as any);

        expect(flagship).toBe('gpt-5.4');
        expect(pro).toBe('gpt-5.4-pro');
        expect(mini).toBe('gpt-5.4-mini');
        expect(nano).toBe('gpt-5.4-nano');
    });

    it('keeps sampling params for GPT-5.4 when using the default effort=none behavior', async () => {
        const provider = new OpenAIProvider('sk-test');
        const create = vi.fn().mockResolvedValue(emptyStream());
        (provider as any)._client = {
            responses: {
                create,
            },
        };

        await drain(
            provider.createResponseStream(
                [{ type: 'message', role: 'user', content: 'Hello there' }] as any,
                'gpt-5.4',
                {
                    agent_id: 'test-gpt-5.4-request',
                    modelSettings: {
                        temperature: 0.7,
                        top_p: 0.9,
                    },
                } as any
            )
        );

        const requestParams = create.mock.calls.at(0)?.[0];
        expect(requestParams.model).toBe('gpt-5.4');
        expect(requestParams.reasoning).toBeUndefined();
        expect(requestParams.temperature).toBe(0.7);
        expect(requestParams.top_p).toBe(0.9);
    });

    it('keeps sampling params for GPT-5.4 mini when using the default effort=none behavior', async () => {
        const provider = new OpenAIProvider('sk-test');
        const create = vi.fn().mockResolvedValue(emptyStream());
        (provider as any)._client = {
            responses: {
                create,
            },
        };

        await drain(
            provider.createResponseStream(
                [{ type: 'message', role: 'user', content: 'Summarize this quickly' }] as any,
                'gpt-5.4-mini',
                {
                    agent_id: 'test-gpt-5.4-mini-request',
                    modelSettings: {
                        temperature: 0.7,
                        top_p: 0.9,
                    },
                } as any
            )
        );

        const requestParams = create.mock.calls.at(0)?.[0];
        expect(requestParams.model).toBe('gpt-5.4-mini');
        expect(requestParams.reasoning).toBeUndefined();
        expect(requestParams.temperature).toBe(0.7);
        expect(requestParams.top_p).toBe(0.9);
    });

    it('keeps sampling params for GPT-5.4 nano when using the default effort=none behavior', async () => {
        const provider = new OpenAIProvider('sk-test');
        const create = vi.fn().mockResolvedValue(emptyStream());
        (provider as any)._client = {
            responses: {
                create,
            },
        };

        await drain(
            provider.createResponseStream(
                [{ type: 'message', role: 'user', content: 'Extract the key fields' }] as any,
                'gpt-5.4-nano',
                {
                    agent_id: 'test-gpt-5.4-nano-request',
                    modelSettings: {
                        temperature: 0.7,
                        top_p: 0.9,
                    },
                } as any
            )
        );

        const requestParams = create.mock.calls.at(0)?.[0];
        expect(requestParams.model).toBe('gpt-5.4-nano');
        expect(requestParams.reasoning).toBeUndefined();
        expect(requestParams.temperature).toBe(0.7);
        expect(requestParams.top_p).toBe(0.9);
    });

    it('maps modelSettings.thinking_budget to OpenAI reasoning effort', async () => {
        const provider = new OpenAIProvider('sk-test');
        const create = vi.fn().mockResolvedValue(emptyStream());
        (provider as any)._client = {
            responses: {
                create,
            },
        };

        await drain(
            provider.createResponseStream(
                [{ type: 'message', role: 'user', content: 'Return concise answer' }] as any,
                'gpt-5.4',
                {
                    agent_id: 'test-gpt-thinking-budget',
                    modelSettings: {
                        thinking_budget: 0,
                    },
                } as any
            )
        );

        const requestParams = create.mock.calls.at(0)?.[0];
        expect(requestParams?.model).toBe('gpt-5.4');
        expect(requestParams?.reasoning).toEqual({ effort: 'none' });
    });

    it('defaults GPT-5.4 Pro to high reasoning and strips unsupported sampling params', async () => {
        const provider = new OpenAIProvider('sk-test');
        const create = vi.fn().mockResolvedValue(emptyStream());
        (provider as any)._client = {
            responses: {
                create,
            },
        };

        await drain(
            provider.createResponseStream(
                [{ type: 'message', role: 'user', content: 'Solve this carefully' }] as any,
                'gpt-5.4-pro',
                {
                    agent_id: 'test-gpt-5.4-pro-request',
                    modelSettings: {
                        temperature: 0.7,
                        top_p: 0.9,
                    },
                } as any
            )
        );

        const requestParams = create.mock.calls.at(0)?.[0];
        expect(requestParams.model).toBe('gpt-5.4-pro');
        expect(requestParams.reasoning).toEqual({
            effort: 'high',
            summary: 'auto',
        });
        expect(requestParams.temperature).toBeUndefined();
        expect(requestParams.top_p).toBeUndefined();
    });
});
