import { describe, expect, it, vi } from 'vitest';
import { MODEL_CLASSES, findModel } from '../data/model_data.js';
import { ClaudeProvider } from '../model_providers/claude.js';
import { getModelFromAgent, getProviderFromModel } from '../model_providers/model_provider.js';

async function drain(stream: AsyncIterable<unknown>): Promise<void> {
    for await (const _event of stream) {
        // Intentionally empty: these tests only need the provider to build the request.
    }
}

function emptyStream() {
    return {
        async *[Symbol.asyncIterator]() {
            // No-op stream.
        },
    };
}

describe('Claude Fable 5 support', () => {
    it('registers Fable 5 with current aliases, pricing, and metadata', () => {
        const model = findModel('claude-fable-5');
        const shortAlias = findModel('claude-fable');
        const latestAlias = findModel('claude-fable-latest');
        const prefixlessAlias = findModel('fable-5');

        expect(model?.id).toBe('claude-fable-5');
        expect(shortAlias?.id).toBe('claude-fable-5');
        expect(latestAlias?.id).toBe('claude-fable-5');
        expect(prefixlessAlias?.id).toBe('claude-fable-5');
        expect(getProviderFromModel('claude-fable-5')).toBe('anthropic');

        expect(model?.cost?.input_per_million).toBe(10.0);
        expect(model?.cost?.cached_input_per_million).toBe(1.0);
        expect(model?.cost?.output_per_million).toBe(50.0);
        expect(model?.features?.context_length).toBe(1_000_000);
        expect(model?.features?.max_output_tokens).toBe(128000);
        expect(model?.features?.input_modality).toEqual(['text', 'image']);
        expect(model?.features?.output_modality).toEqual(['text']);
        expect(model?.features?.tool_use).toBe(true);
        expect(model?.features?.streaming).toBe(true);
        expect(model?.features?.json_output).toBe(true);
        expect(model?.features?.reasoning_output).toBe(true);
    });

    it('updates highest-tier Anthropic model classes to Fable 5', () => {
        expect(MODEL_CLASSES.reasoning_high.models).toContain('claude-fable-5');
        expect(MODEL_CLASSES.metacognition.models).toContain('claude-fable-5');
        expect(MODEL_CLASSES.code.models).toContain('claude-fable-5');
        expect(MODEL_CLASSES.vision.models).toContain('claude-fable-5');
        expect(MODEL_CLASSES.long.models).toContain('claude-fable-5');
    });

    it('normalizes Fable 5 aliases while preserving effort suffixes', async () => {
        const latest = await getModelFromAgent({
            agent_id: 'test-claude-fable-latest',
            model: 'claude-fable-latest',
        } as any);
        const xhigh = await getModelFromAgent({
            agent_id: 'test-claude-fable-xhigh',
            model: 'claude-fable-latest-xhigh',
        } as any);
        const prefixless = await getModelFromAgent({
            agent_id: 'test-fable-5-alias',
            model: 'fable-5',
        } as any);

        expect(latest).toBe('claude-fable-5');
        expect(xhigh).toBe('claude-fable-5-xhigh');
        expect(prefixless).toBe('claude-fable-5');
    });

    it('uses implicit adaptive thinking controls for Fable 5 requests', async () => {
        const provider = new ClaudeProvider('sk-ant-test');
        const create = vi.fn().mockResolvedValue(emptyStream());
        (provider as any)._client = {
            messages: {
                create,
            },
        };

        await drain(
            provider.createResponseStream(
                [{ type: 'message', role: 'user', content: 'Review this carefully' }] as any,
                'claude-fable-latest-xhigh',
                {
                    agent_id: 'test-claude-fable-request',
                    modelSettings: {
                        temperature: 0.3,
                    },
                } as any
            )
        );

        const requestParams = create.mock.calls.at(0)?.[0];
        expect(requestParams?.model).toBe('claude-fable-5');
        expect(requestParams?.thinking).toBeUndefined();
        expect(requestParams?.output_config).toEqual({
            effort: 'xhigh',
        });
        expect(requestParams?.temperature).toBeUndefined();
    });

    it('does not send unsupported disabled thinking parameters for Fable 5', async () => {
        const provider = new ClaudeProvider('sk-ant-test');
        const create = vi.fn().mockResolvedValue(emptyStream());
        (provider as any)._client = {
            messages: {
                create,
            },
        };

        await drain(
            provider.createResponseStream(
                [{ type: 'message', role: 'user', content: 'Return a quick answer' }] as any,
                'claude-fable-5',
                {
                    agent_id: 'test-claude-fable-no-invalid-thinking-request',
                    modelSettings: {
                        thinking_budget: 0,
                    },
                } as any
            )
        );

        const requestParams = create.mock.calls.at(0)?.[0];
        expect(requestParams?.model).toBe('claude-fable-5');
        expect(requestParams?.thinking).toBeUndefined();
        expect(requestParams?.output_config).toBeUndefined();
    });
});
