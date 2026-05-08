import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { findModel } from '../data/model_data.js';
import { FALProvider } from '../model_providers/fal.js';
import { getModelProvider } from '../model_providers/model_provider.js';
import { costTracker } from '../utils/cost_tracker.js';

const originalFalKey = process.env.FAL_KEY;

describe('FAL Ideogram remove background support', () => {
    beforeEach(() => {
        process.env.FAL_KEY = 'fal-test';
        costTracker.reset();
    });

    afterEach(() => {
        process.env.FAL_KEY = originalFalKey;
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it('registers the Ideogram remove-background model with FAL pricing metadata', () => {
        expect(findModel('fal-ai/ideogram/remove-background')).toMatchObject({
            id: 'fal-ai/ideogram/remove-background',
            aliases: ['ideogram-remove-background'],
            provider: 'fal',
            cost: { per_image: 0.01 },
            features: {
                input_modality: ['image'],
                output_modality: ['image'],
            },
            class: 'image_generation',
        });
    });

    it('routes the registered slash model through the FAL provider', () => {
        expect(getModelProvider('fal-ai/ideogram/remove-background')).toBeInstanceOf(FALProvider);
    });

    it('calls the FAL remove-background endpoint with one source image and records cost', async () => {
        const provider = new FALProvider();
        const fetchMock = vi.fn().mockResolvedValue(
            new Response(
                JSON.stringify({
                    image: {
                        url: 'https://example.com/no-background.png',
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
            '',
            'fal-ai/ideogram/remove-background',
            { agent_id: 'test-fal-remove-background' } as any,
            {
                source_images: ['https://example.com/source.png'],
                request_id: 'remove-bg-request',
            }
        );

        expect(images).toEqual(['https://example.com/no-background.png']);
        expect(fetchMock).toHaveBeenCalledWith('https://fal.run/fal-ai/ideogram/remove-background', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: 'Key fal-test',
            },
            body: JSON.stringify({
                image_url: 'https://example.com/source.png',
            }),
        });

        expect(costTracker.getTotalCost()).toBeCloseTo(0.01);
        expect(costTracker.getCostsByModel()['fal-ai/ideogram/remove-background']?.calls).toBe(1);
    });

    it('requires exactly one source image for background removal', async () => {
        const provider = new FALProvider();

        await expect(
            provider.createImage('', 'fal-ai/ideogram/remove-background', {
                agent_id: 'test-fal-remove-background',
            } as any)
        ).rejects.toThrow('requires exactly one source image');

        await expect(
            provider.createImage(
                '',
                'fal-ai/ideogram/remove-background',
                { agent_id: 'test-fal-remove-background' } as any,
                {
                    source_images: ['https://example.com/one.png', 'https://example.com/two.png'],
                }
            )
        ).rejects.toThrow('supports exactly one source image');
    });
});
