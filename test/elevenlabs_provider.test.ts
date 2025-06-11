import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ElevenLabsProvider } from '../model_providers/elevenlabs.js';

// Mock fetch globally
global.fetch = vi.fn();

describe('ElevenLabsProvider', () => {
    let provider: ElevenLabsProvider;

    beforeEach(() => {
        vi.clearAllMocks();
        // Set API key for tests
        process.env.ELEVENLABS_API_KEY = 'test-api-key';
        provider = new ElevenLabsProvider();
    });

    describe('supportsModel', () => {
        it('should support models with eleven_ prefix', () => {
            expect(provider.supportsModel('eleven_multilingual_v2')).toBe(true);
            expect(provider.supportsModel('eleven_turbo_v2_5')).toBe(true);
        });

        it('should support models with elevenlabs- prefix', () => {
            expect(provider.supportsModel('elevenlabs-v1')).toBe(true);
            expect(provider.supportsModel('elevenlabs-turbo')).toBe(true);
        });

        it('should not support other models', () => {
            expect(provider.supportsModel('gpt-4')).toBe(false);
            expect(provider.supportsModel('claude-3')).toBe(false);
        });
    });

    describe('createVoice', () => {
        it('should generate voice with default settings', async () => {
            const mockResponse = new Response(new ArrayBuffer(1024), {
                status: 200,
                headers: { 'Content-Type': 'audio/mpeg' },
            });

            (global.fetch as any).mockResolvedValueOnce(mockResponse);

            const result = await provider.createVoice(
                'Hello world',
                'eleven_multilingual_v2'
            );

            expect(global.fetch).toHaveBeenCalledWith(
                expect.stringContaining('/text-to-speech/'),
                expect.objectContaining({
                    method: 'POST',
                    headers: expect.objectContaining({
                        'xi-api-key': 'test-api-key',
                        'Content-Type': 'application/json',
                    }),
                })
            );

            expect(result).toBeInstanceOf(ArrayBuffer);
        });

        it('should handle streaming response', async () => {
            const mockStream = new ReadableStream({
                start(controller) {
                    controller.enqueue(new Uint8Array([1, 2, 3]));
                    controller.close();
                },
            });

            const mockResponse = new Response(mockStream, {
                status: 200,
                headers: { 'Content-Type': 'audio/mpeg' },
            });

            (global.fetch as any).mockResolvedValueOnce(mockResponse);

            const result = await provider.createVoice(
                'Hello world',
                'eleven_turbo_v2_5',
                { stream: true }
            );

            expect(result).toBeInstanceOf(ReadableStream);
        });

        it('should use custom voice settings', async () => {
            const mockResponse = new Response(new ArrayBuffer(1024), {
                status: 200,
            });

            (global.fetch as any).mockResolvedValueOnce(mockResponse);

            await provider.createVoice('Test', 'eleven_multilingual_v2', {
                voice: 'rachel',
                voice_settings: {
                    stability: 0.8,
                    similarity_boost: 0.9,
                    style: 0.5,
                    use_speaker_boost: false,
                },
            });

            const fetchCall = (global.fetch as any).mock.calls[0];
            const requestBody = JSON.parse(fetchCall[1].body);

            expect(requestBody.voice_settings).toEqual({
                stability: 0.8,
                similarity_boost: 0.9,
                style: 0.5,
                use_speaker_boost: false,
            });
        });

        it('should map voice names to IDs', async () => {
            const mockResponse = new Response(new ArrayBuffer(1024), {
                status: 200,
            });

            (global.fetch as any).mockResolvedValueOnce(mockResponse);

            await provider.createVoice('Test', 'eleven_multilingual_v2', {
                voice: 'adam',
            });

            const fetchCall = (global.fetch as any).mock.calls[0];
            expect(fetchCall[0]).toContain('pNInz6obpgDQGcFmaJgB'); // Adam's voice ID
        });

        it('should handle API errors', async () => {
            const mockResponse = new Response('API Error', {
                status: 400,
                statusText: 'Bad Request',
            });

            (global.fetch as any).mockResolvedValueOnce(mockResponse);

            await expect(
                provider.createVoice('Test', 'eleven_multilingual_v2')
            ).rejects.toThrow('ElevenLabs API error: 400');
        });

        it('should throw error when API key is missing', async () => {
            delete process.env.ELEVENLABS_API_KEY;
            const providerNoKey = new ElevenLabsProvider();

            await expect(
                providerNoKey.createVoice('Test', 'eleven_multilingual_v2')
            ).rejects.toThrow('ElevenLabs API key is required');
        });
    });

    describe('unsupported methods', () => {
        it('should throw error for request method', async () => {
            await expect(provider.request()).rejects.toThrow(
                'ElevenLabs provider only supports voice generation'
            );
        });

        it('should throw error for embed method', async () => {
            await expect(provider.embed()).rejects.toThrow(
                'ElevenLabs provider does not support embeddings'
            );
        });

        it('should throw error for image method', async () => {
            await expect(provider.image()).rejects.toThrow(
                'ElevenLabs provider does not support image generation'
            );
        });

        it('should throw error for createResponseStream', async () => {
            const generator = provider.createResponseStream();

            // First next() yields undefined
            const { value, done } = await generator.next();
            expect(value).toBeUndefined();
            expect(done).toBe(false);

            // Second next() should throw
            await expect(generator.next()).rejects.toThrow(
                'ElevenLabs provider only supports voice generation'
            );
        });
    });

    describe('format mapping', () => {
        it('should map generic formats to ElevenLabs formats', async () => {
            const mockResponse = new Response(new ArrayBuffer(1024), {
                status: 200,
            });

            (global.fetch as any).mockResolvedValueOnce(mockResponse);

            await provider.createVoice('Test', 'eleven_multilingual_v2', {
                response_format: 'mp3_high',
            });

            const fetchCall = (global.fetch as any).mock.calls[0];
            expect(fetchCall[0]).toContain('output_format=mp3_44100_192');
        });
    });
});
