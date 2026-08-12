import { describe, expect, it, vi } from 'vitest';
import { OpenAIChat } from '../model_providers/openai_chat.js';

async function collectEvents(stream: AsyncIterable<any>): Promise<any[]> {
    const events: any[] = [];
    for await (const event of stream) {
        events.push(event);
    }
    return events;
}

describe('provider chat failure paths', () => {
    it('does not start sibling tools once an OpenAIChat multi-tool batch is known malformed', async () => {
        const provider = new OpenAIChat('xai', 'xai-test', 'https://api.x.ai/v1');
        (provider as any)._client = {
            chat: {
                completions: {
                    create: vi.fn().mockResolvedValue({
                        async *[Symbol.asyncIterator]() {
                            yield {
                                id: 'chatcmpl-malformed-multi-tool',
                                choices: [
                                    {
                                        index: 0,
                                        delta: {
                                            tool_calls: [
                                                {
                                                    index: 0,
                                                    id: 'call_1',
                                                    type: 'function',
                                                    function: {
                                                        name: 'lookup_weather',
                                                        arguments: '{"city":"Paris"}',
                                                    },
                                                },
                                                {
                                                    index: 1,
                                                    id: 'call_2',
                                                    type: 'function',
                                                    function: {
                                                        name: 'lookup_time',
                                                        arguments: '{"timezone":"UTC"',
                                                    },
                                                },
                                            ],
                                        },
                                        finish_reason: 'tool_calls',
                                    },
                                ],
                            };
                        },
                    }),
                },
            },
        };

        const events = await collectEvents(
            provider.createResponseStream(
                [{ type: 'message', role: 'user', content: 'Call the tools' }] as any,
                'grok-4.3',
                {
                    agent_id: 'test-openai-chat-malformed-multi-tool',
                } as any
            )
        );

        const toolStarts = events.filter(event => event.type === 'tool_start');
        const errorEvent = events.find(event => event.type === 'error');

        expect(toolStarts).toHaveLength(0);
        expect(errorEvent?.error).toContain('lookup_time');
        expect(errorEvent?.recoverable).toBe(false);
    });
});
