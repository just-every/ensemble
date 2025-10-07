import { BaseModelProvider } from './base_provider.js';
import type { AgentDefinition, ImageGenerationOpts, ProviderStreamEvent, ResponseInput } from '../types/types.js';
import { costTracker } from '../utils/cost_tracker.js';
import { fetchWithTimeout } from '../utils/fetch_with_timeout.js';
import { log_llm_error, log_llm_request, log_llm_response } from '../utils/llm_logger.js';

// Midjourney via KIE API (third-party). Default per provided OpenAPI spec.
const KIE_BASE = process.env.MJ_API_BASE || 'https://api.kie.ai';

function mapMJAspect(size?: ImageGenerationOpts['size']): string | undefined {
    if (!size) return undefined;
    const s = String(size);
    if (s === 'square' || s === '1024x1024' || s === '512x512' || s === '256x256') return '1:1';
    if (s === 'landscape' || s === '1792x1024' || s === '1536x1024') return '16:9';
    if (s === 'portrait' || s === '1024x1792' || s === '1024x1536') return '9:16';
    return undefined;
}

export class MidjourneyProvider extends BaseModelProvider {
    constructor() {
        super('midjourney');
    }

    async *createResponseStream(): AsyncGenerator<ProviderStreamEvent> {
        throw new Error('Midjourney provider does not support text streaming');
    }

    async createImage(prompt: string, model: string, agent: AgentDefinition, opts?: ImageGenerationOpts): Promise<string[]> {
        const apiKey = process.env.MIDJOURNEY_API_KEY || process.env.MJ_API_KEY || process.env.KIE_API_KEY;
        if (!apiKey) throw new Error('Midjourney provider: MIDJOURNEY_API_KEY (or KIE_API_KEY) is not set');
        if (!process.env.MIDJOURNEY_API_KEY && process.env.MJ_API_KEY) {
            console.warn('[Midjourney] MJ_API_KEY is deprecated. Please set MIDJOURNEY_API_KEY instead.');
        }

        const requestId = log_llm_request(agent.agent_id || 'default', 'midjourney', model, { prompt, opts }, new Date());
        try {
            const aspect = mapMJAspect(opts?.size) || '1:1';
            const n = Math.max(1, Math.min(4, opts?.n || 1));

            // Submit job
            // Switch to img2img if source images (URLs) are provided
            let taskType: 'mj_txt2img' | 'mj_img2img' = 'mj_txt2img';
            const fileUrls: string[] = [];
            if (opts?.source_images) {
                const srcs = Array.isArray(opts.source_images) ? opts.source_images : [opts.source_images];
                for (const si of srcs) {
                    const s = typeof si === 'string' ? si : si?.data || '';
                    if (typeof s === 'string' && /^https?:\/\//i.test(s)) fileUrls.push(s);
                }
                if (fileUrls.length > 0) taskType = 'mj_img2img';
            }

            const body: any = {
                taskType,
                version: '7',
                prompt,
                aspectRatio: aspect,
                speed: 'fast',
                // Safe defaults per API constraints
                stylization: 100,
                weirdness: 0,
                variety: 0,
            };
            if (taskType === 'mj_img2img' && fileUrls.length > 0) {
                // KIE accepts either fileUrl or fileUrls; prefer fileUrls
                body.fileUrls = fileUrls;
            }
            const headers: Record<string,string> = {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${apiKey}`,
            };
            const res = await fetchWithTimeout(`${KIE_BASE}/api/v1/mj/generate`, {
                method: 'POST',
                headers,
                body: JSON.stringify(body),
            }, 20000);
            const data = await res.json().catch(async () => ({ code: res.status, msg: await res.text() }));
            if (!res.ok || data?.code && data.code !== 200) {
                throw new Error(`MJ create failed: code=${data?.code ?? res.status} msg=${data?.msg ?? ''}`);
            }
            const taskId = data?.data?.taskId || data?.taskId || data?.id;
            if (!taskId) throw new Error('Midjourney: missing taskId');

            // Poll task result
            const timeoutMs = 300000; // 5 minutes to accommodate provider queue delays
            const started = Date.now();
            let images: string[] = [];
            let notFoundCount = 0;
            while (true) {
                // Prefer GET with query param
                const r = await fetchWithTimeout(`${KIE_BASE}/api/v1/mj/record-info?taskId=${encodeURIComponent(taskId)}`, {
                    headers: { Authorization: `Bearer ${apiKey}` },
                }, 15000);
                const info: any = await r.json().catch(async () => ({ code: r.status, msg: await r.text() }));
                const code = info?.code ?? r.status;
                const status = info?.data?.status || info?.status;

                // Immediate exit on hard API errors
                if (code && code !== 200) {
                    if (code === 404) {
                        notFoundCount++;
                        if (notFoundCount > 5) throw new Error(`Midjourney record not found for task ${taskId}`);
                    } else {
                        throw new Error(`Midjourney poll error: code=${code} msg=${info?.msg ?? ''}`);
                    }
                }
                const list = info?.data?.resultInfoJson?.resultUrls || info?.data?.resultUrls || info?.resultInfoJson?.resultUrls || info?.resultUrls || [];
                const urls: string[] = (list || [])
                    .map((u: any) => (typeof u === 'string' ? u : u?.resultUrl))
                    .filter(Boolean);

                if (status === 'SUCCESS' || info?.successFlag === 1 || urls.length > 0) {
                    const urls: string[] = list
                        .map((u: any) => (typeof u === 'string' ? u : u?.resultUrl))
                        .filter(Boolean);
                    if (!urls.length) throw new Error('Midjourney: no result URLs');
                    images = urls.slice(0, n);
                    break;
                }
                if (info?.successFlag === 2 || status === 'FAILED') throw new Error('Midjourney generation failed');
                if (Date.now() - started > timeoutMs) throw new Error('Midjourney generation timed out');
                await new Promise(r2 => setTimeout(r2, 1000));
            }

            costTracker.addUsage({ model, image_count: images.length, request_id: opts?.request_id, metadata: { source: 'kie' } });
            return images;
        } catch (err) {
            log_llm_error(requestId, err);
            throw err;
        } finally {
            log_llm_response(requestId, { ok: true });
        }
    }
}

export const midjourneyProvider = new MidjourneyProvider();
