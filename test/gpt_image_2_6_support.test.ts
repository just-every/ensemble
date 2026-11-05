import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { findModel, MODEL_CLASSES } from '../data/model_data.js';
import { OpenAIProvider } from '../model_providers/openai.js';
import {
    getOpenAIImageCostEstimate,
    normalizeOpenAIImageQuality,
    normalizeOpenAIImageSize,
} from '../model_providers/openai_image_pricing.js';
import { costTracker } from '../utils/cost_tracker.js';

const resolvedImageRequest = (data: unknown, requestId = 'req_openai_image_26_test') => ({
    withResponse: vi.fn().mockResolvedValue({ data, request_id: requestId }),
});

const GPT_IMAGE_26_MODELS = ['gpt-image-2.6-flare', 'gpt-image-2.6-sunburst'] as const;

describe('gpt-image-2.6 support', () => {
    beforeEach(() => {
        costTracker.reset();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('registers Flare and Sunburst 2.6 at the 2.5 token rates without a static per-image cost', () => {
        expect(MODEL_CLASSES.image_generation.models[0]).toBe('gpt-image-2');

        for (const id of GPT_IMAGE_26_MODELS) {
            expect(findModel(id)).toMatchObject({
                id,
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
            expect(normalizeOpenAIImageQuality(id, 'xhigh')).toBe('xhigh');
            expect(normalizeOpenAIImageQuality(id, 'max')).toBe('max');
            expect(normalizeOpenAIImageSize(id, '2048x1152')).toBe('2048x1152');
            expect(normalizeOpenAIImageSize(id, '3:4')).toBe('1088x1456');
            expect(() => normalizeOpenAIImageSize(id, '4096x1600')).toThrow('neither edge can exceed 3840px');
            expect(getOpenAIImageCostEstimate(id, 'medium', '1536x1024')).toBeUndefined();
        }
    });

    it('sends an animated GIF generation with complexity and costs the returned usage', async () => {
        const provider = new OpenAIProvider('sk-test');
        const generate = vi.fn().mockReturnValue(
            resolvedImageRequest({
                data: [{ b64_json: 'R0lGODlh' }],
                usage: {
                    input_tokens: 86,
                    input_tokens_details: { text_tokens: 86, image_tokens: 0 },
                    output_tokens: 974,
                    total_tokens: 1060,
                },
            })
        );
        (provider as any)._client = { images: { generate } };

        const images = await provider.createImage(
            'A looping sync-complete icon',
            'gpt-image-2.6-sunburst',
            { agent_id: 'test-gpt-image-2-6-gif' } as any,
            {
                quality: 'medium',
                size: '512x512',
                output_format: 'gif',
                frame_count: 8,
                frame_duration_ms: 120,
                complexity: 'low',
            }
        );

        expect(images).toEqual(['data:image/gif;base64,R0lGODlh']);
        expect(generate.mock.calls[0]?.[0]).toEqual({
            model: 'gpt-image-2.6-sunburst',
            prompt: 'A looping sync-complete icon',
            n: 1,
            background: 'auto',
            quality: 'medium',
            size: '512x512',
            moderation: 'low',
            output_format: 'gif',
            complexity: 'low',
            frame_count: 8,
            frame_duration_ms: 120,
        });
        const expectedCost = (86 / 1_000_000) * 5 + (974 / 1_000_000) * 30;
        expect(costTracker.getCostsByModel()['gpt-image-2.6-sunburst']).toEqual({ cost: expectedCost, calls: 1 });
    });

    it('animates a still through the edit endpoint without input_fidelity', async () => {
        const provider = new OpenAIProvider('sk-test');
        const edit = vi.fn().mockReturnValue(resolvedImageRequest({ data: [{ b64_json: 'R0lGODlh' }] }));
        (provider as any)._client = { images: { edit } };

        const images = await provider.createImage(
            'Animate an ambient loop of this hero',
            'gpt-image-2.6-flare',
            { agent_id: 'test-gpt-image-2-6-edit-gif' } as any,
            {
                source_images: 'data:image/png;base64,YWJjMTIz',
                quality: 'low',
                size: '768x512',
                output_format: 'gif',
                frame_count: 8,
                input_fidelity: 'high',
            }
        );

        expect(images).toEqual(['data:image/gif;base64,R0lGODlh']);
        const editParams = edit.mock.calls[0]?.[0];
        expect(editParams).toMatchObject({
            model: 'gpt-image-2.6-flare',
            quality: 'low',
            size: '768x512',
            output_format: 'gif',
            frame_count: 8,
        });
        expect(editParams).not.toHaveProperty('input_fidelity');
        expect(editParams).not.toHaveProperty('frame_duration_ms');
    });

    it('refuses output fields a model cannot take instead of returning an unrequested PNG', async () => {
        const provider = new OpenAIProvider('sk-test');
        const generate = vi.fn();
        (provider as any)._client = { images: { generate } };
        const agent = { agent_id: 'test-gpt-image-2-6-refusals' } as any;

        await expect(
            provider.createImage('x', 'gpt-image-2.6-flare', agent, { output_format: 'webp', frame_count: 4 })
        ).rejects.toThrow("require output_format 'gif'");
        await expect(provider.createImage('x', 'gpt-image-2.6-flare', agent, { output_format: 'svg' })).rejects.toThrow(
            'needs an authoring model'
        );
        await expect(provider.createImage('x', 'gpt-image-2.5-flare', agent, { output_format: 'gif' })).rejects.toThrow(
            'use GPT Image 2.6'
        );
        await expect(provider.createImage('x', 'gpt-image-2', agent, { complexity: 'low' })).rejects.toThrow(
            'use GPT Image 2.6'
        );
        expect(generate).not.toHaveBeenCalled();
    });
});
