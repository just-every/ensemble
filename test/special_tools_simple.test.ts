import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ensembleRequest } from '../core/ensemble_request.js';
import { AgentDefinition, ProviderStreamEvent, ResponseInput } from '../types/types.js';
import { testProviderConfig, resetTestProviderConfig } from '../model_providers/test_provider.js';

describe('Special Tools (task_complete and task_fatal_error)', () => {
    beforeEach(() => {
        resetTestProviderConfig();
        testProviderConfig.streamingDelay = 1;
        testProviderConfig.chunkSize = 50;
    });

    afterEach(() => {
        resetTestProviderConfig();
    });

    it('should not trigger another round when task_complete is called', async () => {
        const messages: ResponseInput = [
            { type: 'message', role: 'user', content: 'Test task_complete', id: '1' },
        ];

        let regularToolCalled = false;
        let taskCompleteCalled = false;

        const agent: AgentDefinition = {
            model: 'test-model',
            tools: [
                {
                    definition: {
                        type: 'function' as const,
                        function: {
                            name: 'task_complete',
                            description: 'Marks the task as complete',
                            parameters: {
                                type: 'object',
                                properties: {
                                    message: { type: 'string' },
                                },
                                required: ['message'],
                            },
                        },
                    },
                    function: vi.fn(async () => {
                        taskCompleteCalled = true;
                        // After task_complete is called, configure provider to call regular_tool
                        testProviderConfig.toolName = 'regular_tool';
                        testProviderConfig.toolArguments = { input: 'test' };
                        return 'Task completed';
                    }),
                },
                {
                    definition: {
                        type: 'function' as const,
                        function: {
                            name: 'regular_tool',
                            description: 'A regular tool',
                            parameters: {
                                type: 'object',
                                properties: {
                                    input: { type: 'string' },
                                },
                                required: ['input'],
                            },
                        },
                    },
                    function: vi.fn(async () => {
                        regularToolCalled = true;
                        return 'Regular tool output';
                    }),
                },
            ],
            maxToolCallRoundsPerTurn: 10,
        };

        // Configure test provider to call task_complete
        testProviderConfig.simulateToolCall = true;
        testProviderConfig.toolName = 'task_complete';
        testProviderConfig.toolArguments = { message: 'Done' };

        const events: ProviderStreamEvent[] = [];
        for await (const event of ensembleRequest(messages, agent)) {
            events.push(event);
        }

        // Verify task_complete was called
        expect(taskCompleteCalled).toBe(true);

        // Verify regular_tool was NOT called (no second round)
        expect(regularToolCalled).toBe(false);

        // Verify we got the tool_done event for task_complete
        const toolDoneEvents = events.filter(e => e.type === 'tool_done');
        expect(toolDoneEvents).toHaveLength(1);
        expect(toolDoneEvents[0].tool_call?.function.name).toBe('task_complete');

        // Verify the task_complete output is NOT in response_output messages
        const responseOutputs = events.filter(e => e.type === 'response_output');
        const functionOutputs = responseOutputs.filter(
            e => e.message?.type === 'function_call_output'
        );
        expect(functionOutputs).toHaveLength(0);
    });

    it('should not trigger another round when task_fatal_error is called', async () => {
        const messages: ResponseInput = [
            { type: 'message', role: 'user', content: 'Test task_fatal_error', id: '1' },
        ];

        let regularToolCalled = false;
        let taskFatalErrorCalled = false;

        const agent: AgentDefinition = {
            model: 'test-model',
            tools: [
                {
                    definition: {
                        type: 'function' as const,
                        function: {
                            name: 'task_fatal_error',
                            description: 'Reports a fatal error',
                            parameters: {
                                type: 'object',
                                properties: {
                                    error: { type: 'string' },
                                },
                                required: ['error'],
                            },
                        },
                    },
                    function: vi.fn(async () => {
                        taskFatalErrorCalled = true;
                        // After task_fatal_error is called, configure provider to call regular_tool
                        testProviderConfig.toolName = 'regular_tool';
                        testProviderConfig.toolArguments = { input: 'test' };
                        return 'Fatal error reported';
                    }),
                },
                {
                    definition: {
                        type: 'function' as const,
                        function: {
                            name: 'regular_tool',
                            description: 'A regular tool',
                            parameters: {
                                type: 'object',
                                properties: {
                                    input: { type: 'string' },
                                },
                                required: ['input'],
                            },
                        },
                    },
                    function: vi.fn(async () => {
                        regularToolCalled = true;
                        return 'Regular tool output';
                    }),
                },
            ],
            maxToolCallRoundsPerTurn: 10,
        };

        // Configure test provider to call task_fatal_error
        testProviderConfig.simulateToolCall = true;
        testProviderConfig.toolName = 'task_fatal_error';
        testProviderConfig.toolArguments = { error: 'Critical failure' };

        const events: ProviderStreamEvent[] = [];
        for await (const event of ensembleRequest(messages, agent)) {
            events.push(event);
        }

        // Verify task_fatal_error was called
        expect(taskFatalErrorCalled).toBe(true);

        // Verify regular_tool was NOT called (no second round)
        expect(regularToolCalled).toBe(false);

        // Verify we got the tool_done event for task_fatal_error
        const toolDoneEvents = events.filter(e => e.type === 'tool_done');
        expect(toolDoneEvents).toHaveLength(1);
        expect(toolDoneEvents[0].tool_call?.function.name).toBe('task_fatal_error');

        // Verify the task_fatal_error output is NOT in response_output messages
        const responseOutputs = events.filter(e => e.type === 'response_output');
        const functionOutputs = responseOutputs.filter(
            e => e.message?.type === 'function_call_output'
        );
        expect(functionOutputs).toHaveLength(0);
    });
});