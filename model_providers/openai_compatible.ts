/**
 * OpenAI-compatible custom endpoint support.
 *
 * Local runtimes such as LM Studio expose the OpenAI chat-completions API but
 * use arbitrary model IDs and endpoints. This provider reuses Ensemble's
 * OpenAIChat streaming implementation while keeping routing explicit through
 * external model registration.
 */

import { ModelCost, ModelEntry, ModelFeatures, ModelProviderID } from '../types/types.js';
import { registerExternalModel } from '../utils/external_models.js';
import { OpenAIChat } from './openai_chat.js';

const DEFAULT_LOCAL_API_KEY = 'not-needed';

const DEFAULT_OPENAI_COMPATIBLE_FEATURES: ModelFeatures = {
    context_length: 128000,
    input_modality: ['text'],
    output_modality: ['text'],
    tool_use: false,
    streaming: true,
    json_output: true,
    max_output_tokens: 8192,
};

export interface OpenAICompatibleModelOptions {
    id: string;
    endpoint: string;
    apiKey?: string;
    providerId?: string;
    aliases?: string[];
    cost?: ModelCost;
    features?: ModelFeatures;
    class?: string;
    description?: string;
    defaultHeaders?: Record<string, string | null | undefined>;
    commonParams?: Record<string, unknown>;
}

export function normalizeOpenAICompatibleEndpoint(endpoint: string): string {
    if (!endpoint || endpoint.trim().length === 0) {
        throw new Error('OpenAI-compatible endpoint is required.');
    }

    const url = new URL(endpoint);
    if (url.pathname === '' || url.pathname === '/') {
        url.pathname = '/v1';
    }
    url.pathname = url.pathname.replace(/\/+$/, '');
    return url.toString().replace(/\/+$/, '');
}

export class OpenAICompatibleProvider extends OpenAIChat {
    readonly endpoint: string;

    constructor(options: OpenAICompatibleModelOptions) {
        const endpoint = normalizeOpenAICompatibleEndpoint(options.endpoint);
        const providerId = (options.providerId || `openai-compatible:${options.id}`) as ModelProviderID;

        super(
            providerId,
            options.apiKey || DEFAULT_LOCAL_API_KEY,
            endpoint,
            options.defaultHeaders,
            options.commonParams
        );

        this.endpoint = endpoint;
    }
}

export function registerOpenAICompatibleModel(options: OpenAICompatibleModelOptions): OpenAICompatibleProvider {
    const provider = new OpenAICompatibleProvider(options);
    const providerId = (options.providerId || `openai-compatible:${options.id}`) as ModelProviderID;
    const model: ModelEntry = {
        id: options.id,
        aliases: options.aliases,
        provider: providerId,
        cost: options.cost,
        features: {
            ...DEFAULT_OPENAI_COMPATIBLE_FEATURES,
            ...options.features,
        },
        class: options.class,
        description: options.description || `OpenAI-compatible model at ${provider.endpoint}`,
    };

    registerExternalModel(model, provider);
    return provider;
}
