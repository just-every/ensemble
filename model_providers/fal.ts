import { BaseModelProvider } from './base_provider.js';
import type { AgentDefinition, ImageGenerationOpts, ProviderStreamEvent } from '../types/types.js';
import { findModel } from '../data/model_data.js';
import { costTracker } from '../utils/cost_tracker.js';
import { normalizeImageDataUrl } from '../utils/image_utils.js';
import { log_llm_error, log_llm_request, log_llm_response } from '../utils/llm_logger.js';

// FAL.ai – used directly for Runway Gen-4 Image and Recraft v3
// Also used as fallback for Flux family
type FalEndpoint = { path: string; bodyMode: 'top' | 'input' | 'remove-background' | 'image2svg' };

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
        if (m === 'fal-ai/image2svg' || m === 'image2svg' || m === 'fal-image2svg') {
            return { path: 'fal-ai/image2svg', bodyMode: 'image2svg' };
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
            throw new Error(
                `${modelName} expects the source image to be a public URL or a data:image/... base64 URI.`
            );
        }

        return imageUrl;
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
                costTracker.addUsage({
                    model,
                    image_count: images.length,
                    request_id: opts?.request_id,
                    metadata: { source: 'fal' },
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
}

export const falProvider = new FALProvider();
