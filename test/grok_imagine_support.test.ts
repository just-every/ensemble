import { describe, expect, it, vi, beforeEach } from 'vitest';
import { findModel } from '../data/model_data.js';
import { GrokProvider } from '../model_providers/grok.js';
import { costTracker } from '../utils/cost_tracker.js';

describe('Grok imagine image support', () => {
    beforeEach(() => {
        costTracker.reset();
    });

    it('registers both Grok imagine image models with xAI pricing metadata', () => {
        expect(findModel('grok-imagine-image')).toMatchObject({
            id: 'grok-imagine-image',
            provider: 'xai',
            cost: { per_image: 0.02 },
        });

        expect(findModel('grok-imagine-image-pro')).toMatchObject({
            id: 'grok-imagine-image-quality',
            provider: 'xai',
            cost: { per_input_image: 0.01, per_image_by_resolution: { '1k': 0.05, '2k': 0.07 } },
        });
    });

    it('uses xAI image generation endpoint with aspect ratio and explicit resolution', async () => {
        const provider = new GrokProvider();
        const post = vi.fn().mockResolvedValue({
            data: [{ url: 'https://example.com/one.png' }, { url: 'https://example.com/two.png' }],
        });

        (provider as any)._client = { post };

        const images = await provider.createImage(
            'A retro-futurist city skyline at dusk',
            'grok-imagine-image',
            { agent_id: 'test-grok-generate' } as any,
            {
                n: 2,
                size: '16:9',
                resolution: '2k',
            }
        );

        expect(images).toEqual(['https://example.com/one.png', 'https://example.com/two.png']);
        expect(post).toHaveBeenCalledWith('/images/generations', {
            body: {
                model: 'grok-imagine-image',
                prompt: 'A retro-futurist city skyline at dusk',
                n: 2,
                aspect_ratio: '16:9',
                resolution: '2k',
            },
        });

        const costsByModel = costTracker.getCostsByModel();
        expect(costsByModel['grok-imagine-image']?.cost).toBeCloseTo(0.04);
        expect(costsByModel['grok-imagine-image']?.calls).toBe(1);
    });

    it('uses xAI image edit endpoint for multiple source images and bills inputs plus outputs', async () => {
        const provider = new GrokProvider();
        const post = vi.fn().mockResolvedValue({
            data: [{ b64_json: 'YWJjMTIz' }],
        });

        (provider as any)._client = { post };

        const images = await provider.createImage(
            'Turn these into a charcoal concept illustration',
            'grok-imagine-image-pro',
            { agent_id: 'test-grok-edit' } as any,
            {
                response_format: 'b64_json',
                size: 'auto',
                source_images: [
                    'https://example.com/reference.png',
                    {
                        data: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7+XxkAAAAASUVORK5CYII=',
                        metadata: { title: 'second-source' },
                    },
                ],
            }
        );

        expect(images).toEqual(['data:image/png;base64,YWJjMTIz']);
        expect(post).toHaveBeenCalledWith('/images/edits', {
            body: {
                model: 'grok-imagine-image-pro',
                prompt: 'Turn these into a charcoal concept illustration',
                n: 1,
                response_format: 'b64_json',
                aspect_ratio: 'auto',
                images: [
                    {
                        type: 'image_url',
                        url: 'https://example.com/reference.png',
                    },
                    {
                        type: 'image_url',
                        url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7+XxkAAAAASUVORK5CYII=',
                    },
                ],
            },
        });

        const costsByModel = costTracker.getCostsByModel();
        expect(costsByModel['grok-imagine-image-pro']?.cost).toBeCloseTo(0.07);
        expect(costsByModel['grok-imagine-image-pro']?.calls).toBe(1);
    });

    it('uses xAI image edit endpoint object shape for a single source image', async () => {
        const provider = new GrokProvider();
        const post = vi.fn().mockResolvedValue({
            data: [{ url: 'https://example.com/edited.png' }],
        });

        (provider as any)._client = { post };

        const images = await provider.createImage(
            'Turn this sketch into a polished interface',
            'grok-imagine-image',
            { agent_id: 'test-grok-single-edit' } as any,
            {
                source_images: ['https://example.com/sketch.png'],
            }
        );

        expect(images).toEqual(['https://example.com/edited.png']);
        expect(post).toHaveBeenCalledWith('/images/edits', {
            body: {
                model: 'grok-imagine-image',
                prompt: 'Turn this sketch into a polished interface',
                n: 1,
                image: {
                    url: 'https://example.com/sketch.png',
                },
            },
        });

        const costsByModel = costTracker.getCostsByModel();
        expect(costsByModel['grok-imagine-image']?.cost).toBeCloseTo(0.022);
        expect(costsByModel['grok-imagine-image']?.calls).toBe(1);
    });

    it('polls the native xAI video endpoint and records resolution pricing', async () => {
        const provider = new GrokProvider();
        const post = vi.fn().mockResolvedValue({ request_id: 'video-123', status: 'pending' });
        const get = vi.fn().mockResolvedValue({
            request_id: 'video-123',
            status: 'done',
            video: { url: 'https://example.com/video.mp4', duration: 6 },
        });
        (provider as any)._client = { post, get };

        const videos = await provider.createVideo(
            'A satellite glides over the ocean',
            'grok-imagine-video',
            { agent_id: 'test-grok-video' } as any,
            { duration: 6, resolution: '720p', poll_interval_ms: 0 }
        );

        expect(videos).toEqual(['https://example.com/video.mp4']);
        expect(post).toHaveBeenCalledWith('/videos/generations', {
            body: {
                model: 'grok-imagine-video',
                prompt: 'A satellite glides over the ocean',
                duration: 6,
                resolution: '720p',
            },
        });
        expect(get).toHaveBeenCalledWith('/videos/video-123');
        expect(costTracker.getCostsByModel()['grok-imagine-video']?.cost).toBeCloseTo(0.42);
    });
});
