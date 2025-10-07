import { BaseModelProvider } from './base_provider.js';
import type { AgentDefinition, ImageGenerationOpts, ProviderStreamEvent } from '../types/types.js';
import { costTracker } from '../utils/cost_tracker.js';
import { log_llm_error, log_llm_request, log_llm_response } from '../utils/llm_logger.js';

// FAL.ai – used directly for Runway Gen-4 Image and Recraft v3
// Also used as fallback for Flux family

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

    async *createResponseStream(): AsyncGenerator<ProviderStreamEvent> {
        throw new Error('FAL provider does not support text streaming');
    }

    private endpointFor(model: string): { path: string; bodyMode: 'top' | 'input' } {
        const m = model.toLowerCase();
        if (m.startsWith('recraft')) return { path: 'fal-ai/recraft/v3/text-to-image', bodyMode: 'top' };
        if (m.includes('runway') || m.includes('gen4')) return { path: 'runwayml/gen4-image', bodyMode: 'input' };
        // flux fallbacks
        if (m.includes('schnell')) return { path: 'fal-ai/flux/schnell', bodyMode: 'top' };
        if (m.includes('dev')) return { path: 'fal-ai/flux/dev', bodyMode: 'top' };
        if (m.includes('kontext') || m.includes('pro')) return { path: 'fal-ai/flux-pro/kontext', bodyMode: 'top' };
        return { path: 'fal-ai/flux/schnell', bodyMode: 'top' };
    }

    async createImage(prompt: string, model: string, agent: AgentDefinition, opts: ImageGenerationOpts = {}): Promise<string[]> {
        const falKey = process.env.FAL_KEY;
        const requestId = log_llm_request(agent.agent_id || 'default', 'fal', model, { prompt, opts }, new Date());
        try {
            if (!falKey) throw new Error('FAL_KEY is not set');
            const { path, bodyMode } = this.endpointFor(model);
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
            const images: string[] = [];
            const arr = data?.images || data?.output?.images || [];
            for (const im of arr) if (im?.url) images.push(im.url);
            if (!images.length && data?.url) images.push(data.url);
            if (!images.length) throw new Error('FAL: no image url in response');
            costTracker.addUsage({ model, image_count: images.length, request_id: opts?.request_id, metadata: { source: 'fal' } });
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
