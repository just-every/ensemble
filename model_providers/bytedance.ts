import { BaseModelProvider } from './base_provider.js';
import type { AgentDefinition, ImageGenerationOpts, ProviderStreamEvent } from '../types/types.js';
import { fetchWithTimeout } from '../utils/fetch_with_timeout.js';
import { costTracker } from '../utils/cost_tracker.js';
import { log_llm_request, log_llm_response, log_llm_error } from '../utils/llm_logger.js';

// BytePlus ModelArk — OpenAI compatible Images API
// Docs: Image Generation API (OpenAI-compatible):
// - Base URL: https://ark.ap-southeast.bytepluses.com/api/v3/
// - Endpoint: POST /images/generations
// - Auth: Bearer <ARK_API_KEY>

const ARK_BASE = 'https://ark.ap-southeast.bytepluses.com/api/v3';

function mapSize(size?: ImageGenerationOpts['size']): string | undefined {
    if (!size) return undefined;
    const s = String(size);
    if (s === 'square') return '1024x1024';
    if (s === 'landscape') return '1536x1024';
    if (s === 'portrait') return '1024x1536';
    // BytePlus presets
    if (s.toUpperCase() === '2K' || s.toUpperCase() === '4K' || s.toUpperCase() === '720P' || s.toUpperCase() === '1080P') return s;
    // pass through explicit sizes
    if (/^\d+x\d+$/i.test(s)) return s;
    return undefined;
}

function normalizeModelId(model: string): string {
    // Allow friendly alias 'seedream-4' to call official release id
    if (model === 'seedream-4' || model === 'seedream-4.0') return 'seedream-4-0-250828';
    // Strip provider prefix if present (e.g., bytedance/seedream-4.0)
    return model.replace(/^bytedance[\/:-]/, '');
}

export class ByteDanceProvider extends BaseModelProvider {
    constructor() {
        super('bytedance' as any);
    }

    // Text streaming not supported via this provider in our integration
    async *createResponseStream(): AsyncGenerator<ProviderStreamEvent> {
        throw new Error('Bytedance provider does not support text streaming');
    }

    async createImage(prompt: string, model: string, agent: AgentDefinition, opts: ImageGenerationOpts = {}): Promise<string[]> {
        const apiKey =
            process.env.ARK_API_KEY ||
            process.env.BYTEPLUS_API_KEY ||
            process.env.BYTEDANCE_API_KEY;
        if (!apiKey) throw new Error('Bytedance provider: set ARK_API_KEY (or BYTEPLUS_API_KEY/BYTEDANCE_API_KEY)');

        const requestId = log_llm_request(agent.agent_id || 'default', 'bytedance', model, { prompt, opts }, new Date());
        try {
            const n = Math.max(1, Math.min(10, opts.n || 1));
            const size = mapSize(opts.size) || '1024x1024';
            const response_format = opts.response_format === 'b64_json' ? 'b64_json' : 'url';

            const body: any = {
                model: normalizeModelId(model),
                prompt,
                n,
                size,
                response_format,
                // sane defaults per docs/examples
                sequential_image_generation: opts.sequential_image_generation || 'disabled',
                sequential_image_generation_options: opts.sequential_image_generation_options,
                stream: Boolean(opts.stream),
                // Default to no watermark for Seedream per request
                watermark: opts.watermark !== undefined ? !!opts.watermark : false,
                seed: typeof opts.seed === 'number' ? opts.seed : undefined,
                guidance_scale: typeof opts.guidance_scale === 'number' ? opts.guidance_scale : undefined,
            };

            // Basic i2i support if a single source image URL or base64 is provided
            if (opts?.source_images) {
                const arr = Array.isArray(opts.source_images) ? (opts.source_images as any[]) : [opts.source_images as any];
                const images: string[] = [];
                for (const s of arr.slice(0, 10)) {
                    const v = typeof s === 'string' ? s : s?.data;
                    if (typeof v === 'string' && v) images.push(v);
                }
                if (images.length === 1) {
                    (body as any).image = images[0];
                    (body as any).reference_image = images[0];
                } else if (images.length > 1) {
                    (body as any).image = images; // API supports array for Seedream‑4
                }
            }

            const res = await fetchWithTimeout(`${ARK_BASE}/images/generations`, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${apiKey}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(body),
            }, 60000);

            if (!res.ok) {
                const text = await res.text();
                throw new Error(`Bytedance images.generation failed: ${res.status} ${text}`);
            }

            const contentType = res.headers.get('content-type') || '';
            const out: string[] = [];
            let observedUsage: any = null;

            if (contentType.includes('text/event-stream')) {
                if (!res.body) throw new Error('Bytedance: missing response body for stream');
                const reader = res.body.getReader();
                const decoder = new TextDecoder();
                let buffer = '';
                let dataBlock = '';

                const flush = () => {
                    const trimmed = dataBlock.trim();
                    dataBlock = '';
                    if (!trimmed || trimmed === '[DONE]') return;
                    try {
                        const payload = JSON.parse(trimmed);
                        const collect = (value: any) => {
                            if (!value) return;
                            if (typeof value === 'string') {
                                if (/^https?:\/\//i.test(value) || value.startsWith('data:')) out.push(value);
                            } else if (value.url) {
                                out.push(String(value.url));
                            } else if (value.b64_json) {
                                out.push(`data:image/png;base64,${value.b64_json}`);
                            }
                        };

                        if (Array.isArray(payload?.data)) {
                            for (const item of payload.data) collect(item);
                        }
                        if (payload?.url) collect(payload.url);
                        if (Array.isArray(payload?.images)) {
                            for (const item of payload.images) collect(item);
                        }
                        if (payload?.image_base64) collect(`data:image/png;base64,${payload.image_base64}`);
                        if (payload?.result?.images) {
                            for (const item of payload.result.images) collect(item);
                        }
                        if (payload?.usage) observedUsage = payload.usage;
                    } catch (err) {
                        console.warn('[bytedance] Failed to parse SSE payload', err);
                    }
                };

                while (true) {
                    const { value, done } = await reader.read();
                    if (done) break;
                    buffer += decoder.decode(value, { stream: true });
                    let idx;
                    while ((idx = buffer.indexOf('\n')) >= 0) {
                        const line = buffer.slice(0, idx);
                        buffer = buffer.slice(idx + 1);
                        const trimmed = line.trim();
                        if (!trimmed) {
                            flush();
                            continue;
                        }
                        if (trimmed.startsWith('data:')) {
                            const payloadPart = trimmed.slice(trimmed.indexOf(':') + 1).trim();
                            dataBlock += payloadPart;
                            dataBlock += '\n';
                        }
                    }
                }
                if (dataBlock.trim()) flush();
            } else {
                const json = await res.json();

                if (Array.isArray(json?.data)) {
                    for (const d of json.data) {
                        if (d?.url) out.push(String(d.url));
                        else if (d?.b64_json) out.push(`data:image/png;base64,${d.b64_json}`);
                    }
                }
                if (!out.length && json?.result?.images) {
                    for (const im of json.result.images) if (im?.url) out.push(String(im.url));
                }
                if (!out.length && typeof json?.image_base64 === 'string') {
                    out.push(`data:image/png;base64,${json.image_base64}`);
                }
                if (json?.usage) observedUsage = json.usage;
            }

            if (!out.length) throw new Error('Bytedance: no image result in response');

            costTracker.addUsage({ model, image_count: out.length, request_id: opts?.request_id, metadata: { source: 'bytedance', usage: observedUsage } });
            log_llm_response(requestId, { ok: true, image_count: out.length });
            return out;
        } catch (err) {
            log_llm_error(requestId, err);
            throw err;
        }
    }
}

export const bytedanceProvider = new ByteDanceProvider();
