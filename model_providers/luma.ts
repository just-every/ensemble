import { BaseModelProvider } from './base_provider.js';
import type { AgentDefinition, ImageGenerationOpts, ProviderStreamEvent, ResponseInput } from '../types/types.js';
import { costTracker } from '../utils/cost_tracker.js';
import { fetchWithTimeout } from '../utils/fetch_with_timeout.js';
import { log_llm_error, log_llm_request, log_llm_response } from '../utils/llm_logger.js';

const LUMA_BASE = 'https://api.lumalabs.ai/dream-machine/v1';

function mapAspect(size?: ImageGenerationOpts['size']): string | undefined {
    if (!size) return undefined;
    const s = String(size);
    if (s === 'square' || s === '1024x1024' || s === '512x512' || s === '256x256') return '1:1';
    if (s === 'landscape' || s === '1792x1024' || s === '1536x1024') return '16:9';
    if (s === 'portrait' || s === '1024x1792' || s === '1024x1536') return '9:16';
    return undefined;
}

export class LumaProvider extends BaseModelProvider {
    constructor() {
        super('luma');
    }

    // Text streaming not supported for Luma image models
    async *createResponseStream(): AsyncGenerator<ProviderStreamEvent> {
        throw new Error('Luma provider does not support text streaming');
    }

    async createImage(prompt: string, model: string, agent: AgentDefinition, opts?: ImageGenerationOpts): Promise<string[]> {
        const apiKey = process.env.LUMA_API_KEY;
        if (!apiKey) throw new Error('Luma provider: LUMA_API_KEY is not set');

        const requestId = log_llm_request(agent.agent_id || 'default', 'luma', model, { prompt, opts }, new Date());
        let success = false;
        try {
            const aspect = mapAspect(opts?.size);
            const body: any = { prompt, model: model.replace('luma-', ''), format: 'png' };
            if (aspect) body.aspect_ratio = aspect; // 16:9 | 1:1 | 9:16
            // photon models: 'photon-1' or 'photon-flash-1' already set

            // Image-to-image: pass http(s) URLs if provided
            const srcs: string[] = [];
            if (opts?.source_images) {
                const arr = Array.isArray(opts.source_images) ? opts.source_images : [opts.source_images];
                for (const s of arr) {
                    const v = typeof s === 'string' ? s : s?.data || '';
                    if (typeof v === 'string' && /^https?:\/\//i.test(v)) srcs.push(v);
                }
            }
            // Prefer documented image_ref structure when a source image is provided (use first URL)
            if (srcs.length) (body as any).image_ref = [{ image_url: srcs[0] }];

            // Request timeout for create
            const shouldRetry = (error: any) => {
                const message = String(error?.message || '').toLowerCase();
                return error?.name === 'AbortError' || message.includes('timed out');
            };

            const withRetries = async <T>(fn: () => Promise<T>, attempts = 3): Promise<T> => {
                let lastError: any;
                for (let attempt = 1; attempt <= attempts; attempt++) {
                    try {
                        return await fn();
                    } catch (error) {
                        lastError = error;
                        if (!shouldRetry(error) || attempt === attempts) throw error;
                        await new Promise(r => setTimeout(r, attempt * 500));
                    }
                }
                throw lastError;
            };

            const createTimeout = 20000;
            let res = await withRetries(() => fetchWithTimeout(`${LUMA_BASE}/generations/image`, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${apiKey}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(body),
            }, createTimeout), 3);
            if (!res.ok) {
                // Retry once without image_urls if server rejects unknown param
                const text = await res.text();
                if (srcs.length && (res.status === 400 || res.status === 422)) {
                    delete (body as any).image_ref;
                    res = await withRetries(() => fetchWithTimeout(`${LUMA_BASE}/generations/image`, {
                        method: 'POST',
                        headers: {
                            Authorization: `Bearer ${apiKey}`,
                            'Content-Type': 'application/json',
                        },
                        body: JSON.stringify(body),
                    }, 20000), 3);
                }
                if (!res.ok) throw new Error(`Luma create failed: ${res.status} ${text}`);
            }
            const job = await res.json();
            // If sync mode succeeded and image is present, return immediately
            if (job?.state === 'completed' && (job?.assets?.image || job?.assets?.image_url)) {
                const url: string | undefined = job.assets?.image || job.assets?.image_url;
                if (url) {
                    costTracker.addUsage({ model, image_count: 1, request_id: opts?.request_id, metadata: { source: 'luma', mode: 'sync' } });
                    success = true;
                    return [url];
                }
            }
            const id = job.id || job.generation_id || job.data?.id;
            if (!id) throw new Error('Luma: missing generation id in response');

            // Poll
            const started = Date.now();
            const timeoutMs = 120000;
            const intervalMs = 1500;
            while (true) {
                let r: any;
                try {
                    r = await withRetries(() => fetchWithTimeout(`${LUMA_BASE}/generations/${id}`, {
                        headers: { Authorization: `Bearer ${apiKey}` },
                    }, 15000), 2);
                } catch (error) {
                    throw new Error(`Luma poll failed for ${id}: ${error?.message || error}`);
                }
                if (!r.ok) throw new Error(`Luma poll failed: ${r.status} ${await r.text()}`);
                const data = await r.json();
                const state = data.state || data.status;
                if (state === 'completed' || state === 'succeeded' || state === 'success') {
                    const url: string | undefined = data.assets?.image || data.output?.image_url || data.url;
                    if (!url) throw new Error('Luma: completed without image url');
                    // Return URL; avoid altering pixels
                    costTracker.addUsage({ model, image_count: 1, request_id: opts?.request_id, metadata: { source: 'luma' } });
                    success = true;
                    return [url];
                }
                if (state === 'failed' || state === 'error' || state === 'canceled') {
                    throw new Error(`Luma generation failed: ${state}`);
                }
                if (Date.now() - started > timeoutMs) throw new Error('Luma generation timed out');
                await new Promise(r => setTimeout(r, intervalMs));
            }
        } catch (err) {
            log_llm_error(requestId, err);
            throw err;
        } finally {
            log_llm_response(requestId, { ok: success });
        }
    }
}

export const lumaProvider = new LumaProvider();
