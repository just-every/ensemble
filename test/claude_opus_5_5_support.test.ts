import { describe, expect, it, vi } from 'vitest';
import { findModel } from '../data/model_data.js';
import { ClaudeProvider } from '../model_providers/claude.js';
import { getModelFromAgent, getProviderFromModel } from '../model_providers/model_provider.js';
import {
    createAnthropicUsageAccumulator,
    mergeAnthropicUsage,
    normalizeAnthropicUsage,
} from '../utils/anthropic_usage.js';
import { CostTracker } from '../utils/cost_tracker.js';

function emptyStream() {
    return { async *[Symbol.asyncIterator]() {} };
}

async function collect(stream: AsyncIterable<unknown>): Promise<any[]> {
    const events: any[] = [];
    for await (const event of stream) events.push(event);
    return events;
}

describe('Claude Opus 5.5 support', () => {
    it('registers only the exact provider ID with current pricing and capabilities', async () => {
        expect(getProviderFromModel('claude-opus-5-5')).toBe('anthropic');
        expect(findModel('claude-opus-5-5')).toMatchObject({
            id: 'claude-opus-5-5',
            provider: 'anthropic',
            cost: {
                input_per_million: 4,
                output_per_million: 20,
                cached_input_per_million: 0.2,
                cache_write_input_per_million: 5,
                cache_write_1h_input_per_million: 8,
            },
            features: {
                context_length: 1_000_000,
                max_output_tokens: 128000,
                input_modality: ['text', 'image'],
                output_modality: ['text'],
                tool_use: true,
                streaming: true,
                structured_output: true,
                reasoning_output: true,
            },
        });
        expect(findModel('claude-opus-5.5')).toBeUndefined();
        await expect(getModelFromAgent({ agent_id: 'opus55-exact', model: 'claude-opus-5-5' } as any)).resolves.toBe(
            'claude-opus-5-5'
        );
    });

    it('uses adaptive medium by default and sends native schema output for image extraction', async () => {
        const provider = new ClaudeProvider('sk-ant-test');
        const create = vi.fn().mockResolvedValue(emptyStream());
        (provider as any)._client = { messages: { create } };
        const schema = {
            type: 'object',
            properties: { label: { type: 'string', minLength: 2 } },
            required: ['label'],
        };

        await collect(
            provider.createResponseStream(
                [
                    {
                        type: 'message',
                        role: 'user',
                        content: [
                            { type: 'input_text', text: 'Read the label.' },
                            { type: 'input_image', image_url: 'data:image/png;base64,AA==', detail: 'high' },
                        ],
                    },
                ] as any,
                'claude-opus-5-5',
                {
                    agent_id: 'opus55-default-medium',
                    modelSettings: {
                        json_schema: { name: 'label', type: 'json_schema', schema },
                    },
                } as any
            )
        );

        const request = create.mock.calls.at(0)?.[0];
        expect(request.model).toBe('claude-opus-5-5');
        expect(request.output_config).toMatchObject({
            effort: 'medium',
            format: {
                type: 'json_schema',
                schema: {
                    type: 'object',
                    properties: { label: { type: 'string' } },
                    required: ['label'],
                    additionalProperties: false,
                },
            },
        });
        expect(request.output_config.format.schema.properties.label.description).toContain('minLength');
        expect(request.output_config.format.schema.properties.label.minLength).toBeUndefined();
        expect(request.output_config.format.parse).toBeUndefined();
        expect(request.system).toBeUndefined();
        expect(request.thinking).toBeUndefined();
        expect(request.messages[0].content).toContainEqual({
            type: 'image',
            source: { type: 'base64', media_type: 'image/png', data: 'AA==' },
        });
    });

    it('maps reasoning_effort low to adaptive effort and gives it precedence over a positive budget', async () => {
        const provider = new ClaudeProvider('sk-ant-test');
        const create = vi.fn().mockResolvedValue(emptyStream());
        (provider as any)._client = { messages: { create } };

        await collect(
            provider.createResponseStream(
                [{ type: 'message', role: 'user', content: 'Think carefully.' }] as any,
                'claude-opus-5-5',
                {
                    agent_id: 'opus55-low',
                    modelSettings: { reasoning_effort: 'low', thinking_budget: 32000 },
                } as any
            )
        );

        expect(create.mock.calls.at(0)?.[0]).toMatchObject({
            model: 'claude-opus-5-5',
            output_config: { effort: 'low' },
        });
        expect(create.mock.calls.at(0)?.[0]?.thinking).toBeUndefined();
    });

    it.each([
        {
            label: 'reasoning_effort none',
            model: 'claude-opus-5-5',
            modelSettings: { reasoning_effort: 'none' },
        },
        {
            label: 'zero thinking budget',
            model: 'claude-opus-5-5',
            modelSettings: { thinking_budget: 0 },
        },
        {
            label: 'none effort suffix',
            model: 'claude-opus-5-5-none',
            modelSettings: {},
        },
    ])('rejects $label because Opus 5.5 thinking cannot be disabled', async ({ model, modelSettings }) => {
        const provider = new ClaudeProvider('sk-ant-test');
        const create = vi.fn().mockResolvedValue(emptyStream());
        (provider as any)._client = { messages: { create } };

        const events = await collect(
            provider.createResponseStream([{ type: 'message', role: 'user', content: 'Answer.' }] as any, model, {
                agent_id: `opus55-reject-${model}`,
                modelSettings,
            } as any)
        );

        expect(
            events.some(event => event.type === 'error' && event.error.includes('always-on adaptive thinking'))
        ).toBe(true);
        expect(create).not.toHaveBeenCalled();
    });

    it('prices prompt cache and reasoning usage without charging reasoning twice', () => {
        const accumulator = createAnthropicUsageAccumulator();
        mergeAnthropicUsage(accumulator, {
            input_tokens: 100,
            output_tokens: 50,
            cache_creation_input_tokens: 30,
            cache_read_input_tokens: 20,
            cache_creation: { ephemeral_5m_input_tokens: 10, ephemeral_1h_input_tokens: 20 },
            output_tokens_details: { thinking_tokens: 15 },
        });

        const usage = normalizeAnthropicUsage('claude-opus-5-5', accumulator)!;
        expect(usage).toMatchObject({
            input_tokens: 150,
            output_tokens: 50,
            cached_tokens: 20,
            cache_write_tokens: 10,
            cache_write_1h_tokens: 20,
            reasoning_tokens: 15,
        });
        expect(new CostTracker().calculateCost(usage).cost).toBeCloseTo(0.001614, 10);
    });
});
