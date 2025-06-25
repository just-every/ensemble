import { describe, it, expect, beforeEach, vi, Mock } from 'vitest';
import {
    executeToolWithLifecycle,
    handleToolCall,
    timeoutPromise,
    agentHasStatusTracking,
    prepareToolArguments,
} from '../utils/tool_execution_manager.js';
import { runningToolTracker } from '../utils/running_tool_tracker.js';
import { ToolCall, ToolFunction, AgentDefinition } from '../types/types.js';

vi.mock('../utils/running_tool_tracker.js', () => ({
    runningToolTracker: {
        addRunningTool: vi.fn(),
        completeRunningTool: vi.fn(),
        failRunningTool: vi.fn(),
        markTimedOut: vi.fn(),
        getRunningTool: vi.fn(),
    },
}));

vi.mock('../utils/sequential_queue.js', () => ({
    runSequential: vi.fn((agentId, fn) => fn()),
}));

describe('Tool Execution Manager', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('timeoutPromise', () => {
        it('should resolve with TIMEOUT after specified time', async () => {
            const result = await timeoutPromise(50);
            expect(result).toBe('TIMEOUT');
        });
    });

    describe('agentHasStatusTracking', () => {
        it('should return true if agent has status tracking tools', () => {
            const agent: AgentDefinition = {
                tools: [
                    {
                        definition: {
                            type: 'function',
                            function: {
                                name: 'get_running_tools',
                                description: 'Get running tools',
                                parameters: {
                                    type: 'object',
                                    properties: {},
                                    required: [],
                                },
                            },
                        },
                        function: async () => 'result',
                    },
                ],
            };

            expect(agentHasStatusTracking(agent)).toBe(true);
        });

        it('should return false if agent has no status tracking tools', () => {
            const agent: AgentDefinition = {
                tools: [
                    {
                        definition: {
                            type: 'function',
                            function: {
                                name: 'other_tool',
                                description: 'Other tool',
                                parameters: {
                                    type: 'object',
                                    properties: {},
                                    required: [],
                                },
                            },
                        },
                        function: async () => 'result',
                    },
                ],
            };

            expect(agentHasStatusTracking(agent)).toBe(false);
        });

        it('should return false if agent has no tools', () => {
            const agent: AgentDefinition = {};
            expect(agentHasStatusTracking(agent)).toBe(false);
        });
    });

    describe('executeToolWithLifecycle', () => {
        const mockTool: ToolFunction = {
            definition: {
                type: 'function',
                function: {
                    name: 'test_tool',
                    description: 'Test tool',
                    parameters: {
                        type: 'object',
                        properties: {
                            param1: { type: 'string' },
                        },
                        required: ['param1'],
                    },
                },
            },
            function: vi.fn(async () => 'tool result'),
        };

        const mockToolCall: ToolCall = {
            id: 'test-id',
            type: 'function',
            function: {
                name: 'test_tool',
                arguments: '{"param1": "value1"}',
            },
        };

        const mockAgent: AgentDefinition = {
            agent_id: 'test-agent',
        };

        it('should execute tool successfully', async () => {
            const mockAbortController = new AbortController();
            (runningToolTracker.addRunningTool as Mock).mockReturnValue({
                abortController: mockAbortController,
            });

            const result = await executeToolWithLifecycle(mockToolCall, mockTool, mockAgent);

            expect(result).toBe('tool result');
            expect(runningToolTracker.addRunningTool).toHaveBeenCalledWith(
                'test-id',
                'test_tool',
                'test-agent',
                '{"param1": "value1"}'
            );
            expect(runningToolTracker.completeRunningTool).toHaveBeenCalledWith('test-id', 'tool result', mockAgent);
        });

        it('should handle tool execution failure', async () => {
            const mockError = new Error('Tool failed');
            const failingTool: ToolFunction = {
                ...mockTool,
                function: vi.fn(async () => {
                    throw mockError;
                }),
            };

            const mockAbortController = new AbortController();
            (runningToolTracker.addRunningTool as Mock).mockReturnValue({
                abortController: mockAbortController,
            });

            await expect(executeToolWithLifecycle(mockToolCall, failingTool, mockAgent)).rejects.toThrow('Tool failed');

            expect(runningToolTracker.failRunningTool).toHaveBeenCalledWith('test-id', 'Error: Tool failed', mockAgent);
        });
    });

    describe('handleToolCall', () => {
        const mockTool: ToolFunction = {
            definition: {
                type: 'function',
                function: {
                    name: 'test_tool',
                    description: 'Test tool',
                    parameters: {
                        type: 'object',
                        properties: {},
                        required: [],
                    },
                },
            },
            function: vi.fn(async () => 'tool result'),
        };

        const mockToolCall: ToolCall = {
            id: 'test-id',
            type: 'function',
            function: {
                name: 'test_tool',
                arguments: '{}',
            },
        };

        const mockAgent: AgentDefinition = {
            agent_id: 'test-agent',
        };

        beforeEach(() => {
            const mockAbortController = new AbortController();
            (runningToolTracker.addRunningTool as Mock).mockReturnValue({
                abortController: mockAbortController,
            });
            (runningToolTracker.getRunningTool as Mock).mockReturnValue({
                abortController: mockAbortController,
            });
        });

        it('should handle tool with timeout', async () => {
            const slowTool: ToolFunction = {
                ...mockTool,
                function: vi.fn(async () => {
                    await new Promise(resolve => setTimeout(resolve, 100));
                    return 'slow result';
                }),
            };

            const agentWithStatusTools: AgentDefinition = {
                ...mockAgent,
                tools: [
                    {
                        definition: {
                            type: 'function',
                            function: {
                                name: 'get_running_tools',
                                description: 'Get running tools',
                                parameters: {
                                    type: 'object',
                                    properties: {},
                                    required: [],
                                },
                            },
                        },
                        function: async () => 'result',
                    },
                ],
            };

            // Mock timeout to happen quickly
            vi.useFakeTimers();

            const resultPromise = handleToolCall(mockToolCall, slowTool, agentWithStatusTools);

            // Advance time to trigger timeout
            vi.advanceTimersByTime(30001);

            const result = await resultPromise;

            expect(result).toBe('Tool test_tool is running in the background (RunningTool: test-id).');
            expect(runningToolTracker.markTimedOut).toHaveBeenCalledWith('test-id');

            vi.useRealTimers();
        });

        it('should handle sequential execution', async () => {
            const sequentialAgent: AgentDefinition = {
                ...mockAgent,
                modelSettings: {
                    sequential_tools: true,
                },
            };

            const result = await handleToolCall(mockToolCall, mockTool, sequentialAgent);

            expect(result).toBe('tool result');
        });

        it('should handle wait_for_running_tool specially', async () => {
            const waitTool: ToolFunction = {
                definition: {
                    type: 'function',
                    function: {
                        name: 'wait_for_running_tool',
                        description: 'Wait for tool',
                        parameters: {
                            type: 'object',
                            properties: {},
                            required: [],
                        },
                    },
                },
                function: vi.fn(async () => 'wait result'),
            };

            const waitToolCall: ToolCall = {
                ...mockToolCall,
                function: {
                    name: 'wait_for_running_tool',
                    arguments: '{}',
                },
            };

            const result = await handleToolCall(waitToolCall, waitTool, mockAgent);

            expect(result).toBe('wait result');
        });
    });

    describe('prepareToolArguments', () => {
        const mockTool: ToolFunction = {
            definition: {
                type: 'function',
                function: {
                    name: 'test_tool',
                    description: 'Test tool',
                    parameters: {
                        type: 'object',
                        properties: {
                            param1: { type: 'string' },
                            param2: { type: 'number' },
                            param3: { type: 'boolean' },
                        },
                        required: ['param1', 'param2'],
                    },
                },
            },
            function: async () => 'result',
        };

        it('should parse and prepare named arguments', () => {
            const args = prepareToolArguments('{"param1": "value1", "param2": 42, "param3": true}', mockTool);

            expect(args).toEqual(['value1', 42, true]);
        });

        it('should filter out unknown parameters', () => {
            const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

            const args = prepareToolArguments('{"param1": "value1", "param2": 42, "unknown": "value"}', mockTool);

            expect(args).toEqual(['value1', 42, undefined]);
            expect(consoleSpy).toHaveBeenCalledWith('Removing unknown parameter "unknown" for tool "test_tool"');

            consoleSpy.mockRestore();
        });

        it('should handle empty arguments', () => {
            // Empty arguments for required parameters should throw
            expect(() => prepareToolArguments('', mockTool)).toThrow();
        });

        it('should handle invalid JSON', () => {
            expect(() => prepareToolArguments('invalid json', mockTool)).toThrow('Invalid JSON in tool arguments');
        });

        it('should handle positional arguments', () => {
            const args = prepareToolArguments('["value1", 42]', mockTool);
            expect(args).toEqual([['value1', 42]]);
        });
    });
});
