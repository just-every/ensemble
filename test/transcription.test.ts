import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ensembleListen } from '../core/ensemble_listen.js';
import type { TranscriptionEvent } from '../types/types.js';

// Mock the model provider
vi.mock('../model_providers/model_provider.js', () => ({
    getModelProvider: vi.fn((model: string) => {
        if (model === 'gpt-4o-transcribe' || model === 'gpt-4o-mini-transcribe' || model === 'whisper-1') {
            // OpenAI transcription mock
            return {
                createTranscription: vi.fn().mockImplementation(async function* () {
                    // Emit speech started
                    yield {
                        type: 'transcription_preview',
                        timestamp: new Date().toISOString(),
                        text: '',
                        isFinal: false,
                    };

                    if (model === 'whisper-1') {
                        // Whisper sends complete transcription at once
                        yield {
                            type: 'transcription_delta',
                            timestamp: new Date().toISOString(),
                            delta: 'Complete whisper transcription.',
                            partial: false,
                        };
                    } else {
                        // GPT-4o models stream incrementally
                        yield {
                            type: 'transcription_delta',
                            timestamp: new Date().toISOString(),
                            delta: 'Hello, ',
                            partial: true,
                        };

                        yield {
                            type: 'transcription_delta',
                            timestamp: new Date().toISOString(),
                            delta: 'streaming from GPT-4o.',
                            partial: true,
                        };
                    }

                    // Emit turn complete
                    yield {
                        type: 'transcription_turn',
                        timestamp: new Date().toISOString(),
                        text:
                            model === 'whisper-1' ? 'Complete whisper transcription.' : 'Hello, streaming from GPT-4o.',
                    };

                    // Emit completion
                    yield {
                        type: 'transcription_complete',
                        timestamp: new Date().toISOString(),
                    };
                }),
            };
        } else {
            // Gemini transcription mock (default)
            return {
                createTranscription: vi.fn().mockImplementation(async function* () {
                    // Don't emit start event - ensembleListen handles that
                    // Emit some transcript deltas
                    yield {
                        type: 'transcription_turn_delta',
                        timestamp: new Date().toISOString(),
                        delta: 'Hello, ',
                        partial: false,
                    };

                    yield {
                        type: 'transcription_turn_delta',
                        timestamp: new Date().toISOString(),
                        delta: 'this is a test.',
                        partial: false,
                    };

                    // Emit turn complete
                    yield {
                        type: 'transcription_turn_complete',
                        timestamp: new Date().toISOString(),
                    };

                    // Emit preview event (user's speech)
                    yield {
                        type: 'transcription_preview',
                        timestamp: new Date().toISOString(),
                        text: 'User input preview',
                        isFinal: true,
                    };
                }),
            };
        }
    }),
    getModelFromAgent: vi.fn((agent: any) => {
        const model = agent.model || 'gemini-live-2.5-flash-preview';
        return Promise.resolve(model);
    }),
}));

describe('ensembleListen', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should handle audio buffer input', async () => {
        const audioData = new Uint8Array(1000).fill(0);
        const events: TranscriptionEvent[] = [];

        for await (const event of ensembleListen(audioData, {
            model: 'gemini-live-2.5-flash-preview',
        })) {
            events.push(event);
        }

        // Should have received: start (from ensembleListen) + 2 deltas + turn + preview + complete
        expect(events.length).toBe(6);

        // Check event types
        expect(events[0].type).toBe('transcription_start');
        expect(events[1].type).toBe('transcription_turn_delta');
        expect(events[2].type).toBe('transcription_turn_delta');
        expect(events[3].type).toBe('transcription_turn_complete');
        expect(events[4].type).toBe('transcription_preview');
        expect(events[5].type).toBe('transcription_complete');

        // Check transcript content
        const completeEvent = events[5] as any;
        expect(completeEvent.text).toBe('Hello, this is a test.');
    });

    it('should handle stream input', async () => {
        // Create a simple readable stream
        const stream = new ReadableStream({
            start(controller) {
                controller.enqueue(new Uint8Array(500));
                controller.enqueue(new Uint8Array(500));
                controller.close();
            },
        });

        const events: TranscriptionEvent[] = [];

        for await (const event of ensembleListen(stream, {
            model: 'gemini-live-2.5-flash-preview',
        })) {
            events.push(event);
        }

        expect(events.length).toBeGreaterThan(0);
        expect(events[0].type).toBe('transcription_start');
    });

    it('should handle async iterable input', async () => {
        // Create an async generator
        async function* audioGenerator() {
            yield new Uint8Array(100);
            yield new Uint8Array(100);
        }

        const events: TranscriptionEvent[] = [];

        for await (const event of ensembleListen(audioGenerator(), {
            model: 'gemini-live-2.5-flash-preview',
        })) {
            events.push(event);
        }

        expect(events.length).toBeGreaterThan(0);
        expect(events[0].type).toBe('transcription_start');
    });

    it('should pass options correctly', async () => {
        const audioData = new Uint8Array(100);

        for await (const event of ensembleListen(
            audioData,
            {
                model: 'gemini-live-2.5-flash-preview',
            },
            {
                audioFormat: {
                    sampleRate: 44100,
                    channels: 2,
                    encoding: 'pcm',
                },
            }
        )) {
            if (event.type === 'transcription_start') {
                // The start event should reflect our audio format
                expect(event.audioFormat?.sampleRate).toBe(44100);
                expect(event.audioFormat?.channels).toBe(2);
                break;
            }
        }
    });

    it('should handle provider errors gracefully', async () => {
        // Mock provider to throw error
        const { getModelProvider } = await import('../model_providers/model_provider.js');
        (getModelProvider as any).mockImplementationOnce(() => {
            throw new Error('Provider not found');
        });

        const audioData = new Uint8Array(100);
        const events: TranscriptionEvent[] = [];

        for await (const event of ensembleListen(audioData, {
            model: 'unknown-model',
        })) {
            events.push(event);
        }

        // Should emit start and error events
        expect(events.length).toBe(2);
        expect(events[0].type).toBe('transcription_start');
        expect(events[1].type).toBe('error');
        expect((events[1] as any).error).toContain('Provider not found');
    });

    it('should accumulate full transcript', async () => {
        const audioData = new Uint8Array(100);
        let fullTranscript = '';

        for await (const event of ensembleListen(audioData, {
            model: 'gemini-live-2.5-flash-preview',
        })) {
            if (event.type === 'transcription_turn_delta' && event.delta) {
                fullTranscript += event.delta;
            } else if (event.type === 'transcription_complete') {
                expect(event.text).toBe('Hello, this is a test.');
                expect(fullTranscript).toBe('Hello, this is a test.');
            }
        }
    });

    it('should include duration in complete event', async () => {
        const audioData = new Uint8Array(100);

        for await (const event of ensembleListen(audioData, {
            model: 'gemini-live-2.5-flash-preview',
        })) {
            if (event.type === 'transcription_complete') {
                expect(event.duration).toBeDefined();
                // Duration might be very small in tests, so just check it exists
                expect(typeof event.duration).toBe('number');
                expect(event.duration).toBeGreaterThanOrEqual(0);
            }
        }
    });

    it('should handle empty audio gracefully', async () => {
        const audioData = new Uint8Array(0);
        const events: TranscriptionEvent[] = [];

        for await (const event of ensembleListen(audioData, {
            model: 'gemini-live-2.5-flash-preview',
        })) {
            events.push(event);
        }

        // Should still emit start and complete events
        expect(events.length).toBeGreaterThanOrEqual(2);
        expect(events[0].type).toBe('transcription_start');
        expect(events[events.length - 1].type).toBe('transcription_complete');
    });

    it('should handle transcription_turn events', async () => {
        const audioData = new Uint8Array(100);
        const events: TranscriptionEvent[] = [];
        let turnCount = 0;

        for await (const event of ensembleListen(audioData, {
            model: 'gemini-live-2.5-flash-preview',
        })) {
            events.push(event);
            if (event.type === 'transcription_turn_complete') {
                turnCount++;
                // Verify turn event includes accumulated text
                expect(event.text).toBe('Hello, this is a test.');
            }
        }

        // Should have received at least one turn event
        expect(turnCount).toBe(1);

        // Turn event should come after deltas but before complete
        const turnIndex = events.findIndex(e => e.type === 'transcription_turn_complete');
        const firstDeltaIndex = events.findIndex(e => e.type === 'transcription_turn_delta');
        const completeIndex = events.findIndex(e => e.type === 'transcription_complete');

        expect(turnIndex).toBeGreaterThan(firstDeltaIndex);
        expect(turnIndex).toBeLessThan(completeIndex);

        // Complete event should have all turns joined
        const completeEvent = events.find(e => e.type === 'transcription_complete') as any;
        expect(completeEvent.text).toBe('Hello, this is a test.');
    });

    it('should handle transcription_preview events', async () => {
        const audioData = new Uint8Array(100);
        const events: TranscriptionEvent[] = [];

        for await (const event of ensembleListen(audioData, {
            model: 'gemini-live-2.5-flash-preview',
        })) {
            events.push(event);
        }

        // Find preview event
        const previewEvent = events.find(e => e.type === 'transcription_preview') as any;

        expect(previewEvent).toBeDefined();
        expect(previewEvent.text).toBe('User input preview');
        expect(previewEvent.isFinal).toBe(true);

        // Preview should come after turn but before complete
        const previewIndex = events.findIndex(e => e.type === 'transcription_preview');
        const turnIndex = events.findIndex(e => e.type === 'transcription_turn');
        const completeIndex = events.findIndex(e => e.type === 'transcription_complete');

        expect(previewIndex).toBeGreaterThan(turnIndex);
        expect(previewIndex).toBeLessThan(completeIndex);
    });

    it('should handle OpenAI gpt-4o-transcribe model', async () => {
        const audioData = new Uint8Array(100);
        const events: TranscriptionEvent[] = [];

        for await (const event of ensembleListen(audioData, {
            model: 'gpt-4o-transcribe',
        })) {
            events.push(event);
        }

        // Should emit start, preview (speech started), incremental deltas, turn, and complete
        expect(events.some(e => e.type === 'transcription_start')).toBe(true);
        expect(events.some(e => e.type === 'transcription_preview')).toBe(true);

        // Check incremental deltas
        const deltas = events.filter(e => e.type === 'transcription_delta');
        expect(deltas.length).toBe(2);
        expect(deltas[0].delta).toBe('Hello, ');
        expect(deltas[0].partial).toBe(true);
        expect(deltas[1].delta).toBe('streaming from GPT-4o.');
        expect(deltas[1].partial).toBe(true);

        // Check turn complete
        const turnEvent = events.find(e => e.type === 'transcription_turn') as any;
        expect(turnEvent).toBeDefined();
        expect(turnEvent.text).toBe('Hello, streaming from GPT-4o.');

        // Check completion
        const completeEvent = events.find(e => e.type === 'transcription_complete');
        expect(completeEvent).toBeDefined();
    });

    it('should handle OpenAI gpt-4o-mini-transcribe model', async () => {
        const audioData = new Uint8Array(100);
        const events: TranscriptionEvent[] = [];

        for await (const event of ensembleListen(audioData, {
            model: 'gpt-4o-mini-transcribe',
        })) {
            events.push(event);
        }

        // Similar to gpt-4o-transcribe
        const deltas = events.filter(e => e.type === 'transcription_delta');
        expect(deltas.length).toBe(2);
        expect(deltas[0].partial).toBe(true);
        expect(deltas[1].partial).toBe(true);
    });

    it('should handle OpenAI whisper-1 model', async () => {
        const audioData = new Uint8Array(100);
        const events: TranscriptionEvent[] = [];

        for await (const event of ensembleListen(audioData, {
            model: 'whisper-1',
        })) {
            events.push(event);
        }

        // Whisper sends complete transcription at once
        const deltas = events.filter(e => e.type === 'transcription_delta');
        expect(deltas.length).toBe(1);
        expect(deltas[0].delta).toBe('Complete whisper transcription.');
        expect(deltas[0].partial).toBe(false);

        // Check turn complete
        const turnEvent = events.find(e => e.type === 'transcription_turn') as any;
        expect(turnEvent).toBeDefined();
        expect(turnEvent.text).toBe('Complete whisper transcription.');
    });

    it('should pass transcription options to OpenAI models', async () => {
        const { getModelProvider } = await import('../model_providers/model_provider.js');
        const mockCreateTranscription = vi.fn().mockImplementation(async function* (
            audio: any,
            agent: any,
            model: string,
            opts?: any
        ) {
            // Verify options were passed
            expect(opts).toBeDefined();
            expect(opts.prompt).toBe('Technical terms expected');
            expect(opts.language).toBe('en');
            expect(opts.vad).toBe(false);
            expect(opts.noiseReduction).toBe('far_field');

            yield {
                type: 'transcription_complete',
                timestamp: new Date().toISOString(),
            };
        });

        (getModelProvider as any).mockReturnValue({
            createTranscription: mockCreateTranscription,
        });

        const audioData = new Uint8Array(100);

        const events: TranscriptionEvent[] = [];
        for await (const event of ensembleListen(
            audioData,
            {
                model: 'gpt-4o-transcribe',
            },
            {
                prompt: 'Technical terms expected',
                language: 'en',
                vad: false,
                noiseReduction: 'far_field',
            }
        )) {
            events.push(event);
        }

        expect(events.length).toBeGreaterThan(0);

        expect(mockCreateTranscription).toHaveBeenCalled();
    });
});
