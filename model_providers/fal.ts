import { BaseModelProvider } from './base_provider.js';
import type { AgentDefinition, ImageGenerationOpts, ProviderStreamEvent, VideoGenerationOpts } from '../types/types.js';
import { findModel } from '../data/model_data.js';
import { costTracker } from '../utils/cost_tracker.js';
import { calculateFalFlux2ProOutpaintCostFromImages } from '../utils/fal_flux_outpaint_pricing.js';
import { normalizeImageDataUrl } from '../utils/image_utils.js';
import { mapTransparentEditMaskForFalIdeogram } from '../utils/ideogram_mask.js';
import { log_llm_error, log_llm_request, log_llm_response } from '../utils/llm_logger.js';

// FAL.ai – used directly for Runway Gen-4 Image and Recraft v3
// Also used as fallback for Flux family
type FalEndpoint = {
    path: string;
    bodyMode:
        | 'top'
        | 'input'
        | 'remove-background'
        | 'image2svg'
        | 'recraft-upscale-crisp'
        | 'ideogram-v3'
        | 'ideogram-v3-edit'
        | 'ideogram-v4-instant'
        | 'ideogram-v4-fast'
        | 'seedream-v5-pro'
        | 'seedream-v5-lite'
        | 'outpaint'
        | 'flux-2-pro-outpaint';
};

const IMAGE2SVG_OPTION_KEYS = [
    'colormode',
    'hierarchical',
    'mode',
    'filter_speckle',
    'color_precision',
    'layer_difference',
    'corner_threshold',
    'length_threshold',
    'max_iterations',
    'splice_threshold',
    'path_precision',
] as const;

function mapImageSize(size?: ImageGenerationOpts['size']): string | { width: number; height: number } | undefined {
    if (!size) return undefined;
    const s = String(size);
    if (s === 'square') return 'square_hd';
    if (s === '1024x1024') return 'square_hd';
    if (s === 'landscape' || s === '1792x1024' || s === '1536x1024') return 'landscape_16_9';
    if (s === 'portrait' || s === '1024x1792' || s === '1024x1536') return 'portrait_16_9';
    return undefined;
}

function mapIdeogramV3RenderingSpeed(quality?: ImageGenerationOpts['quality']): 'TURBO' | 'BALANCED' | 'QUALITY' {
    if (quality === 'low') return 'TURBO';
    if (quality === 'high' || quality === 'hd') return 'QUALITY';
    return 'BALANCED';
}

function ideogramV3CostPerImage(renderingSpeed: 'TURBO' | 'BALANCED' | 'QUALITY'): number {
    if (renderingSpeed === 'TURBO') return 0.03;
    if (renderingSpeed === 'QUALITY') return 0.09;
    return 0.06;
}

function ideogramV4CostPerMegapixel(
    bodyMode: 'ideogram-v4-instant' | 'ideogram-v4-fast',
    renderingSpeed: 'TURBO' | 'BALANCED' | 'QUALITY'
): number {
    const multiplier = bodyMode === 'ideogram-v4-instant' ? 0.5 : 0.7;
    if (renderingSpeed === 'TURBO') return 0.0075 * multiplier;
    if (renderingSpeed === 'QUALITY') return 0.025 * multiplier;
    return 0.015 * multiplier;
}

function clampFalIdeogramImageCount(n?: number): number {
    const count = Math.floor(Number(n || 1));
    if (!Number.isFinite(count)) return 1;
    return Math.max(1, Math.min(8, count));
}

function clampFalSeedreamImageCount(n?: number): number {
    const count = Math.floor(Number(n || 1));
    if (!Number.isFinite(count)) return 1;
    return Math.max(1, Math.min(6, count));
}

function normalizeFalOutputFormat(format?: ImageGenerationOpts['output_format']): 'jpeg' | 'png' | undefined {
    if (format === 'jpg') return 'jpeg';
    if (format === 'jpeg' || format === 'png') return format;
    return undefined;
}

function parsePixelSize(size: unknown): { width: number; height: number } | undefined {
    if (typeof size === 'object' && size !== null) {
        const width = (size as { width?: unknown }).width;
        const height = (size as { height?: unknown }).height;
        if (typeof width === 'number' && typeof height === 'number' && width > 0 && height > 0) {
            return { width, height };
        }
    }

    if (typeof size !== 'string') return undefined;
    const match = /^(\d+)x(\d+)$/i.exec(size);
    if (!match) return undefined;
    return { width: Number(match[1]), height: Number(match[2]) };
}

function falImageSizeMegapixels(size: unknown): number | undefined {
    const pixelSize = parsePixelSize(size);
    if (pixelSize) return (pixelSize.width * pixelSize.height) / (1024 * 1024);

    switch (size) {
        case 'square':
        case 'square_hd':
        case 'auto_1K':
            return 1;
        case 'portrait_4_3':
        case 'landscape_4_3':
            return 1.125;
        case 'portrait_16_9':
        case 'landscape_16_9':
            return 1.125;
        case 'auto_2K':
            return 4;
        default:
            return undefined;
    }
}

function mapSeedreamV5ImageSize(
    size?: ImageGenerationOpts['size'],
    resolution?: ImageGenerationOpts['resolution']
): string | { width: number; height: number } {
    const pixelSize = parsePixelSize(size);
    if (pixelSize) return pixelSize;
    if (resolution === '1k') return 'auto_1K';
    if (size === 'square') return 'square_hd';
    if (size === 'landscape' || size === '1792x1024' || size === '1536x1024' || size === '16:9') {
        return 'landscape_16_9';
    }
    if (size === 'portrait' || size === '1024x1792' || size === '1024x1536' || size === '9:16') {
        return 'portrait_16_9';
    }
    return 'auto_2K';
}

function seedreamV5ProCostForMegapixels(megapixels: number): number {
    return megapixels <= (1536 * 1536) / (1024 * 1024) ? 0.0675 : 0.135;
}

function normalizeFalVideoSource(source: string | undefined, model: string): string {
    if (!source) {
        throw new Error(`${model} requires opts.source_image.`);
    }
    if (!source.startsWith('http://') && !source.startsWith('https://') && !source.startsWith('data:image/')) {
        throw new Error(`${model} expects source_image to be an http(s) URL or data:image base64 URI.`);
    }
    return source;
}

function pixverseVideoRate(resolution: VideoGenerationOpts['resolution'], generateAudio: boolean): number {
    const silentRates: Partial<Record<NonNullable<VideoGenerationOpts['resolution']>, number>> = {
        '360p': 0.025,
        '540p': 0.035,
        '720p': 0.045,
        '1080p': 0.09,
    };
    const audioRates: Partial<Record<NonNullable<VideoGenerationOpts['resolution']>, number>> = {
        '360p': 0.035,
        '540p': 0.045,
        '720p': 0.06,
        '1080p': 0.115,
    };
    const rate = (generateAudio ? audioRates : silentRates)[resolution || '720p'];
    if (typeof rate !== 'number') {
        throw new Error(`PixVerse V6 does not support ${resolution || 'the requested resolution'}.`);
    }
    return rate;
}

export class FALProvider extends BaseModelProvider {
    constructor() {
        super('fal' as any);
    }

    // eslint-disable-next-line require-yield
    async *createResponseStream(): AsyncGenerator<ProviderStreamEvent> {
        throw new Error('FAL provider does not support text streaming');
    }

    private endpointFor(model: string): FalEndpoint {
        const m = model.toLowerCase();
        if (m === 'fal-ai/ideogram/remove-background' || m === 'ideogram-remove-background') {
            return { path: 'fal-ai/ideogram/remove-background', bodyMode: 'remove-background' };
        }
        if (m === 'fal-ai/ideogram/v3' || m === 'fal-ideogram-v3' || m === 'fal-ai-ideogram-v3') {
            return { path: 'fal-ai/ideogram/v3', bodyMode: 'ideogram-v3' };
        }
        if (
            m === 'fal-ai/ideogram/v3/edit' ||
            m === 'ideogram-v3-edit' ||
            m === 'fal-ideogram-v3-edit' ||
            m === 'fal-ai-ideogram-v3-edit'
        ) {
            return { path: 'fal-ai/ideogram/v3/edit', bodyMode: 'ideogram-v3-edit' };
        }
        if (m === 'ideogram/v4/instant' || m === 'fal-ideogram-v4-instant') {
            return { path: 'ideogram/v4/instant', bodyMode: 'ideogram-v4-instant' };
        }
        if (m === 'ideogram/v4/fast' || m === 'fal-ideogram-v4-fast') {
            return { path: 'ideogram/v4/fast', bodyMode: 'ideogram-v4-fast' };
        }
        if (
            m === 'bytedance/seedream/v5/pro' ||
            m === 'bytedance/seedream/v5/pro/text-to-image' ||
            m === 'fal-ai/bytedance/seedream/v5/pro' ||
            m === 'fal-ai/bytedance/seedream/v5/pro/text-to-image'
        ) {
            return { path: 'bytedance/seedream/v5/pro/text-to-image', bodyMode: 'seedream-v5-pro' };
        }
        if (
            m === 'bytedance/seedream/v5/lite' ||
            m === 'bytedance/seedream/v5/lite/text-to-image' ||
            m === 'fal-ai/bytedance/seedream/v5/lite' ||
            m === 'fal-ai/bytedance/seedream/v5/lite/text-to-image'
        ) {
            return { path: 'fal-ai/bytedance/seedream/v5/lite/text-to-image', bodyMode: 'seedream-v5-lite' };
        }
        if (m === 'fal-ai/image2svg' || m === 'image2svg' || m === 'fal-image2svg') {
            return { path: 'fal-ai/image2svg', bodyMode: 'image2svg' };
        }
        if (
            m === 'fal-ai/recraft/upscale/crisp' ||
            m === 'recraft-upscale-crisp' ||
            m === 'fal-recraft-upscale-crisp' ||
            m === 'fal-ai-recraft-upscale-crisp'
        ) {
            return { path: 'fal-ai/recraft/upscale/crisp', bodyMode: 'recraft-upscale-crisp' };
        }
        if (
            m === 'fal-ai/image-apps-v2/outpaint' ||
            m === 'fal-image-apps-v2-outpaint' ||
            m === 'fal-ai-image-apps-v2-outpaint'
        ) {
            return { path: 'fal-ai/image-apps-v2/outpaint', bodyMode: 'outpaint' };
        }
        if (
            m === 'fal-ai/flux-2-pro/outpaint' ||
            m === 'fal-flux-2-pro-outpaint' ||
            m === 'fal-ai-flux-2-pro-outpaint'
        ) {
            return { path: 'fal-ai/flux-2-pro/outpaint', bodyMode: 'flux-2-pro-outpaint' };
        }
        if (m.startsWith('recraft')) return { path: 'fal-ai/recraft/v3/text-to-image', bodyMode: 'top' };
        if (m.includes('runway') || m.includes('gen4')) return { path: 'runwayml/gen4-image', bodyMode: 'input' };
        // flux fallbacks
        if (m.includes('schnell')) return { path: 'fal-ai/flux/schnell', bodyMode: 'top' };
        if (m.includes('dev')) return { path: 'fal-ai/flux/dev', bodyMode: 'top' };
        if (m.includes('kontext') || m.includes('pro')) return { path: 'fal-ai/flux-pro/kontext', bodyMode: 'top' };
        if (m.startsWith('fal-ai/')) return { path: model, bodyMode: 'top' };
        return { path: 'fal-ai/flux/schnell', bodyMode: 'top' };
    }

    private singleSourceImageUrl(opts: ImageGenerationOpts, modelName: string): string {
        const sourceImages = opts.source_images;
        if (!sourceImages) {
            throw new Error(`${modelName} requires exactly one source image.`);
        }

        const rawImages = Array.isArray(sourceImages) ? sourceImages : [sourceImages];
        if (rawImages.length !== 1) {
            throw new Error(`${modelName} supports exactly one source image per request.`);
        }

        const rawImage = rawImages[0];
        const normalized =
            typeof rawImage === 'string'
                ? normalizeImageDataUrl({ data: rawImage })
                : normalizeImageDataUrl({ data: rawImage.data });
        const imageUrl = normalized.url || normalized.dataUrl;

        if (
            !imageUrl ||
            (!imageUrl.startsWith('http://') && !imageUrl.startsWith('https://') && !imageUrl.startsWith('data:image/'))
        ) {
            throw new Error(`${modelName} expects the source image to be a public URL or a data:image/... base64 URI.`);
        }

        return imageUrl;
    }

    private maskUrl(opts: ImageGenerationOpts, modelName: string): string {
        if (!opts.mask) {
            throw new Error(`${modelName} requires a mask image.`);
        }

        const normalized = normalizeImageDataUrl({ data: opts.mask });
        const maskUrl = normalized.url || normalized.dataUrl;
        if (
            !maskUrl ||
            (!maskUrl.startsWith('http://') && !maskUrl.startsWith('https://') && !maskUrl.startsWith('data:image/'))
        ) {
            throw new Error(`${modelName} expects the mask to be a public URL or a data:image/... base64 URI.`);
        }

        return mapTransparentEditMaskForFalIdeogram(maskUrl);
    }

    private buildImage2SvgBody(opts: ImageGenerationOpts): Record<string, unknown> {
        const body: Record<string, unknown> = {
            image_url: this.singleSourceImageUrl(opts, 'fal-ai/image2svg'),
        };
        const image2svg = opts.image2svg || {};
        for (const key of IMAGE2SVG_OPTION_KEYS) {
            const value = image2svg[key];
            if (value !== undefined) {
                body[key] = value;
            }
        }
        return body;
    }

    private buildRecraftUpscaleCrispBody(opts: ImageGenerationOpts): Record<string, unknown> {
        const body: Record<string, unknown> = {
            image_url: this.singleSourceImageUrl(opts, 'fal-ai/recraft/upscale/crisp'),
        };

        if (opts.enable_safety_checker !== undefined) {
            body.enable_safety_checker = opts.enable_safety_checker;
        }
        if (opts?.response_format === 'b64_json') {
            body.sync_mode = true;
        }

        return body;
    }

    private buildFlux2ProOutpaintBody(opts: ImageGenerationOpts): Record<string, unknown> {
        const body: Record<string, unknown> = {
            image_url: this.singleSourceImageUrl(opts, 'fal-ai/flux-2-pro/outpaint'),
        };

        if (opts.expand_left !== undefined) {
            body.expand_left = opts.expand_left;
        }
        if (opts.expand_right !== undefined) {
            body.expand_right = opts.expand_right;
        }
        if (opts.expand_top !== undefined) {
            body.expand_top = opts.expand_top;
        }
        if (opts.expand_bottom !== undefined) {
            body.expand_bottom = opts.expand_bottom;
        }
        if (opts.auto_crop !== undefined) {
            body.auto_crop = opts.auto_crop;
        }
        if (opts.enable_safety_checker !== undefined) {
            body.enable_safety_checker = opts.enable_safety_checker;
        }
        if (opts.output_format) {
            body.output_format = opts.output_format;
        }
        if (opts?.response_format === 'b64_json') {
            body.sync_mode = true;
        }

        return body;
    }

    private sourceImageUrls(opts: ImageGenerationOpts): string[] {
        const sourceImages = opts.source_images;
        if (!sourceImages) return [];
        const rawImages = Array.isArray(sourceImages) ? sourceImages : [sourceImages];
        return rawImages.map(rawImage => {
            const normalized =
                typeof rawImage === 'string'
                    ? normalizeImageDataUrl({ data: rawImage })
                    : normalizeImageDataUrl({ data: rawImage.data });
            const imageUrl = normalized.url || normalized.dataUrl;
            if (
                !imageUrl ||
                (!imageUrl.startsWith('http://') &&
                    !imageUrl.startsWith('https://') &&
                    !imageUrl.startsWith('data:image/'))
            ) {
                throw new Error(
                    'fal-ai/ideogram/v3 expects style reference images to be public URLs or data:image/... base64 URIs.'
                );
            }
            return imageUrl;
        });
    }

    private buildIdeogramV3Body(prompt: string, opts: ImageGenerationOpts): Record<string, unknown> {
        const renderingSpeed = mapIdeogramV3RenderingSpeed(opts.quality);
        const body: Record<string, unknown> = {
            prompt,
            rendering_speed: renderingSpeed,
            num_images: clampFalIdeogramImageCount(opts.n),
        };
        const size = parsePixelSize(opts.size) || mapImageSize(opts.size);
        if (size) body.image_size = size;
        if (opts?.response_format === 'b64_json') {
            body.sync_mode = true;
        }
        if (typeof opts.seed === 'number' && Number.isFinite(opts.seed)) {
            body.seed = Math.floor(opts.seed);
        }
        const imageUrls = this.sourceImageUrls(opts);
        if (imageUrls.length > 0) {
            body.image_urls = imageUrls;
        }
        return body;
    }

    private buildIdeogramV3EditBody(prompt: string, opts: ImageGenerationOpts): Record<string, unknown> {
        const renderingSpeed = mapIdeogramV3RenderingSpeed(opts.quality);
        const body: Record<string, unknown> = {
            prompt,
            image_url: this.singleSourceImageUrl(opts, 'fal-ai/ideogram/v3/edit'),
            mask_url: this.maskUrl(opts, 'fal-ai/ideogram/v3/edit'),
            rendering_speed: renderingSpeed,
            num_images: clampFalIdeogramImageCount(opts.n),
        };
        if (opts?.response_format === 'b64_json') {
            body.sync_mode = true;
        }
        if (typeof opts.seed === 'number' && Number.isFinite(opts.seed)) {
            body.seed = Math.floor(opts.seed);
        }
        return body;
    }

    private buildIdeogramV4Body(
        prompt: string,
        bodyMode: 'ideogram-v4-instant' | 'ideogram-v4-fast',
        opts: ImageGenerationOpts
    ): Record<string, unknown> {
        const body: Record<string, unknown> = {
            prompt,
            num_images: clampFalIdeogramImageCount(opts.n),
        };
        const size = parsePixelSize(opts.size) || mapImageSize(opts.size);
        if (size) body.image_size = size;
        if (bodyMode === 'ideogram-v4-fast') {
            body.rendering_speed = mapIdeogramV3RenderingSpeed(opts.quality);
        }
        if (opts?.response_format === 'b64_json') {
            body.sync_mode = true;
        }
        if (opts.enable_safety_checker !== undefined) {
            body.enable_safety_checker = opts.enable_safety_checker;
        }
        const outputFormat = normalizeFalOutputFormat(opts.output_format);
        if (outputFormat) {
            body.output_format = outputFormat;
        }
        if (typeof opts.seed === 'number' && Number.isFinite(opts.seed)) {
            body.seed = Math.floor(opts.seed);
        }
        return body;
    }

    private buildSeedreamV5Body(
        prompt: string,
        bodyMode: 'seedream-v5-pro' | 'seedream-v5-lite',
        opts: ImageGenerationOpts
    ): Record<string, unknown> {
        const body: Record<string, unknown> = {
            prompt,
            image_size: mapSeedreamV5ImageSize(opts.size, opts.resolution),
            num_images: clampFalSeedreamImageCount(opts.n),
        };
        const outputFormat = normalizeFalOutputFormat(opts.output_format);
        if (bodyMode === 'seedream-v5-pro' && outputFormat) {
            body.output_format = outputFormat;
        }
        if (opts?.response_format === 'b64_json') {
            body.sync_mode = true;
        }
        if (opts.enable_safety_checker !== undefined) {
            body.enable_safety_checker = opts.enable_safety_checker;
        }
        return body;
    }

    private buildOutpaintBody(prompt: string, opts: ImageGenerationOpts): Record<string, unknown> {
        const body: Record<string, unknown> = {
            image_url: this.singleSourceImageUrl(opts, 'fal-ai/image-apps-v2/outpaint'),
            num_images: clampFalIdeogramImageCount(opts.n),
        };

        if (prompt) {
            body.prompt = prompt;
        }

        if (opts.expand_left !== undefined) {
            body.expand_left = opts.expand_left;
        }
        if (opts.expand_right !== undefined) {
            body.expand_right = opts.expand_right;
        }
        if (opts.expand_top !== undefined) {
            body.expand_top = opts.expand_top;
        }
        if (opts.expand_bottom !== undefined) {
            body.expand_bottom = opts.expand_bottom;
        }
        if (opts.zoom_out_percentage !== undefined) {
            body.zoom_out_percentage = opts.zoom_out_percentage;
        }
        if (opts.enable_safety_checker !== undefined) {
            body.enable_safety_checker = opts.enable_safety_checker;
        }
        if (opts.output_format) {
            body.output_format = opts.output_format;
        }
        if (opts?.response_format === 'b64_json') {
            body.sync_mode = true;
        }
        if (typeof opts.seed === 'number' && Number.isFinite(opts.seed)) {
            body.seed = Math.floor(opts.seed);
        }

        return body;
    }

    private buildBody(
        prompt: string,
        bodyMode: FalEndpoint['bodyMode'],
        opts: ImageGenerationOpts
    ): Record<string, unknown> {
        if (bodyMode === 'remove-background') {
            const body: Record<string, unknown> = {
                image_url: this.singleSourceImageUrl(opts, 'fal-ai/ideogram/remove-background'),
            };
            if (opts?.response_format === 'b64_json') {
                body.sync_mode = true;
            }
            return body;
        }

        if (bodyMode === 'image2svg') {
            return this.buildImage2SvgBody(opts);
        }

        if (bodyMode === 'recraft-upscale-crisp') {
            return this.buildRecraftUpscaleCrispBody(opts);
        }

        if (bodyMode === 'ideogram-v3') {
            return this.buildIdeogramV3Body(prompt, opts);
        }

        if (bodyMode === 'ideogram-v3-edit') {
            return this.buildIdeogramV3EditBody(prompt, opts);
        }
        if (bodyMode === 'ideogram-v4-instant' || bodyMode === 'ideogram-v4-fast') {
            return this.buildIdeogramV4Body(prompt, bodyMode, opts);
        }
        if (bodyMode === 'seedream-v5-pro' || bodyMode === 'seedream-v5-lite') {
            return this.buildSeedreamV5Body(prompt, bodyMode, opts);
        }
        if (bodyMode === 'outpaint') {
            return this.buildOutpaintBody(prompt, opts);
        }
        if (bodyMode === 'flux-2-pro-outpaint') {
            return this.buildFlux2ProOutpaintBody(opts);
        }

        const size = mapImageSize(opts.size);
        const bodyInput: any = bodyMode === 'top' ? { prompt } : { input: { prompt } };
        if (size) {
            if (bodyMode === 'top') bodyInput.image_size = size;
            else bodyInput.input.image_size = size;
        }
        if (opts?.response_format === 'b64_json') {
            if (bodyMode === 'top') bodyInput.sync_mode = true;
            else bodyInput.input.sync_mode = true;
        }
        return bodyInput;
    }

    private extractImages(data: any): string[] {
        const images: string[] = [];
        const addImage = (candidate: any) => {
            if (typeof candidate === 'string' && candidate.length > 0) {
                images.push(candidate);
            } else if (candidate?.url) {
                images.push(candidate.url);
            }
        };

        const arr = data?.images || data?.output?.images || [];
        for (const im of arr) addImage(im);
        addImage(data?.image);
        addImage(data?.url);
        return images;
    }

    private getOutpaintCostImageCount(data: any, fallbackImageCount: number): number {
        const candidates = data?.images || data?.output?.images || [];
        if (!Array.isArray(candidates) || candidates.length === 0) {
            return fallbackImageCount;
        }

        let totalMegapixels = 0;
        for (const item of candidates) {
            if (!item || typeof item !== 'object') {
                return fallbackImageCount;
            }

            const width = typeof item.width === 'number' ? item.width : undefined;
            const height = typeof item.height === 'number' ? item.height : undefined;
            if (!width || !height) {
                return fallbackImageCount;
            }

            if (width <= 0 || height <= 0 || !Number.isFinite(width) || !Number.isFinite(height)) {
                return fallbackImageCount;
            }
            totalMegapixels += (width * height) / 1_000_000;
        }

        return totalMegapixels;
    }

    private getImageMegapixels(data: any, requestImageSize: unknown, fallbackImageCount: number): number[] {
        const candidates = data?.images || data?.output?.images || [];
        const requestMegapixels = falImageSizeMegapixels(requestImageSize);

        if (!Array.isArray(candidates) || candidates.length === 0) {
            return Array.from({ length: fallbackImageCount }, () => requestMegapixels || 1);
        }

        return candidates.map((item: any) => {
            if (item && typeof item === 'object') {
                const width = typeof item.width === 'number' ? item.width : undefined;
                const height = typeof item.height === 'number' ? item.height : undefined;
                if (width && height && width > 0 && height > 0 && Number.isFinite(width) && Number.isFinite(height)) {
                    return (width * height) / (1024 * 1024);
                }
            }
            return requestMegapixels || 1;
        });
    }

    async createImage(
        prompt: string,
        model: string,
        agent: AgentDefinition,
        opts: ImageGenerationOpts = {}
    ): Promise<string[]> {
        const falKey = process.env.FAL_KEY;
        const requestId = log_llm_request(agent.agent_id || 'default', 'fal', model, { prompt, opts }, new Date());
        try {
            if (!falKey) throw new Error('FAL_KEY is not set');
            const { path, bodyMode } = this.endpointFor(model);
            const bodyInput = this.buildBody(prompt, bodyMode, opts);

            const res = await fetch(`https://fal.run/${path}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Key ${falKey}`,
                },
                body: JSON.stringify(bodyInput),
            });
            if (!res.ok) throw new Error(`FAL request failed: ${res.status} ${await res.text()}`);
            const data = await res.json();
            const images = this.extractImages(data);
            if (!images.length) throw new Error('FAL: no image url in response');
            if (findModel(model)) {
                const fluxOutpaintCost =
                    bodyMode === 'flux-2-pro-outpaint'
                        ? calculateFalFlux2ProOutpaintCostFromImages(data?.images || data?.output?.images)
                        : null;
                const bodyRecord = bodyInput as Record<string, unknown>;
                const ideogramV4Mode =
                    bodyMode === 'ideogram-v4-instant' || bodyMode === 'ideogram-v4-fast' ? bodyMode : null;
                const ideogramV4Megapixels = ideogramV4Mode
                    ? this.getImageMegapixels(data, bodyRecord.image_size, images.length)
                    : null;
                const seedreamV5ProMegapixels =
                    bodyMode === 'seedream-v5-pro'
                        ? this.getImageMegapixels(data, bodyRecord.image_size, images.length)
                        : null;
                const seedreamV5LiteCost = bodyMode === 'seedream-v5-lite' ? images.length * 0.035 : null;
                const ideogramV4RenderingSpeed =
                    ideogramV4Mode && bodyRecord.rendering_speed
                        ? (bodyRecord.rendering_speed as 'TURBO' | 'BALANCED' | 'QUALITY')
                        : 'BALANCED';
                const ideogramV4Cost =
                    ideogramV4Mode && ideogramV4Megapixels
                        ? ideogramV4Megapixels.reduce(
                              (total, megapixels) =>
                                  total +
                                  megapixels * ideogramV4CostPerMegapixel(ideogramV4Mode, ideogramV4RenderingSpeed),
                              0
                          )
                        : null;
                const seedreamV5ProCost = seedreamV5ProMegapixels
                    ? seedreamV5ProMegapixels.reduce(
                          (total, megapixels) => total + seedreamV5ProCostForMegapixels(megapixels),
                          0
                      )
                    : null;
                const imageCount =
                    bodyMode === 'outpaint'
                        ? this.getOutpaintCostImageCount(data, images.length)
                        : ideogramV4Megapixels
                          ? ideogramV4Megapixels.reduce((total, megapixels) => total + megapixels, 0)
                          : images.length;
                const renderingSpeed =
                    bodyMode === 'ideogram-v3' || bodyMode === 'ideogram-v3-edit'
                        ? mapIdeogramV3RenderingSpeed(opts.quality)
                        : null;
                costTracker.addUsage({
                    model,
                    image_count: imageCount,
                    ...(fluxOutpaintCost ? { cost: fluxOutpaintCost.cost } : {}),
                    ...(ideogramV4Cost !== null ? { cost: ideogramV4Cost } : {}),
                    ...(seedreamV5ProCost !== null ? { cost: seedreamV5ProCost } : {}),
                    ...(seedreamV5LiteCost !== null ? { cost: seedreamV5LiteCost } : {}),
                    request_id: opts?.request_id,
                    metadata: {
                        source: 'fal',
                        ...(fluxOutpaintCost
                            ? {
                                  billable_megapixels: fluxOutpaintCost.billableMegapixels,
                                  priced_images: fluxOutpaintCost.pricedImages,
                              }
                            : {}),
                        ...(ideogramV4Mode && ideogramV4Megapixels
                            ? {
                                  billable_megapixels: ideogramV4Megapixels,
                                  rendering_speed: ideogramV4RenderingSpeed,
                                  cost_per_megapixel: ideogramV4CostPerMegapixel(
                                      ideogramV4Mode,
                                      ideogramV4RenderingSpeed
                                  ),
                              }
                            : {}),
                        ...(seedreamV5ProMegapixels
                            ? {
                                  billable_megapixels: seedreamV5ProMegapixels,
                                  cost_per_image:
                                      seedreamV5ProMegapixels.length > 0
                                          ? seedreamV5ProCostForMegapixels(seedreamV5ProMegapixels[0])
                                          : undefined,
                              }
                            : {}),
                        ...(seedreamV5LiteCost !== null
                            ? {
                                  cost_per_image: 0.035,
                              }
                            : {}),
                        ...(renderingSpeed
                            ? {
                                  rendering_speed: renderingSpeed,
                                  cost_per_image: ideogramV3CostPerImage(renderingSpeed),
                              }
                            : {}),
                    },
                });
            }
            return images;
        } catch (err) {
            log_llm_error(requestId, err);
            throw err;
        } finally {
            log_llm_response(requestId, { ok: true });
        }
    }

    async createVideo(
        prompt: string,
        model: string,
        agent: AgentDefinition,
        opts: VideoGenerationOpts = {}
    ): Promise<string[]> {
        if (model !== 'fal-ai/pixverse/v6/image-to-video') {
            throw new Error(`FAL provider does not support video generation for unregistered model ${model}.`);
        }

        const falKey = process.env.FAL_KEY;
        if (!falKey) throw new Error('FAL_KEY is not set');
        const sourceImage = normalizeFalVideoSource(opts.source_image, model);
        const duration = opts.duration ?? 5;
        const resolution = opts.resolution ?? '720p';
        const generateAudio = opts.generate_audio ?? false;
        if (!Number.isInteger(duration) || duration < 1 || duration > 15) {
            throw new Error('PixVerse V6 video duration must be an integer from 1 to 15 seconds.');
        }
        if (!['360p', '540p', '720p', '1080p'].includes(resolution)) {
            throw new Error('PixVerse V6 video resolution must be 360p, 540p, 720p, or 1080p.');
        }

        const body: Record<string, unknown> = {
            prompt,
            image_url: sourceImage,
            duration,
            resolution,
            generate_audio_switch: generateAudio,
            generate_multi_clip_switch: false,
            thinking_type: 'disabled',
        };
        if (typeof opts.seed === 'number') body.seed = Math.floor(opts.seed);
        if (opts.negative_prompt) body.negative_prompt = opts.negative_prompt;

        const requestId = log_llm_request(
            agent.agent_id || 'default',
            'fal',
            model,
            {
                prompt,
                duration,
                resolution,
                generate_audio: generateAudio,
                has_source_image: true,
            },
            new Date(),
            opts.request_id,
            agent.tags
        );
        const controller = new AbortController();
        const timeout = setTimeout(
            () => controller.abort(new Error('FAL video generation timed out.')),
            opts.timeout_ms ?? 10 * 60_000
        );
        const onAbort = () => controller.abort(agent.abortSignal?.reason);
        agent.abortSignal?.addEventListener('abort', onAbort, { once: true });

        try {
            const response = await fetch(`https://fal.run/${model}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Key ${falKey}`,
                },
                body: JSON.stringify(body),
                signal: controller.signal,
            });
            if (!response.ok) {
                throw new Error(`FAL video request failed: ${response.status} ${await response.text()}`);
            }
            const data: any = await response.json();
            const videoUrl = data?.video?.url || data?.output?.video?.url;
            if (typeof videoUrl !== 'string' || videoUrl.length === 0) {
                throw new Error('FAL video generation completed without a video URL.');
            }

            const actualDuration =
                typeof data?.video?.duration === 'number' && data.video.duration > 0 ? data.video.duration : duration;
            const rate = pixverseVideoRate(resolution, generateAudio);
            costTracker.addUsage({
                model,
                video_seconds: actualDuration,
                cost: actualDuration * rate,
                request_id: opts.request_id,
                metadata: {
                    source: 'fal',
                    provider_request_id: data?.request_id,
                    duration: actualDuration,
                    resolution,
                    cost_per_second: rate,
                    generate_audio: generateAudio,
                    estimated_cost: true,
                },
            });
            log_llm_response(requestId, {
                ok: true,
                provider_request_id: data?.request_id,
                duration: actualDuration,
                resolution,
                video_url: videoUrl,
            });
            return [videoUrl];
        } catch (error) {
            log_llm_error(requestId, error);
            log_llm_response(requestId, { ok: false });
            throw error;
        } finally {
            clearTimeout(timeout);
            agent.abortSignal?.removeEventListener('abort', onAbort);
        }
    }
}

export const falProvider = new FALProvider();
