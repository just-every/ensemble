import { BaseModelProvider } from './base_provider.js';
import type { AgentDefinition, ImageGenerationOpts, ProviderStreamEvent } from '../types/types.js';
import { costTracker } from '../utils/cost_tracker.js';
import { fetchWithTimeout } from '../utils/fetch_with_timeout.js';
import { log_llm_error, log_llm_request, log_llm_response } from '../utils/llm_logger.js';

// Fireworks Image API – FLUX family (Kontext / Pro / Schnell)
// Docs (Kontext, async): https://fireworks.ai/docs/api-reference/generate-or-edit-image-using-flux-kontext
// Poll: https://fireworks.ai/docs/api-reference/get-generated-image-from-flux-kontex

const FW_BASE = 'https://api.fireworks.ai';

function mapAspect(size?: ImageGenerationOpts['size']): string | undefined {
    if (!size) return undefined;
    const s = String(size);
    if (s === 'square' || s === '1024x1024' || s === '512x512' || s === '256x256') return '1:1';
    if (s === 'landscape' || s === '1792x1024' || s === '1536x1024') return '16:9';
    if (s === 'portrait' || s === '1024x1792' || s === '1024x1536') return '9:16';
    return undefined;
}

export class FireworksProvider extends BaseModelProvider {
    constructor() {
        super('fireworks' as any);
    }

    async *createResponseStream(): AsyncGenerator<ProviderStreamEvent> {
        throw new Error('Fireworks provider does not support text streaming');
    }

    private isKontext(model: string) {
        return model.includes('kontext');
    }

    private fireworksModelId(model: string): string {
        // Normalize a few friendly IDs to Fireworks documented values
        const m = model.toLowerCase();
        if (m.includes('kontext') && m.includes('max')) return 'flux-kontext-max';
        if (m.includes('kontext')) return 'flux-kontext-pro';
        if (m.includes('pro')) return 'flux-pro-1.1';
        if (m.includes('schnell')) return 'flux-schnell';
        return model;
    }

    async createImage(prompt: string, model: string, agent: AgentDefinition, opts: ImageGenerationOpts = {}): Promise<string[]> {
        const apiKey = process.env.FIREWORKS_API_KEY;
        const falKey = process.env.FAL_KEY; // fallback
        const requestId = log_llm_request(agent.agent_id || 'default', 'fireworks', model, { prompt, opts }, new Date());

        try {
            if (!apiKey) throw new Error('FIREWORKS_API_KEY is not set');

            const aspect_ratio = mapAspect(opts.size);
            const modelId = this.fireworksModelId(model);

            if (this.isKontext(modelId)) {
                // Async workflow for Kontext
                const createUrl = `${FW_BASE}/inference/v1/workflows/accounts/fireworks/models/${modelId}`;
                // Build body; include input_image when source provided
                let input_image: string | undefined;
                if (opts?.source_images) {
                    const s = Array.isArray(opts.source_images) ? opts.source_images[0] : (opts.source_images as any);
                    const v = typeof s === 'string' ? s : s?.data || s;
                    if (typeof v === 'string') input_image = v;
                }

                const res = await fetchWithTimeout(createUrl, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: `Bearer ${apiKey}`,
                    },
                    body: JSON.stringify({ prompt, aspect_ratio: aspect_ratio, output_format: 'png', ...(input_image ? { input_image } : {}) }),
                }, 60000);

                if (!res.ok) {
                    // Fallback to FAL if configured
                    if ((res.status === 401 || res.status === 403) && falKey) {
                        return this.fallbackToFAL(prompt, modelId, opts);
                    }
                    throw new Error(`Fireworks Kontext create failed: ${res.status} ${await res.text()}`);
                }
                const data = await res.json();
                const id = data.request_id || data.id;
                if (!id) throw new Error('Fireworks Kontext: missing request id');

                // Poll get_result
                const pollUrl = `${FW_BASE}/inference/v1/workflows/accounts/fireworks/models/${modelId}/get_result`;
                const started = Date.now();
                const timeoutMs = 240000;
                while (true) {
                    const r = await fetchWithTimeout(pollUrl, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            Authorization: `Bearer ${apiKey}`,
                        },
                        body: JSON.stringify({ id }),
                    }, 60000);
                    if (!r.ok) throw new Error(`Fireworks Kontext poll failed: ${r.status} ${await r.text()}`);
                    const out = await r.json();
                    const status = String(out.status || '').toLowerCase();
                    if (status.includes('ready') || status === 'succeeded' || status === 'completed') {
                        // Try common result shapes
                        const urls: string[] = [];
                        if (Array.isArray(out.result?.images)) {
                            for (const im of out.result.images) if (im?.url) urls.push(im.url);
                        }
                        if (out.result?.image?.url) urls.push(out.result.image.url);
                        if (out.result?.url) urls.push(out.result.url);
                        if (out.result?.sample) urls.push(out.result.sample);
                        // If Fireworks provided base64
                        if (!urls.length && out.result?.image_base64) {
                            urls.push(`data:image/png;base64,${out.result.image_base64}`);
                        }
                        if (!urls.length && typeof out.result === 'string' && /^https?:\/\//.test(out.result)) {
                            urls.push(out.result);
                        }
                        if (!urls.length) throw new Error('Fireworks Kontext: no image result found');

                        costTracker.addUsage({ model, image_count: urls.length, request_id: opts?.request_id, metadata: { source: 'fireworks', model: modelId } });
                        return urls;
                    }
                    if (status.includes('error') || status.includes('failed')) {
                        throw new Error(`Fireworks Kontext failed: ${status}`);
                    }
                    if (Date.now() - started > timeoutMs) throw new Error('Fireworks Kontext timed out');
                    await new Promise(r2 => setTimeout(r2, 1500));
                }
            }

            // For non-Kontext (e.g., schnell/pro if exposed similarly) try the same workflow first.
            try {
                return await this.createImage(prompt, 'flux-kontext-pro', agent, opts);
            } catch (e) {
                if (falKey) return this.fallbackToFAL(prompt, model, opts);
                throw e;
            }
        } catch (err) {
            log_llm_error(requestId, err);
            // As a final chance, try FAL if available
            if (process.env.FAL_KEY) {
                try {
                    const urls = await this.fallbackToFAL(prompt, model, opts);
                    log_llm_response(requestId, { ok: true, fallback: 'fal' });
                    return urls;
                } catch (_) {
                    // ignore, rethrow original
                }
            }
            throw err;
        } finally {
            log_llm_response(requestId, { ok: true });
        }
    }

    private async fallbackToFAL(prompt: string, model: string, opts: ImageGenerationOpts = {}): Promise<string[]> {
        // Map Fireworks FLUX variants to FAL endpoints where possible
        const lower = model.toLowerCase();
        let endpoint = '';
        if (lower.includes('schnell')) endpoint = 'fal-ai/flux/schnell';
        else if (lower.includes('dev')) endpoint = 'fal-ai/flux/dev';
        else if (lower.includes('pro') || lower.includes('kontext')) endpoint = 'fal-ai/flux-pro/kontext';
        else endpoint = 'fal-ai/flux/schnell';

        const res = await fetch(`https://fal.run/${endpoint}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Key ${process.env.FAL_KEY}`,
            },
            body: JSON.stringify({
                prompt,
                input: { prompt },
            }),
        });
        if (!res.ok) throw new Error(`FAL fallback failed: ${res.status} ${await res.text()}`);
        const data = await res.json();
        const images: string[] = [];
        const arr = data?.images || data?.output?.images || [];
        for (const im of arr) if (im?.url) images.push(im.url);
        if (!images.length && data?.url) images.push(data.url);
        if (!images.length) throw new Error('FAL fallback: no image url');
        costTracker.addUsage({ model, image_count: images.length, request_id: opts?.request_id, metadata: { source: 'fal-fallback' } });
        return images;
    }
}

export const fireworksProvider = new FireworksProvider();
