import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { findModel, MODEL_CLASSES } from '../data/model_data.js';
import { OpenAIProvider } from '../model_providers/openai.js';
import { getOpenAIImageCostEstimate, normalizeOpenAIImageSize } from '../model_providers/openai_image_pricing.js';
import { costTracker } from '../utils/cost_tracker.js';

const resolvedImageRequest = (data: unknown, requestId = 'req_openai_image_test') => ({
    withResponse: vi.fn().mockResolvedValue({ data, request_id: requestId }),
});

describe('gpt-image-2 support', () => {
    beforeEach(() => {
        costTracker.reset();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('registers gpt-image-2 with OpenAI token pricing and aliases', () => {
        expect(MODEL_CLASSES.image_generation.models[0]).toBe('gpt-image-2');
        expect(findModel('gpt-image-2')).toMatchObject({
            id: 'gpt-image-2',
            aliases: ['gpt-image-2-2026-04-21'],
            provider: 'openai',
            cost: {
                per_image: 0.053,
                input_per_million: {
                    text: 5.0,
                    image: 8.0,
                },
                cached_input_per_million: {
                    text: 1.25,
                    image: 2.0,
                },
                output_per_million: {
                    text: 10.0,
                    image: 30.0,
                },
            },
            features: {
                input_modality: ['text', 'image'],
                output_modality: ['image'],
            },
            class: 'image_generation',
        });
        expect(findModel('gpt-image-2-2026-04-21')?.id).toBe('gpt-image-2');
    });

    it('passes flexible gpt-image-2 sizes to OpenAI and tracks returned token usage', async () => {
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

        (provider as any)._client = {
            images: {
                generate,
            },
        };

        const images = await provider.createImage(
            'A polished product render on a clean studio backdrop',
            'gpt-image-2',
            { agent_id: 'test-gpt-image-2' } as any,
            {
                quality: 'high',
                size: '2048x1152',
            }
        );

        expect(images).toEqual(['data:image/png;base64,YWJjMTIz']);
        expect(generate).toHaveBeenCalledWith(
            {
                model: 'gpt-image-2',
                prompt: 'A polished product render on a clean studio backdrop',
                n: 1,
                background: 'auto',
                quality: 'high',
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
        expect(costTracker.getCostsByModel()['gpt-image-2']?.calls).toBe(1);
    });

    it('maps provider-neutral aspect ratios to flexible gpt-image-2 pixel sizes', async () => {
        expect(normalizeOpenAIImageSize('gpt-image-2', '1:1')).toBe('1024x1024');
        expect(normalizeOpenAIImageSize('gpt-image-2', '2:3')).toBe('1024x1536');
        expect(normalizeOpenAIImageSize('gpt-image-2', '3:2')).toBe('1536x1024');
        expect(normalizeOpenAIImageSize('gpt-image-2', '3:4')).toBe('1088x1456');
        expect(normalizeOpenAIImageSize('gpt-image-2', '21:9')).toBe('1920x816');
        expect(normalizeOpenAIImageSize('gpt-image-2', '4:1')).toBe('auto');
        expect(normalizeOpenAIImageSize('gpt-image-1', '3:4')).toBe('auto');
    });

    it('sends normalized aspect-ratio sizes for gpt-image-2 requests', async () => {
        const provider = new OpenAIProvider('sk-test');
        const addUsageSpy = vi.spyOn(costTracker, 'addUsage');
        const generate = vi.fn().mockReturnValue(
            resolvedImageRequest({
                data: [{ b64_json: 'YWJjMTIz' }],
            })
        );

        (provider as any)._client = {
            images: {
                generate,
            },
        };

        await provider.createImage(
            'A clean poster with the original composition preserved',
            'gpt-image-2',
            { agent_id: 'test-gpt-image-2-aspect' } as any,
            {
                quality: 'medium',
                size: '3:4',
            }
        );

        expect(generate).toHaveBeenCalledWith(
            expect.objectContaining({
                model: 'gpt-image-2',
                quality: 'medium',
                size: '1088x1456',
            }),
            expect.objectContaining({
                timeout: 300_000,
                maxRetries: 0,
            })
        );
        expect(costTracker.getCostsByModel()['gpt-image-2']?.cost).toBeCloseTo(0.04647);
        expect(addUsageSpy.mock.calls[0]?.[0]).toMatchObject({
            model: 'gpt-image-2',
            image_count: 1,
            cost: 0.04647,
            metadata: {
                quality: 'medium',
                size: '1088x1456',
                pricing_source: 'ensemble_size_estimate',
                cost_per_image: 0.04647,
                estimated: true,
            },
        });
    });

    it('uses documented common-size estimates when OpenAI does not return usage', async () => {
        const provider = new OpenAIProvider('sk-test');
        const generate = vi.fn().mockReturnValue(
            resolvedImageRequest({
                data: [{ b64_json: 'YWJjMTIz' }],
            })
        );

        (provider as any)._client = {
            images: {
                generate,
            },
        };

        await provider.createImage(
            'A clean architectural poster',
            'gpt-image-2',
            { agent_id: 'test-gpt-image-2-estimate' } as any,
            {
                quality: 'medium',
                size: '1536x1024',
            }
        );

        expect(costTracker.getCostsByModel()['gpt-image-2']?.cost).toBeCloseTo(0.04116);
    });

    it('estimates gpt-image-2 pricing for custom sizes when OpenAI does not return usage', async () => {
        const provider = new OpenAIProvider('sk-test');
        const addUsageSpy = vi.spyOn(costTracker, 'addUsage');
        const generate = vi.fn().mockReturnValue(
            resolvedImageRequest({
                data: [{ b64_json: 'YWJjMTIz' }],
            })
        );

        (provider as any)._client = {
            images: {
                generate,
            },
        };

        await provider.createImage(
            'A clean architectural poster',
            'gpt-image-2',
            { agent_id: 'test-gpt-image-2-custom-estimate' } as any,
            {
                quality: 'medium',
                size: '2048x1152',
            }
        );

        expect(costTracker.getCostsByModel()['gpt-image-2']?.cost).toBeCloseTo(0.04239);
        expect(addUsageSpy.mock.calls[0]?.[0]).toMatchObject({
            model: 'gpt-image-2',
            image_count: 1,
            cost: 0.04239,
            metadata: {
                quality: 'medium',
                size: '2048x1152',
                pricing_source: 'ensemble_size_estimate',
                estimated_output_tokens: 1413,
                output_price_per_million: 30,
                cost_per_image: 0.04239,
                estimated: true,
            },
        });
    });

    it('uses the official GPT Image 2 calculator for 2K square pricing', () => {
        expect(getOpenAIImageCostEstimate('gpt-image-2', 'low', '1024x1024')).toBeCloseTo(0.00588);
        expect(getOpenAIImageCostEstimate('gpt-image-2', 'medium', '1024x1024')).toBeCloseTo(0.05268);
        expect(getOpenAIImageCostEstimate('gpt-image-2', 'high', '1024x1024')).toBeCloseTo(0.21072);
        expect(getOpenAIImageCostEstimate('gpt-image-2', 'low', '2048x2048')).toBeCloseTo(0.01191);
        expect(getOpenAIImageCostEstimate('gpt-image-2', 'medium', '2048x2048')).toBeCloseTo(0.10704);
        expect(getOpenAIImageCostEstimate('gpt-image-2', 'high', '2048x2048')).toBeCloseTo(0.42816);
    });
});
