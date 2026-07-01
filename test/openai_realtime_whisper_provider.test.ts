import { EventEmitter } from 'events';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OpenAIProvider } from '../model_providers/openai.js';

const sockets: MockWebSocket[] = [];

class MockWebSocket extends EventEmitter {
    static OPEN = 1;
    static CLOSED = 3;
    readyState = 0;
    sent: string[] = [];

    constructor(
        public url: string,
        public options: { headers?: Record<string, string> }
    ) {
        super();
        sockets.push(this);
        queueMicrotask(() => {
            this.readyState = MockWebSocket.OPEN;
            this.emit('open');
            this.emit('message', JSON.stringify({ type: 'session.created' }));
        });
    }

    send(data: string) {
        this.sent.push(data);
        if (data.includes('session.update')) {
            queueMicrotask(() => {
                this.emit('message', JSON.stringify({ type: 'session.updated' }));
            });
        }
    }

    close() {
        if (this.readyState === MockWebSocket.CLOSED) return;
        this.readyState = MockWebSocket.CLOSED;
        this.emit('close');
    }
}

vi.mock('ws', () => ({
    WebSocket: MockWebSocket,
}));

describe('OpenAIProvider gpt-realtime-whisper transcription', () => {
    beforeEach(() => {
        sockets.length = 0;
        process.env.OPENAI_API_KEY = 'sk-test';
    });

    it('uses the GA realtime transcription session shape and commits audio manually', async () => {
        const provider = new OpenAIProvider();
        const events: any[] = [];
        const audio = new ReadableStream<Uint8Array>({
            start(controller) {
                controller.enqueue(new Uint8Array([1, 2, 3, 4]));
                controller.close();
            },
        });

        const collectEvents = (async () => {
            for await (const event of provider.createTranscription(
                audio,
                { agent_id: 'openai-realtime-whisper-test' } as any,
                'gpt-realtime-whisper',
                {
                    audioFormat: { sampleRate: 24000, channels: 1, encoding: 'pcm' },
                    language: 'en',
                    delay: 'low',
                    prompt: 'Customer support call.',
                }
            )) {
                events.push(event);
            }
        })();

        await vi.waitFor(() => {
            expect(sockets[0]).toBeDefined();
            expect(sockets[0].sent.some(data => data.includes('session.update'))).toBe(true);
        });

        const socket = sockets[0];
        expect(socket.url).toBe('wss://api.openai.com/v1/realtime?intent=transcription');
        expect(socket.options.headers?.Authorization).toBe('Bearer sk-test');
        expect(socket.options.headers?.['OpenAI-Beta']).toBeUndefined();
        expect(socket.sent.some(data => data.includes('transcription_session.update'))).toBe(false);

        const sessionUpdate = JSON.parse(socket.sent.find(data => data.includes('session.update')) || '{}');
        expect(sessionUpdate).toMatchObject({
            type: 'session.update',
            session: {
                type: 'transcription',
                audio: {
                    input: {
                        format: { type: 'audio/pcm', rate: 24000 },
                        transcription: {
                            model: 'gpt-realtime-whisper',
                            language: 'en',
                            delay: 'low',
                        },
                        turn_detection: null,
                    },
                },
            },
        });

        await vi.waitFor(() => {
            expect(socket.sent.some(data => data.includes('input_audio_buffer.append'))).toBe(true);
            expect(socket.sent.some(data => data.includes('input_audio_buffer.commit'))).toBe(true);
        });

        socket.emit(
            'message',
            JSON.stringify({
                type: 'conversation.item.input_audio_transcription.delta',
                delta: 'Hello',
            })
        );
        socket.emit(
            'message',
            JSON.stringify({
                type: 'conversation.item.input_audio_transcription.completed',
                transcript: 'Hello there.',
            })
        );

        await collectEvents;

        expect(events.some(event => event.type === 'transcription_turn_delta' && event.delta === 'Hello')).toBe(true);
        expect(
            events.some(event => event.type === 'transcription_turn_complete' && event.text === 'Hello there.')
        ).toBe(true);
        expect(events.at(-1)?.type).toBe('transcription_complete');
    });
});
