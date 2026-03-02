import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ensembleImage } from '../core/ensemble_image.js';
import { setEnsembleTraceLogger } from '../utils/trace_logger.js';
import { AgentDefinition, EnsembleTraceEvent, ProviderStreamEvent } from '../types/types.js';

vi.mock('../model_providers/model_provider.js', () => ({
    getModelFromAgent: vi.fn().mockResolvedValue('test-image-model'),
    getModelProvider: vi.fn(),
}));

describe('Trace Logger - Image', () => {
    const traceEvents: EnsembleTraceEvent[] = [];

    beforeEach(() => {
        vi.clearAllMocks();
        traceEvents.length = 0;
        setEnsembleTraceLogger(null);
        setEnsembleTraceLogger({
            log_trace_event: (event: EnsembleTraceEvent) => {
                traceEvents.push(event);
            },
        });
    });

    it('should emit turn/request trace events for non-stream image requests', async () => {
        const { getModelProvider } = await import('../model_providers/model_provider.js');
        const provider = {
            provider_id: 'test-image-provider',
            createImage: vi.fn().mockResolvedValue(['data:image/png;base64,abc123']),
        };
        vi.mocked(getModelProvider).mockReturnValue(provider as any);

        const agent: AgentDefinition = {
            agent_id: 'image-agent',
            model: 'test-image-model',
        };

        const images = (await ensembleImage('Draw a bird', agent, {})) as string[];
        expect(images).toHaveLength(1);

        const types = traceEvents.map(event => event.type);
        expect(types).toEqual(['turn_start', 'request_start', 'request_end', 'turn_end']);

        const requestStart = traceEvents.find(event => event.type === 'request_start');
        expect(requestStart?.data?.payload).toBeDefined();
        expect((requestStart?.data?.payload as any)?.prompt).toBe('Draw a bird');

        const requestEnd = traceEvents.find(event => event.type === 'request_end');
        expect(requestEnd?.data?.status).toBe('completed');
        expect(requestEnd?.data?.image_count).toBe(1);

        const turnEnd = traceEvents.find(event => event.type === 'turn_end');
        expect(turnEnd?.data?.status).toBe('completed');
        expect(turnEnd?.data?.request_count).toBe(1);
        expect(traceEvents.every(event => event.agent_id === 'image-agent')).toBe(true);
    });

    it('should use the same request_id for stream image trace events', async () => {
        const { getModelProvider } = await import('../model_providers/model_provider.js');
        const provider = {
            provider_id: 'test-image-provider',
            createImage: vi.fn().mockResolvedValue(['https://example.com/test.png']),
        };
        vi.mocked(getModelProvider).mockReturnValue(provider as any);

        const agent: AgentDefinition = {
            agent_id: 'image-agent',
            model: 'test-image-model',
        };

        const stream = ensembleImage('Draw a lighthouse', agent, {
            stream: true,
            request_id: 'image-request-1',
        }) as AsyncGenerator<ProviderStreamEvent>;

        for await (const _event of stream) {
            // consume stream
        }

        const requestStart = traceEvents.find(event => event.type === 'request_start');
        const requestEnd = traceEvents.find(event => event.type === 'request_end');
        expect(requestStart?.request_id).toBe('image-request-1');
        expect(requestEnd?.request_id).toBe('image-request-1');
        expect(requestEnd?.data?.status).toBe('completed');
        expect(traceEvents.every(event => event.agent_id === 'image-agent')).toBe(true);
    });
});
