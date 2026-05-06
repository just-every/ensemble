/**
 * Grok model provider for the ensemble system.
 *
 * We extend OpenAIChat as Grok is a drop in replacement for chat APIs,
 * but xAI image generation/editing uses JSON endpoints that differ from
 * OpenAI's multipart image edit API.
 */

import type { AgentDefinition, ImageGenerationOpts } from '../types/types.js';
import { findModel } from '../data/model_data.js';
import { costTracker } from '../utils/cost_tracker.js';
import { log_llm_error, log_llm_request, log_llm_response } from '../utils/llm_logger.js';
import { OpenAIChat } from './openai_chat.js';
import OpenAI from 'openai';

type XAIImageRequestImage = {
    type: 'image_url';
    url: string;
};

type XAIImageResponse = {
    created?: number;
    data?: Array<{
        url?: string;
        b64_json?: string;
    }>;
    model?: string;
};

type SourceImageInput = NonNullable<ImageGenerationOpts['source_images']>;

function normalizeAspectRatio(size?: ImageGenerationOpts['size']): string | undefined {
    if (!size) return undefined;

    const aspectMap: Record<string, string> = {
        auto: 'auto',
        square: '1:1',
        landscape: '3:2',
        portrait: '2:3',
        '256x256': '1:1',
        '512x512': '1:1',
        '1024x1024': '1:1',
        '1536x1024': '3:2',
        '1024x1536': '2:3',
        '1792x1024': '16:9',
        '1024x1792': '9:16',
        '1696x2528': '2:3',
        '2048x2048': '1:1',
        '1:1': '1:1',
        '1:4': '1:4',
        '1:8': '1:8',
        '2:3': '2:3',
        '3:2': '3:2',
        '3:4': '3:4',
        '4:1': '4:1',
        '4:3': '4:3',
        '4:5': '4:5',
        '5:4': '5:4',
        '8:1': '8:1',
        '9:16': '9:16',
        '9:19.5': '9:19.5',
        '9:20': '9:20',
        '16:9': '16:9',
        '19.5:9': '19.5:9',
        '20:9': '20:9',
        '21:9': '21:9',
    };

    return aspectMap[String(size)];
}

function normalizeResolution(opts: ImageGenerationOpts): '1k' | '2k' | undefined {
    if (opts.resolution === '1k' || opts.resolution === '2k') {
        return opts.resolution;
    }

    if (opts.quality === 'hd' || opts.quality === 'high') {
        return '2k';
    }

    return undefined;
}

function normalizeSourceImages(sourceImages?: SourceImageInput): XAIImageRequestImage[] {
    if (!sourceImages) return [];

    const rawImages = Array.isArray(sourceImages) ? sourceImages : [sourceImages];

    return rawImages.map((sourceImage, index) => {
        const url =
            typeof sourceImage === 'string'
                ? sourceImage
                : typeof sourceImage === 'object' && sourceImage !== null && 'data' in sourceImage
                  ? sourceImage.data
                  : undefined;

        if (typeof url !== 'string' || url.length === 0) {
            throw new Error(`xAI image editing source image ${index + 1} is missing image data.`);
        }

        if (!url.startsWith('http://') && !url.startsWith('https://') && !url.startsWith('data:image/')) {
            throw new Error(
                'xAI image editing expects each source image to be a public URL or a data:image/... base64 URI.'
            );
        }

        return {
            type: 'image_url' as const,
            url,
        };
    });
}

function extractImages(response: XAIImageResponse): string[] {
    return (response.data || [])
        .map(item => {
            if (typeof item?.b64_json === 'string' && item.b64_json.length > 0) {
                return `data:image/png;base64,${item.b64_json}`;
            }
            if (typeof item?.url === 'string' && item.url.length > 0) {
                return item.url;
            }
            return null;
        })
        .filter((image): image is string => image !== null);
}

function getPerImageCost(model: string): number | undefined {
    const pricing = findModel(model)?.cost?.per_image;
    return typeof pricing === 'number' ? pricing : undefined;
}

/**
 * Grok model provider implementation
 */
export class GrokProvider extends OpenAIChat {
    constructor() {
        super('xai', process.env.XAI_API_KEY, 'https://api.x.ai/v1');
    }

    prepareParameters(
        requestParams: OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming
    ): OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming {
        if (Array.isArray(requestParams.tools)) {
            const index = requestParams.tools.findIndex(
                t => t.type === 'function' && (t as any).function?.name === 'grok_web_search'
            );
            if (index !== -1) {
                requestParams.tools.splice(index, 1);
                (requestParams as any).search_parameters = {
                    mode: 'on',
                    return_citations: true,
                };
            }
        }

        const reasoningEffort = (requestParams as any).reasoning?.effort;
        if (requestParams.model === 'grok-4.3' && reasoningEffort) {
            (requestParams as any).reasoning_effort = reasoningEffort;
            delete (requestParams as any).reasoning;
        }

        return super.prepareParameters(requestParams);
    }

    async createImage(
        prompt: string,
        model: string,
        agent: AgentDefinition,
        opts: ImageGenerationOpts = {}
    ): Promise<string[]> {
        const numberOfImages = opts.n ?? 1;
        const sourceImages = normalizeSourceImages(opts.source_images);
        const requestBody: Record<string, unknown> = {
            model,
            prompt,
            n: numberOfImages,
        };

        if (!Number.isInteger(numberOfImages) || numberOfImages < 1 || numberOfImages > 10) {
            throw new Error('xAI image generation requires opts.n to be an integer between 1 and 10.');
        }

        if (opts.mask) {
            throw new Error('xAI image generation masks are not supported in Ensemble yet.');
        }

        if (sourceImages.length > 5) {
            throw new Error('xAI image editing supports at most 5 source images per request.');
        }

        const aspectRatio = normalizeAspectRatio(opts.size);
        const resolution = normalizeResolution(opts);
        const usesEditingEndpoint = sourceImages.length > 0;

        if (opts.response_format === 'b64_json') {
            requestBody.response_format = 'b64_json';
        }

        if (aspectRatio) {
            requestBody.aspect_ratio = aspectRatio;
        }

        if (resolution) {
            requestBody.resolution = resolution;
        }

        if (usesEditingEndpoint) {
            if (sourceImages.length === 1) {
                requestBody.image = { url: sourceImages[0].url };
            } else {
                requestBody.images = sourceImages;
            }
        }

        const endpoint = usesEditingEndpoint ? '/images/edits' : '/images/generations';
        const requestId = log_llm_request(
            agent.agent_id || 'default',
            'xai',
            model,
            {
                endpoint,
                ...requestBody,
            },
            new Date(),
            opts.request_id,
            agent.tags
        );
        let success = false;
        let responseLogPayload: unknown = { ok: false };

        try {
            const response = await this.client.post<XAIImageResponse>(endpoint, {
                body: requestBody,
            });
            responseLogPayload = response;

            const images = extractImages(response);
            if (!images.length) {
                throw new Error('xAI image generation returned no images.');
            }

            const perImageCost = getPerImageCost(model);
            const billableImageCount = usesEditingEndpoint ? sourceImages.length + images.length : images.length;

            costTracker.addUsage({
                model,
                image_count: images.length,
                cost: typeof perImageCost === 'number' ? perImageCost * billableImageCount : undefined,
                request_id: opts.request_id,
                metadata: {
                    source: 'xai',
                    endpoint,
                    aspect_ratio: aspectRatio,
                    resolution,
                    response_format: opts.response_format || 'url',
                    source_image_count: sourceImages.length,
                    billable_image_count: billableImageCount,
                    ...(typeof perImageCost === 'number' ? { cost_per_image: perImageCost } : {}),
                },
            });

            success = true;
            return images;
        } catch (error) {
            log_llm_error(requestId, error);
            throw error;
        } finally {
            log_llm_response(requestId, success ? responseLogPayload : { ok: false });
        }
    }
}

// Export an instance of the provider
export const grokProvider = new GrokProvider();
