import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ensembleRequest } from '../core/ensemble_request.js';
import { ResponseInput, ProviderStreamEvent, AgentDefinition } from '../types/types.js';
import { setEnsembleLogger, log_llm_request } from '../utils/llm_logger.js';

// Mock the model provider module
vi.mock('../model_providers/model_provider.js', () => ({
    getModelFromAgent: vi.fn().mockResolvedValue('test-model'),
    getModelProvider: vi.fn(),
}));

// Create a provider that logs requests
const createMockProvider = (
    customStream?: (messages: any, model: any, agent: any, requestId?: string) => AsyncGenerator<ProviderStreamEvent>
) => {
    return {
        createResponseStream: vi.fn().mockImplementation(async function* (messages, model, agent, requestId) {
            // Log the request like real providers do
            log_llm_request(
                agent.agent_id || 'test-agent',
                'test-provider',
                model,
                { messages },
                new Date(),
                requestId
            );

            if (customStream) {
                yield* customStream(messages, model, agent, requestId);
            } else {
                yield { type: 'message_start', message_id: 'msg-1' };
                yield { type: 'message_delta', content: 'Test response', message_id: 'msg-1' };
                yield { type: 'message_complete', content: 'Test response', message_id: 'msg-1' };
            }
        }),
    };
};

describe('Request ID Persistence', () => {
    let capturedEvents: ProviderStreamEvent[] = [];
    let capturedLogs: { type: string; requestId?: string; data: any }[] = [];

    beforeEach(async () => {
        vi.clearAllMocks();
        capturedEvents = [];
        capturedLogs = [];

        // Set up default mock provider
        const { getModelProvider } = await import('../model_providers/model_provider.js');
        vi.mocked(getModelProvider).mockReturnValue(createMockProvider());

        // Set up a logger to capture log_llm_request calls
        setEnsembleLogger({
            log_llm_request: (agentId, providerName, model, requestData, timestamp, requestId) => {
                capturedLogs.push({
                    type: 'llm_request',
                    requestId,
                    data: { agentId, providerName, model },
                });
                return requestId || 'generated-id';
            },
            log_llm_response: (requestId, responseData) => {
                capturedLogs.push({
                    type: 'llm_response',
                    requestId,
                    data: responseData,
                });
            },
            log_llm_error: (requestId, errorData) => {
                capturedLogs.push({
                    type: 'llm_error',
                    requestId,
                    data: errorData,
                });
            },
        });
    });

    it('should use the same request_id throughout a single request', async () => {
        const messages: ResponseInput = [{ type: 'message', role: 'user', content: 'Hello' }];

        const agent: AgentDefinition = {
            agent_id: 'test-agent',
            model: 'test-model',
        };

        // Collect all events
        for await (const event of ensembleRequest(messages, agent)) {
            capturedEvents.push(event);
        }

        // Find agent_start and agent_done events
        const agentStartEvent = capturedEvents.find(e => e.type === 'agent_start');
        const agentDoneEvent = capturedEvents.find(e => e.type === 'agent_done');

        expect(agentStartEvent).toBeDefined();
        expect(agentDoneEvent).toBeDefined();

        // Extract request_id from agent_start
        const requestId = (agentStartEvent as any).request_id;
        expect(requestId).toBeDefined();
        expect(requestId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i); // UUID format

        // Check that agent_done has the same request_id
        expect((agentDoneEvent as any).request_id).toBe(requestId);

        // Check that all events with request_id have the same one
        const eventsWithRequestId = capturedEvents.filter(e => 'request_id' in e);
        eventsWithRequestId.forEach(event => {
            expect((event as any).request_id).toBe(requestId);
        });

        // Check that log_llm_request was called with the same request_id
        const llmRequestLog = capturedLogs.find(log => log.type === 'llm_request');
        expect(llmRequestLog).toBeDefined();
        expect(llmRequestLog?.requestId).toBe(requestId);
    });

    it('should propagate request_id through provider events', async () => {
        const messages: ResponseInput = [{ type: 'message', role: 'user', content: 'Test message' }];

        const agent: AgentDefinition = {
            agent_id: 'test-agent',
            model: 'test-model',
        };

        // Mock the provider to emit various event types
        const { getModelProvider } = await import('../model_providers/model_provider.js');
        const mockProvider = createMockProvider(async function* (messages, model, agent, requestId) {
            // Provider should receive the request_id
            expect(requestId).toBeDefined();
            expect(requestId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);

            yield { type: 'message_start', message_id: 'msg-1' };
            yield { type: 'message_delta', content: 'Hello', message_id: 'msg-1' };
            yield { type: 'message_complete', content: 'Hello', message_id: 'msg-1' };
        });
        vi.mocked(getModelProvider).mockReturnValue(mockProvider);

        // Collect events
        for await (const event of ensembleRequest(messages, agent)) {
            capturedEvents.push(event);
        }

        // Get request_id from agent_start
        const agentStartEvent = capturedEvents.find(e => e.type === 'agent_start');
        const requestId = (agentStartEvent as any).request_id;

        // All provider events should have the same request_id added
        const providerEvents = capturedEvents.filter(e =>
            ['message_start', 'message_delta', 'message_complete'].includes(e.type)
        );

        providerEvents.forEach(event => {
            expect((event as any).request_id).toBe(requestId);
        });
    });

    it('should handle tool calls with consistent request_id', async () => {
        const messages: ResponseInput = [{ type: 'message', role: 'user', content: 'Call a tool' }];

        const mockTool = vi.fn().mockResolvedValue('Tool result');

        const agent: AgentDefinition = {
            agent_id: 'test-agent',
            model: 'test-model',
            tools: [
                {
                    definition: {
                        type: 'function',
                        function: {
                            name: 'test_tool',
                            description: 'Test tool',
                            parameters: { type: 'object', properties: {} },
                        },
                    },
                    function: mockTool,
                },
            ],
        };

        // Mock provider to emit tool calls
        const { getModelProvider } = await import('../model_providers/model_provider.js');
        const mockProvider = createMockProvider(async function* () {
            yield {
                type: 'tool_start',
                tool_call: {
                    id: 'call-1',
                    type: 'function',
                    function: { name: 'test_tool', arguments: '{}' },
                },
            };
            yield { type: 'message_complete', content: '', message_id: 'msg-1' };
        });
        vi.mocked(getModelProvider).mockReturnValue(mockProvider);

        // Collect events
        for await (const event of ensembleRequest(messages, agent)) {
            capturedEvents.push(event);
        }

        const requestId = (capturedEvents.find(e => e.type === 'agent_start') as any).request_id;

        // Check tool-related events
        const toolStartEvent = capturedEvents.find(e => e.type === 'tool_start');
        const toolDoneEvent = capturedEvents.find(e => e.type === 'tool_done');

        expect((toolStartEvent as any).request_id).toBe(requestId);
        expect(toolDoneEvent).toBeDefined();
        if (toolDoneEvent) {
            expect((toolDoneEvent as any).request_id).toBe(requestId);
        }
    });

    it('should maintain unique request_ids for concurrent requests', async () => {
        const messages: ResponseInput = [{ type: 'message', role: 'user', content: 'Request' }];

        const agent: AgentDefinition = {
            agent_id: 'test-agent',
            model: 'test-model',
        };

        // Start two concurrent requests
        const request1Events: ProviderStreamEvent[] = [];
        const request2Events: ProviderStreamEvent[] = [];

        const [events1, events2] = await Promise.all([
            (async () => {
                const events = [];
                for await (const event of ensembleRequest(messages, agent)) {
                    events.push(event);
                }
                return events;
            })(),
            (async () => {
                const events = [];
                for await (const event of ensembleRequest(messages, agent)) {
                    events.push(event);
                }
                return events;
            })(),
        ]);

        request1Events.push(...events1);
        request2Events.push(...events2);

        // Get request_ids
        const requestId1 = (request1Events.find(e => e.type === 'agent_start') as any).request_id;
        const requestId2 = (request2Events.find(e => e.type === 'agent_start') as any).request_id;

        // Request IDs should be unique
        expect(requestId1).not.toBe(requestId2);

        // Each request should maintain its own request_id consistently
        request1Events
            .filter(e => 'request_id' in e)
            .forEach(event => {
                expect((event as any).request_id).toBe(requestId1);
            });

        request2Events
            .filter(e => 'request_id' in e)
            .forEach(event => {
                expect((event as any).request_id).toBe(requestId2);
            });
    });

    it('should handle provider errors while maintaining request_id', async () => {
        const messages: ResponseInput = [{ type: 'message', role: 'user', content: 'Cause an error' }];

        const agent: AgentDefinition = {
            agent_id: 'test-agent',
            model: 'test-model',
        };

        // Mock provider to emit an error event (not throw)
        const { getModelProvider } = await import('../model_providers/model_provider.js');
        const mockProvider = createMockProvider(async function* () {
            yield { type: 'message_start', message_id: 'msg-1' };
            yield { type: 'error', error: 'Provider error' };
            yield { type: 'message_complete', content: 'Error handled', message_id: 'msg-1' };
        });
        vi.mocked(getModelProvider).mockReturnValue(mockProvider);

        // Collect events
        for await (const event of ensembleRequest(messages, agent)) {
            capturedEvents.push(event);
        }

        const requestId = (capturedEvents.find(e => e.type === 'agent_start') as any).request_id;

        // Error event should have the same request_id
        const errorEvent = capturedEvents.find(e => e.type === 'error');
        expect(errorEvent).toBeDefined();
        expect((errorEvent as any).request_id).toBe(requestId);

        // agent_done should still be emitted with the same request_id
        const agentDoneEvent = capturedEvents.find(e => e.type === 'agent_done');
        expect(agentDoneEvent).toBeDefined();
        expect((agentDoneEvent as any).request_id).toBe(requestId);

        // Note: log_llm_error would only be called if the provider implementation handles it
        // In this test, we're just verifying that error events get request_id
    });

    it('should handle multiple rounds with different request_ids per round', async () => {
        const messages: ResponseInput = [{ type: 'message', role: 'user', content: 'Multi-round request' }];

        const mockTool = vi.fn().mockResolvedValueOnce('First tool result').mockResolvedValueOnce('Second tool result');

        const agent: AgentDefinition = {
            agent_id: 'test-agent',
            model: 'test-model',
            tools: [
                {
                    definition: {
                        type: 'function',
                        function: {
                            name: 'test_tool',
                            description: 'Test tool',
                            parameters: { type: 'object', properties: {} },
                        },
                    },
                    function: mockTool,
                },
            ],
        };

        // Mock provider for multiple rounds
        const { getModelProvider } = await import('../model_providers/model_provider.js');
        let callCount = 0;
        const mockProvider = createMockProvider(async function* (messages, model, agent, requestId) {
            callCount++;

            // Each round gets its own unique request_id
            expect(requestId).toBeDefined();
            expect(requestId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);

            if (callCount === 1) {
                // First round: emit tool call
                yield {
                    type: 'tool_start',
                    tool_call: {
                        id: 'call-1',
                        type: 'function',
                        function: { name: 'test_tool', arguments: '{}' },
                    },
                };
            } else if (callCount === 2) {
                // Second round: emit another tool call
                yield {
                    type: 'tool_start',
                    tool_call: {
                        id: 'call-2',
                        type: 'function',
                        function: { name: 'test_tool', arguments: '{}' },
                    },
                };
            } else {
                // Final round: just complete
                yield { type: 'message_complete', content: 'Done', message_id: 'msg-final' };
            }
            yield { type: 'message_complete', content: '', message_id: `msg-${callCount}` };
        });
        vi.mocked(getModelProvider).mockReturnValue(mockProvider);

        // Collect events
        for await (const event of ensembleRequest(messages, agent)) {
            capturedEvents.push(event);
        }

        // Each round gets its own request_id
        const agentStartEvents = capturedEvents.filter(e => e.type === 'agent_start');
        const agentDoneEvents = capturedEvents.filter(e => e.type === 'agent_done');

        // Should have multiple rounds
        expect(agentStartEvents.length).toBeGreaterThanOrEqual(2);
        expect(agentDoneEvents.length).toBe(agentStartEvents.length);

        // Each round should have matching agent_start and agent_done request_ids
        for (let i = 0; i < agentStartEvents.length; i++) {
            const startRequestId = (agentStartEvents[i] as any).request_id;
            const doneRequestId = (agentDoneEvents[i] as any).request_id;
            expect(startRequestId).toBeDefined();
            expect(doneRequestId).toBe(startRequestId);
        }

        // All events within a round should have consistent request_id
        const llmRequests = capturedLogs.filter(log => log.type === 'llm_request');
        expect(llmRequests.length).toBeGreaterThanOrEqual(3); // At least three rounds

        // Each LLM request should have a valid request_id
        llmRequests.forEach(log => {
            expect(log.requestId).toBeDefined();
            expect(log.requestId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
        });

        // Verify that we had multiple unique request_ids
        const uniqueRequestIds = new Set(llmRequests.map(log => log.requestId));
        expect(uniqueRequestIds.size).toBeGreaterThanOrEqual(3);
    });
});
