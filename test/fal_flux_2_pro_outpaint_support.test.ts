import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { findModel } from '../data/model_data.js';
import { FALProvider } from '../model_providers/fal.js';
import { getModelProvider, getProviderFromModel } from '../model_providers/model_provider.js';
import { costTracker } from '../utils/cost_tracker.js';

const originalFalKey = process.env.FAL_KEY;

describe('FAL FLUX.2 Pro outpaint support', () => {
    beforeEach(() => {
        process.env.FAL_KEY = 'fal-test';
        costTracker.reset();
    });

    afterEach(() => {
        process.env.FAL_KEY = originalFalKey;
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it('registers the FLUX.2 Pro outpaint model with FAL pricing metadata', () => {
        expect(findModel('fal-ai/flux-2-pro/outpaint')).toMatchObject({
            id: 'fal-ai/flux-2-pro/outpaint',
            aliases: ['fal-flux-2-pro-outpaint', 'fal-ai-flux-2-pro-outpaint'],
            provider: 'fal',
            cost: { per_image: 0.03 },
            features: {
                input_modality: ['image'],
                output_modality: ['image'],
            },
            class: 'image_generation',
        });
    });

    it('routes the registered slash model through the FAL provider', () => {
        expect(getProviderFromModel('fal-ai/flux-2-pro/outpaint')).toBe('fal');
        expect(getModelProvider('fal-ai/flux-2-pro/outpaint')).toBeInstanceOf(FALProvider);
    });

    it('calls the FLUX.2 Pro outpaint endpoint with supported options only', async () => {
        const provider = new FALProvider();
        const fetchMock = vi.fn().mockResolvedValue(
            new Response(
                JSON.stringify({
                    images: [{ url: 'https://example.com/flux-outpainted.png' }],
                }),
                {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' },
                }
            )
        );
        vi.stubGlobal('fetch', fetchMock);

        const images = await provider.createImage(
            'This prompt is intentionally not sent by the FAL FLUX.2 Pro outpaint API',
            'fal-ai/flux-2-pro/outpaint',
            {
                agent_id: 'test-fal-flux-outpaint',
            } as any,
            {
                source_images: ['https://example.com/source.png'],
                expand_left: 128,
                expand_right: 256,
                expand_top: 0,
                expand_bottom: 64,
                auto_crop: true,
                enable_safety_checker: false,
                output_format: 'png',
                n: 4,
                seed: 1234,
                response_format: 'b64_json',
                request_id: 'flux-outpaint-request',
            }
        );

        expect(images).toEqual(['https://example.com/flux-outpainted.png']);
        expect(fetchMock).toHaveBeenCalledWith('https://fal.run/fal-ai/flux-2-pro/outpaint', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: 'Key fal-test',
            },
            body: JSON.stringify({
                image_url: 'https://example.com/source.png',
                expand_left: 128,
                expand_right: 256,
                expand_top: 0,
                expand_bottom: 64,
                auto_crop: true,
                enable_safety_checker: false,
                output_format: 'png',
                sync_mode: true,
            }),
        });

        expect(costTracker.getTotalCost()).toBeCloseTo(0.03);
        expect(costTracker.getCostsByModel()['fal-ai/flux-2-pro/outpaint']?.calls).toBe(1);
    });

    it('tracks FLUX.2 Pro outpaint cost from returned output dimensions', async () => {
        const provider = new FALProvider();
        const fetchMock = vi.fn().mockResolvedValue(
            new Response(
                JSON.stringify({
                    images: [
                        {
                            url: 'https://example.com/flux-outpainted.jpg',
                            width: 1920,
                            height: 1080,
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
            '',
            'fal-ai/flux-2-pro/outpaint',
            {
                agent_id: 'test-fal-flux-outpaint',
            } as any,
            {
                source_images: ['https://example.com/source.png'],
                expand_left: 300,
                request_id: 'flux-outpaint-dimensions-request',
            }
        );

        expect(images).toEqual(['https://example.com/flux-outpainted.jpg']);
        expect(costTracker.getTotalCost()).toBeCloseTo(0.045);
        expect(costTracker.getCostsByModel()['fal-ai/flux-2-pro/outpaint']?.calls).toBe(1);
    });

    it('requires exactly one source image for FLUX.2 Pro outpaint', async () => {
        const provider = new FALProvider();

        await expect(
            provider.createImage('', 'fal-ai/flux-2-pro/outpaint', {
                agent_id: 'test-fal-flux-outpaint',
            } as any)
        ).rejects.toThrow('requires exactly one source image');

        await expect(
            provider.createImage(
                '',
                'fal-ai/flux-2-pro/outpaint',
                {
                    agent_id: 'test-fal-flux-outpaint',
                } as any,
                {
                    source_images: ['https://example.com/one.png', 'https://example.com/two.png'],
                }
            )
        ).rejects.toThrow('supports exactly one source image');
    });
});
