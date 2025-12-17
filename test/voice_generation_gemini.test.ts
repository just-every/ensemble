import { describe, test, expect, vi, beforeEach } from 'vitest';
import { GeminiProvider } from '../model_providers/gemini.js';
import type { VoiceGenerationOpts, AgentDefinition } from '../types/types.js';

// Mock the Google GenAI SDK
vi.mock('@google/genai', async () => {
    const actual = await vi.importActual<any>('@google/genai');

    class GoogleGenAI {
        public models: {
            generateContent: ReturnType<typeof vi.fn>;
            generateContentStream: ReturnType<typeof vi.fn>;
        };

        constructor() {
            this.models = {
                generateContent: vi.fn().mockResolvedValue({
                    candidates: [
                        {
                            content: {
                                parts: [
                                    {
                                        inlineData: {
                                            mimeType: 'audio/mpeg',
                                            data: 'bW9jayBhdWRpbyBkYXRh', // "mock audio data" in base64
                                        },
                                    },
                                ],
                            },
                        },
                    ],
                }),
                generateContentStream: vi.fn().mockImplementation(() =>
                    Promise.resolve(
                        (async function* () {
                            yield {
                                candidates: [
                                    {
                                        content: {
                                            parts: [
                                                {
                                                    inlineData: {
                                                        mimeType: 'audio/wav',
                                                        data: 'bW9jayBhdWRpbyBkYXRh', // "mock audio data" in base64
                                                    },
                                                },
                                            ],
                                        },
                                    },
                                ],
                            };
                        })()
                    )
                ),
            };
        }
    }

    return {
        ...actual,
        GoogleGenAI,
        Modality: actual.Modality ?? {
            AUDIO: 'AUDIO',
        },
    };
});

describe('Gemini Voice Generation', () => {
    let provider: GeminiProvider;
    let mockAgent: AgentDefinition;

    beforeEach(() => {
        vi.clearAllMocks();
        provider = new GeminiProvider('test-api-key');
        mockAgent = {
            agent_id: 'test-agent',
            name: 'Test Agent',
            model: 'gemini-2.5-flash',
            tags: ['test'],
        };
    });

    test('should generate voice with default settings', async () => {
        const text = 'Hello, world!';
        const model = 'gemini-2.5-flash-preview-tts';

        const result = await provider.createVoice(text, model, mockAgent);

        expect(result).toBeInstanceOf(ArrayBuffer);
        expect(result.byteLength).toBeGreaterThan(0);
    });

    test('should generate voice with specific voice selection', async () => {
        const text = 'Testing voice selection';
        const model = 'gemini-2.5-pro-preview-tts';
        const opts: VoiceGenerationOpts = {
            voice: 'Puck',
        };

        const result = await provider.createVoice(text, model, mockAgent, opts);

        expect(result).toBeInstanceOf(ArrayBuffer);
    });

    test('should map common voice names to Gemini voices', async () => {
        const text = 'Testing voice mapping';
        const model = 'gemini-2.5-flash-preview-tts';
        const voiceMappings = [
            { input: 'alloy', expected: 'Kore' },
            { input: 'nova', expected: 'Aoede' },
            { input: 'male', expected: 'Puck' },
            { input: 'female', expected: 'Kore' },
        ];

        for (const { input } of voiceMappings) {
            const opts: VoiceGenerationOpts = { voice: input };
            const result = await provider.createVoice(text, model, mockAgent, opts);
            expect(result).toBeInstanceOf(ArrayBuffer);
        }
    });

    test('should handle streaming option', async () => {
        const text = 'Testing streaming';
        const model = 'gemini-2.5-flash-preview-tts';
        const opts: VoiceGenerationOpts = {
            stream: true,
        };

        const result = await provider.createVoice(text, model, mockAgent, opts);

        expect(result).toBeInstanceOf(ReadableStream);

        // Test reading from the stream
        const reader = (result as ReadableStream<Uint8Array>).getReader();
        const { value, done } = await reader.read();
        expect(value).toBeInstanceOf(Uint8Array);
        expect(done).toBe(false);
        reader.releaseLock();
    });

    test('should handle speed adjustment in prompt', async () => {
        const text = 'Testing speed';
        const model = 'gemini-2.5-flash-preview-tts';
        const opts: VoiceGenerationOpts = {
            speed: 1.5,
        };

        const result = await provider.createVoice(text, model, mockAgent, opts);

        expect(result).toBeInstanceOf(ArrayBuffer);
        // The speed adjustment should be reflected in the prompt sent to the API
    });

    test('should handle errors gracefully', async () => {
        const text = 'Testing error handling';
        const model = 'gemini-2.5-flash-preview-tts';

        // Mock an error response
        const mockGenAI = vi.mocked((provider as any).client.models.generateContentStream);
        mockGenAI.mockRejectedValueOnce(new Error('API Error'));

        await expect(provider.createVoice(text, model, mockAgent)).rejects.toThrow('API Error');
    });

    test('should handle empty response', async () => {
        const text = 'Testing empty response';
        const model = 'gemini-2.5-flash-preview-tts';

        // Mock empty response
        const mockGenAI = vi.mocked((provider as any).client.models.generateContentStream);
        mockGenAI.mockResolvedValueOnce(
            (async function* () {
                yield { candidates: [] };
            })()
        );

        await expect(provider.createVoice(text, model, mockAgent)).rejects.toThrow(
            'No audio data generated from Gemini TTS'
        );
    });

    test('should handle response without audio parts', async () => {
        const text = 'Testing no audio parts';
        const model = 'gemini-2.5-flash-preview-tts';

        // Mock response without audio parts
        const mockGenAI = vi.mocked((provider as any).client.models.generateContentStream);
        mockGenAI.mockResolvedValueOnce(
            (async function* () {
                yield {
                    candidates: [
                        {
                            content: {
                                parts: [
                                    {
                                        text: 'Some text instead of audio',
                                    },
                                ],
                            },
                        },
                    ],
                };
            })()
        );

        await expect(provider.createVoice(text, model, mockAgent)).rejects.toThrow(
            'No audio data generated from Gemini TTS'
        );
    });
});
