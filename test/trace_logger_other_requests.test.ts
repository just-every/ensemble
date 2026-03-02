import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ensembleEmbed } from '../core/ensemble_embed.js';
import { ensembleListen } from '../core/ensemble_listen.js';
import { ensembleLive } from '../core/ensemble_live.js';
import { ensembleVoice } from '../core/ensemble_voice.js';
import { setEnsembleTraceLogger } from '../utils/trace_logger.js';
import { AgentDefinition, EnsembleTraceEvent, LiveConfig } from '../types/types.js';

vi.mock('../model_providers/model_provider.js', () => ({
    getModelFromAgent: vi.fn(),
    getModelProvider: vi.fn(),
}));

vi.mock('../utils/event_controller.js', () => ({
    emitEvent: vi.fn(),
}));

describe('Trace Logger - Other Requests', () => {
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
    });

    it('should emit trace lifecycle for ensembleEmbed', async () => {
        const { getModelProvider } = await import('../model_providers/model_provider.js');
        vi.mocked(getModelProvider).mockReturnValue({
            provider_id: 'test-provider',
            createEmbedding: vi.fn().mockResolvedValue([0.1, 0.2, 0.3]),
        } as any);

        const agent: AgentDefinition = {
            agent_id: 'embed-agent',
            model: 'text-embedding-3-small',
        };

        const result = await ensembleEmbed('trace this embedding', agent);
        expect(result).toHaveLength(3);

        const types = traceEvents.map(event => event.type);
        expect(types).toEqual(['turn_start', 'request_start', 'request_end', 'turn_end']);
        expect(traceEvents.find(event => event.type === 'request_end')?.data?.status).toBe('completed');
        expect(traceEvents.every(event => event.agent_id === 'embed-agent')).toBe(true);
    });

    it('should emit trace lifecycle for ensembleListen', async () => {
        const { getModelFromAgent, getModelProvider } = await import('../model_providers/model_provider.js');
        vi.mocked(getModelFromAgent).mockResolvedValue('test-transcription-model');
        vi.mocked(getModelProvider).mockReturnValue({
            provider_id: 'test-provider',
            createTranscription: vi.fn().mockImplementation(async function* () {
                yield { type: 'transcription_turn_delta', timestamp: new Date().toISOString(), delta: 'hello' };
                yield { type: 'transcription_turn_complete', timestamp: new Date().toISOString(), turnId: 'turn-1' };
            }),
        } as any);

        const agent: AgentDefinition = {
            agent_id: 'listen-agent',
            model: 'test-transcription-model',
        };

        for await (const _event of ensembleListen(new Uint8Array([1, 2, 3]), agent)) {
            // consume stream
        }

        const types = traceEvents.map(event => event.type);
        expect(types).toEqual(['turn_start', 'request_start', 'request_end', 'turn_end']);
        expect(traceEvents.find(event => event.type === 'request_end')?.data?.status).toBe('completed');
        expect(traceEvents.find(event => event.type === 'request_end')?.data?.final_response).toBe('hello');
        expect(traceEvents.every(event => event.agent_id === 'listen-agent')).toBe(true);
    });

    it('should emit trace lifecycle for ensembleVoice', async () => {
        const { getModelFromAgent, getModelProvider } = await import('../model_providers/model_provider.js');
        vi.mocked(getModelFromAgent).mockResolvedValue('test-voice-model');
        vi.mocked(getModelProvider).mockReturnValue({
            provider_id: 'test-provider',
            createVoice: vi.fn().mockResolvedValue(
                new ReadableStream<Uint8Array>({
                    start(controller) {
                        controller.enqueue(new Uint8Array([1, 2, 3, 4]));
                        controller.close();
                    },
                })
            ),
        } as any);

        const agent: AgentDefinition = {
            agent_id: 'voice-agent',
            model: 'test-voice-model',
        };

        for await (const _event of ensembleVoice('hello voice', agent)) {
            // consume stream
        }

        const types = traceEvents.map(event => event.type);
        expect(types).toEqual(['turn_start', 'request_start', 'request_end', 'turn_end']);
        expect(traceEvents.find(event => event.type === 'request_end')?.data?.status).toBe('completed');
        expect(traceEvents.every(event => event.agent_id === 'voice-agent')).toBe(true);
    });

    it('should emit trace lifecycle for ensembleLive', async () => {
        const { getModelFromAgent, getModelProvider } = await import('../model_providers/model_provider.js');
        vi.mocked(getModelFromAgent).mockResolvedValue('test-live-model');
        vi.mocked(getModelProvider).mockReturnValue({
            provider_id: 'test-provider',
            createLiveSession: vi.fn().mockResolvedValue({
                sessionId: 'live-session-1',
                isActive: vi.fn(() => true),
                sendText: vi.fn(),
                sendAudio: vi.fn(),
                sendToolResponse: vi.fn(),
                close: vi.fn(),
                getEventStream: vi.fn(async function* () {
                    yield {
                        type: 'live_ready',
                        timestamp: new Date().toISOString(),
                        sessionId: 'live-session-1',
                    };
                }),
            }),
        } as any);

        const agent: AgentDefinition = {
            agent_id: 'live-agent',
            model: 'test-live-model',
        };
        const config: LiveConfig = { responseModalities: ['TEXT'] };

        for await (const _event of ensembleLive(config, agent)) {
            // consume stream
        }

        const types = traceEvents.map(event => event.type);
        expect(types).toEqual(['turn_start', 'request_start', 'request_end', 'turn_end']);
        expect(traceEvents.find(event => event.type === 'request_end')?.data?.status).toBe('completed');
        expect(traceEvents.every(event => event.agent_id === 'live-agent')).toBe(true);
    });
});
