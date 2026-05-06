import { describe, expect, it, vi } from 'vitest';
import { OpenAIProvider } from '../model_providers/openai.js';

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

async function collectEvents(stream: AsyncIterable<unknown>): Promise<any[]> {
    const events: any[] = [];
    for await (const event of stream) {
        events.push(event);
    }
    return events;
}

describe('OpenAI structured output request formatting', () => {
    it('passes image inputs through once and forwards explicit original detail', async () => {
        const provider = new OpenAIProvider('sk-test');
        const create = vi.fn().mockResolvedValue(emptyStream());
        (provider as any)._client = {
            responses: {
                create,
            },
        };

        const dataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7+XxkAAAAASUVORK5CYII=';
        await drain(
            provider.createResponseStream(
                [
                    {
                        type: 'message',
                        role: 'user',
                        content: [
                            { type: 'input_text', text: 'Describe this image.' },
                            { type: 'input_image', image_url: dataUrl, detail: 'original' },
                        ],
                    },
                ] as any,
                'gpt-5.5',
                {
                    agent_id: 'test-openai-image-detail',
                } as any
            )
        );

        const requestParams = create.mock.calls.at(0)?.[0] as any;
        const imageParts = requestParams?.input?.[0]?.content?.filter((part: any) => part.type === 'input_image');
        expect(imageParts).toEqual([
            {
                type: 'input_image',
                image_url: dataUrl,
                detail: 'original',
            },
        ]);
    });

    it('forces top-level response properties into required for strict json_schema', async () => {
        const provider = new OpenAIProvider('sk-test');
        const create = vi.fn().mockResolvedValue(emptyStream());
        (provider as any)._client = {
            responses: {
                create,
            },
        };

        await drain(
            provider.createResponseStream(
                [{ type: 'message', role: 'user', content: 'Return JSON' }] as any,
                'gpt-4o',
                {
                    agent_id: 'test-openai-structured-output',
                    modelSettings: {
                        json_schema: {
                            name: 'result',
                            type: 'json_schema',
                            strict: true,
                            schema: {
                                type: 'object',
                                properties: {
                                    answer: { type: 'string' },
                                    note: { type: 'string', optional: true },
                                },
                                additionalProperties: false,
                            },
                        },
                    },
                } as any
            )
        );

        const requestParams = create.mock.calls.at(0)?.[0];
        expect(requestParams?.text?.format?.schema?.required).toEqual(['answer', 'note']);
    });

    it('classifies thrown transport failures as recoverable when they match retryable conditions', async () => {
        const provider = new OpenAIProvider('sk-test');
        const create = vi.fn().mockResolvedValue({
            async *[Symbol.asyncIterator]() {
                throw new Error('fetch failed: ECONNRESET');
            },
        });
        (provider as any)._client = {
            responses: {
                create,
            },
        };

        const events = await collectEvents(
            provider.createResponseStream(
                [{ type: 'message', role: 'user', content: 'Return JSON' }] as any,
                'gpt-4o',
                {
                    agent_id: 'test-openai-transport-retryability',
                } as any
            )
        );

        const errorEvent = events.find(event => event.type === 'error');
        expect(errorEvent?.error).toContain('fetch failed: ECONNRESET');
        expect(errorEvent?.recoverable).toBe(true);
    });

    it('does not add a terminal incomplete-tool error after a recoverable transport drop', async () => {
        const provider = new OpenAIProvider('sk-test');
        const create = vi.fn().mockResolvedValue({
            async *[Symbol.asyncIterator]() {
                yield {
                    type: 'response.output_item.added',
                    output_index: 0,
                    item: {
                        id: 'tool-call-1',
                        type: 'function_call',
                        call_id: 'call-1',
                        name: 'lookup_weather',
                    },
                };
                yield {
                    type: 'response.function_call_arguments.delta',
                    item_id: 'tool-call-1',
                    delta: '{"city":"Paris"',
                };
                throw Object.assign(new Error('fetch failed: ECONNRESET'), {
                    code: 'ECONNRESET',
                });
            },
        });
        (provider as any)._client = {
            responses: {
                create,
            },
        };

        const events = await collectEvents(
            provider.createResponseStream(
                [{ type: 'message', role: 'user', content: 'Call the tool' }] as any,
                'gpt-4o',
                {
                    agent_id: 'test-openai-incomplete-tool-retryability',
                } as any
            )
        );

        const errorEvents = events.filter(event => event.type === 'error');
        expect(errorEvents).toHaveLength(1);
        expect(errorEvents[0]?.error).toContain('fetch failed: ECONNRESET');
        expect(errorEvents[0]?.recoverable).toBe(true);
    });
});
