import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Agent } from '../utils/agent.js';
import { ensembleRequest, mergeHistoryThread } from '../core/ensemble_request.js';
import { convertStreamToMessages } from '../utils/stream_converter.js';
import type {
    ResponseInput,
    ToolCall,
    AgentDefinition,
    ProviderStreamEvent,
} from '../types/types.js';

// Mock the model provider
vi.mock('../model_providers/model_provider.js', () => ({
    getModelFromAgent: vi.fn().mockResolvedValue('test-model'),
    getModelProvider: vi.fn().mockReturnValue({
        createResponseStream: vi.fn(),
    }),
}));

describe('Agent Features', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('historyThread', () => {
        it('should use historyThread if provided', async () => {
            const { getModelProvider } = await import(
                '../model_providers/model_provider.js'
            );
            const mockProvider = {
                createResponseStream: vi.fn().mockImplementation(async function* () {
                    yield {
                        type: 'message_complete',
                        content: 'Response from thread',
                    };
                }),
            };
            (getModelProvider as any).mockReturnValue(mockProvider);

            const historyThread: ResponseInput = [
                { type: 'message', role: 'user', content: 'Thread message' },
            ];

            const agent = new Agent({
                name: 'test_agent',
                historyThread,
            });

            const messages: ResponseInput = [
                { type: 'message', role: 'user', content: 'Regular message' },
            ];

            const stream = ensembleRequest(messages, agent);
            const events: ProviderStreamEvent[] = [];
            for await (const event of stream) {
                events.push(event);
            }

            // Should use historyThread instead of messages
            expect(mockProvider.createResponseStream).toHaveBeenCalledWith(
                historyThread,
                'test-model',
                agent
            );
        });

        it('should merge history threads', () => {
            const mainHistory: ResponseInput = [
                { type: 'message', role: 'user', content: 'Message 1' },
                { type: 'message', role: 'assistant', content: 'Response 1' },
            ];

            const thread: ResponseInput = [
                { type: 'message', role: 'user', content: 'Message 1' },
                { type: 'message', role: 'assistant', content: 'Response 1' },
                { type: 'message', role: 'user', content: 'Thread message' },
                { type: 'message', role: 'assistant', content: 'Thread response' },
            ];

            mergeHistoryThread(mainHistory, thread, 2);

            expect(mainHistory).toHaveLength(4);
            expect(mainHistory[2]).toEqual({
                type: 'message',
                role: 'user',
                content: 'Thread message',
            });
            expect(mainHistory[3]).toEqual({
                type: 'message',
                role: 'assistant',
                content: 'Thread response',
            });
        });
    });

    describe('maxToolCalls', () => {
        it('should limit total tool calls', async () => {
            const { getModelProvider } = await import(
                '../model_providers/model_provider.js'
            );

            let callCount = 0;
            const mockProvider = {
                createResponseStream: vi.fn().mockImplementation(async function* () {
                    callCount++;
                    if (callCount === 1) {
                        // First round: 3 tool calls
                        yield {
                            type: 'tool_start',
                            tool_calls: [
                                {
                                    id: 'call1',
                                    type: 'function',
                                    function: { name: 'test_tool', arguments: '{}' },
                                },
                                {
                                    id: 'call2',
                                    type: 'function',
                                    function: { name: 'test_tool', arguments: '{}' },
                                },
                                {
                                    id: 'call3',
                                    type: 'function',
                                    function: { name: 'test_tool', arguments: '{}' },
                                },
                            ],
                        };
                    } else {
                        // Second round: Try 2 more tool calls
                        yield {
                            type: 'tool_start',
                            tool_calls: [
                                {
                                    id: 'call4',
                                    type: 'function',
                                    function: { name: 'test_tool', arguments: '{}' },
                                },
                                {
                                    id: 'call5',
                                    type: 'function',
                                    function: { name: 'test_tool', arguments: '{}' },
                                },
                            ],
                        };
                    }
                    yield { type: 'message_complete', content: 'Done' };
                }),
            };
            (getModelProvider as any).mockReturnValue(mockProvider);

            const toolCallsSeen: string[] = [];

            const agent = new Agent({
                name: 'test_agent',
                maxToolCalls: 4, // Limit to 4 calls
                tools: [
                    {
                        definition: {
                            type: 'function',
                            function: {
                                name: 'test_tool',
                                description: 'Test tool',
                                parameters: {},
                            },
                        },
                        function: async () => 'Tool result',
                    },
                ],
                onToolCall: async (toolCall: ToolCall) => {
                    toolCallsSeen.push(toolCall.id);
                },
            });

            const messages: ResponseInput = [
                { type: 'message', role: 'user', content: 'Test' },
            ];

            const stream = ensembleRequest(messages, agent);
            const events: ProviderStreamEvent[] = [];
            for await (const event of stream) {
                events.push(event);
            }

            // Should have processed only 4 tool calls (3 + 1)
            expect(toolCallsSeen).toHaveLength(4);
            expect(toolCallsSeen).toEqual(['call1', 'call2', 'call3', 'call4']);

            // Should have warning about limit
            const limitMessage = events.find(
                e =>
                    e.type === 'message_delta' &&
                    e.content?.includes('Total tool calls limit reached')
            );
            expect(limitMessage).toBeDefined();
        });
    });

    describe('maxToolCallRoundsPerTurn', () => {
        it('should limit tool call rounds', async () => {
            const { getModelProvider } = await import(
                '../model_providers/model_provider.js'
            );

            let callCount = 0;
            const mockProvider = {
                createResponseStream: vi.fn().mockImplementation(async function* () {
                    callCount++;
                    // Always return tool calls
                    yield {
                        type: 'tool_start',
                        tool_calls: [
                            {
                                id: `call${callCount}`,
                                type: 'function',
                                function: { name: 'test_tool', arguments: '{}' },
                            },
                        ],
                    };
                    yield { type: 'message_complete', content: `Round ${callCount}` };
                }),
            };
            (getModelProvider as any).mockReturnValue(mockProvider);

            const agent = new Agent({
                name: 'test_agent',
                maxToolCallRoundsPerTurn: 2, // Limit to 2 rounds
                tools: [
                    {
                        definition: {
                            type: 'function',
                            function: {
                                name: 'test_tool',
                                description: 'Test tool',
                                parameters: {},
                            },
                        },
                        function: async () => 'Tool result',
                    },
                ],
            });

            const messages: ResponseInput = [
                { type: 'message', role: 'user', content: 'Test' },
            ];

            const stream = ensembleRequest(messages, agent);
            const events: ProviderStreamEvent[] = [];
            for await (const event of stream) {
                events.push(event);
            }

            // Should have called createResponseStream exactly 2 times
            expect(mockProvider.createResponseStream).toHaveBeenCalledTimes(2);

            // Should have warning about rounds limit
            const limitMessage = events.find(
                e =>
                    e.type === 'message_delta' &&
                    e.content?.includes('Tool call rounds limit reached')
            );
            expect(limitMessage).toBeDefined();
        });
    });

    describe('verifier', () => {
        it('should verify output and retry on failure', async () => {
            const { getModelProvider } = await import(
                '../model_providers/model_provider.js'
            );

            let mainCallCount = 0;
            let verifierCallCount = 0;

            const mockProvider = {
                createResponseStream: vi.fn().mockImplementation(async function* (
                    messages: ResponseInput,
                    model: string,
                    agent: AgentDefinition
                ) {
                    if (agent.name === 'verifier_agent') {
                        verifierCallCount++;
                        if (verifierCallCount === 1) {
                            // First verification: fail
                            yield {
                                type: 'message_complete',
                                content: '{"status": "fail", "reason": "Missing details"}',
                            };
                        } else {
                            // Second verification: pass
                            yield {
                                type: 'message_complete',
                                content: '{"status": "pass"}',
                            };
                        }
                    } else {
                        mainCallCount++;
                        if (mainCallCount === 1) {
                            // First attempt
                            yield {
                                type: 'message_complete',
                                content: 'Incomplete response',
                            };
                        } else {
                            // Retry with better response
                            yield {
                                type: 'message_complete',
                                content: 'Complete response with all details',
                            };
                        }
                    }
                }),
            };
            (getModelProvider as any).mockReturnValue(mockProvider);

            const agent = new Agent({
                name: 'test_agent',
                verifier: {
                    name: 'verifier_agent',
                },
                maxVerificationAttempts: 2,
            });

            const messages: ResponseInput = [
                { type: 'message', role: 'user', content: 'Test' },
            ];

            const stream = ensembleRequest(messages, agent);
            const events: ProviderStreamEvent[] = [];
            for await (const event of stream) {
                events.push(event);
            }

            // Should have called main agent twice (initial + retry)
            expect(mainCallCount).toBe(2);

            // Should have called verifier twice
            expect(verifierCallCount).toBe(2);

            // Should have verification messages
            const failMessage = events.find(
                e =>
                    e.type === 'message_delta' &&
                    e.content?.includes('Verification failed: Missing details')
            );
            expect(failMessage).toBeDefined();

            const passMessage = events.find(
                e => e.type === 'message_delta' && e.content?.includes('✓ Output verified')
            );
            expect(passMessage).toBeDefined();
        });

        it('should handle max verification attempts', async () => {
            const { getModelProvider } = await import(
                '../model_providers/model_provider.js'
            );

            const mockProvider = {
                createResponseStream: vi.fn().mockImplementation(async function* (
                    messages: ResponseInput,
                    model: string,
                    agent: AgentDefinition
                ) {
                    if (agent.name === 'verifier_agent') {
                        // Always fail verification
                        yield {
                            type: 'message_complete',
                            content: '{"status": "fail", "reason": "Not good enough"}',
                        };
                    } else {
                        // Main agent response
                        yield {
                            type: 'message_complete',
                            content: 'Some response',
                        };
                    }
                }),
            };
            (getModelProvider as any).mockReturnValue(mockProvider);

            const agent = new Agent({
                name: 'test_agent',
                verifier: {
                    name: 'verifier_agent',
                },
                maxVerificationAttempts: 3,
            });

            const messages: ResponseInput = [
                { type: 'message', role: 'user', content: 'Test' },
            ];

            const stream = ensembleRequest(messages, agent);
            const events: ProviderStreamEvent[] = [];
            for await (const event of stream) {
                events.push(event);
            }

            // Should have failure message after max attempts
            const failureMessage = events.find(
                e =>
                    e.type === 'message_delta' &&
                    e.content?.includes('❌ Verification failed after 3 attempts')
            );
            expect(failureMessage).toBeDefined();
        });
    });
});