import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MODEL_CLASSES, findModel } from '../data/model_data.js';
import { FALProvider } from '../model_providers/fal.js';
import { GeminiProvider } from '../model_providers/gemini.js';
import { getModelFromAgent, getProviderFromModel } from '../model_providers/model_provider.js';
import { costTracker } from '../utils/cost_tracker.js';

const originalFalKey = process.env.FAL_KEY;

describe('current video generation support', () => {
    beforeEach(() => {
        process.env.FAL_KEY = 'fal-test';
        costTracker.reset();
    });

    afterEach(() => {
        process.env.FAL_KEY = originalFalKey;
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it('registers current Gemini, Veo, and PixVerse video models', async () => {
        expect(findModel('gemini-omni-flash')).toMatchObject({
            id: 'gemini-omni-flash-preview',
            provider: 'google',
            cost: {
                input_per_million: 1.5,
                per_second: 0.10136,
            },
            class: 'video_generation',
        });
        expect(findModel('veo-3.1-lite-generate-preview')?.cost?.per_second_by_resolution?.['720p']).toBe(0.05);
        expect(findModel('veo-3.1-fast-generate-preview')?.cost?.per_second_by_resolution?.['720p']).toBe(0.1);
        expect(findModel('veo-3.1-generate-preview')?.cost?.per_second_by_resolution?.['720p']).toBe(0.4);
        expect(findModel('fal-ai/pixverse/v6/image-to-video')?.cost?.per_second_by_resolution?.['720p']).toBe(0.045);
        expect(MODEL_CLASSES.video_generation.models).toContain('gemini-omni-flash-preview');
        expect(await getModelFromAgent({ agent_id: 'video', model: 'gemini-omni-flash' })).toBe(
            'gemini-omni-flash-preview'
        );
        expect(getProviderFromModel('veo-3.1-fast-generate-preview')).toBe('google');
        expect(getProviderFromModel('fal-ai/pixverse/v6/image-to-video')).toBe('fal');
    });

    it('sends an inline first frame through the Omni Interactions API and records tokenized cost', async () => {
        const provider = new GeminiProvider('test-google-key');
        const fetchMock = vi.fn().mockResolvedValue(
            new Response(
                JSON.stringify({
                    id: 'interaction-123',
                    status: 'completed',
                    steps: [
                        {
                            type: 'model_output',
                            content: [{ type: 'video', mime_type: 'video/mp4', data: 'dmlkZW8=' }],
                        },
                    ],
                    usage: {
                        total_input_tokens: 1120,
                        total_output_tokens: 23168,
                        output_tokens_by_modality: [{ modality: 'video', tokens: 23168 }],
                    },
                }),
                { status: 200, headers: { 'Content-Type': 'application/json' } }
            )
        );
        vi.stubGlobal('fetch', fetchMock);

        const videos = await provider.createVideo(
            'Locked camera. Rowan breathes subtly.',
            'gemini-omni-flash-preview',
            { agent_id: 'test-omni-video' },
            {
                duration: 4,
                aspect_ratio: '9:16',
                source_image: 'data:image/png;base64,aW1hZ2U=',
                request_id: 'omni-request',
            }
        );

        expect(videos).toEqual(['data:video/mp4;base64,dmlkZW8=']);
        const request = fetchMock.mock.calls[0];
        expect(request[0]).toBe('https://generativelanguage.googleapis.com/v1beta/interactions');
        const body = JSON.parse(String(request[1]?.body));
        expect(body).toMatchObject({
            model: 'gemini-omni-flash-preview',
            input: [
                { type: 'image', data: 'aW1hZ2U=', mime_type: 'image/png' },
                { type: 'text', text: 'Locked camera. Rowan breathes subtly.' },
            ],
            response_format: { type: 'video', aspect_ratio: '9:16' },
            generation_config: { video_config: { task: 'image_to_video' } },
            background: false,
            store: false,
            stream: false,
        });
        expect(costTracker.getCostsByModel()['gemini-omni-flash-preview']?.cost).toBeCloseTo(0.40712);
    });

    it('polls Veo Lite, preserves the first frame, and records duration pricing', async () => {
        const provider = new GeminiProvider('test-google-key');
        const generateVideos = vi.fn().mockResolvedValue({ name: 'operations/veo-1', done: false });
        const getVideosOperation = vi.fn().mockResolvedValue({
            name: 'operations/veo-1',
            done: true,
            response: {
                generatedVideos: [{ video: { mimeType: 'video/mp4', videoBytes: 'dmVv' } }],
            },
        });
        (provider as any)._client = {
            models: { generateVideos },
            operations: { getVideosOperation },
        };

        const videos = await provider.createVideo(
            'Locked camera. Rowan breathes subtly.',
            'veo-3.1-lite-generate-preview',
            { agent_id: 'test-veo-video' },
            {
                duration: 4,
                resolution: '720p',
                aspect_ratio: '9:16',
                source_image: 'data:image/png;base64,aW1hZ2U=',
                poll_interval_ms: 0,
                request_id: 'veo-request',
            }
        );

        expect(videos).toEqual(['data:video/mp4;base64,dmVv']);
        expect(generateVideos).toHaveBeenCalledWith({
            model: 'veo-3.1-lite-generate-preview',
            prompt: 'Locked camera. Rowan breathes subtly.',
            image: { imageBytes: 'aW1hZ2U=', mimeType: 'image/png' },
            config: {
                numberOfVideos: 1,
                durationSeconds: 4,
                aspectRatio: '9:16',
                resolution: '720p',
                personGeneration: 'allow_adult',
            },
        });
        expect(getVideosOperation).toHaveBeenCalledTimes(1);
        expect(costTracker.getCostsByModel()['veo-3.1-lite-generate-preview']?.cost).toBeCloseTo(0.2);
    });

    it('rejects non-eight-second Veo end-frame interpolation before making a provider request', async () => {
        const provider = new GeminiProvider('test-google-key');
        const generateVideos = vi.fn();
        (provider as any)._client = {
            models: { generateVideos },
            operations: { getVideosOperation: vi.fn() },
        };

        await expect(
            provider.createVideo(
                'Return to the supplied final frame.',
                'veo-3.1-lite-generate-preview',
                { agent_id: 'test-veo-lite-last-frame' },
                {
                    duration: 4,
                    resolution: '720p',
                    source_image: 'data:image/png;base64,aW1hZ2U=',
                    end_image: 'data:image/png;base64,ZW5kLWltYWdl',
                }
            )
        ).rejects.toThrow('Veo 3.1 end_image interpolation requires an 8-second duration');
        expect(generateVideos).not.toHaveBeenCalled();
    });

    it('passes first and last frames to Veo Fast', async () => {
        const provider = new GeminiProvider('test-google-key');
        const generateVideos = vi.fn().mockResolvedValue({
            name: 'operations/veo-fast-1',
            done: true,
            response: {
                generatedVideos: [{ video: { mimeType: 'video/mp4', videoBytes: 'ZmFzdA==' } }],
            },
        });
        (provider as any)._client = {
            models: { generateVideos },
            operations: { getVideosOperation: vi.fn() },
        };

        const videos = await provider.createVideo(
            'Return to the supplied final frame.',
            'veo-3.1-fast-generate-preview',
            { agent_id: 'test-veo-fast-last-frame' },
            {
                duration: 8,
                resolution: '720p',
                aspect_ratio: '9:16',
                source_image: 'data:image/png;base64,aW1hZ2U=',
                end_image: 'data:image/png;base64,ZW5kLWltYWdl',
                request_id: 'veo-fast-request',
            }
        );

        expect(videos).toEqual(['data:video/mp4;base64,ZmFzdA==']);
        expect(generateVideos).toHaveBeenCalledWith({
            model: 'veo-3.1-fast-generate-preview',
            prompt: 'Return to the supplied final frame.',
            image: { imageBytes: 'aW1hZ2U=', mimeType: 'image/png' },
            config: {
                numberOfVideos: 1,
                durationSeconds: 8,
                aspectRatio: '9:16',
                resolution: '720p',
                personGeneration: 'allow_adult',
                lastFrame: { imageBytes: 'ZW5kLWltYWdl', mimeType: 'image/png' },
            },
        });
        expect(costTracker.getCostsByModel()['veo-3.1-fast-generate-preview']?.cost).toBeCloseTo(0.8);
    });

    it('calls the registered PixVerse image-to-video endpoint without prompt expansion or audio', async () => {
        const provider = new FALProvider();
        const fetchMock = vi.fn().mockResolvedValue(
            new Response(
                JSON.stringify({
                    request_id: 'fal-video-1',
                    video: {
                        url: 'https://example.com/pixverse.mp4',
                        duration: 4,
                    },
                }),
                { status: 200, headers: { 'Content-Type': 'application/json' } }
            )
        );
        vi.stubGlobal('fetch', fetchMock);

        const videos = await provider.createVideo(
            'Locked camera. Rowan breathes subtly.',
            'fal-ai/pixverse/v6/image-to-video',
            { agent_id: 'test-fal-video' },
            {
                duration: 4,
                resolution: '720p',
                source_image: 'data:image/png;base64,aW1hZ2U=',
                generate_audio: false,
                request_id: 'fal-request',
            }
        );

        expect(videos).toEqual(['https://example.com/pixverse.mp4']);
        expect(fetchMock).toHaveBeenCalledWith('https://fal.run/fal-ai/pixverse/v6/image-to-video', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: 'Key fal-test',
            },
            body: JSON.stringify({
                prompt: 'Locked camera. Rowan breathes subtly.',
                image_url: 'data:image/png;base64,aW1hZ2U=',
                duration: 4,
                resolution: '720p',
                generate_audio_switch: false,
                generate_multi_clip_switch: false,
                thinking_type: 'disabled',
            }),
            signal: expect.any(AbortSignal),
        });
        expect(costTracker.getCostsByModel()['fal-ai/pixverse/v6/image-to-video']?.cost).toBeCloseTo(0.18);
    });
});
