import { EventEmitter } from 'events';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AssemblyAIProvider } from '../model_providers/assemblyai.js';

const sockets: MockWebSocket[] = [];

class MockWebSocket extends EventEmitter {
    static OPEN = 1;
    static CLOSED = 3;
    readyState = 0;
    sent: unknown[] = [];

    constructor(
        public url: string,
        public options: { headers?: Record<string, string> }
    ) {
        super();
        sockets.push(this);
        queueMicrotask(() => {
            this.readyState = MockWebSocket.OPEN;
            this.emit('open');
        });
    }

    send(data: unknown, callback?: (error?: Error) => void) {
        this.sent.push(data);
        callback?.();
    }

    close() {
        if (this.readyState === MockWebSocket.CLOSED) return;
        this.readyState = MockWebSocket.CLOSED;
        this.emit('close', 1000, Buffer.from(''));
    }
}

vi.mock('ws', () => ({
    WebSocket: MockWebSocket,
}));

describe('AssemblyAIProvider', () => {
    beforeEach(() => {
        sockets.length = 0;
        process.env.ASSEMBLYAI_API_KEY = 'test-assemblyai-key';
    });

    it('streams u3-rt-pro audio over AssemblyAI v3 and maps turn events', async () => {
        const provider = new AssemblyAIProvider();
        const events: any[] = [];
        const audio = new Uint8Array(1600);

        const collectEvents = (async () => {
            const stream = provider.createTranscription(audio, { agent_id: 'assemblyai-test' } as any, 'u3-rt-pro', {
                audioFormat: { sampleRate: 16000, channels: 1, encoding: 'pcm' },
                prompt: 'Customer support call.',
                language: 'en',
                keytermsPrompt: ['AssemblyAI'],
                disableRealtimeThrottle: true,
            } as any);

            for await (const event of stream) {
                events.push(event);
            }
        })();

        await vi.waitFor(() => {
            expect(sockets[0]).toBeDefined();
            expect(sockets[0].listenerCount('message')).toBeGreaterThan(0);
        });
        const activeSocket = sockets[0];
        activeSocket.emit(
            'message',
            JSON.stringify({
                type: 'SpeechStarted',
                timestamp: 0,
                confidence: 0.9,
            })
        );
        activeSocket.emit(
            'message',
            JSON.stringify({
                type: 'Turn',
                turn_order: 0,
                transcript: 'Hello AssemblyAI.',
                end_of_turn: true,
                turn_is_formatted: true,
            })
        );
        await vi.waitFor(() =>
            expect(activeSocket.sent.some(data => typeof data === 'string' && data.includes('Terminate'))).toBe(true)
        );
        activeSocket.emit(
            'message',
            JSON.stringify({
                type: 'Termination',
                audio_duration_seconds: 1,
                session_duration_seconds: 1,
            })
        );
        activeSocket.close();

        await collectEvents;

        const socket = sockets[0];
        expect(socket.url).toContain('wss://streaming.assemblyai.com/v3/ws?');
        expect(socket.url).toContain('speech_model=u3-rt-pro');
        expect(socket.url).toContain('sample_rate=16000');
        expect(socket.url).toContain('prompt=Customer+support+call.');
        expect(socket.url).toContain('language_code=en');
        expect(socket.options.headers?.Authorization).toBe('test-assemblyai-key');
        expect(socket.sent.some(data => data instanceof Uint8Array)).toBe(true);
        expect(socket.sent.some(data => typeof data === 'string' && data.includes('Terminate'))).toBe(true);
        expect(events.map(event => event.type)).toEqual([
            'transcription_turn_start',
            'transcription_turn_delta',
            'transcription_turn_complete',
        ]);
        expect(events[1].delta).toBe('Hello AssemblyAI.');
        expect(events[2].text).toBe('Hello AssemblyAI.');
    });
});
