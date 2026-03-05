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
    it('registers canonical GPT-5.4 models with dated aliases and metadata', () => {
        const flagship = findModel('gpt-5.4');
        const flagshipAlias = findModel('gpt-5.4-2026-02-27');
        const pro = findModel('gpt-5.4-pro');
        const proAlias = findModel('gpt-5.4-pro-2026-02-27');

        expect(flagship?.id).toBe('gpt-5.4');
        expect(flagshipAlias?.id).toBe('gpt-5.4');
        expect(flagship?.features?.context_length).toBe(1050000);
        expect(flagship?.features?.max_output_tokens).toBe(128000);
        expect(flagship?.cost?.input_per_million).toBe(2.0);
        expect(flagship?.cost?.cached_input_per_million).toBe(0.5);
        expect(flagship?.cost?.output_per_million).toBe(16.0);

        expect(pro?.id).toBe('gpt-5.4-pro');
        expect(proAlias?.id).toBe('gpt-5.4-pro');
        expect(pro?.features?.context_length).toBe(1050000);
        expect(pro?.features?.max_output_tokens).toBe(128000);
        expect(pro?.features?.json_output).toBe(false);
        expect(pro?.cost?.input_per_million).toBe(24.0);
        expect(pro?.cost?.output_per_million).toBe(192.0);
    });

    it('upgrades the OpenAI picks for reasoning-heavy model classes', () => {
        expect(MODEL_CLASSES.reasoning.models[0]).toBe('gpt-5.4');
        expect(MODEL_CLASSES.reasoning_high.models[0]).toBe('gpt-5.4-pro');
        expect(MODEL_CLASSES.metacognition.models[0]).toBe('gpt-5.4');
        expect(MODEL_CLASSES.vision.models[0]).toBe('gpt-5.4');
        expect(MODEL_CLASSES.long.models[0]).toBe('gpt-5.4');
    });

    it('normalizes dated GPT-5.4 aliases back to their canonical model IDs', async () => {
        const flagship = await getModelFromAgent({
            agent_id: 'test-gpt-5.4-alias',
            model: 'gpt-5.4-2026-02-27',
        } as any);
        const pro = await getModelFromAgent({
            agent_id: 'test-gpt-5.4-pro-alias',
            model: 'gpt-5.4-pro-2026-02-27',
        } as any);

        expect(flagship).toBe('gpt-5.4');
        expect(pro).toBe('gpt-5.4-pro');
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
