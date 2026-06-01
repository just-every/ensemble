/**
 * OpenRouter model provider for the ensemble system.
 */

import { OpenAIChat } from './openai_chat.js';
import OpenAI from 'openai';
import { appendJsonSchemaInstruction, getJsonSchemaFromResponseFormat } from '../utils/structured_output.js';
import { findModel } from '../data/model_data.js';

type OpenRouterChatCompletionParams = OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming & {
    structured_outputs?: boolean;
};

function supportsNativeStructuredOutput(model: string): boolean {
    return findModel(model)?.features?.structured_output === true;
}

/**
 * OpenRouter model provider implementation
 */
export class OpenRouterProvider extends OpenAIChat {
    constructor() {
        super(
            'openrouter',
            process.env.OPENROUTER_API_KEY,
            'https://openrouter.ai/api/v1',
            {
                'User-Agent': 'JustEvery_',
                'HTTP-Referer': 'https://justevery.com/',
                'X-Title': 'JustEvery_',
            },
            {
                provider: {
                    require_parameters: true,
                    sort: 'throughput',
                    ignore: ['Novita'], // Fails frequently with Qwen tool calling
                },
            }
        );
    }

    prepareParameters(
        requestParams: OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming
    ): OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming {
        requestParams = super.prepareParameters(requestParams);
        const openRouterParams = requestParams as OpenRouterChatCompletionParams;

        const jsonSchema = getJsonSchemaFromResponseFormat(openRouterParams.response_format);
        if (jsonSchema && openRouterParams.model.startsWith('deepseek/')) {
            openRouterParams.response_format = { type: 'json_object' } as any;
            openRouterParams.messages = appendJsonSchemaInstruction(openRouterParams.messages, jsonSchema);
            return openRouterParams;
        }

        if (jsonSchema && supportsNativeStructuredOutput(openRouterParams.model)) {
            // OpenRouter distinguishes JSON mode from schema-enforced structured-output routing.
            openRouterParams.structured_outputs = true;
            return openRouterParams;
        }

        if (jsonSchema) {
            openRouterParams.response_format = { type: 'json_object' } as any;
            openRouterParams.messages = appendJsonSchemaInstruction(openRouterParams.messages, jsonSchema);
        }

        return openRouterParams;
    }
}

/**
 * A singleton instance of OpenRouterProvider for use in import statements
 */
export const openRouterProvider = new OpenRouterProvider();
