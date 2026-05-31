import { describe, expect, it, vi } from 'vitest';
import { MODEL_CLASSES, findModel } from '../data/model_data.js';
import { ClaudeProvider } from '../model_providers/claude.js';
import { getModelFromAgent } from '../model_providers/model_provider.js';

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

describe('Claude Opus 4.8 support', () => {
    it('registers Opus 4.8 with current aliases, pricing, and metadata', () => {
        const model = findModel('claude-opus-4-8');
        const dotAlias = findModel('claude-opus-4.8');
        const latestAlias = findModel('claude-opus-latest');
        const shortAlias = findModel('claude-opus');
        const prefixlessAlias = findModel('opus-4.8');
        const previous = findModel('claude-opus-4-7');

        expect(model?.id).toBe('claude-opus-4-8');
        expect(dotAlias?.id).toBe('claude-opus-4-8');
        expect(latestAlias?.id).toBe('claude-opus-4-8');
        expect(shortAlias?.id).toBe('claude-opus-4-8');
        expect(prefixlessAlias?.id).toBe('claude-opus-4-8');
        expect(previous?.id).toBe('claude-opus-4-7');

        expect(model?.cost?.input_per_million).toBe(5.0);
        expect(model?.cost?.cached_input_per_million).toBe(0.5);
        expect(model?.cost?.output_per_million).toBe(25.0);
        expect(model?.features?.context_length).toBe(1_000_000);
        expect(model?.features?.max_output_tokens).toBe(128000);
        expect(model?.features?.input_modality).toEqual(['text', 'image']);
        expect(model?.features?.output_modality).toEqual(['text']);
        expect(model?.features?.tool_use).toBe(true);
        expect(model?.features?.streaming).toBe(true);
        expect(model?.features?.json_output).toBe(true);
        expect(model?.features?.reasoning_output).toBe(true);
    });

    it('updates highest-tier Anthropic model classes to Opus 4.8', () => {
        expect(MODEL_CLASSES.reasoning_high.models).toContain('claude-opus-4-8');
        expect(MODEL_CLASSES.metacognition.models).toContain('claude-opus-4-8');
        expect(MODEL_CLASSES.code.models).toContain('claude-opus-4-8');
        expect(MODEL_CLASSES.vision.models).toContain('claude-opus-4-8');
        expect(MODEL_CLASSES.long.models).toContain('claude-opus-4-8');
    });

    it('normalizes Opus 4.8 aliases while preserving effort suffixes', async () => {
        const latest = await getModelFromAgent({
            agent_id: 'test-claude-opus-latest',
            model: 'claude-opus-latest',
        } as any);
        const xhigh = await getModelFromAgent({
            agent_id: 'test-claude-opus-4.8-xhigh',
            model: 'claude-opus-4.8-xhigh',
        } as any);
        const prefixless = await getModelFromAgent({
            agent_id: 'test-opus-4.8-alias',
            model: 'opus-4.8',
        } as any);

        expect(latest).toBe('claude-opus-4-8');
        expect(xhigh).toBe('claude-opus-4-8-xhigh');
        expect(prefixless).toBe('claude-opus-4-8');
    });

    it('uses adaptive thinking and omits unsupported sampling params for Opus 4.8', async () => {
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
                'claude-opus-4.8-xhigh',
                {
                    agent_id: 'test-claude-opus-4.8-request',
                    modelSettings: {
                        temperature: 0.3,
                    },
                } as any
            )
        );

        const requestParams = create.mock.calls.at(0)?.[0];
        expect(requestParams?.model).toBe('claude-opus-4-8');
        expect(requestParams?.thinking).toEqual({
            type: 'adaptive',
            display: 'summarized',
        });
        expect(requestParams?.output_config).toEqual({
            effort: 'xhigh',
        });
        expect(requestParams?.temperature).toBeUndefined();
    });

    it('allows modelSettings.thinking_budget=0 to disable adaptive thinking for Opus 4.8', async () => {
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
                'claude-opus-latest',
                {
                    agent_id: 'test-claude-opus-4.8-no-thinking-request',
                    modelSettings: {
                        thinking_budget: 0,
                    },
                } as any
            )
        );

        const requestParams = create.mock.calls.at(0)?.[0];
        expect(requestParams?.model).toBe('claude-opus-4-8');
        expect(requestParams?.thinking).toBeUndefined();
        expect(requestParams?.output_config).toBeUndefined();
    });
});
