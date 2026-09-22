import { describe, expect, it, vi } from 'vitest';
import { findModel } from '../data/model_data.js';
import { OpenAIProvider } from '../model_providers/openai.js';
import { getModelFromAgent, getProviderFromModel } from '../model_providers/model_provider.js';
import { CostTracker } from '../utils/cost_tracker.js';
import { normalizeOpenAIResponsesUsage } from '../utils/provider_usage.js';

function emptyStream() {
    return { async *[Symbol.asyncIterator]() {} };
}

async function drain(stream: AsyncIterable<unknown>): Promise<void> {
    for await (const _event of stream) {
        // Only request construction is under test.
    }
}

describe('GPT-6 support', () => {
    it.each([
        {
            id: 'gpt-6-sol',
            input: 2,
            cached: 0.2,
            cacheWrite: 2.5,
            output: 10,
            inputAbove: 4,
            cachedAbove: 0.4,
            cacheWriteAbove: 5,
            outputAbove: 15,
        },
        {
            id: 'gpt-6-luna',
            input: 0.1,
            cached: 0.01,
            cacheWrite: 0.125,
            output: 0.5,
            inputAbove: 0.2,
            cachedAbove: 0.02,
            cacheWriteAbove: 0.25,
            outputAbove: 0.75,
        },
    ])('registers $id with multimodal capabilities and both pricing tiers', model => {
        expect(getProviderFromModel(model.id)).toBe('openai');
        expect(findModel(model.id)).toMatchObject({
            id: model.id,
            provider: 'openai',
            cost: {
                input_per_million: {
                    threshold_tokens: 272000,
                    price_below_threshold_per_million: model.input,
                    price_above_threshold_per_million: model.inputAbove,
                    tier_basis: 'input_tokens',
                },
                cached_input_per_million: {
                    price_below_threshold_per_million: model.cached,
                    price_above_threshold_per_million: model.cachedAbove,
                },
                cache_write_input_per_million: {
                    price_below_threshold_per_million: model.cacheWrite,
                    price_above_threshold_per_million: model.cacheWriteAbove,
                },
                output_per_million: {
                    price_below_threshold_per_million: model.output,
                    price_above_threshold_per_million: model.outputAbove,
                },
            },
            features: {
                context_length: 1050000,
                max_output_tokens: 128000,
                input_modality: ['text', 'image'],
                output_modality: ['text'],
                tool_use: true,
                streaming: true,
                json_output: true,
                structured_output: true,
                reasoning_output: true,
            },
        });
    });

    it.each(['none', 'low'] as const)('sends reasoning_effort %s with image and native JSON output', async effort => {
        const provider = new OpenAIProvider('sk-test');
        const create = vi.fn().mockResolvedValue(emptyStream());
        (provider as any)._client = { responses: { create } };

        await drain(
            provider.createResponseStream(
                [
                    {
                        type: 'message',
                        role: 'user',
                        content: [
                            { type: 'input_text', text: 'Extract the visible labels.' },
                            { type: 'input_image', image_url: 'data:image/png;base64,AA==', detail: 'high' },
                        ],
                    },
                ] as any,
                'gpt-6-sol',
                {
                    agent_id: `gpt-6-${effort}`,
                    modelSettings: {
                        reasoning_effort: effort,
                        temperature: 0.2,
                        top_p: 0.3,
                        json_schema: {
                            name: 'labels',
                            type: 'json_schema',
                            strict: true,
                            schema: {
                                type: 'object',
                                properties: { labels: { type: 'array', items: { type: 'string' } } },
                                required: ['labels'],
                                additionalProperties: false,
                            },
                        },
                    },
                } as any
            )
        );

        const request = create.mock.calls.at(0)?.[0];
        expect(request.model).toBe('gpt-6-sol');
        expect(request.reasoning).toMatchObject({ effort });
        expect(request.temperature).toBeUndefined();
        expect(request.top_p).toBeUndefined();
        expect(request.input[0].content).toContainEqual(
            expect.objectContaining({ type: 'input_image', image_url: 'data:image/png;base64,AA==' })
        );
        expect(request.text.format).toMatchObject({
            type: 'json_schema',
            name: 'labels',
            strict: true,
            schema: {
                type: 'object',
                properties: { labels: { type: 'array', items: { type: 'string' } } },
            },
        });
    });

    it('lets explicit reasoning_effort override a thinking budget and preserves max aliases', async () => {
        await expect(getModelFromAgent({ agent_id: 'gpt-6-max-alias', model: 'gpt-6-sol-max' } as any)).resolves.toBe(
            'gpt-6-sol-max'
        );

        const provider = new OpenAIProvider('sk-test');
        const create = vi.fn().mockResolvedValue(emptyStream());
        (provider as any)._client = { responses: { create } };
        await drain(
            provider.createResponseStream([{ type: 'message', role: 'user', content: 'Hello' }] as any, 'gpt-6-luna', {
                agent_id: 'gpt-6-effort-precedence',
                modelSettings: { reasoning_effort: 'none', thinking_budget: 10000 },
            } as any)
        );
        expect(create.mock.calls.at(0)?.[0]?.reasoning).toEqual({ effort: 'none' });
    });

    it('defaults to medium and normalizes unsupported minimal effort before dispatch', async () => {
        const provider = new OpenAIProvider('sk-test');
        const create = vi.fn().mockResolvedValue(emptyStream());
        (provider as any)._client = { responses: { create } };

        await drain(
            provider.createResponseStream([{ type: 'message', role: 'user', content: 'Hello' }] as any, 'gpt-6-sol', {
                agent_id: 'gpt-6-default-effort',
            } as any)
        );
        expect(create.mock.calls.at(0)?.[0]?.reasoning).toMatchObject({ effort: 'medium' });
        expect(create.mock.calls.at(0)?.[0]?.max_output_tokens).toBeUndefined();

        await drain(
            provider.createResponseStream([{ type: 'message', role: 'user', content: 'Hello' }] as any, 'gpt-6-sol', {
                agent_id: 'gpt-6-minimal-budget',
                modelSettings: { thinking_budget: 1 },
            } as any)
        );
        expect(create.mock.calls.at(1)?.[0]?.reasoning).toMatchObject({ effort: 'low' });

        await drain(
            provider.createResponseStream(
                [{ type: 'message', role: 'user', content: 'Hello' }] as any,
                'gpt-6-sol-minimal',
                { agent_id: 'gpt-6-minimal-suffix' } as any
            )
        );
        expect(create.mock.calls.at(2)?.[0]).toMatchObject({
            model: 'gpt-6-sol',
            reasoning: { effort: 'low' },
        });
    });

    it.each([
        { model: 'gpt-6-sol', maxTokens: 8192, expected: 8192 },
        { model: 'gpt-6-luna', maxTokens: 200000, expected: 128000 },
        { model: 'gpt-5.6-terra', maxTokens: 8192, expected: 8192 },
    ])(
        'maps max_tokens for Responses model $model and respects its output cap',
        async ({ model, maxTokens, expected }) => {
            const provider = new OpenAIProvider('sk-test');
            const create = vi.fn().mockResolvedValue(emptyStream());
            (provider as any)._client = { responses: { create } };

            await drain(
                provider.createResponseStream(
                    [{ type: 'message', role: 'user', content: 'Answer briefly.' }] as any,
                    model,
                    { agent_id: `${model}-max-output`, modelSettings: { max_tokens: maxTokens } } as any
                )
            );

            expect(create.mock.calls.at(0)?.[0]?.max_output_tokens).toBe(expected);
        }
    );

    it.each([
        { model: 'gpt-6-sol', inputRate: 4, cachedRate: 0.4, writeRate: 5, outputRate: 15, expectedCost: 1.36 },
        {
            model: 'gpt-6-luna',
            inputRate: 0.2,
            cachedRate: 0.02,
            writeRate: 0.25,
            outputRate: 0.75,
            expectedCost: 0.068,
        },
    ])('prices long-context usage and reasoning tokens for $model', ({ model, expectedCost }) => {
        const usage = normalizeOpenAIResponsesUsage(model, {
            input_tokens: 300000,
            output_tokens: 15000,
            total_tokens: 315000,
            input_tokens_details: { cached_tokens: 25000, cache_write_tokens: 25000 },
            output_tokens_details: { reasoning_tokens: 3000 },
        });
        const priced = new CostTracker().calculateCost(usage);

        expect(priced).toMatchObject({
            model,
            input_tokens: 300000,
            output_tokens: 15000,
            cached_tokens: 25000,
            cache_write_tokens: 25000,
            reasoning_tokens: 3000,
        });
        expect(priced.cost).toBeCloseTo(expectedCost, 10);
    });

    it.each([
        { model: 'gpt-6-sol', belowRate: 2, aboveRate: 4 },
        { model: 'gpt-6-luna', belowRate: 0.1, aboveRate: 0.2 },
    ])('switches $model pricing only above 272K input tokens', ({ model, belowRate, aboveRate }) => {
        const tracker = new CostTracker();
        const usageAtThreshold = normalizeOpenAIResponsesUsage(model, {
            input_tokens: 272000,
            output_tokens: 0,
            total_tokens: 272000,
            input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 },
        });
        const usageAboveThreshold = normalizeOpenAIResponsesUsage(model, {
            input_tokens: 272001,
            output_tokens: 0,
            total_tokens: 272001,
            input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 },
        });

        expect(tracker.calculateCost(usageAtThreshold).cost).toBeCloseTo((272000 / 1000000) * belowRate, 10);
        expect(tracker.calculateCost(usageAboveThreshold).cost).toBeCloseTo((272001 / 1000000) * aboveRate, 10);
    });
});
