/** DeepSeek V4 provider. DeepSeek exposes an OpenAI-compatible chat endpoint. */

import OpenAI from 'openai';
import { OpenAIChat } from './openai_chat.js';
import { applyDeepSeekV4Contract } from './deepseek_v4_contract.js';
import { appendJsonSchemaInstruction, getJsonSchemaFromResponseFormat } from '../utils/structured_output.js';

export class DeepSeekProvider extends OpenAIChat {
    constructor() {
        super('deepseek', process.env.DEEPSEEK_API_KEY, 'https://api.deepseek.com/v1');
    }

    prepareParameters(
        requestParams: OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming
    ): OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming {
        const jsonSchema = getJsonSchemaFromResponseFormat(requestParams.response_format);
        const params = applyDeepSeekV4Contract(super.prepareParameters(requestParams));
        if (jsonSchema) {
            params.response_format = { type: 'json_object' };
            params.messages = appendJsonSchemaInstruction(params.messages, jsonSchema);
        }
        return params;
    }
}

export const deepSeekProvider = new DeepSeekProvider();
