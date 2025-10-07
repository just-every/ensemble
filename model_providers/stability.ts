import { BaseModelProvider } from './base_provider.js';
import type { AgentDefinition, ImageGenerationOpts, ProviderStreamEvent } from '../types/types.js';
import { costTracker } from '../utils/cost_tracker.js';
import { log_llm_error, log_llm_request, log_llm_response } from '../utils/llm_logger.js';

// Stability AI REST v2beta (Stable Image Ultra / SDXL via sd3.5 endpoints)
// Docs: https://platform.stability.ai/docs/api-reference

const STABILITY_BASE = 'https://api.stability.ai/v2beta';

function mapAspect(size?: ImageGenerationOpts['size']): string | undefined {
    if (!size) return undefined;
    const s = String(size);
    if (s === 'square' || s === '1024x1024' || s === '512x512' || s === '256x256') return '1:1';
    if (s === 'landscape' || s === '1792x1024' || s === '1536x1024') return '16:9';
    if (s === 'portrait' || s === '1024x1792' || s === '1024x1536') return '9:16';
    return undefined;
}

export class StabilityProvider extends BaseModelProvider {
    constructor() {
        super('stability' as any);
    }

    async *createResponseStream(): AsyncGenerator<ProviderStreamEvent> {
        throw new Error('Stability provider does not support text streaming');
    }

    private endpointFor(model: string): string {
        const m = model.toLowerCase();
        if (m.includes('ultra')) return `${STABILITY_BASE}/stable-image/generate/ultra`;
        if (m.includes('core')) return `${STABILITY_BASE}/stable-image/generate/core`;
        // SDXL or SD3.5 family
        return `${STABILITY_BASE}/stable-image/generate/sd3`;
    }

    async createImage(prompt: string, model: string, agent: AgentDefinition, opts: ImageGenerationOpts = {}): Promise<string[]> {
        const apiKey = process.env.STABILITY_API_KEY;
        const requestId = log_llm_request(agent.agent_id || 'default', 'stability', model, { prompt, opts }, new Date());
        try {
            if (!apiKey) throw new Error('STABILITY_API_KEY is not set');

            const endpoint = this.endpointFor(model);
            const form = new FormData();
            form.set('prompt', prompt);
            if (opts?.response_format === 'url') form.set('output_format', 'png');

            // Select explicit SD3.5 variant if requested in model string
            const ml = model.toLowerCase();
            if (ml.includes('sd3.5-large-turbo')) form.set('model', 'sd3.5-large-turbo');
            else if (ml.includes('sd3.5-large')) form.set('model', 'sd3.5-large');
            else if (ml.includes('sd3.5-medium')) form.set('model', 'sd3.5-medium');
            else if (ml.includes('sd3.5-flash')) form.set('model', 'sd3.5-flash');

            // Image-to-image support when source_images provided
            let isI2I = false;
            if (opts?.source_images) {
                const arr = Array.isArray(opts.source_images) ? opts.source_images : [opts.source_images];
                const first = arr[0] as any;
                if (typeof first === 'string' && first.startsWith('data:image/')) {
                    const [, mime, b64] = first.match(/^data:(image\/[^;]+);base64,(.+)$/) || [];
                    if (!b64) throw new Error('Invalid base64 source image');
                    const bin = Buffer.from(b64, 'base64');
                    form.set('image', new Blob([bin], { type: mime || 'image/png' }) as any, 'image.png');
                    form.set('mode', 'image-to-image');
                    form.set('strength', '0.75');
                    isI2I = true;
                } else if (typeof first === 'string') {
                    // Try fetching URL to binary
                    const r = await fetch(first);
                    const ct = r.headers.get('content-type') || 'image/png';
                    const buf = new Uint8Array(await r.arrayBuffer());
                    form.set('image', new Blob([buf], { type: ct }) as any, 'image');
                    form.set('mode', 'image-to-image');
                    form.set('strength', '0.75');
                    isI2I = true;
                }
            }

            // aspect_ratio must NOT be set for image-to-image per API
            if (!isI2I) {
                const aspect = mapAspect(opts.size);
                if (aspect) form.set('aspect_ratio', aspect);
            }

            const res = await fetch(endpoint, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${apiKey}`,
                    Accept: 'application/json', // get base64 JSON, then wrap as data URL
                },
                body: form as any,
            });

            if (!res.ok) throw new Error(`Stability create failed: ${res.status} ${await res.text()}`);
            // JSON with base64 image in field per docs (application/json; type=image/png)
            const contentType = res.headers.get('content-type') || '';
            if (contentType.startsWith('image/')) {
                const buf = new Uint8Array(await res.arrayBuffer());
                const b64 = Buffer.from(buf).toString('base64');
                const mime = contentType.split(';')[0];
                const dataUrl = `data:${mime};base64,${b64}`;
                costTracker.addUsage({ model, image_count: 1, request_id: opts?.request_id, metadata: { source: 'stability' } });
                return [dataUrl];
            }
            const json = await res.json();
            // Try common shapes
            const images: string[] = [];
            if (Array.isArray(json?.artifacts)) {
                for (const a of json.artifacts) if (a?.base64) images.push(`data:image/png;base64,${a.base64}`);
            }
            if (json?.image) images.push(`data:image/png;base64,${json.image}`);
            if (json?.images?.[0]?.base64) images.push(`data:image/png;base64,${json.images[0].base64}`);
            if (!images.length) throw new Error('Stability: no image in response');
            costTracker.addUsage({ model, image_count: images.length, request_id: opts?.request_id, metadata: { source: 'stability' } });
            return images;
        } catch (err) {
            log_llm_error(requestId, err);
            throw err;
        } finally {
            log_llm_response(requestId, { ok: true });
        }
    }
}

export const stabilityProvider = new StabilityProvider();
