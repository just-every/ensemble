/**
 * Grok model provider for the ensemble system.
 *
 * We extend OpenAIChat as Grok is a drop in replacement for chat APIs,
 * but xAI image generation/editing uses JSON endpoints that differ from
 * OpenAI's multipart image edit API.
 */

import type { AgentDefinition, ImageGenerationOpts, VideoGenerationOpts } from '../types/types.js';
import { costTracker } from '../utils/cost_tracker.js';
import { log_llm_error, log_llm_request, log_llm_response } from '../utils/llm_logger.js';
import { OpenAIChat } from './openai_chat.js';
import OpenAI from 'openai';
import { getGrokImagePricing, getGrokVideoPricing } from './grok_imagine_pricing.js';

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

type XAIVideoJob = {
    request_id?: string;
    status?: 'pending' | 'processing' | 'done' | 'expired' | 'error';
    video?: { url?: string; duration?: number };
    error?: { message?: string } | string;
    usage?: { cost_in_usd_ticks?: number };
};

function waitForPoll(delayMs: number, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) return Promise.reject(signal.reason ?? new Error('Video generation aborted.'));
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(resolve, delayMs);
        signal?.addEventListener(
            'abort',
            () => {
                clearTimeout(timeout);
                reject(signal.reason ?? new Error('Video generation aborted.'));
            },
            { once: true }
        );
    });
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
        if ((requestParams.model === 'grok-4.3' || requestParams.model === 'grok-4.5') && reasoningEffort) {
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

        if (sourceImages.length > 3) {
            throw new Error('xAI image editing supports at most 3 source images per request.');
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

            const effectiveResolution = resolution ?? '1k';
            const pricing = getGrokImagePricing(model, effectiveResolution);
            const cost = images.length * pricing.outputImage + sourceImages.length * pricing.inputImage;

            costTracker.addUsage({
                model,
                image_count: images.length,
                cost,
                request_id: opts.request_id,
                metadata: {
                    source: 'xai',
                    endpoint,
                    aspect_ratio: aspectRatio,
                    resolution,
                    response_format: opts.response_format || 'url',
                    source_image_count: sourceImages.length,
                    input_image_cost: pricing.inputImage,
                    output_image_cost: pricing.outputImage,
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

    async createVideo(
        prompt: string,
        model: string,
        agent: AgentDefinition,
        opts: VideoGenerationOpts = {}
    ): Promise<string[]> {
        const duration = opts.duration ?? 6;
        const resolution = opts.resolution ?? '720p';
        if (!Number.isInteger(duration) || duration < 1 || duration > 15) {
            throw new Error('xAI video generation requires duration to be an integer between 1 and 15 seconds.');
        }
        if (model === 'grok-imagine-video-1.5' && !opts.source_image) {
            throw new Error('grok-imagine-video-1.5 requires opts.source_image.');
        }

        const body: Record<string, unknown> = { model, prompt, duration, resolution };
        if (opts.aspect_ratio) body.aspect_ratio = opts.aspect_ratio;
        if (opts.source_image) body.image = { url: opts.source_image };
        if (opts.source_video) body.video = { url: opts.source_video };

        const requestId = log_llm_request(
            agent.agent_id || 'default',
            'xai',
            model,
            { endpoint: '/videos/generations', ...body },
            new Date(),
            opts.request_id,
            agent.tags
        );
        try {
            let job = await this.client.post<XAIVideoJob>('/videos/generations', { body });
            const providerRequestId = job.request_id;
            if (!providerRequestId) throw new Error('xAI video generation returned no request_id.');

            const deadline = Date.now() + (opts.timeout_ms ?? 10 * 60_000);
            while (job.status !== 'done') {
                if (job.status === 'error' || job.status === 'expired') {
                    const message = typeof job.error === 'string' ? job.error : job.error?.message;
                    throw new Error(message || `xAI video generation ended with status ${job.status}.`);
                }
                if (Date.now() >= deadline) throw new Error('xAI video generation timed out.');
                await waitForPoll(opts.poll_interval_ms ?? 5000, agent.abortSignal);
                job = await this.client.get<XAIVideoJob>(`/videos/${providerRequestId}`);
            }

            const url = job.video?.url;
            if (!url) throw new Error('xAI video generation completed without a video URL.');
            const pricing = getGrokVideoPricing(model, resolution);
            const providerCostTicks = job.usage?.cost_in_usd_ticks;
            const estimatedCost =
                duration * pricing.outputSecond +
                (opts.source_image ? pricing.inputImage : 0) +
                (opts.source_video ? duration * pricing.inputSecond : 0);
            costTracker.addUsage({
                model,
                video_seconds: job.video?.duration ?? duration,
                cost: typeof providerCostTicks === 'number' ? providerCostTicks / 10_000_000_000 : estimatedCost,
                request_id: opts.request_id,
                metadata: {
                    source: 'xai',
                    provider_request_id: providerRequestId,
                    resolution,
                    cost_per_second: pricing.outputSecond,
                },
            });
            log_llm_response(requestId, job);
            return [url];
        } catch (error) {
            log_llm_error(requestId, error);
            log_llm_response(requestId, { ok: false });
            throw error;
        }
    }
}

// Export an instance of the provider
export const grokProvider = new GrokProvider();
