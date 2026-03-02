import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ensembleRequest } from '../core/ensemble_request.js';
import { setEnsembleTraceLogger } from '../utils/trace_logger.js';
import { AgentDefinition, EnsembleTraceEvent, ProviderStreamEvent, ResponseInput } from '../types/types.js';

vi.mock('../model_providers/model_provider.js', () => ({
    getModelFromAgent: vi.fn().mockResolvedValue('test-model'),
    getModelProvider: vi.fn(),
}));

const createMockProvider = (
    customStream?: (messages: any, model: any, agent: any, requestId?: string) => AsyncGenerator<ProviderStreamEvent>
) => ({
    provider_id: 'test-provider',
    createResponseStream: vi.fn().mockImplementation(async function* (messages, model, agent, requestId) {
        if (customStream) {
            yield* customStream(messages, model, agent, requestId);
            return;
        }

        yield { type: 'message_start', message_id: 'msg-1' };
        yield { type: 'message_delta', content: 'Hello', message_id: 'msg-1' };
        yield { type: 'message_complete', content: 'Hello', message_id: 'msg-1' };
    }),
});

describe('Trace Logger', () => {
    const traceEvents: EnsembleTraceEvent[] = [];

    beforeEach(async () => {
        vi.clearAllMocks();
        traceEvents.length = 0;
        setEnsembleTraceLogger(null);
        setEnsembleTraceLogger({
            log_trace_event: (event: EnsembleTraceEvent) => {
                traceEvents.push(event);
            },
        });

        const { getModelProvider } = await import('../model_providers/model_provider.js');
        vi.mocked(getModelProvider).mockReturnValue(createMockProvider() as any);
    });

    it('should emit turn and request events with request payload', async () => {
        const messages: ResponseInput = [{ type: 'message', role: 'user', content: 'Hello trace logging' }];
        const agent: AgentDefinition = {
            agent_id: 'trace-agent',
            model: 'test-model',
        };

        for await (const _event of ensembleRequest(messages, agent)) {
            // consume stream
        }

        const eventTypes = traceEvents.map(event => event.type);
        expect(eventTypes).toContain('turn_start');
        expect(eventTypes).toContain('request_start');
        expect(eventTypes).toContain('request_end');
        expect(eventTypes).toContain('turn_end');
        expect(eventTypes).not.toContain('message_delta');

        const requestStart = traceEvents.find(event => event.type === 'request_start');
        expect(requestStart).toBeDefined();
        expect(requestStart?.data?.payload).toBeDefined();

        const requestEnd = traceEvents.find(event => event.type === 'request_end');
        expect(requestEnd?.data?.status).toBe('completed');
        expect(requestEnd?.data?.final_response).toBe('Hello');

        // Sequence numbers should be increasing within a turn.
        const sequences = traceEvents.map(event => event.sequence);
        for (let i = 1; i < sequences.length; i++) {
            expect(sequences[i]).toBeGreaterThan(sequences[i - 1]);
        }

        // All events should be tied to a single turn.
        const turnIds = new Set(traceEvents.map(event => event.turn_id));
        expect(turnIds.size).toBe(1);

        // Agent id should be present on all trace events.
        expect(traceEvents.every(event => event.agent_id === 'trace-agent')).toBe(true);
    });

    it('should emit tool lifecycle events and request follow-up status', async () => {
        const messages: ResponseInput = [{ type: 'message', role: 'user', content: 'Call a tool then finish' }];
        const tool = vi.fn().mockResolvedValue('Tool output');

        const agent: AgentDefinition = {
            agent_id: 'trace-agent',
            model: 'test-model',
            tools: [
                {
                    definition: {
                        type: 'function',
                        function: {
                            name: 'test_tool',
                            description: 'Test tool',
                            parameters: { type: 'object', properties: {}, required: [] },
                        },
                    },
                    function: tool,
                },
            ],
        };

        const { getModelProvider } = await import('../model_providers/model_provider.js');
        let callCount = 0;
        vi.mocked(getModelProvider).mockReturnValue(
            createMockProvider(async function* () {
                callCount += 1;
                if (callCount === 1) {
                    yield {
                        type: 'tool_start',
                        tool_call: {
                            id: 'tool-call-1',
                            type: 'function',
                            function: { name: 'test_tool', arguments: '{}' },
                        },
                    };
                    yield { type: 'message_complete', content: '', message_id: 'msg-1' };
                    return;
                }

                yield { type: 'message_complete', content: 'Final answer', message_id: 'msg-2' };
            }) as any
        );

        for await (const _event of ensembleRequest(messages, agent)) {
            // consume stream
        }

        expect(callCount).toBe(2);

        const requestStarts = traceEvents.filter(event => event.type === 'request_start');
        const requestEnds = traceEvents.filter(event => event.type === 'request_end');
        const toolStarts = traceEvents.filter(event => event.type === 'tool_start');
        const toolDones = traceEvents.filter(event => event.type === 'tool_done');

        expect(requestStarts.length).toBe(2);
        expect(requestEnds.length).toBe(2);
        expect(toolStarts.length).toBe(1);
        expect(toolDones.length).toBe(1);

        expect(requestEnds[0].data?.status).toBe('waiting_for_followup_request');
        expect(requestEnds[1].data?.status).toBe('completed');
        expect(requestEnds[1].data?.final_response).toBe('Final answer');

        // Tool events should be associated with the first request.
        expect(toolStarts[0].request_id).toBe(requestStarts[0].request_id);
        expect(toolDones[0].request_id).toBe(requestStarts[0].request_id);
        expect(traceEvents.every(event => event.agent_id === 'trace-agent')).toBe(true);
    });
});
