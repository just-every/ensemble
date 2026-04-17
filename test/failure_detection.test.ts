import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ensembleRequest } from '../core/ensemble_request.js';
import { ensembleImage } from '../core/ensemble_image.js';
import { ensembleResult } from '../utils/ensemble_result.js';
import { raceWithAbortAndTimeout, toTerminalErrorEvent } from '../utils/failure_detection.js';
import type { AgentDefinition, ProviderStreamEvent } from '../types/types.js';

vi.mock('../model_providers/model_provider.js', () => ({
    getModelFromAgent: vi.fn().mockResolvedValue('test-model'),
    getModelProvider: vi.fn(),
}));

describe('failure detection', () => {
    beforeEach(async () => {
        vi.clearAllMocks();
    });

    it('emits retrying and terminal request failure status events', async () => {
        const { getModelProvider } = await import('../model_providers/model_provider.js');
        let attempts = 0;

        vi.mocked(getModelProvider).mockReturnValue({
            provider_id: 'test-provider',
            createResponseStream: vi.fn().mockImplementation(async function* () {
                attempts += 1;
                yield { type: 'error', error: `provider failure ${attempts}` } as ProviderStreamEvent;
            }),
        } as any);

        const agent: AgentDefinition = { model: 'test-model' };
        const events: ProviderStreamEvent[] = [];

        for await (const event of ensembleRequest([{ type: 'message', role: 'user', content: 'Hello' }], agent)) {
            events.push(event);
        }

        const statusEvents = events.filter(event => event.type === 'operation_status') as Array<any>;
        expect(statusEvents).toHaveLength(6);
        expect(statusEvents[0]?.status).toBe('started');
        expect(statusEvents.slice(1, 5).every(event => event.status === 'retrying')).toBe(true);
        expect(statusEvents.slice(1, 5).every(event => event.recoverable === true)).toBe(true);
        expect(statusEvents.slice(1, 5).every(event => event.terminal === false)).toBe(true);
        expect(new Set(statusEvents.map(event => event.request_id)).size).toBe(1);

        const finalStatus = statusEvents.at(-1);
        expect(finalStatus?.status).toBe('failed');
        expect(finalStatus?.recoverable).toBe(false);
        expect(finalStatus?.terminal).toBe(true);
        expect(finalStatus?.attempt).toBe(5);
        expect(finalStatus?.error).toBe('provider failure 5');
    });

    it('keeps request lifecycle request_id stable when a retry later succeeds', async () => {
        const { getModelProvider } = await import('../model_providers/model_provider.js');
        let attempts = 0;

        vi.mocked(getModelProvider).mockReturnValue({
            provider_id: 'retry-success-provider',
            createResponseStream: vi.fn().mockImplementation(async function* () {
                attempts += 1;
                if (attempts === 1) {
                    yield { type: 'error', error: 'temporary provider failure' } as ProviderStreamEvent;
                    return;
                }

                yield {
                    type: 'message_complete',
                    message_id: 'msg_success',
                    content: 'Recovered response',
                } as ProviderStreamEvent;
            }),
        } as any);

        const events: ProviderStreamEvent[] = [];
        for await (const event of ensembleRequest([{ type: 'message', role: 'user', content: 'Hello' }], { model: 'test-model' })) {
            events.push(event);
        }

        const agentStarts = events.filter(event => event.type === 'agent_start') as Array<any>;
        const statusEvents = events.filter(event => event.type === 'operation_status') as Array<any>;

        expect(agentStarts).toHaveLength(2);
        expect(agentStarts[0]?.request_id).not.toBe(agentStarts[1]?.request_id);
        expect(statusEvents.map(event => event.status)).toEqual(['started', 'retrying', 'completed']);
        expect(statusEvents.every(event => event.request_id === agentStarts[0]?.request_id)).toBe(true);
    });

    it('keeps request lifecycle request_id stable when onRequest fails before the provider stream starts', async () => {
        const { getModelProvider } = await import('../model_providers/model_provider.js');
        let attempts = 0;
        let onRequestCalls = 0;

        vi.mocked(getModelProvider).mockReturnValue({
            provider_id: 'onrequest-retry-provider',
            createResponseStream: vi.fn().mockImplementation(async function* () {
                attempts += 1;
                yield {
                    type: 'message_complete',
                    message_id: `msg_${attempts}`,
                    content: 'Recovered response',
                } as ProviderStreamEvent;
            }),
        } as any);

        const recoverableHookError = Object.assign(new Error('temporary onRequest failure'), { recoverable: true });
        const agent: AgentDefinition = {
            model: 'test-model',
            onRequest: async (currentAgent, messages) => {
                onRequestCalls += 1;
                if (onRequestCalls === 1) {
                    throw recoverableHookError;
                }

                return [currentAgent, messages];
            },
        };

        const events: ProviderStreamEvent[] = [];
        for await (const event of ensembleRequest([{ type: 'message', role: 'user', content: 'Hello' }], agent)) {
            events.push(event);
        }

        const agentStarts = events.filter(event => event.type === 'agent_start') as Array<any>;
        const statusEvents = events.filter(event => event.type === 'operation_status') as Array<any>;

        expect(agentStarts).toHaveLength(2);
        expect(agentStarts[0]?.request_id).not.toBe(agentStarts[1]?.request_id);
        expect(statusEvents.map(event => event.status)).toEqual(['started', 'retrying', 'completed']);
        expect(statusEvents.every(event => event.request_id === agentStarts[0]?.request_id)).toBe(true);
    });

    it('emits a terminal image failure status before the error event', async () => {
        const { getModelProvider } = await import('../model_providers/model_provider.js');

        vi.mocked(getModelProvider).mockReturnValue({
            provider_id: 'test-image-provider',
            createImage: vi.fn().mockRejectedValue(new Error('image provider failed')),
        } as any);

        const agent: AgentDefinition = { model: 'test-model' };
        const stream = ensembleImage('Draw a fox', agent, { stream: true }) as AsyncGenerator<ProviderStreamEvent>;
        const events: ProviderStreamEvent[] = [];

        for await (const event of stream) {
            events.push(event);
        }

        expect(events[0]?.type).toBe('image_start');
        expect(events[1]?.type).toBe('operation_status');
        expect((events[1] as any).status).toBe('started');
        expect((events[2] as any).type).toBe('operation_status');
        expect((events[2] as any).status).toBe('failed');
        expect((events[2] as any).terminal).toBe(true);
        expect((events[2] as any).recoverable).toBe(false);
        expect((events[3] as any).type).toBe('error');
        expect((events[3] as any).error).toBe('image provider failed');
    });

    it('returns early from ensembleResult when failFast sees a terminal failure', async () => {
        let returnCalled = false;
        let nextCalls = 0;

        const stream = {
            async next() {
                nextCalls += 1;
                if (nextCalls === 1) {
                    return {
                        done: false,
                        value: {
                            type: 'operation_status',
                            operation: 'image',
                            status: 'failed',
                            error: 'image failed',
                            recoverable: false,
                            terminal: true,
                        },
                    };
                }

                return new Promise(() => undefined);
            },
            async return() {
                returnCalled = true;
                return { done: true, value: undefined };
            },
            [Symbol.asyncIterator]() {
                return this;
            },
        } as any as AsyncGenerator<ProviderStreamEvent>;

        const result = await ensembleResult(stream, { failFast: true });

        expect(returnCalled).toBe(true);
        expect(result.completed).toBe(false);
        expect(result.error).toBe('image failed');
        expect(result.failure?.operation).toBe('image');
        expect(result.failure?.terminal).toBe(true);
        expect(result.failure?.recoverable).toBe(false);
    });

    it('preserves buffered outputs when ensembleResult fails fast', async () => {
        let returnCalled = false;
        const events: ProviderStreamEvent[] = [
            {
                type: 'response_output',
                message: {
                    type: 'message',
                    role: 'assistant',
                    content: 'partial answer',
                    status: 'completed',
                } as any,
            } as ProviderStreamEvent,
            {
                type: 'file_complete',
                data: 'https://example.com/file.png',
                data_format: 'url',
            } as ProviderStreamEvent,
            {
                type: 'tool_start',
                tool_call: {
                    id: 'tool-1',
                    call_id: 'call-1',
                    type: 'function',
                    function: {
                        name: 'lookup_weather',
                        arguments: '{}',
                    },
                },
            } as ProviderStreamEvent,
            {
                type: 'tool_done',
                tool_call: {
                    id: 'tool-1',
                    call_id: 'call-1',
                    type: 'function',
                    function: {
                        name: 'lookup_weather',
                        arguments: '{}',
                    },
                },
                result: {
                    call_id: 'call-1',
                    output: 'sunny',
                },
            } as ProviderStreamEvent,
            {
                type: 'operation_status',
                operation: 'request',
                status: 'failed',
                error: 'terminal failure',
                recoverable: false,
                terminal: true,
            } as ProviderStreamEvent,
        ];

        const stream = {
            async next() {
                const value = events.shift();
                return value ? { done: false, value } : new Promise(() => undefined);
            },
            async return() {
                returnCalled = true;
                return { done: true, value: undefined };
            },
            [Symbol.asyncIterator]() {
                return this;
            },
        } as any as AsyncGenerator<ProviderStreamEvent>;

        const result = await ensembleResult(stream, { failFast: true });

        expect(returnCalled).toBe(true);
        expect(result.completed).toBe(false);
        expect(result.responseOutputs).toHaveLength(1);
        expect(result.responseOutputs?.[0]).toMatchObject({ content: 'partial answer' });
        expect(result.files).toEqual([
            {
                data: 'https://example.com/file.png',
                data_format: 'url',
                mime_type: undefined,
            },
        ]);
        expect(result.tools?.totalCalls).toBe(1);
        expect(result.tools?.calls[0]).toMatchObject({
            call_id: 'call-1',
            output: 'sunny',
        });
    });

    it('waits for a following failed status before finishing failFast on a terminal error', async () => {
        let returnCalled = false;
        const events: ProviderStreamEvent[] = [
            {
                type: 'error',
                request_id: 'req_failfast',
                error: 'request failed',
                recoverable: false,
            } as ProviderStreamEvent,
            {
                type: 'operation_status',
                operation: 'request',
                status: 'failed',
                request_id: 'req_failfast',
                reason: 'terminal_error',
                error: 'request failed',
                recoverable: false,
                terminal: true,
            } as ProviderStreamEvent,
        ];

        const stream = {
            async next() {
                const value = events.shift();
                return value ? { done: false, value } : new Promise(() => undefined);
            },
            async return() {
                returnCalled = true;
                return { done: true, value: undefined };
            },
            [Symbol.asyncIterator]() {
                return this;
            },
        } as any as AsyncGenerator<ProviderStreamEvent>;

        const result = await ensembleResult(stream, { failFast: true });

        expect(returnCalled).toBe(true);
        expect(result.completed).toBe(false);
        expect(result.error).toBe('request failed');
        expect(result.failure).toMatchObject({
            operation: 'request',
            request_id: 'req_failfast',
            reason: 'terminal_error',
            terminal: true,
            recoverable: false,
        });
    });

    it('returns immediately from failFast on a terminal error when no failed status follows', async () => {
        let returnCalled = false;
        let nextCalls = 0;

        const stream = {
            async next() {
                nextCalls += 1;
                if (nextCalls === 1) {
                    return {
                        done: false,
                        value: {
                            type: 'error',
                            request_id: 'req_terminal_error_only',
                            error: 'request failed without failed status',
                            recoverable: false,
                        },
                    };
                }

                return new Promise(() => undefined);
            },
            async return() {
                returnCalled = true;
                return { done: true, value: undefined };
            },
            [Symbol.asyncIterator]() {
                return this;
            },
        } as any as AsyncGenerator<ProviderStreamEvent>;

        const result = await Promise.race([
            ensembleResult(stream, { failFast: true }),
            new Promise<never>((_, reject) => {
                setTimeout(() => reject(new Error('ensembleResult hung on terminal error without failed status')), 100);
            }),
        ]);

        expect(returnCalled).toBe(true);
        expect(result.completed).toBe(false);
        expect(result.error).toBe('request failed without failed status');
        expect(result.failure).toMatchObject({
            operation: 'result',
            request_id: 'req_terminal_error_only',
            terminal: true,
            recoverable: false,
        });
    });

    it('preserves operation failure metadata when a terminal error follows failed status', async () => {
        async function* stream(): AsyncGenerator<ProviderStreamEvent> {
            yield {
                type: 'operation_status',
                operation: 'request',
                status: 'failed',
                request_id: 'req_123',
                reason: 'terminal_error',
                error: 'request failed',
                recoverable: false,
                terminal: true,
            } as ProviderStreamEvent;
            yield {
                type: 'error',
                request_id: 'req_123',
                error: 'request failed',
                recoverable: false,
            } as ProviderStreamEvent;
        }

        const result = await ensembleResult(stream());

        expect(result.completed).toBe(false);
        expect(result.error).toBe('request failed');
        expect(result.failure).toMatchObject({
            operation: 'request',
            request_id: 'req_123',
            reason: 'terminal_error',
            terminal: true,
            recoverable: false,
        });
    });

    it('captures thinking from message_complete events without a preceding message_start', async () => {
        async function* stream(): AsyncGenerator<ProviderStreamEvent> {
            yield {
                type: 'message_complete',
                message_id: 'msg_thinking',
                content: 'final answer',
                thinking_content: 'chain of thought summary',
                thinking_signature: 'sig_123',
            } as ProviderStreamEvent;
            yield { type: 'stream_end' } as ProviderStreamEvent;
        }

        const result = await ensembleResult(stream());

        expect(result.message).toBe('final answer');
        expect(result.thinking).toEqual({
            content: 'chain of thought summary',
            signature: 'sig_123',
        });
    });

    it('times out a stalled image provider via ImageGenerationOpts.timeout_ms', async () => {
        const { getModelProvider } = await import('../model_providers/model_provider.js');

        vi.mocked(getModelProvider).mockReturnValue({
            provider_id: 'test-image-provider',
            createImage: vi.fn().mockImplementation(() => new Promise(() => undefined)),
        } as any);

        const agent: AgentDefinition = { model: 'test-model' };
        const stream = ensembleImage('Draw a clock', agent, {
            stream: true,
            timeout_ms: 25,
        }) as AsyncGenerator<ProviderStreamEvent>;

        const events: ProviderStreamEvent[] = [];
        for await (const event of stream) {
            events.push(event);
        }

        const failedStatus = events.find(event => event.type === 'operation_status' && (event as any).status === 'failed') as any;
        expect(failedStatus).toBeDefined();
        expect(failedStatus.error).toContain('timed out after 25ms');
        expect(failedStatus.terminal).toBe(true);
    });

    it('does not start image generation when already aborted', async () => {
        const { getModelProvider } = await import('../model_providers/model_provider.js');
        const createImage = vi.fn().mockResolvedValue(['image-data']);
        const abortController = new AbortController();
        abortController.abort();

        vi.mocked(getModelProvider).mockReturnValue({
            provider_id: 'test-image-provider',
            createImage,
        } as any);

        const agent: AgentDefinition = {
            model: 'test-model',
            abortSignal: abortController.signal,
        };
        const stream = ensembleImage('Draw a clock', agent, {
            stream: true,
        }) as AsyncGenerator<ProviderStreamEvent>;

        const events: ProviderStreamEvent[] = [];
        for await (const event of stream) {
            events.push(event);
        }

        expect(createImage).not.toHaveBeenCalled();
        const failedStatus = events.find(event => event.type === 'operation_status' && (event as any).status === 'failed') as any;
        expect(failedStatus?.error).toContain('aborted');
    });

    it('aborts promptly when the signal flips during raceWithAbortAndTimeout startup', async () => {
        const abortController = new AbortController();

        const result = await Promise.race([
            raceWithAbortAndTimeout(
                () => {
                    abortController.abort();
                    return new Promise<string>(() => undefined);
                },
                {
                    operationName: 'Image generation',
                    abortSignal: abortController.signal,
                    timeoutMs: 1000,
                }
            ).then(
                value => value,
                error => error
            ),
            new Promise(resolve => setTimeout(() => resolve(new Error('raceWithAbortAndTimeout hung during startup')), 50)),
        ]);

        expect(result).toBeInstanceOf(Error);
        expect((result as Error).message).toContain('aborted');
    });

    it('times out a stalled request provider via ModelSettings.timeout_ms', async () => {
        const { getModelProvider } = await import('../model_providers/model_provider.js');
        const createResponseStream = vi.fn().mockImplementation(async function* () {
            await new Promise(() => undefined);
        });

        vi.mocked(getModelProvider).mockReturnValue({
            provider_id: 'test-request-provider',
            createResponseStream,
        } as any);

        const agent: AgentDefinition = {
            model: 'test-model',
            modelSettings: {
                timeout_ms: 25,
            },
        };

        const events: ProviderStreamEvent[] = [];
        for await (const event of ensembleRequest([{ type: 'message', role: 'user', content: 'Hello' }], agent)) {
            events.push(event);
        }

        const failedStatus = events.find(event => event.type === 'operation_status' && (event as any).status === 'failed') as any;
        expect(failedStatus).toBeDefined();
        expect(failedStatus.error).toContain('timed out after 25ms');
        expect(failedStatus.terminal).toBe(true);
        expect(failedStatus.recoverable).toBe(false);
        expect(events.some(event => event.type === 'operation_status' && (event as any).status === 'retrying')).toBe(false);
        expect(events.some(event => event.type === 'operation_status' && (event as any).status === 'completed')).toBe(false);
        expect(createResponseStream).toHaveBeenCalledTimes(1);
    });

    it('does not retry after a stream error arrives after tool_start', async () => {
        const { getModelProvider } = await import('../model_providers/model_provider.js');
        const createResponseStream = vi.fn().mockImplementation(async function* () {
            yield {
                type: 'tool_start',
                tool_call: {
                    id: 'tool-1',
                    call_id: 'call-1',
                    type: 'function',
                    function: {
                        name: 'lookup_weather',
                        arguments: '{}',
                    },
                },
            } as ProviderStreamEvent;
            yield {
                type: 'error',
                error: 'provider ended with malformed later tool call',
            } as ProviderStreamEvent;
        });

        vi.mocked(getModelProvider).mockReturnValue({
            provider_id: 'tool-error-provider',
            createResponseStream,
        } as any);

        const toolFn = vi.fn().mockImplementation(async () => {
            await new Promise(resolve => setTimeout(resolve, 75));
            return 'sunny';
        });
        const agent: AgentDefinition = {
            model: 'test-model',
            tools: [
                {
                    definition: {
                        type: 'function',
                        function: {
                            name: 'lookup_weather',
                            description: 'Lookup weather',
                            parameters: { type: 'object', properties: {} },
                        },
                    },
                    function: toolFn,
                },
            ],
        };

        const events: ProviderStreamEvent[] = [];
        for await (const event of ensembleRequest([{ type: 'message', role: 'user', content: 'Hello' }], agent)) {
            events.push(event);
        }

        expect(createResponseStream).toHaveBeenCalledTimes(1);
        expect(toolFn).toHaveBeenCalledTimes(1);
        const errorEvent = events.find(event => event.type === 'error') as any;
        const failedStatus = events.find(event => event.type === 'operation_status' && (event as any).status === 'failed') as any;
        expect(errorEvent?.recoverable).toBe(false);
        expect(failedStatus?.terminal).toBe(true);
        expect(events.some(event => event.type === 'operation_status' && (event as any).status === 'retrying')).toBe(false);
        expect(events.some(event => event.type === 'operation_status' && (event as any).status === 'completed')).toBe(false);
    });

    it('uses bounded tool finalization after a terminal provider error event', async () => {
        const { getModelProvider } = await import('../model_providers/model_provider.js');
        const createResponseStream = vi.fn().mockImplementation(async function* () {
            yield {
                type: 'tool_start',
                tool_call: {
                    id: 'tool-terminal-error',
                    call_id: 'call-terminal-error',
                    type: 'function',
                    function: {
                        name: 'lookup_weather',
                        arguments: '{}',
                    },
                },
            } as ProviderStreamEvent;
            yield {
                type: 'error',
                error: 'provider emitted malformed arguments for a later tool call',
                recoverable: false,
            } as ProviderStreamEvent;
        });

        vi.mocked(getModelProvider).mockReturnValue({
            provider_id: 'terminal-error-provider',
            createResponseStream,
        } as any);

        const toolFn = vi.fn().mockImplementation(
            async (_args?: unknown, abortSignal?: AbortSignal) =>
                new Promise((_, reject) => {
                    abortSignal?.addEventListener(
                        'abort',
                        () => reject(new Error('tool aborted after terminal provider failure')),
                        { once: true }
                    );
                })
        );

        const agent: AgentDefinition = {
            model: 'test-model',
            tools: [
                {
                    definition: {
                        type: 'function',
                        function: {
                            name: 'lookup_weather',
                            description: 'Lookup weather',
                            parameters: { type: 'object', properties: {} },
                        },
                    },
                    function: toolFn,
                    injectAbortSignal: true,
                },
            ],
        };

        const events = await Promise.race([
            (async () => {
                const collected: ProviderStreamEvent[] = [];
                for await (const event of ensembleRequest([{ type: 'message', role: 'user', content: 'Hello' }], agent)) {
                    collected.push(event);
                }
                return collected;
            })(),
            new Promise<ProviderStreamEvent[]>((_, reject) => {
                setTimeout(() => reject(new Error('ensembleRequest hung after terminal provider error event')), 250);
            }),
        ]);

        const toolDone = events.find(event => event.type === 'tool_done') as any;
        const failedStatus = events.find(event => event.type === 'operation_status' && (event as any).status === 'failed') as any;

        expect(toolDone?.result?.error).toContain('Operation was aborted');
        expect(failedStatus?.error).toContain('malformed arguments');
        expect(events.some(event => event.type === 'operation_status' && (event as any).status === 'completed')).toBe(false);
    });

    it('uses bounded tool finalization after a post-tool provider error is upgraded to terminal', async () => {
        const { getModelProvider } = await import('../model_providers/model_provider.js');
        const createResponseStream = vi.fn().mockImplementation(async function* () {
            yield {
                type: 'tool_start',
                tool_call: {
                    id: 'tool-upgraded-terminal-error',
                    call_id: 'call-upgraded-terminal-error',
                    type: 'function',
                    function: {
                        name: 'lookup_weather',
                        arguments: '{}',
                    },
                },
            } as ProviderStreamEvent;
            yield {
                type: 'error',
                error: 'provider emitted a plain post-tool error',
            } as ProviderStreamEvent;
        });

        vi.mocked(getModelProvider).mockReturnValue({
            provider_id: 'upgraded-terminal-error-provider',
            createResponseStream,
        } as any);

        const toolFn = vi.fn().mockImplementation(
            async (_args?: unknown, abortSignal?: AbortSignal) =>
                new Promise((_, reject) => {
                    abortSignal?.addEventListener(
                        'abort',
                        () => reject(new Error('tool aborted after upgraded terminal provider failure')),
                        { once: true }
                    );
                })
        );

        const agent: AgentDefinition = {
            model: 'test-model',
            tools: [
                {
                    definition: {
                        type: 'function',
                        function: {
                            name: 'lookup_weather',
                            description: 'Lookup weather',
                            parameters: { type: 'object', properties: {} },
                        },
                    },
                    function: toolFn,
                    injectAbortSignal: true,
                },
            ],
        };

        const events = await Promise.race([
            (async () => {
                const collected: ProviderStreamEvent[] = [];
                for await (const event of ensembleRequest([{ type: 'message', role: 'user', content: 'Hello' }], agent)) {
                    collected.push(event);
                }
                return collected;
            })(),
            new Promise<ProviderStreamEvent[]>((_, reject) => {
                setTimeout(() => reject(new Error('ensembleRequest hung after upgraded terminal provider error event')), 250);
            }),
        ]);

        const errorEvent = events.find(event => event.type === 'error') as any;
        const toolDone = events.find(event => event.type === 'tool_done') as any;
        const failedStatus = events.find(event => event.type === 'operation_status' && (event as any).status === 'failed') as any;

        expect(errorEvent?.recoverable).toBe(false);
        expect(toolDone?.result?.error).toContain('Operation was aborted');
        expect(failedStatus?.error).toContain('plain post-tool error');
        expect(events.some(event => event.type === 'operation_status' && (event as any).status === 'completed')).toBe(false);
    });

    it('does not report completion when a terminal tool succeeds before a malformed later tool error', async () => {
        const { getModelProvider } = await import('../model_providers/model_provider.js');
        const createResponseStream = vi.fn().mockImplementation(async function* () {
            yield {
                type: 'tool_start',
                tool_call: {
                    id: 'tool-terminal',
                    call_id: 'call-terminal',
                    type: 'function',
                    function: {
                        name: 'task_complete',
                        arguments: '{"answer":"done"}',
                    },
                },
            } as ProviderStreamEvent;
            yield {
                type: 'error',
                error: 'provider emitted malformed arguments for a later tool call',
                recoverable: false,
            } as ProviderStreamEvent;
        });

        vi.mocked(getModelProvider).mockReturnValue({
            provider_id: 'terminal-tool-error-provider',
            createResponseStream,
        } as any);

        const agent: AgentDefinition = {
            model: 'test-model',
            tools: [
                {
                    definition: {
                        type: 'function',
                        function: {
                            name: 'task_complete',
                            description: 'Finish the task',
                            parameters: {
                                type: 'object',
                                properties: {
                                    answer: { type: 'string' },
                                },
                            },
                        },
                    },
                    function: vi.fn().mockResolvedValue('done'),
                },
            ],
        };

        const events: ProviderStreamEvent[] = [];
        for await (const event of ensembleRequest([{ type: 'message', role: 'user', content: 'Hello' }], agent)) {
            events.push(event);
        }

        const failedStatus = events.find(event => event.type === 'operation_status' && (event as any).status === 'failed') as any;
        expect(failedStatus?.terminal).toBe(true);
        expect(failedStatus?.error).toContain('malformed arguments');
        expect(events.some(event => event.type === 'operation_status' && (event as any).status === 'completed')).toBe(false);
    });

    it('retries recoverable thrown stream errors even after tool_start events', async () => {
        const { getModelProvider } = await import('../model_providers/model_provider.js');
        let attempts = 0;
        let retryMessages: any[] = [];

        const createResponseStream = vi.fn().mockImplementation(async function* (messages: any[]) {
            attempts += 1;

            if (attempts === 1) {
                yield {
                    type: 'tool_start',
                    tool_call: {
                        id: 'tool-retry',
                        call_id: 'call-retry',
                        type: 'function',
                        function: {
                            name: 'lookup_weather',
                            arguments: '{}',
                        },
                    },
                } as ProviderStreamEvent;

                throw new Error('temporary transport failure');
            }

            retryMessages = messages;

            yield {
                type: 'message_complete',
                message_id: 'msg_recovered',
                content: 'Recovered after retry',
            } as ProviderStreamEvent;
        });

        vi.mocked(getModelProvider).mockReturnValue({
            provider_id: 'tool-throw-retry-provider',
            createResponseStream,
        } as any);

        const agent: AgentDefinition = {
            model: 'test-model',
            tools: [
                {
                    definition: {
                        type: 'function',
                        function: {
                            name: 'lookup_weather',
                            description: 'Lookup weather',
                            parameters: { type: 'object', properties: {} },
                        },
                    },
                    function: vi.fn().mockImplementation(async () => {
                        await new Promise(resolve => setTimeout(resolve, 75));
                        return 'sunny';
                    }),
                },
            ],
        };

        const events: ProviderStreamEvent[] = [];
        for await (const event of ensembleRequest([{ type: 'message', role: 'user', content: 'Hello' }], agent)) {
            events.push(event);
        }

        const toolDone = events.find(event => event.type === 'tool_done') as any;
        const retryToolOutput = retryMessages.find(
            message => message.type === 'function_call_output' && message.call_id === 'call-retry'
        );

        expect(createResponseStream).toHaveBeenCalledTimes(2);
        expect(agent.tools?.[0] && 'function' in agent.tools[0] ? agent.tools[0].function : undefined).toHaveBeenCalledTimes(1);
        expect(toolDone?.result?.output).toBe('sunny');
        expect(toolDone?.result?.error).toBeUndefined();
        expect(retryToolOutput?.output).toBe('sunny');
        expect(events.some(event => event.type === 'operation_status' && (event as any).status === 'retrying')).toBe(true);
        expect(events.some(event => event.type === 'operation_status' && (event as any).status === 'completed')).toBe(true);
        expect(events.some(event => event.type === 'operation_status' && (event as any).status === 'failed')).toBe(false);
    });

    it('awaits started tools and emits tool_done before timing out the request stream', async () => {
        const { getModelProvider } = await import('../model_providers/model_provider.js');
        const createResponseStream = vi.fn().mockImplementation(async function* () {
            yield {
                type: 'tool_start',
                tool_call: {
                    id: 'tool-1',
                    call_id: 'call-1',
                    type: 'function',
                    function: {
                        name: 'lookup_weather',
                        arguments: '{}',
                    },
                },
            } as ProviderStreamEvent;

            await new Promise(() => undefined);
        });

        vi.mocked(getModelProvider).mockReturnValue({
            provider_id: 'timed-tool-provider',
            createResponseStream,
        } as any);

        const toolFn = vi.fn().mockImplementation(async () => {
            await new Promise(resolve => setTimeout(resolve, 15));
            return 'sunny';
        });

        const agent: AgentDefinition = {
            model: 'test-model',
            modelSettings: {
                timeout_ms: 5,
            },
            tools: [
                {
                    definition: {
                        type: 'function',
                        function: {
                            name: 'lookup_weather',
                            description: 'Lookup weather',
                            parameters: { type: 'object', properties: {} },
                        },
                    },
                    function: toolFn,
                },
            ],
        };

        const events: ProviderStreamEvent[] = [];
        for await (const event of ensembleRequest([{ type: 'message', role: 'user', content: 'Hello' }], agent)) {
            events.push(event);
        }

        expect(createResponseStream).toHaveBeenCalledTimes(1);
        expect(toolFn).toHaveBeenCalledTimes(1);
        expect(events.some(event => event.type === 'tool_done')).toBe(true);
        const toolDone = events.find(event => event.type === 'tool_done') as any;
        expect(toolDone?.result?.output).toBe('sunny');
        const failedStatus = events.find(event => event.type === 'operation_status' && (event as any).status === 'failed') as any;
        expect(failedStatus?.error).toContain('timed out after 5ms');
        expect(events.some(event => event.type === 'operation_status' && (event as any).status === 'retrying')).toBe(false);
    });

    it('surfaces request timeout even when a started tool would otherwise never settle', async () => {
        const { getModelProvider } = await import('../model_providers/model_provider.js');
        const createResponseStream = vi.fn().mockImplementation(async function* () {
            yield {
                type: 'tool_start',
                tool_call: {
                    id: 'tool-hang',
                    call_id: 'call-hang',
                    type: 'function',
                    function: {
                        name: 'lookup_weather',
                        arguments: '{}',
                    },
                },
            } as ProviderStreamEvent;

            await new Promise(() => undefined);
        });

        vi.mocked(getModelProvider).mockReturnValue({
            provider_id: 'hung-tool-provider',
            createResponseStream,
        } as any);

        const toolFn = vi.fn().mockImplementation(
            async (_args?: unknown, abortSignal?: AbortSignal) =>
                new Promise((_, reject) => {
                    abortSignal?.addEventListener(
                        'abort',
                        () => reject(new Error('tool aborted after request failure')),
                        { once: true }
                    );
                })
        );

        const agent: AgentDefinition = {
            model: 'test-model',
            modelSettings: {
                timeout_ms: 5,
            },
            tools: [
                {
                    definition: {
                        type: 'function',
                        function: {
                            name: 'lookup_weather',
                            description: 'Lookup weather',
                            parameters: { type: 'object', properties: {} },
                        },
                    },
                    function: toolFn,
                    injectAbortSignal: true,
                },
            ],
        };

        const events = await Promise.race([
            (async () => {
                const collected: ProviderStreamEvent[] = [];
                for await (const event of ensembleRequest([{ type: 'message', role: 'user', content: 'Hello' }], agent)) {
                    collected.push(event);
                }
                return collected;
            })(),
            new Promise<ProviderStreamEvent[]>((_, reject) => {
                setTimeout(() => reject(new Error('ensembleRequest hung after timing out a started tool')), 250);
            }),
        ]);

        const toolDone = events.find(event => event.type === 'tool_done') as any;
        const failedStatus = events.find(event => event.type === 'operation_status' && (event as any).status === 'failed') as any;

        expect(toolDone?.result?.error).toContain('Operation was aborted');
        expect(failedStatus?.error).toContain('timed out after 5ms');
        expect(events.some(event => event.type === 'operation_status' && (event as any).status === 'retrying')).toBe(false);
    });

    it('preserves the terminal stream failure when onToolCall throws during failed-round finalization', async () => {
        const { getModelProvider } = await import('../model_providers/model_provider.js');
        const createResponseStream = vi.fn().mockImplementation(async function* () {
            yield {
                type: 'tool_start',
                tool_call: {
                    id: 'tool-hook-failure',
                    call_id: 'call-hook-failure',
                    type: 'function',
                    function: {
                        name: 'lookup_weather',
                        arguments: '{}',
                    },
                },
            } as ProviderStreamEvent;

            await new Promise(() => undefined);
        });

        vi.mocked(getModelProvider).mockReturnValue({
            provider_id: 'hook-failure-provider',
            createResponseStream,
        } as any);

        const agent: AgentDefinition = {
            model: 'test-model',
            modelSettings: {
                timeout_ms: 5,
            },
            onToolCall: vi.fn().mockRejectedValue(new Error('tool hook failed')),
            tools: [
                {
                    definition: {
                        type: 'function',
                        function: {
                            name: 'lookup_weather',
                            description: 'Lookup weather',
                            parameters: { type: 'object', properties: {} },
                        },
                    },
                    function: vi.fn().mockResolvedValue('sunny'),
                },
            ],
        };

        const events = await Promise.race([
            (async () => {
                const collected: ProviderStreamEvent[] = [];
                for await (const event of ensembleRequest([{ type: 'message', role: 'user', content: 'Hello' }], agent)) {
                    collected.push(event);
                }
                return collected;
            })(),
            new Promise<ProviderStreamEvent[]>((_, reject) => {
                setTimeout(() => reject(new Error('ensembleRequest masked the terminal stream failure')), 250);
            }),
        ]);

        const toolDone = events.find(event => event.type === 'tool_done') as any;
        const failedStatus = events.find(event => event.type === 'operation_status' && (event as any).status === 'failed') as any;

        expect(toolDone?.result?.error).toContain('tool hook failed');
        expect(failedStatus?.error).toContain('timed out after 5ms');
        expect(events.some(event => event.type === 'operation_status' && (event as any).status === 'retrying')).toBe(false);
    });

    it('emits a synthetic failed tool output when bounded finalization gives up on a started tool', async () => {
        const { getModelProvider } = await import('../model_providers/model_provider.js');
        const { runningToolTracker } = await import('../utils/running_tool_tracker.js');
        const abortSpy = vi.spyOn(runningToolTracker, 'abortRunningTool').mockImplementation(() => {});
        const createResponseStream = vi.fn().mockImplementation(async function* () {
            yield {
                type: 'tool_start',
                tool_call: {
                    id: 'tool-slow',
                    call_id: 'call-slow',
                    type: 'function',
                    function: {
                        name: 'lookup_weather',
                        arguments: '{}',
                    },
                },
            } as ProviderStreamEvent;
            yield {
                type: 'error',
                error: 'terminal provider failure after tool start',
                recoverable: false,
            } as ProviderStreamEvent;
        });

        vi.mocked(getModelProvider).mockReturnValue({
            provider_id: 'terminal-tool-failure-provider',
            createResponseStream,
        } as any);

        const agent: AgentDefinition = {
            model: 'test-model',
            tools: [
                {
                    definition: {
                        type: 'function',
                        function: {
                            name: 'lookup_weather',
                            description: 'Lookup weather',
                            parameters: { type: 'object', properties: {} },
                        },
                    },
                    function: vi.fn().mockImplementation(async () => new Promise(() => undefined)),
                },
            ],
        };

        try {
            const events: ProviderStreamEvent[] = [];
            for await (const event of ensembleRequest([{ type: 'message', role: 'user', content: 'Hello' }], agent)) {
                events.push(event);
            }

            const toolDone = events.find(event => event.type === 'tool_done') as any;
            const functionOutput = events.find(
                event => event.type === 'response_output' && (event as any).message?.type === 'function_call_output'
            ) as any;
            const failedStatus = events.find(
                event => event.type === 'operation_status' && (event as any).status === 'failed'
            ) as any;

            expect(createResponseStream).toHaveBeenCalledTimes(1);
            expect(toolDone?.result?.error).toContain('did not finish before request finalization');
            expect(functionOutput?.message?.output).toContain(
                'Tool execution failed: Tool did not finish before request finalization'
            );
            expect(functionOutput?.message?.output.startsWith('undefined')).toBe(false);
            expect(failedStatus?.error).toContain('terminal provider failure after tool start');
            expect(events.some(event => event.type === 'operation_status' && (event as any).status === 'retrying')).toBe(false);
            expect(events.some(event => event.type === 'operation_status' && (event as any).status === 'completed')).toBe(false);
        } finally {
            abortSpy.mockRestore();
            runningToolTracker.clear();
        }
    });

    it('fails immediately when a provider stream ends without output', async () => {
        const { getModelProvider } = await import('../model_providers/model_provider.js');

        vi.mocked(getModelProvider).mockReturnValue({
            provider_id: 'empty-provider',
            createResponseStream: vi.fn().mockImplementation(async function* () {
                // Intentionally empty.
            }),
        } as any);

        const agent: AgentDefinition = { model: 'test-model' };
        const events: ProviderStreamEvent[] = [];

        for await (const event of ensembleRequest([{ type: 'message', role: 'user', content: 'Hello' }], agent)) {
            events.push(event);
        }

        const errorEvent = events.find(event => event.type === 'error') as any;
        const failedStatus = events.find(event => event.type === 'operation_status' && (event as any).status === 'failed') as any;

        expect(errorEvent?.error).toContain('ended the stream without any terminal content');
        expect(failedStatus?.terminal).toBe(true);
        expect(failedStatus?.attempt).toBe(1);
        expect(events.some(event => event.type === 'operation_status' && (event as any).status === 'completed')).toBe(false);
    });

    it('does not treat reasoning-only completions as terminal output', async () => {
        const { getModelProvider } = await import('../model_providers/model_provider.js');

        vi.mocked(getModelProvider).mockReturnValue({
            provider_id: 'reasoning-only-provider',
            createResponseStream: vi.fn().mockImplementation(async function* () {
                yield {
                    type: 'message_complete',
                    message_id: 'reasoning-only',
                    content: '',
                    thinking_content: 'internal thoughts',
                } as ProviderStreamEvent;
            }),
        } as any);

        const agent: AgentDefinition = { model: 'test-model' };
        const events: ProviderStreamEvent[] = [];

        for await (const event of ensembleRequest([{ type: 'message', role: 'user', content: 'Hello' }], agent)) {
            events.push(event);
        }

        const errorEvent = events.find(event => event.type === 'error') as any;
        expect(errorEvent?.error).toContain('ended the stream without any terminal content');
        expect(events.some(event => event.type === 'operation_status' && (event as any).status === 'completed')).toBe(false);
    });

    it('accepts reasoning-only structured-output frames before a final JSON message', async () => {
        const { getModelProvider } = await import('../model_providers/model_provider.js');

        vi.mocked(getModelProvider).mockReturnValue({
            provider_id: 'reasoning-json-provider',
            createResponseStream: vi.fn().mockImplementation(async function* () {
                yield {
                    type: 'message_complete',
                    message_id: 'reasoning',
                    content: '',
                    thinking_content: 'working through it',
                } as ProviderStreamEvent;
                yield {
                    type: 'message_complete',
                    message_id: 'result',
                    content: '{"answer":"done"}',
                } as ProviderStreamEvent;
            }),
        } as any);

        const agent: AgentDefinition = {
            model: 'test-model',
            modelSettings: {
                json_schema: {
                    name: 'result',
                    type: 'json_schema',
                    strict: true,
                    schema: {
                        type: 'object',
                        properties: {
                            answer: { type: 'string' },
                        },
                        required: ['answer'],
                        additionalProperties: false,
                    },
                },
            },
        };

        const events: ProviderStreamEvent[] = [];
        for await (const event of ensembleRequest([{ type: 'message', role: 'user', content: 'Hello' }], agent)) {
            events.push(event);
        }

        expect(events.some(event => event.type === 'error')).toBe(false);
        expect(events.some(event => event.type === 'operation_status' && (event as any).status === 'failed')).toBe(false);
        expect(events.some(event => event.type === 'operation_status' && (event as any).status === 'completed')).toBe(true);
        const responseOutputs = events.filter(event => event.type === 'response_output') as any[];
        expect(responseOutputs.some(event => event.message?.content === '{"answer":"done"}')).toBe(true);
    });

    it('treats invalid structured output as a terminal request failure', async () => {
        const { getModelProvider } = await import('../model_providers/model_provider.js');

        vi.mocked(getModelProvider).mockReturnValue({
            provider_id: 'structured-provider',
            createResponseStream: vi.fn().mockImplementation(async function* () {
                yield {
                    type: 'message_complete',
                    message_id: 'msg_invalid_json',
                    content: 'not valid json',
                } as ProviderStreamEvent;
            }),
        } as any);

        const agent: AgentDefinition = {
            model: 'test-model',
            modelSettings: {
                json_schema: {
                    name: 'result',
                    type: 'json_schema',
                    strict: true,
                    schema: {
                        type: 'object',
                        properties: {
                            answer: { type: 'string' },
                        },
                        required: ['answer'],
                        additionalProperties: false,
                    },
                },
            },
        };

        const events: ProviderStreamEvent[] = [];
        for await (const event of ensembleRequest([{ type: 'message', role: 'user', content: 'Hello' }], agent)) {
            events.push(event);
        }

        const errorEvent = events.find(event => event.type === 'error') as any;
        const failedStatus = events.find(event => event.type === 'operation_status' && (event as any).status === 'failed') as any;

        expect(errorEvent?.error).toContain('Structured output was not valid JSON');
        expect(failedStatus?.terminal).toBe(true);
        expect(failedStatus?.recoverable).toBe(false);
        expect(failedStatus?.attempt).toBe(1);
        expect(events.some(event => event.type === 'operation_status' && (event as any).status === 'completed')).toBe(false);
    });

    it('does not turn non-strict structured-output mismatches into terminal request failures', async () => {
        const { getModelProvider } = await import('../model_providers/model_provider.js');

        vi.mocked(getModelProvider).mockReturnValue({
            provider_id: 'non-strict-structured-provider',
            createResponseStream: vi.fn().mockImplementation(async function* () {
                yield {
                    type: 'message_complete',
                    message_id: 'msg_non_strict_json',
                    content: 'not valid json',
                } as ProviderStreamEvent;
            }),
        } as any);

        const agent: AgentDefinition = {
            model: 'test-model',
            modelSettings: {
                json_schema: {
                    name: 'result',
                    type: 'json_schema',
                    schema: {
                        type: 'object',
                        properties: {
                            answer: { type: 'string' },
                        },
                        required: ['answer'],
                        additionalProperties: false,
                    },
                },
            },
        };

        const events: ProviderStreamEvent[] = [];
        for await (const event of ensembleRequest([{ type: 'message', role: 'user', content: 'Hello' }], agent)) {
            events.push(event);
        }

        expect(events.some(event => event.type === 'error')).toBe(false);
        expect(events.some(event => event.type === 'operation_status' && (event as any).status === 'failed')).toBe(false);
        const responseOutputs = events.filter(event => event.type === 'response_output') as any[];
        expect(responseOutputs.some(event => event.message?.content === 'not valid json')).toBe(true);
        expect(events.some(event => event.type === 'operation_status' && (event as any).status === 'completed')).toBe(true);
    });

    it('treats invalid structured-output regex patterns as terminal schema validation failures', async () => {
        const { getModelProvider } = await import('../model_providers/model_provider.js');

        vi.mocked(getModelProvider).mockReturnValue({
            provider_id: 'invalid-pattern-provider',
            createResponseStream: vi.fn().mockImplementation(async function* () {
                yield {
                    type: 'message_complete',
                    message_id: 'msg_regex_json',
                    content: '{"answer":"done"}',
                } as ProviderStreamEvent;
            }),
        } as any);

        const agent: AgentDefinition = {
            model: 'test-model',
            modelSettings: {
                json_schema: {
                    name: 'result',
                    type: 'json_schema',
                    strict: true,
                    schema: {
                        type: 'object',
                        properties: {
                            answer: {
                                type: 'string',
                                pattern: '[invalid',
                            },
                        },
                        required: ['answer'],
                        additionalProperties: false,
                    },
                },
            },
        };

        const events: ProviderStreamEvent[] = [];
        for await (const event of ensembleRequest([{ type: 'message', role: 'user', content: 'Hello' }], agent)) {
            events.push(event);
        }

        const errorEvent = events.find(event => event.type === 'error') as any;
        const failedStatus = events.find(event => event.type === 'operation_status' && (event as any).status === 'failed') as any;

        expect(errorEvent?.error).toContain('invalid pattern');
        expect(errorEvent?.error).toContain('[invalid');
        expect(failedStatus?.terminal).toBe(true);
        expect(failedStatus?.recoverable).toBe(false);
        expect(events.some(event => event.type === 'operation_status' && (event as any).status === 'retrying')).toBe(false);
    });

    it('treats blank structured output as a terminal request failure', async () => {
        const { getModelProvider } = await import('../model_providers/model_provider.js');

        vi.mocked(getModelProvider).mockReturnValue({
            provider_id: 'structured-provider',
            createResponseStream: vi.fn().mockImplementation(async function* () {
                yield {
                    type: 'message_complete',
                    message_id: 'msg_blank_json',
                    content: '   ',
                } as ProviderStreamEvent;
            }),
        } as any);

        const agent: AgentDefinition = {
            model: 'test-model',
            modelSettings: {
                json_schema: {
                    name: 'result',
                    type: 'json_schema',
                    strict: true,
                    schema: {
                        type: 'object',
                        properties: {
                            answer: { type: 'string' },
                        },
                        required: ['answer'],
                        additionalProperties: false,
                    },
                },
            },
        };

        const events: ProviderStreamEvent[] = [];
        for await (const event of ensembleRequest([{ type: 'message', role: 'user', content: 'Hello' }], agent)) {
            events.push(event);
        }

        const errorEvent = events.find(event => event.type === 'error') as any;
        expect(errorEvent?.error).toContain('ended the stream without any terminal content');
        expect(events.some(event => event.type === 'operation_status' && (event as any).status === 'completed')).toBe(false);
    });

    it('treats whitespace-only plain-text completions as terminal output', async () => {
        const { getModelProvider } = await import('../model_providers/model_provider.js');

        vi.mocked(getModelProvider).mockReturnValue({
            provider_id: 'plain-text-provider',
            createResponseStream: vi.fn().mockImplementation(async function* () {
                yield {
                    type: 'message_complete',
                    message_id: 'msg_blank_text',
                    content: '   ',
                } as ProviderStreamEvent;
            }),
        } as any);

        const agent: AgentDefinition = {
            model: 'test-model',
        };

        const events: ProviderStreamEvent[] = [];
        for await (const event of ensembleRequest([{ type: 'message', role: 'user', content: 'Hello' }], agent)) {
            events.push(event);
        }

        expect(events.some(event => event.type === 'error')).toBe(false);
        expect(events.some(event => event.type === 'operation_status' && (event as any).status === 'failed')).toBe(false);
        expect(events.some(event => event.type === 'operation_status' && (event as any).status === 'completed')).toBe(true);
        const responseOutput = events.find(event => event.type === 'response_output') as any;
        expect(responseOutput?.message?.content).toBe('   ');
    });

    it('fails tool-limited turns instead of reporting completion', async () => {
        const { getModelProvider } = await import('../model_providers/model_provider.js');

        vi.mocked(getModelProvider).mockReturnValue({
            provider_id: 'tool-limit-provider',
            createResponseStream: vi.fn().mockImplementation(async function* () {
                yield {
                    type: 'tool_start',
                    tool_call: {
                        id: 'tool-1',
                        type: 'function',
                        function: {
                            name: 'lookup_weather',
                            arguments: '{}',
                        },
                    },
                } as ProviderStreamEvent;
            }),
        } as any);

        const agent: AgentDefinition = {
            model: 'test-model',
            maxToolCalls: 0,
        };

        const events: ProviderStreamEvent[] = [];
        for await (const event of ensembleRequest([{ type: 'message', role: 'user', content: 'Hello' }], agent)) {
            events.push(event);
        }

        const failedStatus = events.find(
            event => event.type === 'operation_status' && (event as any).status === 'failed'
        ) as any;
        expect(failedStatus?.reason).toBe('tool_limit_reached');
        expect(failedStatus?.terminal).toBe(true);
        expect(failedStatus?.recoverable).toBe(false);
        expect(failedStatus?.error).toContain('Tool call limit reached (0).');
        expect(events.some(event => event.type === 'operation_status' && (event as any).status === 'completed')).toBe(false);
    });

    it('emits a failed outer request status when verification exhausts its attempts', async () => {
        const { getModelProvider } = await import('../model_providers/model_provider.js');

        vi.mocked(getModelProvider).mockReturnValue({
            provider_id: 'verification-failure-provider',
            createResponseStream: vi.fn().mockImplementation(async function* (_messages: any[], _model: string, agent: AgentDefinition) {
                yield {
                    type: 'message_complete',
                    message_id: `${agent.name || 'agent'}-message`,
                    content:
                        agent.name === 'verifier_agent'
                            ? '{"status":"fail","reason":"Missing required details"}'
                            : 'Candidate response',
                } as ProviderStreamEvent;
            }),
        } as any);

        const events: ProviderStreamEvent[] = [];
        for await (const event of ensembleRequest(
            [{ type: 'message', role: 'user', content: 'Hello' }],
            {
                model: 'test-model',
                name: 'main_agent',
                verifier: {
                    name: 'verifier_agent',
                },
                maxVerificationAttempts: 2,
            }
        )) {
            events.push(event);
        }

        const outerRequestId = (events.find(event => event.type === 'agent_start') as any)?.request_id;
        const outerStatuses = events.filter(
            event => event.type === 'operation_status' && (event as any).request_id === outerRequestId
        ) as any[];

        expect(outerStatuses.map(event => event.status)).toEqual(['started', 'failed']);
        expect(outerStatuses[1]?.reason).toBe('verification_failed');
        expect(outerStatuses[1]?.error).toContain('Verification failed after 2 attempts: Missing required details');
        expect(outerStatuses.some(event => event.status === 'completed')).toBe(false);
        expect(
            events.some(
                event =>
                    event.type === 'message_delta' &&
                    (event as any).content?.includes('❌ Verification failed after 2 attempts: Missing required details')
            )
        ).toBe(true);
    });

    it('clears transient retry errors when ensembleResult later sees completion', async () => {
        const stream = {
            events: [
                {
                    type: 'operation_status',
                    operation: 'request',
                    status: 'retrying',
                    error: 'temporary failure',
                    recoverable: true,
                    terminal: false,
                },
                {
                    type: 'operation_status',
                    operation: 'request',
                    status: 'completed',
                    terminal: true,
                    will_continue: false,
                },
                { type: 'stream_end' },
            ],
            async next() {
                const value = this.events.shift();
                return value ? { done: false, value } : { done: true, value: undefined };
            },
            async return() {
                return { done: true, value: undefined };
            },
            [Symbol.asyncIterator]() {
                return this;
            },
        } as any as AsyncGenerator<ProviderStreamEvent>;

        const result = await ensembleResult(stream);
        expect(result.completed).toBe(true);
        expect(result.error).toBeUndefined();
        expect(result.failure).toBeUndefined();
    });

    it('does not mark a terminal failure as completed when stream_end arrives', async () => {
        const stream = {
            events: [
                {
                    type: 'operation_status',
                    operation: 'request',
                    status: 'failed',
                    error: 'terminal failure',
                    recoverable: false,
                    terminal: true,
                },
                { type: 'stream_end' },
            ],
            async next() {
                const value = this.events.shift();
                return value ? { done: false, value } : { done: true, value: undefined };
            },
            async return() {
                return { done: true, value: undefined };
            },
            [Symbol.asyncIterator]() {
                return this;
            },
        } as any as AsyncGenerator<ProviderStreamEvent>;

        const result = await ensembleResult(stream);

        expect(result.completed).toBe(false);
        expect(result.error).toBe('terminal failure');
        expect(result.failure?.terminal).toBe(true);
    });

    it('marks a stream as completed when only non-terminal errors occurred before stream_end', async () => {
        const stream = {
            events: [
                {
                    type: 'error',
                    error: 'temporary warning',
                    recoverable: true,
                },
                { type: 'stream_end' },
            ],
            async next() {
                const value = this.events.shift();
                return value ? { done: false, value } : { done: true, value: undefined };
            },
            async return() {
                return { done: true, value: undefined };
            },
            [Symbol.asyncIterator]() {
                return this;
            },
        } as any as AsyncGenerator<ProviderStreamEvent>;

        const result = await ensembleResult(stream);

        expect(result.completed).toBe(true);
        expect(result.error).toBe('temporary warning');
        expect(result.failure).toBeUndefined();
    });

    it('does not mark error-only streams as completed when they end without stream_end', async () => {
        const stream = {
            events: [
                {
                    type: 'error',
                    error: 'provider stream failed',
                },
            ],
            async next() {
                const value = this.events.shift();
                return value ? { done: false, value } : { done: true, value: undefined };
            },
            async return() {
                return { done: true, value: undefined };
            },
            [Symbol.asyncIterator]() {
                return this;
            },
        } as any as AsyncGenerator<ProviderStreamEvent>;

        const result = await ensembleResult(stream);

        expect(result.completed).toBe(false);
        expect(result.error).toBe('provider stream failed');
        expect(result.failure).toBeUndefined();
    });

    it('preserves recoverable false on terminal error events', () => {
        const event = toTerminalErrorEvent({
            error: 'terminal failure',
            recoverable: undefined,
        });

        expect(event.recoverable).toBe(false);
    });
});
