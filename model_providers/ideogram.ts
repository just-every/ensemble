import { BaseModelProvider } from './base_provider.js';
import type { AgentDefinition, ImageGenerationOpts, ProviderStreamEvent, ResponseInput } from '../types/types.js';
import { costTracker } from '../utils/cost_tracker.js';
import { log_llm_error, log_llm_request, log_llm_response } from '../utils/llm_logger.js';

const IDEOGRAM_BASE = 'https://api.ideogram.ai';

function mapResolution(size?: ImageGenerationOpts['size']): string | undefined {
    if (!size) return undefined;
    const s = String(size);
    // Ideogram supports a set of fixed resolutions
    const allowed = new Set([
        '1792x1024', '1536x1024', '1365x1024', '1280x720', '1024x1024', '1024x1536', '1216x832', '1088x1088',
        '1216x1216', '1344x1344', '1536x1536', '1792x1792', '1792x1024', '1792x1792', '1024x1792'
    ]);
    if (allowed.has(s)) return s;
    if (s === 'square') return '1024x1024';
    if (s === 'landscape') return '1792x1024';
    if (s === 'portrait') return '1024x1792';
    return undefined;
}

export class IdeogramProvider extends BaseModelProvider {
    constructor() {
        super('ideogram');
    }

    async *createResponseStream(): AsyncGenerator<ProviderStreamEvent> {
        throw new Error('Ideogram provider does not support text streaming');
    }

    async createImage(prompt: string, model: string, agent: AgentDefinition, opts?: ImageGenerationOpts): Promise<string[]> {
        const apiKey = process.env.IDEOGRAM_API_KEY;
        if (!apiKey) throw new Error('Ideogram provider: IDEOGRAM_API_KEY is not set');

        const requestId = log_llm_request(agent.agent_id || 'default', 'ideogram', model, { prompt, opts }, new Date());

        try {
            const resolution = mapResolution(opts?.size);
            const n = Math.max(1, Math.min(4, opts?.n || 1));

            // If source image present (edit mode): POST multipart/form-data to /v1/ideogram-v3/edit
            const hasSource = !!opts?.source_images;
            if (hasSource) {
                const src = Array.isArray(opts?.source_images)
                    ? (opts!.source_images as any[])[0]
                    : (opts!.source_images as any);
                // Load image bytes (URL or data URL)
                let imgBlob: Blob | null = null;
                let maskBlob: Blob | null = null;
                try {
                    const toBlob = async (val: any, fallbackName: string) => {
                        if (!val) return null;
                        const s = typeof val === 'string' ? val : val?.data || val;
                        if (typeof s !== 'string') return null;
                        if (s.startsWith('data:')) {
                            const m = /^data:([^;]+);base64,(.+)$/i.exec(s);
                            if (!m) return null;
                            const buf = Buffer.from(m[2], 'base64');
                            return new Blob([buf], { type: m[1] || 'image/png' });
                        }
                        if (/^https?:\/\//i.test(s)) {
                            const r = await fetch(s);
                            const ab = await r.arrayBuffer();
                            const ct = r.headers.get('content-type') || 'image/png';
                            return new Blob([ab], { type: ct });
                        }
                        return null;
                    };
                    imgBlob = await toBlob(src, 'image.png');
                    if (opts?.mask) maskBlob = await toBlob(opts.mask, 'mask.png');
                } catch (e) {
                    throw new Error(`Ideogram: failed to load source image/mask: ${e}`);
                }
                if (!imgBlob) throw new Error('Ideogram edit: no usable source image');

                const form = new FormData();
                form.append('prompt', prompt);
                form.append('rendering_speed', 'DEFAULT');
                form.append('image', imgBlob as any, 'image.png');
                if (maskBlob) form.append('mask', maskBlob as any, 'mask.png');

                const res = await fetch(`${IDEOGRAM_BASE}/v1/ideogram-v3/edit`, {
                    method: 'POST',
                    headers: {
                        'Api-Key': apiKey,
                    },
                    body: form as any,
                });
                if (!res.ok) throw new Error(`Ideogram edit failed: ${res.status} ${await res.text()}`);
                const data = await res.json();
                const urls: string[] = (data?.data || []).map((d: any) => d?.url).filter(Boolean);
                if (!urls.length) throw new Error('Ideogram edit: no image URLs returned');
                costTracker.addUsage({ model, image_count: urls.length, request_id: opts?.request_id, metadata: { source: 'ideogram', mode: 'edit' } });
                return urls;
            }

            // Generate mode
            const body: any = {
                prompt,
                model: 'V_3', // Ideogram 3.0
                num_images: n,
            };
            if (resolution) body.resolution = resolution;

            const res = await fetch(`${IDEOGRAM_BASE}/v1/ideogram-v3/generate`, {
                method: 'POST',
                headers: {
                    'Api-Key': apiKey,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(body),
            });
            if (!res.ok) throw new Error(`Ideogram create failed: ${res.status} ${await res.text()}`);
            const data = await res.json();

            const urls: string[] = (data?.data || []).map((d: any) => d?.url).filter(Boolean);
            if (urls.length === 0) throw new Error('Ideogram: no image URLs returned');

            costTracker.addUsage({ model, image_count: urls.length, request_id: opts?.request_id, metadata: { source: 'ideogram' } });
            return urls;
        } catch (err) {
            log_llm_error(requestId, err);
            throw err;
        } finally {
            log_llm_response(requestId, { ok: true });
        }
    }
}

export const ideogramProvider = new IdeogramProvider();
