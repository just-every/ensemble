import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { findModel, MODEL_CLASSES } from '../data/model_data.js';
import { OpenAIProvider } from '../model_providers/openai.js';
import {
    getOpenAIImageCostEstimate,
    normalizeOpenAIImageQuality,
    normalizeOpenAIImageSize,
} from '../model_providers/openai_image_pricing.js';
import { costTracker } from '../utils/cost_tracker.js';

const resolvedImageRequest = (data: unknown, requestId = 'req_openai_image_25_test') => ({
    withResponse: vi.fn().mockResolvedValue({ data, request_id: requestId }),
});

describe('gpt-image-2.5 support', () => {
    beforeEach(() => {
        costTracker.reset();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('registers exact Flare and Sunburst IDs and snapshots without changing the image default', () => {
        expect(MODEL_CLASSES.image_generation.models[0]).toBe('gpt-image-2');

        for (const [id, snapshot] of [
            ['gpt-image-2.5-flare', 'gpt-image-2.5-flare-2026-09-08'],
            ['gpt-image-2.5-sunburst', 'gpt-image-2.5-sunburst-2026-09-08'],
        ]) {
            expect(findModel(id)).toMatchObject({
                id,
                aliases: [snapshot],
                provider: 'openai',
                cost: {
                    input_per_million: { text: 5.0, image: 8.0 },
                    cached_input_per_million: { text: 1.25, image: 2.0 },
                    output_per_million: { image: 30.0 },
                },
                features: {
                    input_modality: ['text', 'image'],
                    output_modality: ['image'],
                    streaming: false,
                },
                class: 'image_generation',
            });
            expect(findModel(id)?.cost?.per_image).toBeUndefined();
            expect(findModel(snapshot)?.id).toBe(id);
        }
    });

    it('keeps 2.5-only qualities and Image 2 family geometry in the provider request contract', () => {
        expect(normalizeOpenAIImageQuality('gpt-image-2.5-flare', 'xhigh')).toBe('xhigh');
        expect(normalizeOpenAIImageQuality('gpt-image-2.5-sunburst', 'max')).toBe('max');
        expect(normalizeOpenAIImageQuality('gpt-image-2', 'max')).toBe('auto');
        expect(normalizeOpenAIImageSize('gpt-image-2.5-flare', '2048x1152')).toBe('2048x1152');
        expect(normalizeOpenAIImageSize('gpt-image-2.5-sunburst', '3:4')).toBe('1088x1456');
        expect(normalizeOpenAIImageSize('gpt-image-2.5-flare', '4:1')).toBe('auto');
        expect(() => normalizeOpenAIImageSize('gpt-image-2.5-flare', '4096x1600')).toThrow(
            'neither edge can exceed 3840px'
        );
        expect(getOpenAIImageCostEstimate('gpt-image-2.5-flare', 'xhigh', '2048x1152')).toBeUndefined();
    });

    it('sends a transparent PNG 2.5 generation and costs returned provider token usage', async () => {
        const provider = new OpenAIProvider('sk-test');
        const generate = vi.fn().mockReturnValue(
            resolvedImageRequest({
                data: [{ b64_json: 'YWJjMTIz' }],
                usage: {
                    input_tokens: 150,
                    input_tokens_details: {
                        text_tokens: 100,
                        image_tokens: 50,
                    },
                    output_tokens: 5500,
                    total_tokens: 5650,
                },
            })
        );

        (provider as any)._client = { images: { generate } };

        const images = await provider.createImage(
            'A product cutout with a transparent background',
            'gpt-image-2.5-flare',
            { agent_id: 'test-gpt-image-2-5-generation' } as any,
            {
                background: 'transparent',
                quality: 'xhigh',
                size: '2048x1152',
            }
        );

        expect(images).toEqual(['data:image/png;base64,YWJjMTIz']);
        expect(generate).toHaveBeenCalledWith(
            {
                model: 'gpt-image-2.5-flare',
                prompt: 'A product cutout with a transparent background',
                n: 1,
                background: 'transparent',
                quality: 'xhigh',
                size: '2048x1152',
                moderation: 'low',
                output_format: 'png',
            },
            expect.objectContaining({
                timeout: 300_000,
                maxRetries: 0,
                signal: expect.any(AbortSignal),
            })
        );

        const expectedCost = (100 / 1_000_000) * 5 + (50 / 1_000_000) * 8 + (5500 / 1_000_000) * 30;
        expect(costTracker.getTotalCost()).toBeCloseTo(expectedCost);
        expect(costTracker.getCostsByModel()['gpt-image-2.5-flare']).toEqual({ cost: expectedCost, calls: 1 });
    });

    it('uses the edit endpoint for 2.5 references and does not create a fictional cost without usage', async () => {
        const provider = new OpenAIProvider('sk-test');
        const edit = vi.fn().mockReturnValue(
            resolvedImageRequest({
                data: [{ b64_json: 'YWJjMTIz' }],
            })
        );

        (provider as any)._client = { images: { edit } };

        await provider.createImage(
            'Replace only the label while preserving the product and backdrop',
            'gpt-image-2.5-sunburst',
            { agent_id: 'test-gpt-image-2-5-edit' } as any,
            {
                source_images: 'data:image/png;base64,YWJjMTIz',
                mask: 'data:image/png;base64,ZGVmNDU2',
                background: 'transparent',
                quality: 'max',
                size: '1536x1024',
                input_fidelity: 'high',
            }
        );

        const editParams = edit.mock.calls[0]?.[0];
        expect(editParams).toMatchObject({
            model: 'gpt-image-2.5-sunburst',
            prompt: 'Replace only the label while preserving the product and backdrop',
            n: 1,
            background: 'transparent',
            quality: 'max',
            size: '1536x1024',
            moderation: 'low',
            output_format: 'png',
        });
        expect(editParams).not.toHaveProperty('input_fidelity');
        expect(editParams.image).toHaveLength(1);
        expect(editParams.mask).toBeDefined();
        expect(costTracker.getTotalCost()).toBe(0);
        expect(costTracker.getCostsByModel()['gpt-image-2.5-sunburst']).toBeUndefined();
    });
});
