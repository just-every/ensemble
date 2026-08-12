import { describe, expect, it, vi } from 'vitest';
import { findModel } from '../data/model_data.js';
import { ClaudeProvider } from '../model_providers/claude.js';
import { getModelFromAgent, getModelProvider } from '../model_providers/model_provider.js';

async function drain(stream: AsyncIterable<unknown>): Promise<void> {
    for await (const _event of stream) {
        // Only request construction is under test.
    }
}

function emptyStream() {
    return { async *[Symbol.asyncIterator]() {} };
}

describe('Claude Opus 5 support', () => {
    it('registers current metadata, pricing, aliases, and keeps Opus 4.8', async () => {
        const model = findModel('claude-opus-5');
        expect(model).toMatchObject({
            id: 'claude-opus-5',
            provider: 'anthropic',
            cost: {
                input_per_million: 5,
                cached_input_per_million: 0.5,
                cache_write_input_per_million: 6.25,
                cache_write_1h_input_per_million: 10,
                output_per_million: 25,
            },
            features: {
                context_length: 1_000_000,
                max_output_tokens: 128000,
                input_modality: ['text', 'image'],
                output_modality: ['text'],
            },
        });
        expect(findModel('claude-opus-latest')?.id).toBe('claude-opus-5');
        expect(findModel('claude-opus-4.8')?.id).toBe('claude-opus-4-8');
        expect(await getModelFromAgent({ agent_id: 'opus-max', model: 'claude-opus-latest-max' } as any)).toBe(
            'claude-opus-5-max'
        );
    });

    it('uses implicit adaptive thinking with true max effort', async () => {
        const provider = new ClaudeProvider('sk-ant-test');
        const create = vi.fn().mockResolvedValue(emptyStream());
        (provider as any)._client = { messages: { create } };

        await drain(
            provider.createResponseStream(
                [{ type: 'message', role: 'user', content: 'Solve this carefully' }] as any,
                'claude-opus-5-max',
                { agent_id: 'opus-5-max', modelSettings: { temperature: 0.2 } } as any
            )
        );

        expect(create.mock.calls.at(0)?.[0]).toMatchObject({
            model: 'claude-opus-5',
            output_config: { effort: 'max' },
        });
        expect(create.mock.calls.at(0)?.[0]?.thinking).toBeUndefined();
        expect(create.mock.calls.at(0)?.[0]?.temperature).toBeUndefined();
    });

    it('sends explicit disabled thinking for a zero budget', async () => {
        const provider = new ClaudeProvider('sk-ant-test');
        const create = vi.fn().mockResolvedValue(emptyStream());
        (provider as any)._client = { messages: { create } };

        await drain(
            provider.createResponseStream(
                [{ type: 'message', role: 'user', content: 'Answer directly' }] as any,
                'claude-opus-5',
                { agent_id: 'opus-5-off', modelSettings: { thinking_budget: 0 } } as any
            )
        );

        expect(create.mock.calls.at(0)?.[0]?.thinking).toEqual({ type: 'disabled' });
        expect(create.mock.calls.at(0)?.[0]?.output_config).toBeUndefined();
    });

    it('rejects retired Opus 4.1 IDs with migration guidance', () => {
        expect(findModel('claude-opus-4-1-20250805')).toBeUndefined();
        expect(() => getModelProvider('claude-opus-4-1-20250805')).toThrow('Migrate to claude-opus-5');
        expect(() => getModelProvider('claude-opus-4.1')).toThrow('Migrate to claude-opus-5');
    });
});
