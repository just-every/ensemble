import { describe, expect, it, vi } from 'vitest';
import { OpenAIChat } from '../model_providers/openai_chat.js';

async function drain(stream: AsyncIterable<unknown>): Promise<void> {
    for await (const _event of stream) {
        // Intentionally empty.
    }
}

function emptyStream() {
    return {
        async *[Symbol.asyncIterator]() {
            // No-op stream.
        },
    };
}

describe('OpenAI chat provider thinking budget', () => {
    it('maps modelSettings.thinking_budget to reasoning effort', async () => {
        const provider = new OpenAIChat('openrouter', 'sk-test', 'https://openrouter.ai/api/v1');
        const create = vi.fn().mockResolvedValue(emptyStream());
        (provider as any)._client = {
            chat: {
                completions: {
                    create,
                },
            },
        };

        await drain(
            provider.createResponseStream(
                [{ type: 'message', role: 'user', content: 'Return concise answer' }] as any,
                'gpt-oss-20b', // model doesn't matter in this unit test
                {
                    agent_id: 'test-openai-chat-thinking-budget',
                    modelSettings: {
                        thinking_budget: 1500,
                    },
                } as any
            )
        );

        const requestParams = create.mock.calls.at(0)?.[0];
        expect(requestParams?.reasoning).toEqual({ effort: 'low' });
    });

    it('keeps default reasoning settings when thinking_budget is not provided', async () => {
        const provider = new OpenAIChat('openrouter', 'sk-test', 'https://openrouter.ai/api/v1');
        const create = vi.fn().mockResolvedValue(emptyStream());
        (provider as any)._client = {
            chat: {
                completions: {
                    create,
                },
            },
        };

        await drain(
            provider.createResponseStream(
                [{ type: 'message', role: 'user', content: 'Return concise answer' }] as any,
                'gpt-oss-20b',
                {
                    agent_id: 'test-openai-chat-thinking-budget-default',
                } as any
            )
        );

        const requestParams = create.mock.calls.at(0)?.[0];
        expect(requestParams).toBeDefined();
        expect(requestParams.reasoning).toBeUndefined();
    });
});
