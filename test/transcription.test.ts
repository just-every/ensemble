import { describe, it, expect } from 'vitest';
import { ensembleListen } from '../index.js';
import type {
    AgentDefinition,
    TranscriptionOpts,
    TranscriptionEvent,
} from '../index.js';

describe('Audio Transcription', () => {
    // Skip these tests in CI or if no API keys are available
    const hasOpenAIKey = !!process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY.startsWith('sk-');
    // const hasGoogleKey =
    //     !!process.env.GOOGLE_API_KEY || !!process.env.GEMINI_API_KEY;

    describe('ensembleListen', () => {
        it('should emit transcription events', async () => {
            // Create a simple audio buffer (silence)
            const sampleRate = 16000;
            const duration = 0.5; // 0.5 seconds
            const numSamples = sampleRate * duration;
            const audioBuffer = new ArrayBuffer(numSamples * 2); // 16-bit PCM
            const view = new Int16Array(audioBuffer);

            // Fill with silence (zeros)
            for (let i = 0; i < numSamples; i++) {
                view[i] = 0;
            }

            const agent: AgentDefinition = {
                model: 'test-transcription-model',
            };

            const events: TranscriptionEvent[] = [];

            for await (const event of ensembleListen(audioBuffer, agent)) {
                events.push(event);
            }

            // Should have at least start and complete events
            expect(events.length).toBeGreaterThanOrEqual(2);
            expect(events[0].type).toBe('transcription_start');
            expect(
                events.find(e => e.type === 'transcription_complete')
            ).toBeDefined();
        });

        it.skipIf(!hasOpenAIKey)(
            'should transcribe audio with OpenAI Whisper',
            async () => {
                // Create a simple test audio with a tone
                const sampleRate = 16000;
                const duration = 1; // 1 second
                const frequency = 440; // A4 note
                const numSamples = sampleRate * duration;
                const audioBuffer = new ArrayBuffer(numSamples * 2);
                const view = new Int16Array(audioBuffer);

                // Generate a sine wave
                for (let i = 0; i < numSamples; i++) {
                    const t = i / sampleRate;
                    const sample =
                        Math.sin(2 * Math.PI * frequency * t) * 0.3 * 32767;
                    view[i] = Math.round(sample);
                }

                const agent: AgentDefinition = {
                    model: 'whisper-1',
                };

                const options: TranscriptionOpts = {
                    language: 'en',
                    temperature: 0,
                };

                const events: TranscriptionEvent[] = [];

                for await (const event of ensembleListen(
                    audioBuffer,
                    agent,
                    options
                )) {
                    events.push(event);
                    console.log('Transcription event:', event.type, event);
                }

                // Check we got transcription events
                const startEvent = events.find(
                    e => e.type === 'transcription_start'
                );
                expect(startEvent).toBeDefined();

                const completeEvent = events.find(
                    e => e.type === 'transcription_complete'
                );
                expect(completeEvent).toBeDefined();

                // The transcription might be empty or contain noise detection
                // We're mainly testing that the API call works
                if (
                    completeEvent &&
                    completeEvent.type === 'transcription_complete'
                ) {
                    expect(typeof completeEvent.text).toBe('string');
                }
            }
        );

        it('should handle ReadableStream input', async () => {
            // Create a ReadableStream from chunks
            const chunks = [
                new Uint8Array([0, 0, 0, 0]), // Some silence
                new Uint8Array([0, 0, 0, 0]),
                new Uint8Array([0, 0, 0, 0]),
            ];

            const audioStream = new ReadableStream<Uint8Array>({
                async start(controller) {
                    for (const chunk of chunks) {
                        controller.enqueue(chunk);
                    }
                    controller.close();
                },
            });

            const agent: AgentDefinition = {
                model: 'test-transcription-model',
            };

            const events: TranscriptionEvent[] = [];

            for await (const event of ensembleListen(audioStream, agent)) {
                events.push(event);
            }

            expect(events.length).toBeGreaterThanOrEqual(2);
            expect(events[0].type).toBe('transcription_start');
        });

        it('should handle base64 string input', async () => {
            // Create a small audio buffer and encode as base64
            const audioData = new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0]);
            const base64 = btoa(String.fromCharCode(...audioData));

            const agent: AgentDefinition = {
                model: 'test-transcription-model',
            };

            const events: TranscriptionEvent[] = [];

            for await (const event of ensembleListen(base64, agent)) {
                events.push(event);
            }

            expect(events.length).toBeGreaterThanOrEqual(2);
            expect(events[0].type).toBe('transcription_start');
        });

        it('should select correct provider based on model', async () => {
            const testData = new ArrayBuffer(100);

            // Test transcription model
            const testAgent: AgentDefinition = { model: 'test-transcription-model' };
            const testEvents: TranscriptionEvent[] = [];

            for await (const event of ensembleListen(testData, testAgent)) {
                testEvents.push(event);
            }

            expect(testEvents.length).toBeGreaterThan(0);

            // Test direct model specification works as expected
            expect(testEvents[0].type).toBe('transcription_start');
            const completeEvent = testEvents.find(e => e.type === 'transcription_complete');
            expect(completeEvent).toBeDefined();
            if (completeEvent && completeEvent.type === 'transcription_complete') {
                expect(completeEvent.text).toBe('This is a test transcription.');
            }
        });

        it('should handle errors gracefully', async () => {
            const agent: AgentDefinition = {
                model: 'invalid-transcription-model',
            };

            const testData = new ArrayBuffer(100);

            await expect(async () => {
                const events: TranscriptionEvent[] = [];
                for await (const event of ensembleListen(testData, agent)) {
                    events.push(event);
                }
            }).rejects.toThrow();
        });
    });
});
