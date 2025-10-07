import { BaseModelProvider } from './base_provider.js';
import type { AgentDefinition, ImageGenerationOpts, ProviderStreamEvent } from '../types/types.js';
import { costTracker } from '../utils/cost_tracker.js';
import { log_llm_error, log_llm_request, log_llm_response } from '../utils/llm_logger.js';
import { fetchWithTimeout } from '../utils/fetch_with_timeout.js';

// Runway Gen-4 Image – official API
// Docs: https://docs.dev.runwayml.com/api/#tag/Start-generating/paths/~1v1~1text_to_image/post
// Task poll: GET /v1/tasks/{id}

const RUNWAY_BASE = process.env.RUNWAY_API_BASE || 'https://api.dev.runwayml.com';
const RUNWAY_VERSION = process.env.RUNWAY_API_VERSION || '2024-11-06';

function mapRatio(size?: ImageGenerationOpts['size']): string {
    const s = String(size || 'square');
    if (s === 'landscape' || s === '1792x1024' || s === '1536x1024' || s === '1920x1080' || s === '1280x720') return '1920:1080';
    if (s === 'portrait' || s === '1024x1792' || s === '1080x1920' || s === '720x1280') return '1080:1920';
    return '1024:1024';
}

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

export class RunwayProvider extends BaseModelProvider {
    constructor() {
        super('runway' as any);
    }

    async *createResponseStream(): AsyncGenerator<ProviderStreamEvent> {
        throw new Error('Runway provider does not support text streaming');
    }

    async createImage(prompt: string, model: string, agent: AgentDefinition, opts: ImageGenerationOpts = {}): Promise<string[]> {
        const apiKey = process.env.RUNWAY_API_KEY;
        const requestId = log_llm_request(agent.agent_id || 'default', 'runway', model, { prompt, opts }, new Date());
        let success = false;
        try {
            if (!apiKey) throw new Error('RUNWAY_API_KEY is not set');

            // 1) Start job
            const body: any = {
                promptText: prompt,
                ratio: mapRatio(opts.size),
                model: (model && model.toLowerCase().includes('turbo')) ? 'gen4_image_turbo' : 'gen4_image',
            };
            if (opts?.source_images) {
                const srcs = Array.isArray(opts.source_images) ? opts.source_images : [opts.source_images];
                body.referenceImages = srcs.slice(0, 3).map((v: any, i: number) => {
                    const uri = typeof v === 'string' ? v : v?.data || v;
                    return { uri, tag: `ref${i + 1}` };
                });
            }

            const createRes = await withRetries(() => fetchWithTimeout(`${RUNWAY_BASE}/v1/text_to_image`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${apiKey}`,
                    'X-Runway-Version': RUNWAY_VERSION,
                },
                body: JSON.stringify(body),
            }, 20000), 3);
            if (!createRes.ok) throw new Error(`Runway create failed: ${createRes.status} ${await createRes.text()}`);
            const created = await createRes.json();
            const id: string | undefined = created?.id || created?.task?.id;
            if (!id) throw new Error('Runway: missing task id');

            // 2) Poll task
            const pollUrl = `${RUNWAY_BASE}/v1/tasks/${encodeURIComponent(id)}`;
            const started = Date.now();
            const timeoutMs = 180000;
            let urls: string[] = [];
            while (true) {
                const response = await withRetries(() => fetchWithTimeout(pollUrl, {
                    headers: {
                        Authorization: `Bearer ${apiKey}`,
                        'X-Runway-Version': RUNWAY_VERSION,
                    },
                }, 15000), 2);

                if (!response.ok) throw new Error(`Runway poll failed: ${response.status} ${await response.text()}`);
                const info = await response.json();
                const status = (info?.status || info?.task?.status || '').toLowerCase();

                const extracted: string[] = [];
                const tryPush = (value: any) => {
                    if (!value) return;
                    if (typeof value === 'string') extracted.push(value);
                    else if (Array.isArray(value)) value.forEach(tryPush);
                    else if (typeof value === 'object') {
                        if (typeof value.url === 'string') extracted.push(value.url);
                        if (typeof value.uri === 'string') extracted.push(value.uri);
                        if (Array.isArray(value.images)) value.images.forEach(tryPush);
                        if (Array.isArray(value.assets)) value.assets.forEach(tryPush);
                        if (value.image) tryPush(value.image);
                    }
                };
                tryPush(info?.output);
                tryPush(info?.assets);
                tryPush(info?.task?.output);

                if (status === 'succeeded' || status === 'completed' || (extracted.length > 0 && (status === 'success' || status === ''))) {
                    urls = extracted;
                    break;
                }
                if (status === 'failed' || status === 'canceled' || status === 'error') {
                    throw new Error(`Runway task failed (status=${status || 'unknown'})`);
                }
                if (Date.now() - started > timeoutMs) throw new Error('Runway generation timed out');
                await new Promise(r => setTimeout(r, 1200));
            }

            if (!urls.length) throw new Error('Runway: no image url in response');
            costTracker.addUsage({ model, image_count: urls.length, request_id: opts?.request_id, metadata: { source: 'runway' } });
            success = true;
            return urls;
        } catch (err) {
            log_llm_error(requestId, err);
            throw err;
        } finally {
            log_llm_response(requestId, { ok: success });
        }
    }
}

export const runwayProvider = new RunwayProvider();
