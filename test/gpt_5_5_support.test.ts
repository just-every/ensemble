import { describe, expect, it, vi } from 'vitest';
import { MODEL_CLASSES, findModel } from '../data/model_data.js';
import { getModelFromAgent } from '../model_providers/model_provider.js';
import { OpenAIProvider } from '../model_providers/openai.js';
import { CostTracker } from '../utils/cost_tracker.js';

async function collect(stream: AsyncIterable<any>): Promise<any[]> {
    const events: any[] = [];
    for await (const event of stream) {
        events.push(event);
    }
    return events;
}

function emptyStream() {
    return {
        async *[Symbol.asyncIterator]() {
            // No-op
        },
    };
}

describe('GPT-5.5 support', () => {
    it('registers the GPT-5.5 family with current aliases, limits, and pricing', () => {
        const flagship = findModel('gpt-5.5');
        const flagshipAlias = findModel('gpt-5.5-2026-04-23');
        const pro = findModel('gpt-5.5-pro');
        const proAlias = findModel('gpt-5.5-pro-2026-04-23');

        expect(flagship?.id).toBe('gpt-5.5');
        expect(flagshipAlias?.id).toBe('gpt-5.5');
        expect(flagship?.features?.context_length).toBe(1050000);
        expect(flagship?.features?.max_output_tokens).toBe(128000);
        expect(flagship?.features?.streaming).toBe(true);
        expect(flagship?.features?.json_output).toBe(true);
        expect(flagship?.cost?.input_per_million).toEqual({
            threshold_tokens: 272000,
            price_below_threshold_per_million: 5.0,
            price_above_threshold_per_million: 10.0,
            tier_basis: 'input_tokens',
        });
        expect(flagship?.cost?.cached_input_per_million).toEqual({
            threshold_tokens: 272000,
            price_below_threshold_per_million: 0.5,
            price_above_threshold_per_million: 1.0,
            tier_basis: 'input_tokens',
        });
        expect(flagship?.cost?.output_per_million).toEqual({
            threshold_tokens: 272000,
            price_below_threshold_per_million: 30.0,
            price_above_threshold_per_million: 45.0,
            tier_basis: 'input_tokens',
        });

        expect(pro?.id).toBe('gpt-5.5-pro');
        expect(proAlias?.id).toBe('gpt-5.5-pro');
        expect(pro?.features?.context_length).toBe(1050000);
        expect(pro?.features?.max_output_tokens).toBe(128000);
        expect(pro?.features?.streaming).toBe(false);
        expect(pro?.features?.json_output).toBe(true);
        expect(pro?.cost?.input_per_million).toEqual({
            threshold_tokens: 272000,
            price_below_threshold_per_million: 30.0,
            price_above_threshold_per_million: 60.0,
            tier_basis: 'input_tokens',
        });
        expect(pro?.cost?.cached_input_per_million).toBeUndefined();
        expect(pro?.cost?.output_per_million).toEqual({
            threshold_tokens: 272000,
            price_below_threshold_per_million: 180.0,
            price_above_threshold_per_million: 270.0,
            tier_basis: 'input_tokens',
        });
    });

    it('uses GPT-5.5 as the OpenAI default where no smaller 5.5 variant exists', () => {
        expect(MODEL_CLASSES.standard.models[0]).toBe('gpt-5.5');
        expect(MODEL_CLASSES.reasoning.models[0]).toBe('gpt-5.5');
        expect(MODEL_CLASSES.reasoning_high.models[0]).toBe('gpt-5.5-pro');
        expect(MODEL_CLASSES.monologue.models[0]).toBe('gpt-5.5');
        expect(MODEL_CLASSES.metacognition.models[0]).toBe('gpt-5.5');
        expect(MODEL_CLASSES.writing.models[0]).toBe('gpt-5.5');
        expect(MODEL_CLASSES.vision.models[0]).toBe('gpt-5.5');
        expect(MODEL_CLASSES.long.models[0]).toBe('gpt-5.5');
        expect(MODEL_CLASSES.mini.models[0]).toBe('gpt-5.4-nano');
        expect(MODEL_CLASSES.reasoning_mini.models[0]).toBe('gpt-5.4-mini');
        expect(MODEL_CLASSES.vision_mini.models[0]).toBe('gpt-5.4-mini');
    });

    it('normalizes dated GPT-5.5 aliases back to their canonical model IDs', async () => {
        const flagship = await getModelFromAgent({
            agent_id: 'test-gpt-5.5-alias',
            model: 'gpt-5.5-2026-04-23',
        } as any);
        const pro = await getModelFromAgent({
            agent_id: 'test-gpt-5.5-pro-alias',
            model: 'gpt-5.5-pro-2026-04-23',
        } as any);

        expect(flagship).toBe('gpt-5.5');
        expect(pro).toBe('gpt-5.5-pro');
    });

    it('defaults GPT-5.5 to medium reasoning and strips sampling params', async () => {
        const provider = new OpenAIProvider('sk-test');
        const create = vi.fn().mockResolvedValue(emptyStream());
        (provider as any)._client = {
            responses: {
                create,
            },
        };

        await collect(
            provider.createResponseStream(
                [{ type: 'message', role: 'user', content: 'Think carefully' }] as any,
                'gpt-5.5',
                {
                    agent_id: 'test-gpt-5.5-request',
                    modelSettings: {
                        temperature: 0.7,
                        top_p: 0.9,
                    },
                } as any
            )
        );

        const requestParams = create.mock.calls.at(0)?.[0];
        expect(requestParams.model).toBe('gpt-5.5');
        expect(requestParams.reasoning).toEqual({
            effort: 'medium',
            summary: 'auto',
        });
        expect(requestParams.temperature).toBeUndefined();
        expect(requestParams.top_p).toBeUndefined();
    });

    it('allows sampling params for GPT-5.5 when effort is explicitly none', async () => {
        const provider = new OpenAIProvider('sk-test');
        const create = vi.fn().mockResolvedValue(emptyStream());
        (provider as any)._client = {
            responses: {
                create,
            },
        };

        await collect(
            provider.createResponseStream(
                [{ type: 'message', role: 'user', content: 'Answer directly' }] as any,
                'gpt-5.5',
                {
                    agent_id: 'test-gpt-5.5-none-request',
                    modelSettings: {
                        thinking_budget: 0,
                        temperature: 0.7,
                        top_p: 0.9,
                    },
                } as any
            )
        );

        const requestParams = create.mock.calls.at(0)?.[0];
        expect(requestParams.model).toBe('gpt-5.5');
        expect(requestParams.reasoning).toEqual({ effort: 'none' });
        expect(requestParams.temperature).toBe(0.7);
        expect(requestParams.top_p).toBe(0.9);
    });

    it('uses non-streaming Responses requests for GPT-5.5 Pro', async () => {
        const provider = new OpenAIProvider('sk-test');
        const create = vi.fn().mockResolvedValue({
            id: 'resp_123',
            status: 'completed',
            output: [
                {
                    id: 'msg_123',
                    type: 'message',
                    content: [{ type: 'output_text', text: 'Done.' }],
                },
            ],
            usage: {
                input_tokens: 1000,
                output_tokens: 50,
                total_tokens: 1050,
                input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 },
                output_tokens_details: { reasoning_tokens: 10 },
            },
        });
        (provider as any)._client = {
            responses: {
                create,
            },
        };

        const events = await collect(
            provider.createResponseStream(
                [{ type: 'message', role: 'user', content: 'Solve this hard problem' }] as any,
                'gpt-5.5-pro',
                {
                    agent_id: 'test-gpt-5.5-pro-request',
                    modelSettings: {
                        temperature: 0.7,
                        top_p: 0.9,
                    },
                } as any
            )
        );

        const requestParams = create.mock.calls.at(0)?.[0];
        expect(requestParams.model).toBe('gpt-5.5-pro');
        expect(requestParams.stream).toBeUndefined();
        expect(requestParams.reasoning).toEqual({
            effort: 'high',
            summary: 'auto',
        });
        expect(requestParams.temperature).toBeUndefined();
        expect(requestParams.top_p).toBeUndefined();
        expect(events.some(event => event.type === 'message_complete' && event.content === 'Done.')).toBe(true);
    });

    it('calculates GPT-5.5 long-context pricing from input-token tier for the full session', () => {
        const tracker = new CostTracker();

        const shortUsage = tracker.calculateCost({
            model: 'gpt-5.5',
            input_tokens: 100000,
            cached_tokens: 10000,
            output_tokens: 10000,
        });
        expect(shortUsage.cost).toBeCloseTo(0.755, 6);

        const longUsage = tracker.calculateCost({
            model: 'gpt-5.5',
            input_tokens: 300000,
            cached_tokens: 50000,
            output_tokens: 10000,
        });
        expect(longUsage.cost).toBeCloseTo(3.0, 6);

        const proLongUsage = tracker.calculateCost({
            model: 'gpt-5.5-pro',
            input_tokens: 300000,
            output_tokens: 10000,
        });
        expect(proLongUsage.cost).toBeCloseTo(20.7, 6);
    });
});
