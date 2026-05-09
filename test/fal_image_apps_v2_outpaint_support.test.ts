import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { findModel } from '../data/model_data.js';
import { FALProvider } from '../model_providers/fal.js';
import { getModelProvider, getProviderFromModel } from '../model_providers/model_provider.js';
import { costTracker } from '../utils/cost_tracker.js';

const originalFalKey = process.env.FAL_KEY;

describe('FAL image-apps-v2 outpaint support', () => {
    beforeEach(() => {
        process.env.FAL_KEY = 'fal-test';
        costTracker.reset();
    });

    afterEach(() => {
        process.env.FAL_KEY = originalFalKey;
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it('registers the outpaint model with FAL pricing metadata', () => {
        expect(findModel('fal-ai/image-apps-v2/outpaint')).toMatchObject({
            id: 'fal-ai/image-apps-v2/outpaint',
            aliases: ['fal-image-apps-v2-outpaint', 'fal-ai-image-apps-v2-outpaint'],
            provider: 'fal',
            cost: { per_image: 0.035 },
            features: {
                input_modality: ['text', 'image'],
                output_modality: ['image'],
            },
            class: 'image_generation',
        });
    });

    it('routes the registered slash model through the FAL provider', () => {
        expect(getProviderFromModel('fal-ai/image-apps-v2/outpaint')).toBe('fal');
        expect(getModelProvider('fal-ai/image-apps-v2/outpaint')).toBeInstanceOf(FALProvider);
    });

    it('calls the outpaint endpoint with source image and directional expansion options', async () => {
        const provider = new FALProvider();
        const fetchMock = vi.fn().mockResolvedValue(
            new Response(
                JSON.stringify({
                    images: [
                        { url: 'https://example.com/outpainted-left.png' },
                        { url: 'https://example.com/outpainted-right.png' },
                    ],
                }),
                {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' },
                }
            )
        );
        vi.stubGlobal('fetch', fetchMock);

        const images = await provider.createImage(
            'Add a dramatic skyline to the right edge',
            'fal-ai/image-apps-v2/outpaint',
            {
                agent_id: 'test-fal-outpaint',
            } as any,
            {
                source_images: ['https://example.com/source.png'],
                expand_left: 128,
                expand_right: 256,
                expand_top: 0,
                expand_bottom: 64,
                zoom_out_percentage: 20,
                enable_safety_checker: false,
                output_format: 'webp',
                n: 2,
                seed: 1234,
                response_format: 'b64_json',
                request_id: 'outpaint-request',
            }
        );

        expect(images).toEqual(['https://example.com/outpainted-left.png', 'https://example.com/outpainted-right.png']);
        expect(fetchMock).toHaveBeenCalledWith('https://fal.run/fal-ai/image-apps-v2/outpaint', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: 'Key fal-test',
            },
            body: JSON.stringify({
                image_url: 'https://example.com/source.png',
                num_images: 2,
                prompt: 'Add a dramatic skyline to the right edge',
                expand_left: 128,
                expand_right: 256,
                expand_top: 0,
                expand_bottom: 64,
                zoom_out_percentage: 20,
                enable_safety_checker: false,
                output_format: 'webp',
                sync_mode: true,
                seed: 1234,
            }),
        });

        expect(costTracker.getTotalCost()).toBeCloseTo(0.07);
        expect(costTracker.getCostsByModel()['fal-ai/image-apps-v2/outpaint']?.calls).toBe(1);
    });

    it('tracks outpaint cost based on returned megapixel output dimensions', async () => {
        const provider = new FALProvider();
        const fetchMock = vi.fn().mockResolvedValue(
            new Response(
                JSON.stringify({
                    images: [
                        {
                            url: 'https://example.com/outpainted.png',
                            width: 1000,
                            height: 1000,
                        },
                    ],
                }),
                {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' },
                }
            )
        );
        vi.stubGlobal('fetch', fetchMock);

        const images = await provider.createImage(
            'Extend the scene to the left',
            'fal-ai/image-apps-v2/outpaint',
            {
                agent_id: 'test-fal-outpaint',
            } as any,
            {
                source_images: ['https://example.com/source.png'],
                expand_left: 300,
                response_format: 'url',
                request_id: 'outpaint-mp-request',
            }
        );

        expect(images).toEqual(['https://example.com/outpainted.png']);
        expect(costTracker.getTotalCost()).toBeCloseTo(0.035);
        expect(costTracker.getCostsByModel()['fal-ai/image-apps-v2/outpaint']?.calls).toBe(1);
    });

    it('requires exactly one source image for outpaint', async () => {
        const provider = new FALProvider();

        await expect(
            provider.createImage('outpaint', 'fal-ai/image-apps-v2/outpaint', {
                agent_id: 'test-fal-outpaint',
            } as any)
        ).rejects.toThrow('requires exactly one source image');

        await expect(
            provider.createImage(
                'outpaint',
                'fal-ai/image-apps-v2/outpaint',
                {
                    agent_id: 'test-fal-outpaint',
                } as any,
                {
                    source_images: ['https://example.com/one.png', 'https://example.com/two.png'],
                }
            )
        ).rejects.toThrow('supports exactly one source image');
    });
});
