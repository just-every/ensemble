import { describe, expect, it, vi } from 'vitest';
import { OpenAIChat } from '../model_providers/openai_chat.js';
import { OpenAIProvider } from '../model_providers/openai.js';
import { ClaudeProvider } from '../model_providers/claude.js';
import { validateJsonResponseContent } from '../utils/json_schema.js';

async function collectEvents(stream: AsyncIterable<any>): Promise<any[]> {
    const events: any[] = [];
    for await (const event of stream) {
        events.push(event);
    }
    return events;
}

function emptyStream() {
    return {
        async *[Symbol.asyncIterator]() {
            // No-op stream.
        },
    };
}

describe('provider chat failure paths', () => {
    it('preserves strict json_schema payloads for chat providers', async () => {
        const provider = new OpenAIChat('xai', 'xai-test', 'https://api.x.ai/v1');
        const create = vi.fn().mockResolvedValue(emptyStream());
        (provider as any)._client = {
            chat: {
                completions: {
                    create,
                },
            },
        };


        const schema = {
            type: 'object',
            properties: {
                answer: {
                    type: 'string',
                    optional: true,
                    minLength: 3,
                    pattern: '^[a-z]+$',
                    default: 'nope',
                },
                score: {
                    type: 'number',
                    minimum: 1,
                    maximum: 5,
                    multipleOf: 0.5,
                },
                tags: {
                    type: 'array',
                    items: { type: 'string' },
                    minItems: 1,
                    maxItems: 3,
                },
            },
            required: ['score'],
            additionalProperties: false,
        };

        await collectEvents(
            provider.createResponseStream(
                [{ type: 'message', role: 'user', content: 'Return JSON' }] as any,
                'grok-4-fast-reasoning',
                {
                    agent_id: 'test-grok-json-schema',
                    modelSettings: {
                        json_schema: {
                            name: 'result',
                            type: 'json_schema',
                            strict: true,
                            schema,
                        },
                    },
                } as any
            )
        );

        const requestParams = create.mock.calls.at(0)?.[0];
        expect(requestParams?.response_format?.json_schema?.schema).toEqual(schema);
    });

    it('preserves explicit required arrays in caller-provided json_schema', async () => {
        const provider = new OpenAIChat('xai', 'xai-test', 'https://api.x.ai/v1');
        const create = vi.fn().mockResolvedValue(emptyStream());
        (provider as any)._client = {
            chat: {
                completions: {
                    create,
                },
            },
        };

        await collectEvents(
            provider.createResponseStream(
                [{ type: 'message', role: 'user', content: 'Return JSON' }] as any,
                'grok-4-fast-reasoning',
                {
                    agent_id: 'test-grok-standard-json-schema',
                    modelSettings: {
                        json_schema: {
                            name: 'result',
                            type: 'json_schema',
                            strict: true,
                            schema: {
                                type: 'object',
                                properties: {
                                    answer: { type: 'string' },
                                    note: { type: 'string' },
                                },
                                required: ['answer'],
                                additionalProperties: false,
                            },
                        },
                    },
                } as any
            )
        );

        const requestParams = create.mock.calls.at(0)?.[0];
        expect(requestParams?.response_format?.json_schema?.schema.required).toEqual(['answer']);
    });

    it('preserves non-strict json_schema payloads for chat providers', async () => {
        const provider = new OpenAIChat('xai', 'xai-test', 'https://api.x.ai/v1');
        const create = vi.fn().mockResolvedValue(emptyStream());
        (provider as any)._client = {
            chat: {
                completions: {
                    create,
                },
            },
        };

        const schema = {
            type: 'object',
            properties: {
                answer: {
                    type: 'string',
                    minLength: 3,
                    pattern: '^[a-z]+$',
                    default: 'abc',
                },
                metadata: {
                    type: 'object',
                    additionalProperties: {
                        type: 'string',
                    },
                },
            },
        };

        await collectEvents(
            provider.createResponseStream(
                [{ type: 'message', role: 'user', content: 'Return JSON' }] as any,
                'grok-4-fast-reasoning',
                {
                    agent_id: 'test-grok-non-strict-json-schema',
                    modelSettings: {
                        json_schema: {
                            name: 'result',
                            type: 'json_schema',
                            schema,
                        },
                    },
                } as any
            )
        );

        const requestParams = create.mock.calls.at(0)?.[0];
        expect(requestParams?.response_format?.json_schema?.schema).toEqual(schema);
    });

    it('preserves oneOf branch requirements when normalizing OpenAI response schemas', async () => {
        const provider = new OpenAIProvider();
        const create = vi.fn().mockResolvedValue(emptyStream());
        (provider as any)._client = {
            responses: {
                create,
            },
        };

        await collectEvents(
            provider.createResponseStream(
                [{ type: 'message', role: 'user', content: 'Return JSON' }] as any,
                'gpt-4.1-mini',
                {
                    agent_id: 'test-openai-oneof-json-schema',
                    modelSettings: {
                        json_schema: {
                            name: 'result',
                            type: 'json_schema',
                            strict: true,
                            schema: {
                                oneOf: [
                                    {
                                        type: 'object',
                                        properties: {
                                            kind: { const: 'weather' },
                                            city: { type: 'string' },
                                            units: { type: 'string', optional: true },
                                        },
                                    },
                                    {
                                        type: 'object',
                                        properties: {
                                            kind: { const: 'time' },
                                            timezone: { type: 'string' },
                                        },
                                        required: ['kind', 'timezone'],
                                    },
                                ],
                            },
                        },
                    },
                } as any
            )
        );

        const requestParams = create.mock.calls.at(0)?.[0];
        expect(requestParams?.text?.format?.schema).toEqual({
            anyOf: [
                {
                    type: 'object',
                    properties: {
                        kind: { const: 'weather' },
                        city: { type: 'string' },
                        units: { type: 'string' },
                    },
                    additionalProperties: false,
                    required: ['kind', 'city', 'units'],
                },
                {
                    type: 'object',
                    properties: {
                        kind: { const: 'time' },
                        timezone: { type: 'string' },
                    },
                    additionalProperties: false,
                    required: ['kind', 'timezone'],
                },
            ],
        });
    });

    it('preserves optional tool properties in OpenAI tool schemas', async () => {
        const provider = new OpenAIProvider();
        const create = vi.fn().mockResolvedValue(emptyStream());
        (provider as any)._client = {
            responses: {
                create,
            },
        };

        await collectEvents(
            provider.createResponseStream(
                [{ type: 'message', role: 'user', content: 'Call the tool' }] as any,
                'gpt-4.1-mini',
                {
                    agent_id: 'test-openai-tool-optional-required',
                    tools: [
                        {
                            definition: {
                                type: 'function',
                                function: {
                                    name: 'lookup_weather',
                                    description: 'Lookup weather',
                                    parameters: {
                                        type: 'object',
                                        properties: {
                                            city: { type: 'string' },
                                            units: { type: 'string', optional: true },
                                        },
                                    },
                                },
                            },
                            function: vi.fn(),
                        },
                    ],
                } as any
            )
        );

        const requestParams = create.mock.calls.at(0)?.[0];
        expect(requestParams?.tools?.[0]?.parameters).toMatchObject({
            type: 'object',
            additionalProperties: false,
            required: ['city'],
        });
    });

    it('preserves explicit required subsets in OpenAI tool schemas', async () => {
        const provider = new OpenAIProvider();
        const create = vi.fn().mockResolvedValue(emptyStream());
        (provider as any)._client = {
            responses: {
                create,
            },
        };

        await collectEvents(
            provider.createResponseStream(
                [{ type: 'message', role: 'user', content: 'Call the tool' }] as any,
                'gpt-4.1-mini',
                {
                    agent_id: 'test-openai-tool-explicit-required',
                    tools: [
                        {
                            definition: {
                                type: 'function',
                                function: {
                                    name: 'lookup_weather',
                                    description: 'Lookup weather',
                                    parameters: {
                                        type: 'object',
                                        properties: {
                                            city: { type: 'string' },
                                            units: { type: 'string' },
                                            locale: { type: 'string', optional: true },
                                        },
                                        required: ['city'],
                                    },
                                },
                            },
                            function: vi.fn(),
                        },
                    ],
                } as any
            )
        );

        const requestParams = create.mock.calls.at(0)?.[0];
        expect(requestParams?.tools?.[0]?.parameters).toMatchObject({
            type: 'object',
            additionalProperties: false,
            required: ['city'],
        });
    });

    it('emits an error instead of a partial tool call when OpenAI responses stop mid-tool', async () => {
        const provider = new OpenAIProvider();
        (provider as any)._client = {
            responses: {
                create: vi.fn().mockResolvedValue({
                    async *[Symbol.asyncIterator]() {
                        yield {
                            type: 'response.output_item.added',
                            output_index: 0,
                            item: {
                                type: 'function_call',
                                id: 'fc_1',
                                call_id: 'call_1',
                                name: 'lookup_weather',
                            },
                        };
                    },
                }),
            },
        };

        const events = await collectEvents(
            provider.createResponseStream(
                [{ type: 'message', role: 'user', content: 'Call the tool' }] as any,
                'gpt-5-mini',
                {
                    agent_id: 'test-openai-incomplete-tool',
                } as any
            )
        );

        expect(events.some(event => event.type === 'tool_start')).toBe(false);
        const errorEvent = events.find(event => event.type === 'error');
        expect(errorEvent?.error).toContain('incomplete tool call arguments');
        expect(errorEvent?.error).toContain('lookup_weather');
        expect(errorEvent?.recoverable).toBe(false);
    });

    it('marks incomplete OpenAI multi-tool streams as terminal after valid tool starts', async () => {
        const provider = new OpenAIProvider();
        (provider as any)._client = {
            responses: {
                create: vi.fn().mockResolvedValue({
                    async *[Symbol.asyncIterator]() {
                        yield {
                            type: 'response.output_item.added',
                            output_index: 0,
                            item: {
                                type: 'function_call',
                                id: 'fc_1',
                                call_id: 'call_1',
                                name: 'lookup_weather',
                            },
                        };
                        yield {
                            type: 'response.output_item.added',
                            output_index: 1,
                            item: {
                                type: 'function_call',
                                id: 'fc_2',
                                call_id: 'call_2',
                                name: 'lookup_time',
                            },
                        };
                        yield {
                            type: 'response.function_call_arguments.done',
                            item_id: 'fc_1',
                            arguments: '{"city":"Paris"}',
                        };
                    },
                }),
            },
        };

        const events = await collectEvents(
            provider.createResponseStream(
                [{ type: 'message', role: 'user', content: 'Call the tools' }] as any,
                'gpt-5-mini',
                {
                    agent_id: 'test-openai-mixed-tool-stream',
                } as any
            )
        );

        const toolStart = events.find(event => event.type === 'tool_start');
        const errorEvent = events.find(event => event.type === 'error');
        expect(toolStart?.tool_call?.function?.name).toBe('lookup_weather');
        expect(errorEvent?.error).toContain('lookup_time');
        expect(errorEvent?.recoverable).toBe(false);
    });

    it('marks malformed Claude tool arguments as terminal after earlier tool starts', async () => {
        const provider = new ClaudeProvider('test-key');
        (provider as any)._client = {
            messages: {
                create: vi.fn().mockResolvedValue({
                    async *[Symbol.asyncIterator]() {
                        yield {
                            type: 'content_block_start',
                            content_block: {
                                type: 'tool_use',
                                id: 'tool_1',
                                name: 'lookup_weather',
                                input: {},
                            },
                        };
                        yield {
                            type: 'content_block_stop',
                            content_block: {
                                type: 'tool_use',
                            },
                        };
                        yield {
                            type: 'content_block_start',
                            content_block: {
                                type: 'tool_use',
                                id: 'tool_2',
                                name: 'lookup_time',
                                input: {},
                            },
                        };
                        yield {
                            type: 'content_block_delta',
                            delta: {
                                type: 'input_json_delta',
                                partial_json: '{"timezone":"UTC"',
                            },
                        };
                        yield {
                            type: 'content_block_stop',
                            content_block: {
                                type: 'tool_use',
                            },
                        };
                    },
                }),
            },
        };

        const events = await collectEvents(
            provider.createResponseStream(
                [{ type: 'message', role: 'user', content: 'Call the tools' }] as any,
                'claude-sonnet-4-20250514',
                {
                    agent_id: 'test-claude-mixed-tool-stream',
                } as any
            )
        );

        const toolStart = events.find(event => event.type === 'tool_start');
        const errorEvent = events.find(event => event.type === 'error');
        expect(toolStart?.tool_call?.function?.name).toBe('lookup_weather');
        expect(errorEvent?.error).toContain('lookup_time');
        expect(errorEvent?.recoverable).toBe(false);
    });

    it('marks malformed OpenAIChat tool arguments as terminal', async () => {
        const provider = new OpenAIChat('xai', 'xai-test', 'https://api.x.ai/v1');
        (provider as any)._client = {
            chat: {
                completions: {
                    create: vi.fn().mockResolvedValue({
                        async *[Symbol.asyncIterator]() {
                            yield {
                                id: 'chatcmpl-malformed',
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
                                                        arguments: '{"city":"Paris"',
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
                [{ type: 'message', role: 'user', content: 'Call the tool' }] as any,
                'grok-4-fast-reasoning',
                {
                    agent_id: 'test-openai-chat-malformed-tool',
                } as any
            )
        );

        expect(events.some(event => event.type === 'tool_start')).toBe(false);
        const errorEvent = events.find(event => event.type === 'error');
        expect(errorEvent?.error).toContain('malformed tool arguments');
        expect(errorEvent?.recoverable).toBe(false);
    });

    it('marks OpenAIChat unparsed tool-call finishes as terminal', async () => {
        const provider = new OpenAIChat('xai', 'xai-test', 'https://api.x.ai/v1');
        (provider as any)._client = {
            chat: {
                completions: {
                    create: vi.fn().mockResolvedValue({
                        async *[Symbol.asyncIterator]() {
                            yield {
                                id: 'chatcmpl-no-tools',
                                choices: [
                                    {
                                        index: 0,
                                        delta: {},
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
                [{ type: 'message', role: 'user', content: 'Call the tool' }] as any,
                'grok-4-fast-reasoning',
                {
                    agent_id: 'test-openai-chat-no-parsed-tools',
                } as any
            )
        );

        expect(events.some(event => event.type === 'tool_start')).toBe(false);
        const errorEvent = events.find(event => event.type === 'error');
        expect(errorEvent?.error).toContain('none were parsed correctly');
        expect(errorEvent?.recoverable).toBe(false);
    });

    it('does not start earlier valid OpenAIChat tool calls once a sibling is malformed', async () => {
        const provider = new OpenAIChat('xai', 'xai-test', 'https://api.x.ai/v1');
        (provider as any)._client = {
            chat: {
                completions: {
                    create: vi.fn().mockResolvedValue({
                        async *[Symbol.asyncIterator]() {
                            yield {
                                id: 'chatcmpl-mixed-tools',
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
                'grok-4-fast-reasoning',
                {
                    agent_id: 'test-openai-chat-mixed-tools',
                } as any
            )
        );

        const toolStart = events.find(event => event.type === 'tool_start');
        const errorEvent = events.find(event => event.type === 'error');
        expect(toolStart).toBeUndefined();
        expect(errorEvent?.error).toContain('lookup_time');
        expect(errorEvent?.recoverable).toBe(false);
    });

    it('does not start later valid OpenAIChat tool calls once a sibling is malformed', async () => {
        const provider = new OpenAIChat('xai', 'xai-test', 'https://api.x.ai/v1');
        (provider as any)._client = {
            chat: {
                completions: {
                    create: vi.fn().mockResolvedValue({
                        async *[Symbol.asyncIterator]() {
                            yield {
                                id: 'chatcmpl-mixed-tools-later-valid',
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
                                                {
                                                    index: 2,
                                                    id: 'call_3',
                                                    type: 'function',
                                                    function: {
                                                        name: 'lookup_forecast',
                                                        arguments: '{"days":3}',
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
                'grok-4-fast-reasoning',
                {
                    agent_id: 'test-openai-chat-later-valid-tools',
                } as any
            )
        );

        const toolStarts = events.filter(event => event.type === 'tool_start');
        const toolNames = toolStarts.map(event => event.tool_call?.function?.name);
        const errorEvent = events.find(event => event.type === 'error');
        expect(toolNames).toEqual([]);
        expect(errorEvent?.error).toContain('lookup_time');
        expect(errorEvent?.recoverable).toBe(false);
    });

    it('marks max_tokens truncation errors as terminal in OpenAIChat streams', async () => {
        const provider = new OpenAIChat('xai', 'xai-test', 'https://api.x.ai/v1');
        (provider as any)._client = {
            chat: {
                completions: {
                    create: vi.fn().mockResolvedValue({
                        async *[Symbol.asyncIterator]() {
                            yield {
                                id: 'chatcmpl-truncated',
                                choices: [
                                    {
                                        index: 0,
                                        delta: {
                                            content: 'partial answer',
                                        },
                                        finish_reason: 'length',
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
                [{ type: 'message', role: 'user', content: 'Answer briefly' }] as any,
                'grok-4-fast-reasoning',
                {
                    agent_id: 'test-openai-chat-finish-length',
                } as any
            )
        );

        const errorEvent = events.find(event => event.type === 'error');
        expect(errorEvent?.error).toContain('Response truncated (max_tokens)');
        expect(errorEvent?.recoverable).toBe(false);
    });

    it('marks non-stop OpenAIChat finish reasons as terminal', async () => {
        const provider = new OpenAIChat('xai', 'xai-test', 'https://api.x.ai/v1');
        (provider as any)._client = {
            chat: {
                completions: {
                    create: vi.fn().mockResolvedValue({
                        async *[Symbol.asyncIterator]() {
                            yield {
                                id: 'chatcmpl-content-filter',
                                choices: [
                                    {
                                        index: 0,
                                        delta: {
                                            content: 'blocked answer',
                                        },
                                        finish_reason: 'content_filter',
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
                [{ type: 'message', role: 'user', content: 'Answer briefly' }] as any,
                'grok-4-fast-reasoning',
                {
                    agent_id: 'test-openai-chat-finish-filter',
                } as any
            )
        );

        const errorEvent = events.find(event => event.type === 'error');
        expect(errorEvent?.error).toContain('Response stopped due to: content_filter');
        expect(errorEvent?.recoverable).toBe(false);
    });

    it('rejects extra keys for closed objects without explicit properties', () => {
        const validation = validateJsonResponseContent('{"unexpected":true}', {
            type: 'object',
            additionalProperties: false,
        });

        expect(validation.ok).toBe(false);
        if (!validation.ok) {
            expect(validation.error).toContain('unexpected');
            expect(validation.error).toContain('not allowed');
        }
    });

    it('accepts valid anyOf object variants when top-level schema is closed', () => {
        const validation = validateJsonResponseContent('{"kind":"weather","city":"Paris"}', {
            type: 'object',
            anyOf: [
                {
                    type: 'object',
                    properties: {
                        kind: { const: 'weather' },
                        city: { type: 'string' },
                    },
                    required: ['kind', 'city'],
                    additionalProperties: false,
                },
                {
                    type: 'object',
                    properties: {
                        kind: { const: 'time' },
                        timezone: { type: 'string' },
                    },
                    required: ['kind', 'timezone'],
                    additionalProperties: false,
                },
            ],
            additionalProperties: false,
        });

        expect(validation.ok).toBe(true);
    });

    it('does not infer required keys from plain json_schema properties during structured-output validation', () => {
        const validation = validateJsonResponseContent('{"optionalField":"present"}', {
            type: 'object',
            properties: {
                requiredField: { type: 'string' },
                optionalField: { type: 'string', optional: true },
            },
            additionalProperties: false,
        });

        expect(validation.ok).toBe(true);
    });

    it('honors explicit required keys even without local properties', () => {
        const validation = validateJsonResponseContent('{"optionalField":"present"}', {
            type: 'object',
            required: ['answer'],
            additionalProperties: {
                type: 'string',
            },
        });

        expect(validation.ok).toBe(false);
        if (!validation.ok) {
            expect(validation.error).toContain('answer');
            expect(validation.error).toContain('required');
        }
    });

    it('validates tuple arrays against per-index schemas', () => {
        const validation = validateJsonResponseContent('["ok","not-an-int"]', {
            type: 'array',
            items: [{ type: 'string' }, { type: 'integer' }],
        });

        expect(validation.ok).toBe(false);
        if (!validation.ok) {
            expect(validation.error).toContain('$[1]');
            expect(validation.error).toContain('integer');
        }
    });

    it('validates numeric multipleOf constraints', () => {
        const invalidValidation = validateJsonResponseContent('0.3', {
            type: 'number',
            multipleOf: 0.5,
        });

        expect(invalidValidation.ok).toBe(false);
        if (!invalidValidation.ok) {
            expect(invalidValidation.error).toContain('multiple of 0.5');
        }

        const validValidation = validateJsonResponseContent('1.5', {
            type: 'number',
            multipleOf: 0.5,
        });

        expect(validValidation.ok).toBe(true);
    });

    it('matches object const values by structure', () => {
        const validation = validateJsonResponseContent('{"kind":"weather","units":"c"}', {
            const: {
                kind: 'weather',
                units: 'c',
            },
        });

        expect(validation.ok).toBe(true);
    });

    it('matches array enum values by structure', () => {
        const validation = validateJsonResponseContent('["weather",3]', {
            enum: [
                ['weather', 3],
                ['time', 1],
            ],
        });

        expect(validation.ok).toBe(true);
    });

    it('validates schema-valued additionalProperties', () => {
        const validation = validateJsonResponseContent('{"fixed":"ok","extra":"oops"}', {
            type: 'object',
            properties: {
                fixed: { type: 'string' },
            },
            additionalProperties: {
                type: 'integer',
            },
        });

        expect(validation.ok).toBe(false);
        if (!validation.ok) {
            expect(validation.error).toContain('extra');
            expect(validation.error).toContain('integer');
        }
    });

    it('collects allowed keys across allOf object branches', () => {
        const validation = validateJsonResponseContent('{"kind":"weather","city":"Paris"}', {
            allOf: [
                {
                    type: 'object',
                    properties: {
                        kind: { const: 'weather' },
                    },
                },
                {
                    type: 'object',
                    properties: {
                        city: { type: 'string' },
                    },
                },
            ],
            additionalProperties: false,
        });

        expect(validation.ok).toBe(true);
    });

    it('accepts closed allOf object branches when their keys compose the full object', () => {
        const validation = validateJsonResponseContent('{"a":"x","b":"y"}', {
            allOf: [
                {
                    type: 'object',
                    properties: {
                        a: { type: 'string' },
                    },
                    required: ['a'],
                    additionalProperties: false,
                },
                {
                    type: 'object',
                    properties: {
                        b: { type: 'string' },
                    },
                    required: ['b'],
                    additionalProperties: false,
                },
            ],
        });

        expect(validation.ok).toBe(true);
    });

    it('does not relax partially closed allOf object branches', () => {
        const validation = validateJsonResponseContent('{"kind":"weather","city":"Paris"}', {
            allOf: [
                {
                    type: 'object',
                    properties: {
                        kind: { const: 'weather' },
                    },
                    required: ['kind'],
                    additionalProperties: false,
                },
                {
                    type: 'object',
                    properties: {
                        city: { type: 'string' },
                    },
                    required: ['city'],
                },
            ],
        });

        expect(validation.ok).toBe(false);
        if (!validation.ok) {
            expect(validation.error).toContain('city');
            expect(validation.error).toContain('not allowed');
        }
    });

    it('rejects unexpected keys when allOf object branches are all closed', () => {
        const validation = validateJsonResponseContent('{"a":"x","b":"y","c":"z"}', {
            allOf: [
                {
                    type: 'object',
                    properties: {
                        a: { type: 'string' },
                    },
                    required: ['a'],
                    additionalProperties: false,
                },
                {
                    type: 'object',
                    properties: {
                        b: { type: 'string' },
                    },
                    required: ['b'],
                    additionalProperties: false,
                },
            ],
        });

        expect(validation.ok).toBe(false);
        if (!validation.ok) {
            expect(validation.error).toContain('c');
            expect(validation.error).toContain('not allowed');
        }
    });
});
