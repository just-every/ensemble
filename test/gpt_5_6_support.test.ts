import { describe, expect, it, vi } from 'vitest';
import { findModel } from '../data/model_data.js';
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

describe('GPT-5.6 support', () => {
    it('registers the Sol, Terra, and Luna models with their pricing and limits', () => {
        const sol = findModel('gpt-5.6-sol');
        const alias = findModel('gpt-5.6');
        const terra = findModel('gpt-5.6-terra');
        const luna = findModel('gpt-5.6-luna');

        expect(sol?.id).toBe('gpt-5.6-sol');
        expect(alias?.id).toBe('gpt-5.6-sol');
        expect(terra?.id).toBe('gpt-5.6-terra');
        expect(luna?.id).toBe('gpt-5.6-luna');

        for (const model of [sol, terra, luna]) {
            expect(model?.features).toMatchObject({
                context_length: 1050000,
                max_output_tokens: 128000,
                input_modality: ['text', 'image'],
                output_modality: ['text'],
                tool_use: true,
                streaming: true,
                json_output: true,
            });
        }

        expect(sol?.cost?.input_per_million).toMatchObject({
            price_below_threshold_per_million: 5,
            price_above_threshold_per_million: 10,
        });
        expect(terra?.cost?.input_per_million).toMatchObject({
            price_below_threshold_per_million: 2,
            price_above_threshold_per_million: 4,
        });
        expect(luna?.cost?.input_per_million).toMatchObject({
            price_below_threshold_per_million: 0.2,
            price_above_threshold_per_million: 0.4,
        });
        expect(terra?.cost?.cached_input_per_million).toMatchObject({
            price_below_threshold_per_million: 0.2,
            price_above_threshold_per_million: 0.4,
        });
        expect(terra?.cost?.output_per_million).toMatchObject({
            price_below_threshold_per_million: 12,
            price_above_threshold_per_million: 18,
        });
        expect(luna?.cost?.cached_input_per_million).toMatchObject({
            price_below_threshold_per_million: 0.02,
            price_above_threshold_per_million: 0.04,
        });
        expect(luna?.cost?.output_per_million).toMatchObject({
            price_below_threshold_per_million: 1.2,
            price_above_threshold_per_million: 1.8,
        });
    });

    it('normalizes the GPT-5.6 alias to Sol', async () => {
        await expect(getModelFromAgent({ agent_id: 'test-gpt-5.6', model: 'gpt-5.6' } as any)).resolves.toBe(
            'gpt-5.6-sol'
        );
    });

    it('sends the GPT-5.6 max reasoning effort and pro mode to Responses', async () => {
        const provider = new OpenAIProvider('sk-test');
        const create = vi.fn().mockResolvedValue(emptyStream());
        (provider as any)._client = {
            responses: {
                create,
            },
        };

        await drain(
            provider.createResponseStream(
                [{ type: 'message', role: 'user', content: 'Solve the hardest version of this task.' }] as any,
                'gpt-5.6-sol-max',
                {
                    agent_id: 'test-gpt-5.6-max',
                    modelSettings: { reasoning_mode: 'pro' },
                } as any
            )
        );

        const requestParams = create.mock.calls.at(0)?.[0];
        expect(requestParams.model).toBe('gpt-5.6-sol');
        expect(requestParams.reasoning).toEqual({
            effort: 'max',
            summary: 'auto',
            mode: 'pro',
        });
    });

    it('does not reinterpret the existing gpt-5.1-codex-max model as an effort suffix', async () => {
        const provider = new OpenAIProvider('sk-test');
        const create = vi.fn().mockResolvedValue(emptyStream());
        (provider as any)._client = {
            responses: {
                create,
            },
        };

        await drain(
            provider.createResponseStream(
                [{ type: 'message', role: 'user', content: 'Implement this change.' }] as any,
                'gpt-5.1-codex-max',
                { agent_id: 'test-gpt-5.1-codex-max' } as any
            )
        );

        const requestParams = create.mock.calls.at(0)?.[0];
        expect(requestParams.model).toBe('gpt-5.1-codex-max');
        expect(requestParams.reasoning).toBeUndefined();
    });
});
