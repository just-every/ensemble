import { describe, it, expect, vi, beforeAll } from 'vitest';
import { ensembleVoice, ensembleVoiceStream } from '../core/ensemble_voice.js';

// Mock the OpenAI provider
vi.mock('../model_providers/openai.js', () => {
    const mockCreateVoice = vi.fn();

    return {
        OpenAIProvider: vi.fn().mockImplementation(() => ({
            createVoice: mockCreateVoice,
        })),
        openaiProvider: {
            createVoice: mockCreateVoice,
        },
    };
});

// Mock the ElevenLabs provider
vi.mock('../model_providers/elevenlabs.js', () => {
    const mockCreateVoice = vi.fn();

    return {
        ElevenLabsProvider: vi.fn().mockImplementation(() => ({
            createVoice: mockCreateVoice,
        })),
        elevenLabsProvider: {
            createVoice: mockCreateVoice,
        },
    };
});

// Mock the model provider module
vi.mock('../model_providers/model_provider.js', () => ({
    getModelFromAgent: vi.fn().mockResolvedValue('tts-1'),
    getModelProvider: vi.fn().mockReturnValue({
        createVoice: vi.fn(),
    }),
}));

describe('Voice Generation', () => {
    let mockProvider: any;
    let getModelProvider: any;

    beforeAll(async () => {
        const modelProviderModule = await import(
            '../model_providers/model_provider.js'
        );
        getModelProvider = modelProviderModule.getModelProvider;
        mockProvider = getModelProvider('tts-1');
    });

    describe('ensembleVoice', () => {
        it('should generate voice as ArrayBuffer', async () => {
            const mockAudioData = new ArrayBuffer(1024);
            mockProvider.createVoice.mockResolvedValue(mockAudioData);

            const result = await ensembleVoice(
                'Hello, world!',
                { model: 'tts-1' },
                { voice: 'nova', stream: false }
            );

            expect(result).toBe(mockAudioData);
            expect(mockProvider.createVoice).toHaveBeenCalledWith(
                'Hello, world!',
                'tts-1',
                { voice: 'nova', stream: false }
            );
        });

        it('should generate voice as ReadableStream', async () => {
            const mockStream = new ReadableStream<Uint8Array>({
                start(controller) {
                    controller.enqueue(new Uint8Array([1, 2, 3]));
                    controller.close();
                },
            });
            mockProvider.createVoice.mockResolvedValue(mockStream);

            const result = await ensembleVoice(
                'Streaming test',
                { model: 'tts-1' },
                { voice: 'echo', stream: true }
            );

            expect(result).toBeInstanceOf(ReadableStream);
            expect(mockProvider.createVoice).toHaveBeenCalledWith(
                'Streaming test',
                'tts-1',
                { voice: 'echo', stream: true }
            );
        });

        it('should throw error if provider does not support voice', async () => {
            const providerWithoutVoice = {
                createResponseStream: vi.fn(),
                // createVoice is missing
            };
            vi.mocked(getModelProvider).mockReturnValueOnce(
                providerWithoutVoice as any
            );

            await expect(
                ensembleVoice('Test', { model: 'unsupported-model' })
            ).rejects.toThrow(
                'Provider for model tts-1 does not support voice generation'
            );
        });
    });

    describe('ensembleVoiceStream', () => {
        it('should yield audio stream events', async () => {
            const mockChunks = [
                new Uint8Array([1, 2, 3]),
                new Uint8Array([4, 5, 6]),
                new Uint8Array([7, 8, 9]),
            ];

            const mockStream = new ReadableStream<Uint8Array>({
                start(controller) {
                    mockChunks.forEach(chunk => controller.enqueue(chunk));
                    controller.close();
                },
            });

            mockProvider.createVoice.mockResolvedValue(mockStream);

            const events = [];
            for await (const event of ensembleVoiceStream(
                'Stream test',
                { model: 'tts-1' },
                { voice: 'alloy', response_format: 'opus' }
            )) {
                events.push(event);
            }

            // First event is format announcement, then chunks
            expect(events.length).toBeGreaterThanOrEqual(1);

            // Find actual chunk events
            const chunkEvents = events.filter(
                e => e.type === 'audio_stream' && e.data
            );
            expect(chunkEvents.length).toBeGreaterThan(0);
        });

        it('should force streaming mode', async () => {
            const mockStream = new ReadableStream<Uint8Array>({
                start(controller) {
                    controller.close();
                },
            });

            mockProvider.createVoice.mockResolvedValue(mockStream);

            const events = [];
            for await (const event of ensembleVoiceStream(
                'Force stream',
                { model: 'tts-1' },
                { stream: false } // This should be overridden
            )) {
                events.push(event);
            }

            // Check that stream: true was passed
            expect(mockProvider.createVoice).toHaveBeenCalledWith(
                'Force stream',
                'tts-1',
                { stream: true }
            );
        });

        it('should throw error if buffer is returned instead of stream', async () => {
            const mockBuffer = new ArrayBuffer(1024);
            mockProvider.createVoice.mockResolvedValue(mockBuffer);

            // Create generator and collect results
            const events = [];
            try {
                for await (const event of ensembleVoiceStream('Should fail', {
                    model: 'tts-1',
                })) {
                    events.push(event);
                }
            } catch (error) {
                expect(error.message).toContain(
                    'Expected streaming response but got buffer'
                );
                return;
            }

            // Should have thrown
            expect.fail('Should have thrown an error');
        });

        it('should use default format if not specified', async () => {
            const mockStream = new ReadableStream<Uint8Array>({
                start(controller) {
                    controller.enqueue(new Uint8Array([1, 2, 3]));
                    controller.close();
                },
            });

            mockProvider.createVoice.mockResolvedValue(mockStream);

            const events = [];
            for await (const event of ensembleVoiceStream('Default format', {
                model: 'tts-1',
            })) {
                events.push(event);
            }

            expect(events[0].format).toBe('mp3');
        });
    });

    describe('ElevenLabs integration', () => {
        beforeAll(() => {
            // Setup ElevenLabs provider mock
            vi.mocked(getModelProvider).mockImplementation(model => {
                if (model?.startsWith('eleven_')) {
                    return {
                        createVoice: vi
                            .fn()
                            .mockResolvedValue(new ArrayBuffer(2048)),
                    };
                }
                return mockProvider;
            });
        });

        it('should work with ElevenLabs models', async () => {
            const mockAudioData = new ArrayBuffer(2048);
            const elevenLabsProvider = {
                createVoice: vi.fn().mockResolvedValue(mockAudioData),
            };

            vi.mocked(getModelProvider).mockReturnValueOnce(
                elevenLabsProvider as any
            );
            const { getModelFromAgent } = await import(
                '../model_providers/model_provider.js'
            );
            vi.mocked(getModelFromAgent).mockResolvedValueOnce(
                'eleven_multilingual_v2'
            );

            const result = await ensembleVoice(
                'Test ElevenLabs',
                { model: 'eleven_multilingual_v2' },
                {
                    voice: 'adam',
                    voice_settings: {
                        stability: 0.5,
                        similarity_boost: 0.75,
                    },
                }
            );

            expect(result).toBe(mockAudioData);
            expect(elevenLabsProvider.createVoice).toHaveBeenCalledWith(
                'Test ElevenLabs',
                'eleven_multilingual_v2',
                {
                    voice: 'adam',
                    voice_settings: {
                        stability: 0.5,
                        similarity_boost: 0.75,
                    },
                }
            );
        });

        it('should handle ElevenLabs streaming', async () => {
            const mockStream = new ReadableStream<Uint8Array>({
                start(controller) {
                    controller.enqueue(new Uint8Array([10, 20, 30]));
                    controller.close();
                },
            });

            const elevenLabsProvider = {
                createVoice: vi.fn().mockResolvedValue(mockStream),
            };

            vi.mocked(getModelProvider).mockReturnValueOnce(
                elevenLabsProvider as any
            );
            const { getModelFromAgent } = await import(
                '../model_providers/model_provider.js'
            );
            vi.mocked(getModelFromAgent).mockResolvedValueOnce(
                'eleven_turbo_v2_5'
            );

            const events = [];
            for await (const event of ensembleVoiceStream(
                'ElevenLabs stream',
                { model: 'eleven_turbo_v2_5' },
                { voice: 'rachel', response_format: 'mp3_high' }
            )) {
                if (event.type === 'audio_stream' && event.data) {
                    events.push(event);
                }
            }

            expect(events.length).toBeGreaterThan(0);
            expect(elevenLabsProvider.createVoice).toHaveBeenCalledWith(
                'ElevenLabs stream',
                'tts-1', // Model is mocked to return 'tts-1'
                { voice: 'rachel', response_format: 'mp3_high', stream: true }
            );
        });
    });
});
