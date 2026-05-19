import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { findModel } from '../data/model_data.js';
import { FALProvider } from '../model_providers/fal.js';
import { getModelProvider, getProviderFromModel } from '../model_providers/model_provider.js';
import { costTracker } from '../utils/cost_tracker.js';

const originalFalKey = process.env.FAL_KEY;

describe('FAL image2svg support', () => {
    beforeEach(() => {
        process.env.FAL_KEY = 'fal-test';
        costTracker.reset();
    });

    afterEach(() => {
        process.env.FAL_KEY = originalFalKey;
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it('registers image2svg with FAL pricing metadata', () => {
        expect(findModel('fal-ai/image2svg')).toMatchObject({
            id: 'fal-ai/image2svg',
            aliases: ['image2svg', 'fal-image2svg'],
            provider: 'fal',
            cost: { per_image: 0.005 },
            features: {
                input_modality: ['image'],
                output_modality: ['image'],
            },
            class: 'image_generation',
        });
    });

    it('routes FAL slash paths through the FAL provider', () => {
        expect(getProviderFromModel('fal-ai/image2svg')).toBe('fal');
        expect(getModelProvider('fal-ai/image2svg')).toBeInstanceOf(FALProvider);
    });

    it('calls the image2svg endpoint with one source image and records per-image cost', async () => {
        const provider = new FALProvider();
        const fetchMock = vi.fn().mockResolvedValue(
            new Response(
                JSON.stringify({
                    images: [
                        {
                            url: 'https://example.com/output.svg',
                            content_type: 'image/svg+xml',
                            file_name: 'output.svg',
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

        const images = await provider.createImage('', 'fal-ai/image2svg', { agent_id: 'test-fal-image2svg' } as any, {
            source_images: ['https://example.com/source.png'],
            image2svg: {
                colormode: 'binary',
                hierarchical: 'cutout',
                mode: 'polygon',
                path_precision: 2,
            },
            request_id: 'image2svg-request',
        });

        expect(images).toEqual(['https://example.com/output.svg']);
        expect(fetchMock).toHaveBeenCalledWith('https://fal.run/fal-ai/image2svg', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: 'Key fal-test',
            },
            body: JSON.stringify({
                image_url: 'https://example.com/source.png',
                colormode: 'binary',
                hierarchical: 'cutout',
                mode: 'polygon',
                path_precision: 2,
            }),
        });

        expect(costTracker.getTotalCost()).toBeCloseTo(0.005);
        expect(costTracker.getCostsByModel()['fal-ai/image2svg']?.calls).toBe(1);
    });

    it('maps unregistered fal-ai slash paths to their matching FAL endpoint', async () => {
        const provider = new FALProvider();
        const fetchMock = vi.fn().mockResolvedValue(
            new Response(JSON.stringify({ images: [{ url: 'https://example.com/output.png' }] }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            })
        );
        vi.stubGlobal('fetch', fetchMock);

        const images = await provider.createImage('draw a small icon', 'fal-ai/example-model', {
            agent_id: 'test-fal-auto-path',
        } as any);

        expect(images).toEqual(['https://example.com/output.png']);
        expect(fetchMock).toHaveBeenCalledWith('https://fal.run/fal-ai/example-model', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: 'Key fal-test',
            },
            body: JSON.stringify({
                prompt: 'draw a small icon',
            }),
        });
        expect(costTracker.getCostsByModel()['fal-ai/example-model']).toBeUndefined();
    });

    it('requires exactly one source image for image2svg', async () => {
        const provider = new FALProvider();

        await expect(
            provider.createImage('', 'fal-ai/image2svg', { agent_id: 'test-fal-image2svg' } as any)
        ).rejects.toThrow('requires exactly one source image');

        await expect(
            provider.createImage('', 'fal-ai/image2svg', { agent_id: 'test-fal-image2svg' } as any, {
                source_images: ['https://example.com/one.png', 'https://example.com/two.png'],
            })
        ).rejects.toThrow('supports exactly one source image');
    });
});
