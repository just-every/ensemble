import OpenAI from 'openai';

type DeepSeekV4Params = OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming & {
    reasoning?: { effort?: string };
    reasoning_effort?: 'high' | 'max';
    thinking?: { type: 'enabled' | 'disabled' };
};

/** Translate Ensemble reasoning controls into DeepSeek V4's native thinking contract. */
export function applyDeepSeekV4Contract(
    requestParams: OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming
): OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming {
    const params = requestParams as DeepSeekV4Params;
    if (!params.model.startsWith('deepseek-v4-')) return params;

    const effort = params.reasoning?.effort;
    delete params.reasoning;

    if (effort === 'none' || effort === 'disabled') {
        params.thinking = { type: 'disabled' };
        delete params.reasoning_effort;
        return params;
    }

    params.thinking = { type: 'enabled' };
    params.reasoning_effort = effort === 'xhigh' || effort === 'max' ? 'max' : 'high';
    return params;
}
