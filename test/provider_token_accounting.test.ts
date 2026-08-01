import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ClaudeProvider } from '../model_providers/claude.js';
import { GeminiProvider } from '../model_providers/gemini.js';
import { OpenAIProvider } from '../model_providers/openai.js';
import {
    createAnthropicUsageAccumulator,
    mergeAnthropicUsage,
    normalizeAnthropicUsage,
} from '../utils/anthropic_usage.js';
import { CostTracker, costTracker } from '../utils/cost_tracker.js';
import { setEventHandler } from '../utils/event_controller.js';
import {
    normalizeGeminiUsage,
    normalizeOpenAIChatUsage,
    normalizeOpenAIResponsesUsage,
} from '../utils/provider_usage.js';

function streamOf(events: unknown[]) {
    return {
        async *[Symbol.asyncIterator]() {
            for (const event of events) {
                yield event;
            }
        },
    };
}

async function collect(stream: AsyncIterable<unknown>): Promise<any[]> {
    const events: any[] = [];
    for await (const event of stream) {
        events.push(event);
    }
    return events;
}

describe('provider token accounting', () => {
    beforeEach(() => {
        costTracker.reset();
        setEventHandler(null);
    });

    it('prices OpenAI cache writes at 1.25x input without double-charging reasoning output', () => {
        const normalized = normalizeOpenAIResponsesUsage('gpt-5.6-terra', {
            input_tokens: 1000,
            output_tokens: 200,
            total_tokens: 1200,
            input_tokens_details: {
                cached_tokens: 200,
                cache_write_tokens: 100,
            },
            output_tokens_details: { reasoning_tokens: 80 },
        });
        const priced = new CostTracker().calculateCost(normalized);

        expect(priced).toMatchObject({
            input_tokens: 1000,
            output_tokens: 200,
            cached_tokens: 200,
            cache_write_tokens: 100,
            reasoning_tokens: 80,
            total_tokens: 1200,
        });
        expect(priced.cost).toBeCloseTo(0.00409, 10);

        const withoutReasoningTelemetry = new CostTracker().calculateCost({
            ...normalized,
            reasoning_tokens: 0,
            metadata: { reasoning_tokens: 0 },
        });
        expect(withoutReasoningTelemetry.cost).toBe(priced.cost);

        const genericOpenAIWrite = new CostTracker().calculateCost(
            normalizeOpenAIResponsesUsage('gpt-5.5', {
                input_tokens: 1000,
                output_tokens: 0,
                total_tokens: 1000,
                input_tokens_details: { cached_tokens: 0, cache_write_tokens: 100 },
            })
        );
        expect(genericOpenAIWrite.cost).toBeCloseTo(0.005125, 10);
    });

    it.each(['incomplete', 'failed'] as const)(
        'retains OpenAI usage when a streaming response is %s',
        async terminalStatus => {
            const provider = new OpenAIProvider('sk-test');
            const response = {
                id: `resp_${terminalStatus}`,
                usage: {
                    input_tokens: 1000,
                    output_tokens: 200,
                    total_tokens: 1200,
                    input_tokens_details: { cached_tokens: 200, cache_write_tokens: 100 },
                    output_tokens_details: { reasoning_tokens: 80 },
                },
                ...(terminalStatus === 'incomplete'
                    ? { incomplete_details: { reason: 'max_output_tokens' } }
                    : { error: { code: 'server_error', message: 'terminal failure' } }),
            };
            (provider as any)._client = {
                responses: {
                    create: vi.fn().mockResolvedValue(streamOf([{ type: `response.${terminalStatus}`, response }])),
                },
            };

            const events = await collect(
                provider.createResponseStream(
                    [{ type: 'message', role: 'user', content: 'hello' }] as any,
                    'gpt-5.6-terra',
                    { agent_id: `openai-${terminalStatus}` } as any
                )
            );
            const costs = events.filter(event => event.type === 'cost_update');

            expect(costs).toHaveLength(1);
            expect(costs[0].usage).toMatchObject({
                input_tokens: 1000,
                output_tokens: 200,
                cached_tokens: 200,
                cache_write_tokens: 100,
                reasoning_tokens: 80,
                total_tokens: 1200,
                cost: expect.closeTo(0.00409, 10),
            });
            expect(events.some(event => event.type === 'error')).toBe(true);
        }
    );

    it('bills Gemini tool prompt tokens as input and thinking tokens as output', () => {
        const normalized = normalizeGeminiUsage('gemini-3.6-flash', {
            promptTokenCount: 100,
            toolUsePromptTokenCount: 20,
            candidatesTokenCount: 40,
            thoughtsTokenCount: 10,
            cachedContentTokenCount: 30,
            totalTokenCount: 170,
        });
        const priced = new CostTracker().calculateCost(normalized);

        expect(priced).toMatchObject({
            input_tokens: 120,
            output_tokens: 50,
            cached_tokens: 30,
            reasoning_tokens: 10,
            total_tokens: 170,
        });
        expect(priced.cost).toBeCloseTo(0.0005145, 10);
    });

    it('uses normalized Gemini usage in the text streaming adapter', async () => {
        const provider = new GeminiProvider('test-key');
        (provider as any)._client = {
            models: {
                generateContentStream: vi.fn().mockResolvedValue(
                    streamOf([
                        {
                            candidates: [{ content: { parts: [{ text: 'done' }] } }],
                            usageMetadata: {
                                promptTokenCount: 100,
                                toolUsePromptTokenCount: 20,
                                candidatesTokenCount: 40,
                                thoughtsTokenCount: 10,
                                cachedContentTokenCount: 30,
                                totalTokenCount: 170,
                            },
                        },
                    ])
                ),
            },
        };

        const events = await collect(
            provider.createResponseStream(
                [{ type: 'message', role: 'user', content: 'hello' }] as any,
                'gemini-3.6-flash',
                { agent_id: 'gemini-accounting' } as any
            )
        );
        const costs = events.filter(event => event.type === 'cost_update');

        expect(costs).toHaveLength(1);
        expect(costs[0].usage).toMatchObject({
            input_tokens: 120,
            output_tokens: 50,
            cached_tokens: 30,
            reasoning_tokens: 10,
            total_tokens: 170,
            cost: expect.closeTo(0.0005145, 10),
        });
    });

    it('de-duplicates cumulative Anthropic usage and prices cache TTLs separately', () => {
        const accumulator = createAnthropicUsageAccumulator();
        mergeAnthropicUsage(accumulator, {
            input_tokens: 100,
            output_tokens: 1,
            cache_creation_input_tokens: 50,
            cache_read_input_tokens: 200,
            cache_creation: {
                ephemeral_5m_input_tokens: 30,
                ephemeral_1h_input_tokens: 20,
            },
            output_tokens_details: { thinking_tokens: 1 },
        });
        mergeAnthropicUsage(accumulator, {
            input_tokens: 100,
            output_tokens: 10,
            cache_creation_input_tokens: 50,
            cache_read_input_tokens: 200,
            output_tokens_details: { thinking_tokens: 4 },
        });

        const normalized = normalizeAnthropicUsage('claude-sonnet-5', accumulator);
        expect(normalized).toMatchObject({
            input_tokens: 350,
            output_tokens: 10,
            cached_tokens: 200,
            cache_write_tokens: 30,
            cache_write_1h_tokens: 20,
            reasoning_tokens: 4,
            total_tokens: 360,
        });
        expect(new CostTracker().calculateCost(normalized!).cost).toBeCloseTo(0.000495, 10);

        const longContext = new CostTracker().calculateCost({
            model: 'claude-sonnet-4-5-20250929',
            input_tokens: 300000,
            output_tokens: 10000,
            cached_tokens: 50000,
            cache_write_tokens: 30000,
            cache_write_1h_tokens: 20000,
        });
        expect(longContext.cost).toBeCloseTo(1.92, 10);
    });

    it('uses exact Anthropic cache buckets in the streaming adapter', async () => {
        const provider = new ClaudeProvider('sk-ant-test');
        (provider as any)._client = {
            messages: {
                create: vi.fn().mockResolvedValue(
                    streamOf([
                        {
                            type: 'message_start',
                            message: {
                                usage: {
                                    input_tokens: 100,
                                    output_tokens: 1,
                                    cache_creation_input_tokens: 50,
                                    cache_read_input_tokens: 200,
                                    cache_creation: {
                                        ephemeral_5m_input_tokens: 30,
                                        ephemeral_1h_input_tokens: 20,
                                    },
                                    output_tokens_details: { thinking_tokens: 1 },
                                },
                            },
                        },
                        { type: 'content_block_start', index: 0, content_block: { type: 'text' } },
                        { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'done' } },
                        { type: 'content_block_stop', index: 0 },
                        {
                            type: 'message_delta',
                            delta: { stop_reason: 'end_turn' },
                            usage: {
                                input_tokens: 100,
                                output_tokens: 10,
                                cache_creation_input_tokens: 50,
                                cache_read_input_tokens: 200,
                                output_tokens_details: { thinking_tokens: 4 },
                            },
                        },
                        { type: 'message_stop' },
                    ])
                ),
            },
        };

        const events = await collect(
            provider.createResponseStream(
                [{ type: 'message', role: 'user', content: 'hello' }] as any,
                'claude-sonnet-5',
                { agent_id: 'anthropic-accounting' } as any
            )
        );
        const costs = events.filter(event => event.type === 'cost_update');

        expect(costs).toHaveLength(1);
        expect(costs[0].usage).toMatchObject({
            input_tokens: 350,
            output_tokens: 10,
            cached_tokens: 200,
            cache_write_tokens: 30,
            cache_write_1h_tokens: 20,
            reasoning_tokens: 4,
            total_tokens: 360,
            cost: expect.closeTo(0.000495, 10),
        });
    });

    it('refuses to guess an Anthropic cache-write TTL when the provider omits the breakdown', () => {
        const accumulator = createAnthropicUsageAccumulator();
        mergeAnthropicUsage(accumulator, {
            input_tokens: 100,
            cache_creation_input_tokens: 50,
        });

        expect(() => normalizeAnthropicUsage('claude-sonnet-5', accumulator)).toThrow('lacks an exact TTL breakdown');
    });

    it('rejects malformed or internally inconsistent OpenAI usage', () => {
        expect(() =>
            normalizeOpenAIResponsesUsage('gpt-5.6-terra', {
                input_tokens: 10,
                output_tokens: 2,
                total_tokens: 11,
                input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 },
            })
        ).toThrow('does not equal its billed components');

        expect(() =>
            normalizeOpenAIResponsesUsage('gpt-5.6-terra', {
                input_tokens: -1,
                output_tokens: 0,
                total_tokens: 0,
                input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 },
            })
        ).toThrow('must be a non-negative safe integer');

        expect(() =>
            normalizeOpenAIResponsesUsage('gpt-5.6-terra', {
                input_tokens: 10,
                output_tokens: 2,
                total_tokens: 12,
                input_tokens_details: { cached_tokens: 8, cache_write_tokens: 3 },
            })
        ).toThrow('exceeds usage.input_tokens');

        expect(() =>
            normalizeOpenAIChatUsage('gpt-5.5', {
                prompt_tokens: 10,
                completion_tokens: 2,
                total_tokens: 13,
            })
        ).toThrow('does not equal its billed components');
    });

    it('rejects malformed or internally inconsistent Gemini and Anthropic usage', () => {
        expect(() =>
            normalizeGeminiUsage('gemini-3.6-flash', {
                promptTokenCount: 10,
                candidatesTokenCount: 2,
                thoughtsTokenCount: 1,
                totalTokenCount: 12,
            })
        ).toThrow('does not equal its billed components');

        expect(() =>
            normalizeGeminiUsage('gemini-3.6-flash', {
                promptTokenCount: 10,
                candidatesTokenCount: Number.NaN,
            })
        ).toThrow('must be a non-negative safe integer');

        expect(() =>
            normalizeGeminiUsage('gemini-3.6-flash', {
                promptTokenCount: 10,
                toolUsePromptTokenCount: 10,
                cachedContentTokenCount: 11,
            })
        ).toThrow('exceeds usage.promptTokenCount');

        const accumulator = createAnthropicUsageAccumulator();
        expect(() => mergeAnthropicUsage(accumulator, { input_tokens: -1 })).toThrow(
            'must be a non-negative safe integer'
        );
    });
});
