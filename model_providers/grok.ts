/**
 * Grok model provider for the ensemble system.
 *
 * We extend OpenAIChat as Grok is a drop in replacement
 */

import type { AgentDefinition, ImageGenerationOpts } from '../types/types.js';
import { costTracker } from '../utils/cost_tracker.js';
import { log_llm_error, log_llm_request, log_llm_response } from '../utils/llm_logger.js';
import { OpenAIChat } from './openai_chat.js';
import OpenAI from 'openai';

/**
 * Grok model provider implementation
 */
export class GrokProvider extends OpenAIChat {
    constructor() {
        super('xai', process.env.XAI_API_KEY, 'https://api.x.ai/v1');
    }

    prepareParameters(
        requestParams: OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming
    ): OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming {
        if (Array.isArray(requestParams.tools)) {
            const index = requestParams.tools.findIndex(
                t => t.type === 'function' && (t as any).function?.name === 'grok_web_search'
            );
            if (index !== -1) {
                requestParams.tools.splice(index, 1);
                (requestParams as any).search_parameters = {
                    mode: 'on',
                    return_citations: true,
                };
            }
        }
        return super.prepareParameters(requestParams);
    }

    async createImage(
        prompt: string,
        model: string,
        agent: AgentDefinition,
        opts: ImageGenerationOpts = {}
    ): Promise<string[]> {
        const requestId = log_llm_request(agent.agent_id || 'default', 'xai', model, { prompt, opts }, new Date());
        let success = false;

        try {
            if (opts.source_images || opts.mask) {
                throw new Error('xAI image generation with source images or masks is not supported in Ensemble yet.');
            }

            const response = await this.client.images.generate({
                model,
                prompt,
                n: opts.n || 1,
            } as any);

            const images = (response.data || [])
                .map((item: any) => {
                    if (typeof item?.b64_json === 'string' && item.b64_json.length > 0) {
                        return `data:image/png;base64,${item.b64_json}`;
                    }
                    if (typeof item?.url === 'string' && item.url.length > 0) {
                        return item.url;
                    }
                    return null;
                })
                .filter((image: string | null): image is string => image !== null);

            if (!images.length) {
                throw new Error('xAI image generation returned no images.');
            }

            costTracker.addUsage({
                model,
                image_count: images.length,
                request_id: opts.request_id,
                metadata: { source: 'xai' },
            });
            success = true;
            return images;
        } catch (error) {
            log_llm_error(requestId, error);
            throw error;
        } finally {
            log_llm_response(requestId, { ok: success });
        }
    }
}

// Export an instance of the provider
export const grokProvider = new GrokProvider();
