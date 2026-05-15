import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { findModel } from '../data/model_data.js';
import { FALProvider } from '../model_providers/fal.js';
import { getModelProvider, getProviderFromModel } from '../model_providers/model_provider.js';
import { costTracker } from '../utils/cost_tracker.js';

const originalFalKey = process.env.FAL_KEY;

describe('FAL Recraft Crisp Upscale support', () => {
    beforeEach(() => {
        process.env.FAL_KEY = 'fal-test';
        costTracker.reset();
    });

    afterEach(() => {
        process.env.FAL_KEY = originalFalKey;
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it('registers the Recraft Crisp Upscale model with FAL pricing metadata', () => {
        expect(findModel('fal-ai/recraft/upscale/crisp')).toMatchObject({
            id: 'fal-ai/recraft/upscale/crisp',
            aliases: ['recraft-upscale-crisp', 'fal-recraft-upscale-crisp', 'fal-ai-recraft-upscale-crisp'],
            provider: 'fal',
            cost: { per_image: 0.004 },
            features: {
                input_modality: ['image'],
                output_modality: ['image'],
            },
            class: 'image_generation',
        });
    });

    it('routes the registered slash model and aliases through the FAL provider', () => {
        expect(getProviderFromModel('fal-ai/recraft/upscale/crisp')).toBe('fal');
        expect(getModelProvider('fal-ai/recraft/upscale/crisp')).toBeInstanceOf(FALProvider);
        expect(getProviderFromModel('recraft-upscale-crisp')).toBe('fal');
    });

    it('calls the Recraft Crisp Upscale endpoint with one source image and records cost', async () => {
        const provider = new FALProvider();
        const fetchMock = vi.fn().mockResolvedValue(
            new Response(
                JSON.stringify({
                    image: {
                        url: 'https://example.com/upscaled.png',
                        content_type: 'image/png',
                    },
                }),
                {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' },
                }
            )
        );
        vi.stubGlobal('fetch', fetchMock);

        const images = await provider.createImage(
            'This prompt is intentionally not sent by the Recraft Crisp Upscale API',
            'fal-ai/recraft/upscale/crisp',
            { agent_id: 'test-fal-recraft-upscale-crisp' } as any,
            {
                source_images: ['https://example.com/source.png'],
                enable_safety_checker: true,
                response_format: 'b64_json',
                request_id: 'recraft-upscale-crisp-request',
            }
        );

        expect(images).toEqual(['https://example.com/upscaled.png']);
        expect(fetchMock).toHaveBeenCalledWith('https://fal.run/fal-ai/recraft/upscale/crisp', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: 'Key fal-test',
            },
            body: JSON.stringify({
                image_url: 'https://example.com/source.png',
                enable_safety_checker: true,
                sync_mode: true,
            }),
        });

        expect(costTracker.getTotalCost()).toBeCloseTo(0.004);
        expect(costTracker.getCostsByModel()['fal-ai/recraft/upscale/crisp']?.calls).toBe(1);
    });

    it('requires exactly one source image for Recraft Crisp Upscale', async () => {
        const provider = new FALProvider();

        await expect(
            provider.createImage('', 'fal-ai/recraft/upscale/crisp', {
                agent_id: 'test-fal-recraft-upscale-crisp',
            } as any)
        ).rejects.toThrow('requires exactly one source image');

        await expect(
            provider.createImage(
                '',
                'fal-ai/recraft/upscale/crisp',
                { agent_id: 'test-fal-recraft-upscale-crisp' } as any,
                {
                    source_images: ['https://example.com/one.png', 'https://example.com/two.png'],
                }
            )
        ).rejects.toThrow('supports exactly one source image');
    });
});
