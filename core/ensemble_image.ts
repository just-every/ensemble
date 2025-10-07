import { randomUUID } from 'node:crypto';
import type { AgentDefinition, ImageGenerationOpts, ProviderStreamEvent } from '../types/types.js';
import { getModelFromAgent, getModelProvider } from '../model_providers/model_provider.js';

/**
 * Generate images from text prompts
 *
 * @param prompt - Text description of the image to generate
 * @param options - Optional configuration for image generation
 * @returns Promise that resolves to an array of generated image data (base64 or URLs)
 *
 * @example
 * ```typescript
 * // Simple image generation
 * const result = await ensembleImage('A beautiful sunset over mountains');
 * console.log(`Generated ${result.images.length} image(s)`);
 *
 * // Using Google Gemini 2.5 Flash Image (Preview)
 * const result = await ensembleImage('A serene lake at dawn', {
 *   model: 'gemini-2.5-flash-image-preview',
 * }, {
 *   size: 'portrait'
 * }});
 * ```
 */
export function ensembleImage(
    prompt: string,
    agent: AgentDefinition,
    options: ImageGenerationOpts = {}
): Promise<string[]> | AsyncGenerator<ProviderStreamEvent> {
    const run = async (): Promise<string[]> => {
        const model = await getModelFromAgent(agent, 'image_generation');
        const provider = getModelProvider(model);
        if (!provider.createImage) throw new Error(`Provider for model ${model} does not support image generation`);
        return provider.createImage(prompt, model, agent, options);
    };

    if (!options.stream) {
        return run();
    }

    // Streaming mode
    const self = async function* (): AsyncGenerator<ProviderStreamEvent> {
        const request_id = options.request_id || randomUUID();
        // Ensure providers receive the correlation id
        options = { ...options, request_id };
        const { costTracker } = await import('../utils/cost_tracker.js');

        // Emit start
        yield { type: 'image_start', request_id, timestamp: new Date().toISOString() } as ProviderStreamEvent;

        // Bridge cost updates for this request_id only
        const handler = (usage: any) => {
            if (usage?.request_id === request_id) {
                const ev: ProviderStreamEvent = { type: 'cost_update', usage, request_id, timestamp: new Date().toISOString() } as any;
                // push synchronously so consumers can flush immediately after provider returns
                iterator.push(ev);
            }
        };
        const iterator: { queue: ProviderStreamEvent[]; push: (e: ProviderStreamEvent) => void } = {
            queue: [],
            push(e) { this.queue.push(e); },
        };
        costTracker.onAddUsage(handler);

        try {
            const images = await run();
            // flush any cost updates that may have arrived before first file
            while (iterator.queue.length) yield iterator.queue.shift() as ProviderStreamEvent;
            // Emit each file as it becomes available (we have them all at once here)
            let idx = 0;
            for (const img of images) {
                const isUrl = typeof img === 'string' && /^https?:\/\//i.test(img);
                const ev: ProviderStreamEvent = {
                    type: 'file_complete',
                    request_id,
                    message_id: `${request_id}_img_${idx}`,
                    data_format: isUrl ? 'url' : 'base64',
                    data: img,
                    timestamp: new Date().toISOString(),
                } as any;
                yield ev;
                // flush any pending cost updates
                while (iterator.queue.length) yield iterator.queue.shift() as ProviderStreamEvent;
                idx++;
            }

            // Final image_complete
            yield { type: 'image_complete', request_id, timestamp: new Date().toISOString() } as ProviderStreamEvent;

            // Flush residual cost events
            while (iterator.queue.length) yield iterator.queue.shift() as ProviderStreamEvent;
        } catch (error: any) {
            yield { type: 'error', request_id, error: String(error?.message || error) } as ProviderStreamEvent;
        } finally {
            // remove listener
            costTracker.offAddUsage(handler);
        }
    };

    return self();
}
