import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ensembleRequest } from '../core/ensemble_request.js';
import type { AgentDefinition, ProviderStreamEvent } from '../types/types.js';
import { runningToolTracker } from '../utils/running_tool_tracker.js';

vi.mock('../model_providers/model_provider.js', () => ({
    getModelFromAgent: vi.fn().mockResolvedValue('test-model'),
    getModelProvider: vi.fn(),
}));

async function collectEvents(stream: AsyncIterable<ProviderStreamEvent>): Promise<ProviderStreamEvent[]> {
    const events: ProviderStreamEvent[] = [];
    for await (const event of stream) {
        events.push(event);
    }
    return events;
}

describe('request lifecycle', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('lets started tools finish before retrying a recoverable provider failure', async () => {
        const { getModelProvider } = await import('../model_providers/model_provider.js');
        let attempts = 0;

        vi.mocked(getModelProvider).mockReturnValue({
            provider_id: 'recoverable-provider',
            createResponseStream: vi.fn().mockImplementation(async function* () {
                attempts += 1;
                if (attempts === 1) {
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
                        error: 'temporary provider failure',
                        recoverable: true,
                    } as ProviderStreamEvent;
                    return;
                }

                yield {
                    type: 'message_complete',
                    message_id: 'msg-2',
                    content: 'Recovered response',
                } as ProviderStreamEvent;
            }),
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
                            parameters: { type: 'object', properties: {}, required: [] },
                        },
                    },
                    function: vi.fn(async () => {
                        await new Promise(resolve => setTimeout(resolve, 20));
                        return 'sunny';
                    }),
                },
            ],
        };

        const events = await collectEvents(
            ensembleRequest([{ type: 'message', role: 'user', content: 'Hello' } as any], agent)
        );

        const toolDone = events.find(event => event.type === 'tool_done') as any;
        const errorEvent = events.find(event => event.type === 'error') as any;
        const statuses = events.filter(event => event.type === 'operation_status') as any[];
        const startedStatus = statuses.find(event => event.status === 'started');
        const retryingStatus = statuses.find(event => event.status === 'retrying');
        const completedStatus = statuses.find(event => event.status === 'completed');
        const finalAgentDone = events.filter(event => event.type === 'agent_done').at(-1) as any;

        expect(attempts).toBe(2);
        expect(toolDone?.result?.output).toBe('sunny');
        expect(toolDone?.result?.error).toBeUndefined();
        expect(errorEvent?.recoverable).toBe(true);
        expect(statuses.map(event => event.status)).toEqual(['started', 'retrying', 'completed']);
        expect(statuses.filter(event => event.terminal === true)).toHaveLength(1);
        expect(retryingStatus?.request_id).toBe(startedStatus?.request_id);
        expect(completedStatus?.request_id).toBe(startedStatus?.request_id);
        expect(completedStatus?.request_id).not.toBe(finalAgentDone?.request_id);
    });

    it('retries when assistant prefill text is followed by tool use before a recoverable failure', async () => {
        const { getModelProvider } = await import('../model_providers/model_provider.js');
        let attempts = 0;

        vi.mocked(getModelProvider).mockReturnValue({
            provider_id: 'prefill-tool-provider',
            createResponseStream: vi.fn().mockImplementation(async function* () {
                attempts += 1;
                if (attempts === 1) {
                    yield {
                        type: 'message_complete',
                        message_id: 'prefill-1',
                        content: 'Let me check that for you.',
                    } as ProviderStreamEvent;
                    yield {
                        type: 'tool_start',
                        tool_call: {
                            id: 'tool-prefill',
                            call_id: 'call-prefill',
                            type: 'function',
                            function: {
                                name: 'lookup_weather',
                                arguments: '{}',
                            },
                        },
                    } as ProviderStreamEvent;
                    yield {
                        type: 'error',
                        error: 'temporary provider failure after tool prefill',
                        recoverable: true,
                    } as ProviderStreamEvent;
                    return;
                }

                yield {
                    type: 'message_complete',
                    message_id: 'prefill-final',
                    content: 'Recovered response',
                } as ProviderStreamEvent;
            }),
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
                            parameters: { type: 'object', properties: {}, required: [] },
                        },
                    },
                    function: vi.fn(async () => 'sunny'),
                },
            ],
        };

        const events = await collectEvents(
            ensembleRequest([{ type: 'message', role: 'user', content: 'Hello' } as any], agent)
        );

        const statuses = events.filter(event => event.type === 'operation_status') as any[];
        const toolDone = events.find(event => event.type === 'tool_done') as any;

        expect(attempts).toBe(2);
        expect(toolDone?.result?.output).toBe('sunny');
        expect(statuses.map(event => event.status)).toEqual(['started', 'retrying', 'completed']);
        expect(
            events.some(event => event.type === 'message_complete' && (event as any).content === 'Recovered response')
        ).toBe(true);
    });

    it('bounds tool finalization after a terminal provider failure', async () => {
        const { getModelProvider } = await import('../model_providers/model_provider.js');

        vi.mocked(getModelProvider).mockReturnValue({
            provider_id: 'terminal-provider',
            createResponseStream: vi.fn().mockImplementation(async function* () {
                yield {
                    type: 'tool_start',
                    tool_call: {
                        id: 'tool-terminal',
                        call_id: 'call-terminal',
                        type: 'function',
                        function: {
                            name: 'lookup_weather',
                            arguments: '{}',
                        },
                    },
                } as ProviderStreamEvent;
                yield {
                    type: 'error',
                    error: 'terminal provider failure',
                    recoverable: false,
                } as ProviderStreamEvent;
            }),
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
                            parameters: { type: 'object', properties: {}, required: [] },
                        },
                    },
                    function: vi.fn(
                        async (_args?: unknown, abortSignal?: AbortSignal) =>
                            new Promise((_, reject) => {
                                abortSignal?.addEventListener(
                                    'abort',
                                    () => reject(new Error('tool aborted after terminal provider failure')),
                                    { once: true }
                                );
                            })
                    ),
                    injectAbortSignal: true,
                },
            ],
        };

        const events = await Promise.race([
            collectEvents(ensembleRequest([{ type: 'message', role: 'user', content: 'Hello' } as any], agent)),
            new Promise<ProviderStreamEvent[]>((_, reject) => {
                setTimeout(() => reject(new Error('ensembleRequest hung after terminal provider failure')), 250);
            }),
        ]);

        const toolDone = events.find(event => event.type === 'tool_done') as any;
        const errorEvent = events.find(event => event.type === 'error') as any;
        const failedStatus = events.find(
            event => event.type === 'operation_status' && (event as any).status === 'failed'
        ) as any;

        expect(toolDone?.result?.error).toContain('Operation was aborted');
        expect(errorEvent?.recoverable).toBe(false);
        expect(failedStatus?.terminal).toBe(true);
        expect(events.some(event => event.type === 'operation_status' && (event as any).status === 'retrying')).toBe(
            false
        );
    });

    it('does not start queued sequential tools after terminal request failure finalization', async () => {
        const { getModelProvider } = await import('../model_providers/model_provider.js');
        runningToolTracker.clear();

        vi.mocked(getModelProvider).mockReturnValue({
            provider_id: 'sequential-terminal-provider',
            createResponseStream: vi.fn().mockImplementation(async function* () {
                yield {
                    type: 'tool_start',
                    tool_call: {
                        id: 'tool-sequential-1',
                        call_id: 'call-sequential-1',
                        type: 'function',
                        function: {
                            name: 'lookup_weather',
                            arguments: '{}',
                        },
                    },
                } as ProviderStreamEvent;
                yield {
                    type: 'tool_start',
                    tool_call: {
                        id: 'tool-sequential-2',
                        call_id: 'call-sequential-2',
                        type: 'function',
                        function: {
                            name: 'lookup_time',
                            arguments: '{}',
                        },
                    },
                } as ProviderStreamEvent;
                yield {
                    type: 'error',
                    error: 'terminal provider failure',
                    recoverable: false,
                } as ProviderStreamEvent;
            }),
        } as any);

        const secondTool = vi.fn(async () => 'utc');
        const events = await Promise.race([
            collectEvents(
                ensembleRequest([{ type: 'message', role: 'user', content: 'Hello' } as any], {
                    agent_id: 'sequential-agent',
                    model: 'test-model',
                    modelSettings: {
                        sequential_tools: true,
                    },
                    tools: [
                        {
                            definition: {
                                type: 'function',
                                function: {
                                    name: 'lookup_weather',
                                    description: 'Lookup weather',
                                    parameters: { type: 'object', properties: {}, required: [] },
                                },
                            },
                            function: vi.fn(
                                async (_args?: unknown, abortSignal?: AbortSignal) =>
                                    new Promise((_, reject) => {
                                        abortSignal?.addEventListener(
                                            'abort',
                                            () => reject(new Error('first sequential tool aborted')),
                                            { once: true }
                                        );
                                    })
                            ),
                            injectAbortSignal: true,
                        },
                        {
                            definition: {
                                type: 'function',
                                function: {
                                    name: 'lookup_time',
                                    description: 'Lookup time',
                                    parameters: { type: 'object', properties: {}, required: [] },
                                },
                            },
                            function: secondTool,
                        },
                    ],
                })
            ),
            new Promise<ProviderStreamEvent[]>((_, reject) => {
                setTimeout(
                    () => reject(new Error('ensembleRequest hung during sequential terminal finalization')),
                    250
                );
            }),
        ]);

        expect(secondTool).not.toHaveBeenCalled();
        expect(events.filter(event => event.type === 'tool_done')).toHaveLength(2);
        expect(
            events.some(
                event =>
                    event.type === 'tool_done' &&
                    (event as any).tool_call?.function?.name === 'lookup_time' &&
                    String((event as any).result?.error || '').includes('terminal provider failure')
            )
        ).toBe(true);
        expect(runningToolTracker.getRunningToolCount()).toBe(0);
        runningToolTracker.clear();
    });

    it('propagates request timeouts to the provider signal', async () => {
        const { getModelProvider } = await import('../model_providers/model_provider.js');
        let aborted = false;

        vi.mocked(getModelProvider).mockReturnValue({
            provider_id: 'timeout-provider',
            createResponseStream: vi.fn().mockImplementation(async function* (_messages, _model, agent) {
                yield* [] as ProviderStreamEvent[];
                agent.abortSignal?.addEventListener('abort', () => {
                    aborted = true;
                });
                await new Promise(() => undefined);
            }),
        } as any);

        const events = await collectEvents(
            ensembleRequest([{ type: 'message', role: 'user', content: 'Hello' } as any], {
                model: 'test-model',
                modelSettings: {
                    timeout_ms: 10,
                },
            })
        );

        const errorEvent = events.find(event => event.type === 'error') as any;
        const failedStatus = events.find(
            event => event.type === 'operation_status' && (event as any).status === 'failed'
        ) as any;

        expect(aborted).toBe(true);
        expect(errorEvent?.recoverable).toBe(false);
        expect(failedStatus?.error).toContain('timed out after');
    });

    it('fails the outer request when timeout_ms expires during tool completion', async () => {
        const { getModelProvider } = await import('../model_providers/model_provider.js');

        vi.mocked(getModelProvider).mockReturnValue({
            provider_id: 'tool-timeout-provider',
            createResponseStream: vi.fn().mockImplementation(async function* () {
                yield {
                    type: 'tool_start',
                    tool_call: {
                        id: 'tool-timeout',
                        call_id: 'call-timeout',
                        type: 'function',
                        function: {
                            name: 'lookup_weather',
                            arguments: '{}',
                        },
                    },
                } as ProviderStreamEvent;
            }),
        } as any);

        const events = await Promise.race([
            collectEvents(
                ensembleRequest([{ type: 'message', role: 'user', content: 'Hello' } as any], {
                    model: 'test-model',
                    modelSettings: {
                        timeout_ms: 10,
                    },
                    tools: [
                        {
                            definition: {
                                type: 'function',
                                function: {
                                    name: 'lookup_weather',
                                    description: 'Lookup weather',
                                    parameters: { type: 'object', properties: {}, required: [] },
                                },
                            },
                            function: vi.fn(async () => {
                                await new Promise(() => undefined);
                                return 'sunny';
                            }),
                        },
                    ],
                })
            ),
            new Promise<ProviderStreamEvent[]>((_, reject) => {
                setTimeout(() => reject(new Error('ensembleRequest hung while awaiting tool completion')), 250);
            }),
        ]);

        const toolDone = events.find(event => event.type === 'tool_done') as any;
        const errorEvent = events.find(event => event.type === 'error') as any;
        const failedStatus = events.find(
            event => event.type === 'operation_status' && (event as any).status === 'failed'
        ) as any;

        expect(toolDone).toBeUndefined();
        expect(errorEvent?.error).toContain('timed out after');
        expect(errorEvent?.recoverable).toBe(false);
        expect(failedStatus?.error).toContain('timed out after');
        expect(runningToolTracker.getRunningTool('tool-timeout')).toBeDefined();
        runningToolTracker.clear();
    });

    it('keeps non-abortable tools tracked when bounded failure finalization gives up waiting', async () => {
        const { getModelProvider } = await import('../model_providers/model_provider.js');
        runningToolTracker.clear();

        vi.mocked(getModelProvider).mockReturnValue({
            provider_id: 'tool-cleanup-provider',
            createResponseStream: vi.fn().mockImplementation(async function* () {
                yield {
                    type: 'tool_start',
                    tool_call: {
                        id: 'tool-cleanup',
                        call_id: 'call-cleanup',
                        type: 'function',
                        function: {
                            name: 'lookup_weather',
                            arguments: '{}',
                        },
                    },
                } as ProviderStreamEvent;
                yield {
                    type: 'error',
                    error: 'terminal provider failure',
                    recoverable: false,
                } as ProviderStreamEvent;
            }),
        } as any);

        const events = await Promise.race([
            collectEvents(
                ensembleRequest([{ type: 'message', role: 'user', content: 'Hello' } as any], {
                    model: 'test-model',
                    tools: [
                        {
                            definition: {
                                type: 'function',
                                function: {
                                    name: 'lookup_weather',
                                    description: 'Lookup weather',
                                    parameters: { type: 'object', properties: {}, required: [] },
                                },
                            },
                            function: vi.fn(async () => {
                                await new Promise(() => undefined);
                                return 'sunny';
                            }),
                        },
                    ],
                })
            ),
            new Promise<ProviderStreamEvent[]>((_, reject) => {
                setTimeout(() => reject(new Error('ensembleRequest hung after bounded tool finalization')), 250);
            }),
        ]);

        expect(events.some(event => event.type === 'tool_done')).toBe(false);
        expect(runningToolTracker.getRunningTool('tool-cleanup')).toBeDefined();
        expect(runningToolTracker.getRunningToolCount()).toBe(1);
        runningToolTracker.clear();
    });

    it('uses the outer lifecycle directly instead of provider retry wrappers', async () => {
        const { getModelProvider } = await import('../model_providers/model_provider.js');
        const createResponseStream = vi.fn().mockImplementation(async function* () {
            yield {
                type: 'message_complete',
                message_id: 'msg-direct',
                content: 'Direct provider response',
            } as ProviderStreamEvent;
        });
        const createResponseStreamWithRetry = vi.fn().mockImplementation(async function* () {
            yield* [] as ProviderStreamEvent[];
            throw new Error('provider retry wrapper should not be called');
        });

        vi.mocked(getModelProvider).mockReturnValue({
            provider_id: 'direct-provider',
            createResponseStream,
            createResponseStreamWithRetry,
        } as any);

        const events = await collectEvents(
            ensembleRequest([{ type: 'message', role: 'user', content: 'Hello' } as any], { model: 'test-model' })
        );

        expect(createResponseStream).toHaveBeenCalledTimes(1);
        expect(createResponseStreamWithRetry).not.toHaveBeenCalled();
        expect(events.some(event => event.type === 'message_complete')).toBe(true);
        expect(events.filter(event => event.type === 'operation_status').map(event => (event as any).status)).toEqual([
            'started',
            'completed',
        ]);
    });

    it('honors outer retryOptions.maxRetries and onRetry callbacks', async () => {
        const { getModelProvider } = await import('../model_providers/model_provider.js');
        const onRetry = vi.fn();
        let attempts = 0;

        vi.mocked(getModelProvider).mockReturnValue({
            provider_id: 'retry-options-provider',
            createResponseStream: vi.fn().mockImplementation(async function* () {
                attempts += 1;
                yield {
                    type: 'error',
                    error: `recoverable failure ${attempts}`,
                    recoverable: true,
                    code: 'ECONNRESET',
                } as ProviderStreamEvent;
            }),
        } as any);

        const events = await collectEvents(
            ensembleRequest([{ type: 'message', role: 'user', content: 'Hello' } as any], {
                model: 'test-model',
                retryOptions: {
                    maxRetries: 1,
                    onRetry,
                },
            })
        );

        const statuses = events.filter(event => event.type === 'operation_status') as any[];
        const failedStatus = statuses.find(event => event.status === 'failed');

        expect(attempts).toBe(2);
        expect(onRetry).toHaveBeenCalledTimes(1);
        expect(onRetry).toHaveBeenCalledWith(
            expect.objectContaining({
                message: 'recoverable failure 1',
                code: 'ECONNRESET',
                recoverable: true,
            }),
            1
        );
        expect(statuses.map(event => event.status)).toEqual(['started', 'retrying', 'failed']);
        expect(failedStatus?.attempt).toBe(2);
        expect(failedStatus?.max_attempts).toBe(2);
    });

    it('retries thrown transport failures when the error matches retryable network conditions', async () => {
        const { getModelProvider } = await import('../model_providers/model_provider.js');
        let attempts = 0;

        vi.mocked(getModelProvider).mockReturnValue({
            provider_id: 'thrown-transport-provider',
            createResponseStream: vi.fn().mockImplementation(async function* () {
                attempts += 1;
                if (attempts === 1) {
                    throw new Error('fetch failed: ECONNRESET');
                }

                yield {
                    type: 'message_complete',
                    message_id: 'msg-transport-retry',
                    content: 'Recovered after thrown transport error',
                } as ProviderStreamEvent;
            }),
        } as any);

        const events = await collectEvents(
            ensembleRequest([{ type: 'message', role: 'user', content: 'Hello' } as any], {
                model: 'test-model',
                retryOptions: {
                    maxRetries: 1,
                },
            })
        );

        const errorEvent = events.find(event => event.type === 'error') as any;
        const statuses = events.filter(event => event.type === 'operation_status') as any[];

        expect(attempts).toBe(2);
        expect(errorEvent?.recoverable).toBe(true);
        expect(events.some(event => event.type === 'message_complete')).toBe(true);
        expect(statuses.map(event => event.status)).toEqual(['started', 'retrying', 'completed']);
    });

    it('does not retry after a terminal response has already been emitted', async () => {
        const { getModelProvider } = await import('../model_providers/model_provider.js');
        let attempts = 0;

        vi.mocked(getModelProvider).mockReturnValue({
            provider_id: 'post-response-drop-provider',
            createResponseStream: vi.fn().mockImplementation(async function* () {
                attempts += 1;
                yield {
                    type: 'message_complete',
                    message_id: `msg-post-response-${attempts}`,
                    content: 'Completed before disconnect',
                } as ProviderStreamEvent;
                yield {
                    type: 'error',
                    error: 'fetch failed: ECONNRESET',
                    code: 'ECONNRESET',
                    recoverable: true,
                } as ProviderStreamEvent;
            }),
        } as any);

        const events = await collectEvents(
            ensembleRequest([{ type: 'message', role: 'user', content: 'Hello' } as any], {
                model: 'test-model',
                retryOptions: {
                    maxRetries: 1,
                },
            })
        );

        const errorEvent = events.find(event => event.type === 'error') as any;
        const statuses = events.filter(event => event.type === 'operation_status') as any[];
        const failedStatus = statuses.find(event => event.status === 'failed');

        expect(attempts).toBe(1);
        expect(events.filter(event => event.type === 'message_complete')).toHaveLength(1);
        expect(errorEvent?.recoverable).toBe(false);
        expect(events.some(event => event.type === 'operation_status' && (event as any).status === 'retrying')).toBe(
            false
        );
        expect(statuses.map(event => event.status)).toEqual(['started', 'failed']);
        expect(failedStatus?.recoverable).toBe(false);
        expect(failedStatus?.error).toBe(errorEvent?.error);
    });

    it('clears forced tool_choice before issuing the follow-up request', async () => {
        const { getModelProvider } = await import('../model_providers/model_provider.js');
        const seenToolChoices: Array<unknown> = [];

        vi.mocked(getModelProvider).mockReturnValue({
            provider_id: 'tool-choice-provider',
            createResponseStream: vi.fn().mockImplementation(async function* (_messages, _model, agent) {
                seenToolChoices.push(agent.modelSettings?.tool_choice);

                if (seenToolChoices.length === 1) {
                    yield {
                        type: 'tool_start',
                        tool_call: {
                            id: 'tool-choice-1',
                            call_id: 'call-tool-choice-1',
                            type: 'function',
                            function: {
                                name: 'lookup_weather',
                                arguments: '{}',
                            },
                        },
                    } as ProviderStreamEvent;
                    return;
                }

                yield {
                    type: 'message_complete',
                    message_id: 'msg-tool-choice-final',
                    content: 'Weather is sunny',
                } as ProviderStreamEvent;
            }),
        } as any);

        const events = await collectEvents(
            ensembleRequest([{ type: 'message', role: 'user', content: 'Hello' } as any], {
                model: 'test-model',
                modelSettings: {
                    tool_choice: 'required',
                },
                tools: [
                    {
                        definition: {
                            type: 'function',
                            function: {
                                name: 'lookup_weather',
                                description: 'Lookup weather',
                                parameters: { type: 'object', properties: {}, required: [] },
                            },
                        },
                        function: vi.fn(async () => 'sunny'),
                    },
                ],
            })
        );

        expect(seenToolChoices).toEqual(['required', undefined]);
        expect(events.filter(event => event.type === 'tool_done')).toHaveLength(1);
        expect(
            events.some(event => event.type === 'message_complete' && (event as any).content === 'Weather is sunny')
        ).toBe(true);
        expect(events.some(event => event.type === 'operation_status' && (event as any).status === 'completed')).toBe(
            true
        );
    });

    it('honors additionalRetryableErrors in the outer retry classifier', async () => {
        const { getModelProvider } = await import('../model_providers/model_provider.js');
        let attempts = 0;

        vi.mocked(getModelProvider).mockReturnValue({
            provider_id: 'custom-retry-code-provider',
            createResponseStream: vi.fn().mockImplementation(async function* () {
                attempts += 1;
                if (attempts === 1) {
                    yield {
                        type: 'error',
                        error: 'custom retryable failure',
                        code: 'CUSTOM_RETRY',
                    } as ProviderStreamEvent;
                    return;
                }

                yield {
                    type: 'message_complete',
                    message_id: 'msg-custom-retry-code',
                    content: 'Recovered after custom retry code',
                } as ProviderStreamEvent;
            }),
        } as any);

        const events = await collectEvents(
            ensembleRequest([{ type: 'message', role: 'user', content: 'Hello' } as any], {
                model: 'test-model',
                retryOptions: {
                    maxRetries: 1,
                    additionalRetryableErrors: ['CUSTOM_RETRY'],
                },
            })
        );

        const statuses = events.filter(event => event.type === 'operation_status') as any[];
        const errorEvent = events.find(event => event.type === 'error') as any;

        expect(attempts).toBe(2);
        expect(errorEvent?.code).toBe('CUSTOM_RETRY');
        expect(errorEvent?.recoverable).toBe(true);
        expect(statuses.map(event => event.status)).toEqual(['started', 'retrying', 'completed']);
    });

    it('waits for configured backoff before retrying a recoverable failure', async () => {
        const { getModelProvider } = await import('../model_providers/model_provider.js');
        let attempts = 0;

        vi.useFakeTimers();
        const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.5);

        try {
            vi.mocked(getModelProvider).mockReturnValue({
                provider_id: 'retry-delay-provider',
                createResponseStream: vi.fn().mockImplementation(async function* () {
                    attempts += 1;
                    if (attempts === 1) {
                        yield {
                            type: 'error',
                            error: 'recoverable failure 1',
                            recoverable: true,
                            code: 'ECONNRESET',
                        } as ProviderStreamEvent;
                        return;
                    }

                    yield {
                        type: 'message_complete',
                        message_id: 'msg-retried',
                        content: 'Recovered after backoff',
                    } as ProviderStreamEvent;
                }),
            } as any);

            const eventsPromise = collectEvents(
                ensembleRequest([{ type: 'message', role: 'user', content: 'Hello' } as any], {
                    model: 'test-model',
                    retryOptions: {
                        maxRetries: 1,
                        initialDelay: 100,
                        maxDelay: 100,
                        backoffMultiplier: 1,
                    },
                })
            );

            await vi.advanceTimersByTimeAsync(99);
            expect(attempts).toBe(1);

            await vi.advanceTimersByTimeAsync(1);
            const events = await eventsPromise;

            expect(attempts).toBe(2);
            expect(events.some(event => event.type === 'message_complete')).toBe(true);
        } finally {
            randomSpy.mockRestore();
            vi.useRealTimers();
        }
    });

    it('applies timeout_ms across all retry attempts', async () => {
        const { getModelProvider } = await import('../model_providers/model_provider.js');
        let attempts = 0;
        let secondAttemptAborted = false;

        vi.useFakeTimers();
        try {
            vi.mocked(getModelProvider).mockReturnValue({
                provider_id: 'timeout-budget-provider',
                createResponseStream: vi.fn().mockImplementation(async function* (_messages, _model, agent) {
                    attempts += 1;
                    if (attempts === 1) {
                        await new Promise(resolve => setTimeout(resolve, 8));
                        yield {
                            type: 'error',
                            error: 'recoverable failure before timeout budget is exhausted',
                            recoverable: true,
                            code: 'ECONNRESET',
                        } as ProviderStreamEvent;
                        return;
                    }

                    agent.abortSignal?.addEventListener('abort', () => {
                        secondAttemptAborted = true;
                    });
                    await new Promise(() => undefined);
                }),
            } as any);

            const eventsPromise = collectEvents(
                ensembleRequest([{ type: 'message', role: 'user', content: 'Hello' } as any], {
                    model: 'test-model',
                    modelSettings: {
                        timeout_ms: 10,
                    },
                    retryOptions: {
                        maxRetries: 1,
                    },
                })
            );

            await vi.advanceTimersByTimeAsync(10);
            const events = await eventsPromise;

            const errorEvent = events.filter(event => event.type === 'error').at(-1) as any;
            const failedStatus = events.find(
                event => event.type === 'operation_status' && (event as any).status === 'failed'
            ) as any;

            expect(attempts).toBe(2);
            expect(secondAttemptAborted).toBe(true);
            expect(errorEvent?.error).toContain('timed out after');
            expect(failedStatus?.error).toContain('timed out after');
        } finally {
            vi.useRealTimers();
        }
    });

    it('does not retry request setup failures when recoverable is unspecified', async () => {
        const { getModelProvider } = await import('../model_providers/model_provider.js');
        let attempts = 0;

        vi.mocked(getModelProvider).mockImplementation(() => {
            attempts += 1;
            throw new Error('No valid provider found for the model missing-model');
        });

        const events = await collectEvents(
            ensembleRequest([{ type: 'message', role: 'user', content: 'Hello' } as any], {
                model: 'missing-model',
                retryOptions: {
                    maxRetries: 3,
                },
            })
        );

        const errorEvent = events.find(event => event.type === 'error') as any;
        const statuses = events.filter(event => event.type === 'operation_status') as any[];

        expect(attempts).toBe(1);
        expect(errorEvent?.recoverable).toBe(false);
        expect(statuses.map(event => event.status)).toEqual(['started', 'failed']);
    });

    it('emits a terminal failed request status when model selection throws before the round starts', async () => {
        const { getModelFromAgent } = await import('../model_providers/model_provider.js');

        vi.mocked(getModelFromAgent).mockRejectedValueOnce(
            new Error('No valid provider found for the model missing-model')
        );

        const events = await collectEvents(
            ensembleRequest([{ type: 'message', role: 'user', content: 'Hello' } as any], {
                modelClass: 'reasoning_mini',
            })
        );

        const statuses = events.filter(event => event.type === 'operation_status') as any[];
        const failedStatus = statuses.find(event => event.status === 'failed');
        const errorEvent = events.find(event => event.type === 'error') as any;

        expect(statuses.map(event => event.status)).toEqual(['started', 'failed']);
        expect(failedStatus?.request_id).toBeDefined();
        expect(failedStatus?.error).toContain('missing-model');
        expect(errorEvent?.request_id).toBe(failedStatus?.request_id);
        expect(errorEvent?.recoverable).toBe(false);
    });

    it('filters nested verifier request statuses and emits exactly one outer terminal status', async () => {
        const { getModelProvider } = await import('../model_providers/model_provider.js');
        let mainCalls = 0;
        let verifierCalls = 0;

        vi.mocked(getModelProvider).mockReturnValue({
            provider_id: 'verifier-provider',
            createResponseStream: vi.fn().mockImplementation(async function* (_messages, _model, agent) {
                if (agent.name === 'verifier') {
                    verifierCalls += 1;
                    yield {
                        type: 'message_complete',
                        message_id: `verifier-${verifierCalls}`,
                        content:
                            verifierCalls === 1 ? '{"status":"fail","reason":"Please retry"}' : '{"status":"pass"}',
                    } as ProviderStreamEvent;
                    return;
                }

                mainCalls += 1;
                yield {
                    type: 'message_complete',
                    message_id: `main-${mainCalls}`,
                    content: mainCalls === 1 ? 'First draft' : 'Second draft',
                } as ProviderStreamEvent;
            }),
        } as any);

        const events = await collectEvents(
            ensembleRequest([{ type: 'message', role: 'user', content: 'Hello' } as any], {
                model: 'test-model',
                verifier: {
                    model: 'test-model',
                    name: 'verifier',
                },
                maxVerificationAttempts: 2,
            })
        );

        const statuses = events.filter(event => event.type === 'operation_status') as any[];
        const terminalStatuses = statuses.filter(event => event.terminal === true);

        expect(mainCalls).toBe(2);
        expect(verifierCalls).toBe(2);
        expect(statuses.map(event => event.status)).toEqual(['started', 'completed']);
        expect(terminalStatuses).toHaveLength(1);
        expect(terminalStatuses[0]?.status).toBe('completed');
    });

    it('keeps error events and failed request status aligned on recoverability', async () => {
        const { getModelProvider } = await import('../model_providers/model_provider.js');

        vi.mocked(getModelProvider).mockReturnValue({
            provider_id: 'failure-provider',
            createResponseStream: vi.fn().mockImplementation(async function* () {
                yield {
                    type: 'error',
                    error: 'terminal provider failure',
                    recoverable: false,
                } as ProviderStreamEvent;
            }),
        } as any);

        const events = await collectEvents(
            ensembleRequest([{ type: 'message', role: 'user', content: 'Hello' } as any], { model: 'test-model' })
        );

        const errorEvent = events.find(event => event.type === 'error') as any;
        const failedStatus = events.find(
            event => event.type === 'operation_status' && (event as any).status === 'failed'
        ) as any;

        expect(errorEvent?.recoverable).toBe(false);
        expect(failedStatus?.recoverable).toBe(false);
        expect(failedStatus?.error).toBe(errorEvent?.error);
    });

    it('enforces strict structured-output exclusive bounds', async () => {
        const { getModelProvider } = await import('../model_providers/model_provider.js');

        vi.mocked(getModelProvider).mockReturnValue({
            provider_id: 'structured-provider',
            createResponseStream: vi.fn().mockImplementation(async function* () {
                yield {
                    type: 'message_complete',
                    message_id: 'msg-structured',
                    content: '{"score":1}',
                } as ProviderStreamEvent;
            }),
        } as any);

        const events = await collectEvents(
            ensembleRequest([{ type: 'message', role: 'user', content: 'Hello' } as any], {
                model: 'test-model',
                modelSettings: {
                    json_schema: {
                        name: 'score_result',
                        type: 'json_schema',
                        strict: true,
                        schema: {
                            type: 'object',
                            properties: {
                                score: {
                                    type: 'number',
                                    exclusiveMinimum: 1,
                                    exclusiveMaximum: 5,
                                },
                            },
                            required: ['score'],
                            additionalProperties: false,
                        },
                    },
                },
            })
        );

        const errorEvent = events.find(event => event.type === 'error') as any;
        const failedStatus = events.find(
            event => event.type === 'operation_status' && (event as any).status === 'failed'
        ) as any;

        expect(errorEvent?.error).toContain('must be > 1');
        expect(failedStatus?.error).toContain('must be > 1');
        expect(events.some(event => event.type === 'operation_status' && (event as any).status === 'completed')).toBe(
            false
        );
    });

    it('fails instead of completing when maxToolCalls blocks the requested tool', async () => {
        const { getModelProvider } = await import('../model_providers/model_provider.js');

        vi.mocked(getModelProvider).mockReturnValue({
            provider_id: 'tool-limit-provider',
            createResponseStream: vi.fn().mockImplementation(async function* () {
                yield {
                    type: 'tool_start',
                    tool_call: {
                        id: 'tool-over-budget',
                        call_id: 'call-over-budget',
                        type: 'function',
                        function: {
                            name: 'lookup_weather',
                            arguments: '{}',
                        },
                    },
                } as ProviderStreamEvent;
            }),
        } as any);

        const events = await collectEvents(
            ensembleRequest([{ type: 'message', role: 'user', content: 'Hello' } as any], {
                model: 'test-model',
                maxToolCalls: 0,
                tools: [
                    {
                        definition: {
                            type: 'function',
                            function: {
                                name: 'lookup_weather',
                                description: 'Lookup weather',
                                parameters: { type: 'object', properties: {}, required: [] },
                            },
                        },
                        function: vi.fn(async () => 'sunny'),
                    },
                ],
            })
        );

        const completedStatus = events.find(
            event => event.type === 'operation_status' && (event as any).status === 'completed'
        );
        const failedStatus = events.find(
            event => event.type === 'operation_status' && (event as any).status === 'failed'
        ) as any;
        const errorEvent = events.find(event => event.type === 'error') as any;

        expect(completedStatus).toBeUndefined();
        expect(failedStatus?.reason).toBe('max_tool_calls_reached');
        expect(failedStatus?.error).toContain('Tool call limit reached (0)');
        expect(errorEvent?.recoverable).toBe(false);
        expect(errorEvent?.error).toContain('Tool call limit reached (0)');
    });
});
