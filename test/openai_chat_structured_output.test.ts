import { describe, expect, it, vi } from 'vitest';
import { DeepSeekProvider } from '../model_providers/deepseek.js';
import { OpenAIChat } from '../model_providers/openai_chat.js';
import { OpenRouterProvider } from '../model_providers/openrouter.js';
import { convertToFunctionCall, convertToFunctionCallOutput } from '../utils/message_converter.js';

async function drain(stream: AsyncIterable<unknown>): Promise<void> {
    for await (const _event of stream) {
        // Request formatting happens before the mocked stream is consumed.
    }
}

function completionStream(content = '{}') {
    return {
        async *[Symbol.asyncIterator]() {
            yield {
                choices: [
                    {
                        delta: {
                            content,
                        },
                        finish_reason: 'stop',
                    },
                ],
            };
        },
    };
}

function reasoningToolCallStream() {
    return {
        async *[Symbol.asyncIterator]() {
            yield {
                choices: [
                    {
                        delta: { reasoning_content: 'I need the scoped knowledge before answering.' },
                    },
                ],
            };
            yield {
                choices: [
                    {
                        delta: {
                            tool_calls: [
                                {
                                    index: 0,
                                    id: 'call_knowledge',
                                    type: 'function',
                                    function: { name: 'search_knowledge', arguments: '{"query":"refund"}' },
                                },
                                {
                                    index: 1,
                                    id: 'call_history',
                                    type: 'function',
                                    function: { name: 'read_conversation_history', arguments: '{"limit":10}' },
                                },
                            ],
                        },
                        finish_reason: 'tool_calls',
                    },
                ],
            };
        },
    };
}

function attachMockChatClient(provider: unknown) {
    const create = vi.fn().mockResolvedValue(completionStream());
    (provider as any)._client = {
        chat: {
            completions: {
                create,
            },
        },
    };
    return create;
}

const jsonSchema = {
    name: 'answer_result',
    type: 'json_schema' as const,
    strict: true,
    schema: {
        type: 'object',
        properties: {
            answer: { type: 'string' },
            note: { type: 'string', optional: true },
        },
        additionalProperties: false,
    },
};

describe('OpenAI chat structured output request formatting', () => {
    it('sends OpenRouter/OpenAI-compatible json_schema without the Ensemble wrapper type inside json_schema', async () => {
        const provider = new OpenAIChat('openrouter', 'test-openrouter-key', 'https://openrouter.ai/api/v1');
        const create = attachMockChatClient(provider);

        await drain(
            provider.createResponseStream(
                [{ type: 'message', role: 'user', content: 'Return JSON' }] as any,
                'deepseek/deepseek-v4-pro',
                {
                    agent_id: 'test-openrouter-structured-output',
                    modelSettings: {
                        json_schema: jsonSchema,
                    },
                } as any
            )
        );

        const requestParams = create.mock.calls.at(0)?.[0];
        expect(requestParams.response_format.type).toBe('json_schema');
        expect(requestParams.response_format.json_schema.type).toBeUndefined();
        expect(requestParams.response_format.json_schema.name).toBe('answer_result');
        expect(requestParams.response_format.json_schema.strict).toBe(true);
        expect(requestParams.response_format.json_schema.schema.required).toEqual(['answer', 'note']);
    });

    it('uses json_object plus schema instructions for OpenRouter DeepSeek structured requests', async () => {
        const provider = new OpenRouterProvider();
        const create = attachMockChatClient(provider);

        await drain(
            provider.createResponseStream(
                [{ type: 'message', role: 'user', content: 'Return JSON' }] as any,
                'deepseek/deepseek-v4-flash',
                {
                    agent_id: 'test-openrouter-deepseek-json-object',
                    modelSettings: {
                        json_schema: jsonSchema,
                    },
                } as any
            )
        );

        const requestParams = create.mock.calls.at(0)?.[0];
        expect(requestParams.response_format).toEqual({ type: 'json_object' });
        expect(requestParams.structured_outputs).toBeUndefined();
        expect(JSON.stringify(requestParams.response_format)).not.toContain('json_schema');
        expect(requestParams.messages.at(-1).role).toBe('system');
        expect(requestParams.messages.at(-1).content).toContain('Respond only with valid JSON.');
        expect(requestParams.messages.at(-1).content).toContain('"answer"');
    });

    it('requires schema-capable OpenRouter endpoints for MiMo json_schema requests', async () => {
        const provider = new OpenRouterProvider();
        const create = attachMockChatClient(provider);

        await drain(
            provider.createResponseStream(
                [{ type: 'message', role: 'user', content: 'Return JSON' }] as any,
                'xiaomi/mimo-v2.5-pro',
                {
                    agent_id: 'test-openrouter-mimo-structured-output',
                    modelSettings: {
                        json_schema: jsonSchema,
                    },
                } as any
            )
        );

        const requestParams = create.mock.calls.at(0)?.[0];
        expect(requestParams.response_format.type).toBe('json_schema');
        expect(requestParams.structured_outputs).toBe(true);
        expect(requestParams.provider.require_parameters).toBe(true);
    });

    it('uses portable JSON mode for OpenRouter MiMo without known native structured output', async () => {
        const provider = new OpenRouterProvider();
        const create = attachMockChatClient(provider);

        await drain(
            provider.createResponseStream(
                [{ type: 'message', role: 'user', content: 'Return JSON' }] as any,
                'xiaomi/mimo-v2.5',
                {
                    agent_id: 'test-openrouter-mimo-portable-json-schema',
                    modelSettings: {
                        json_schema: jsonSchema,
                    },
                } as any
            )
        );

        const requestParams = create.mock.calls.at(0)?.[0];
        expect(requestParams.response_format).toEqual({ type: 'json_object' });
        expect(requestParams.structured_outputs).toBeUndefined();
        expect(requestParams.messages.at(-1).role).toBe('system');
        expect(requestParams.messages.at(-1).content).toContain('Respond only with valid JSON.');
        expect(requestParams.messages.at(-1).content).toContain('"answer"');
    });

    it('keeps OpenRouter reasoning deltas out of final structured content', async () => {
        const provider = new OpenAIChat('openrouter', 'test-openrouter-key', 'https://openrouter.ai/api/v1');
        (provider as any)._client = {
            chat: {
                completions: {
                    create: vi.fn().mockResolvedValue({
                        async *[Symbol.asyncIterator]() {
                            yield {
                                choices: [
                                    {
                                        delta: {
                                            reasoning: 'I should think privately before returning JSON.',
                                        },
                                    },
                                ],
                            };
                            yield {
                                choices: [
                                    {
                                        delta: {
                                            content: '{"answer":"ok"}',
                                        },
                                        finish_reason: 'stop',
                                    },
                                ],
                            };
                        },
                    }),
                },
            },
        };

        const events: any[] = [];
        for await (const event of provider.createResponseStream(
            [{ type: 'message', role: 'user', content: 'Return JSON' }] as any,
            'deepseek/deepseek-v4-flash',
            {
                agent_id: 'test-openrouter-reasoning-content',
                modelSettings: {
                    json_schema: jsonSchema,
                },
            } as any
        )) {
            events.push(event);
        }

        const complete = events.find(event => event.type === 'message_complete');
        const thinkingDelta = events.find(event => event.type === 'message_delta' && event.thinking_content);
        expect(complete?.content).toBe('{"answer":"ok"}');
        expect(complete?.thinking_content).toContain('think privately');
        expect(thinkingDelta?.content).toBe('');
        expect(thinkingDelta?.thinking_content).toContain('think privately');
    });

    it('maps direct DeepSeek schema requests to json_object and carries the schema in the prompt', async () => {
        const provider = new DeepSeekProvider();
        const create = attachMockChatClient(provider);

        await drain(
            provider.createResponseStream(
                [{ type: 'message', role: 'user', content: 'Return the result' }] as any,
                'deepseek-v4-flash',
                {
                    agent_id: 'test-deepseek-json-object',
                    modelSettings: {
                        json_schema: jsonSchema,
                    },
                } as any
            )
        );

        const requestParams = create.mock.calls.at(0)?.[0];
        expect(requestParams.response_format).toEqual({ type: 'json_object' });
        expect(JSON.stringify(requestParams.response_format)).not.toContain('json_schema');
        expect(requestParams.messages.at(-1).role).toBe('system');
        expect(requestParams.messages.at(-1).content).toContain('Respond only with valid JSON.');
        expect(requestParams.messages.at(-1).content).toContain('"answer"');
    });

    it('uses DeepSeek V4 Pro JSON mode with explicit schema instructions', async () => {
        const provider = new DeepSeekProvider();
        const create = attachMockChatClient(provider);

        await drain(
            provider.createResponseStream(
                [{ type: 'message', role: 'user', content: 'Return the result' }] as any,
                'deepseek-v4-pro',
                {
                    agent_id: 'test-deepseek-reasoner-json-prompt',
                    modelSettings: {
                        json_schema: jsonSchema,
                    },
                } as any
            )
        );

        const requestParams = create.mock.calls.at(0)?.[0];
        expect(requestParams.response_format).toEqual({ type: 'json_object' });
        expect(requestParams.messages.at(-1).role).toBe('system');
        expect(requestParams.messages.at(-1).content).toContain('Respond only with valid JSON.');
    });

    it('replays DeepSeek reasoning with a grouped native tool turn', async () => {
        const provider = new DeepSeekProvider();
        const create = vi
            .fn()
            .mockResolvedValueOnce(reasoningToolCallStream())
            .mockResolvedValueOnce(completionStream('Done.'));
        (provider as any)._client = { chat: { completions: { create } } };

        const firstRoundEvents: any[] = [];
        for await (const event of provider.createResponseStream(
            [{ type: 'message', role: 'user', content: 'Check the refund status.' }] as any,
            'deepseek-v4-flash',
            { agent_id: 'test-deepseek-reasoning-tool-replay' } as any
        )) {
            firstRoundEvents.push(event);
        }

        const toolCalls = firstRoundEvents.filter(event => event.type === 'tool_start').map(event => event.tool_call);
        expect(toolCalls).toHaveLength(2);
        expect(toolCalls.map(call => call.reasoning_content)).toEqual([
            'I need the scoped knowledge before answering.',
            'I need the scoped knowledge before answering.',
        ]);

        const resumedHistory: any[] = [{ type: 'message', role: 'user', content: 'Check the refund status.' }];
        for (const toolCall of toolCalls) {
            resumedHistory.push(convertToFunctionCall(toolCall, 'deepseek-v4-flash'));
            resumedHistory.push(
                convertToFunctionCallOutput(
                    {
                        id: toolCall.id,
                        call_id: toolCall.id,
                        toolCall,
                        output: JSON.stringify({ source: toolCall.function.name }),
                    },
                    'deepseek-v4-flash'
                )
            );
        }

        await drain(
            provider.createResponseStream(resumedHistory as any, 'deepseek-v4-flash', {
                agent_id: 'test-deepseek-reasoning-tool-replay',
            } as any)
        );

        const resumedRequest = create.mock.calls.at(1)?.[0];
        expect(resumedRequest.messages).toHaveLength(4);
        expect(resumedRequest.messages[1]).toMatchObject({
            role: 'assistant',
            content: null,
            reasoning_content: 'I need the scoped knowledge before answering.',
            tool_calls: [
                { id: 'call_knowledge', function: { name: 'search_knowledge', arguments: '{"query":"refund"}' } },
                { id: 'call_history', function: { name: 'read_conversation_history', arguments: '{"limit":10}' } },
            ],
        });
        expect(resumedRequest.messages.slice(2)).toEqual([
            { role: 'tool', tool_call_id: 'call_knowledge', content: '{"source":"search_knowledge"}' },
            { role: 'tool', tool_call_id: 'call_history', content: '{"source":"read_conversation_history"}' },
        ]);
    });
});
