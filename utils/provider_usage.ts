import type { ModelUsage } from '../types/types.js';

interface OpenAIResponsesUsage {
    input_tokens?: number | null;
    output_tokens?: number | null;
    total_tokens?: number | null;
    input_tokens_details?: {
        cached_tokens?: number | null;
        cache_write_tokens?: number | null;
    } | null;
    output_tokens_details?: {
        reasoning_tokens?: number | null;
    } | null;
}

interface OpenAIChatUsage {
    prompt_tokens?: number | null;
    completion_tokens?: number | null;
    total_tokens?: number | null;
    prompt_tokens_details?: {
        cached_tokens?: number | null;
        cache_write_tokens?: number | null;
    } | null;
    completion_tokens_details?: {
        reasoning_tokens?: number | null;
    } | null;
}

interface GeminiUsageMetadata {
    promptTokenCount?: number | null;
    candidatesTokenCount?: number | null;
    totalTokenCount?: number | null;
    cachedContentTokenCount?: number | null;
    thoughtsTokenCount?: number | null;
    toolUsePromptTokenCount?: number | null;
}

function tokenCount(value: number | null | undefined): number {
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

export function normalizeOpenAIResponsesUsage(model: string, usage: OpenAIResponsesUsage): ModelUsage {
    const inputTokens = tokenCount(usage.input_tokens);
    const outputTokens = tokenCount(usage.output_tokens);
    const reasoningTokens = tokenCount(usage.output_tokens_details?.reasoning_tokens);

    return {
        model,
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        total_tokens: inputTokens + outputTokens,
        cached_tokens: tokenCount(usage.input_tokens_details?.cached_tokens),
        cache_write_tokens: tokenCount(usage.input_tokens_details?.cache_write_tokens),
        reasoning_tokens: reasoningTokens,
        metadata: {
            provider_total_tokens: tokenCount(usage.total_tokens),
            reasoning_tokens: reasoningTokens,
        },
    };
}

export function normalizeOpenAIChatUsage(model: string, usage: OpenAIChatUsage): ModelUsage {
    const inputTokens = tokenCount(usage.prompt_tokens);
    const outputTokens = tokenCount(usage.completion_tokens);
    const reasoningTokens = tokenCount(usage.completion_tokens_details?.reasoning_tokens);

    return {
        model,
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        total_tokens: inputTokens + outputTokens,
        cached_tokens: tokenCount(usage.prompt_tokens_details?.cached_tokens),
        cache_write_tokens: tokenCount(usage.prompt_tokens_details?.cache_write_tokens),
        reasoning_tokens: reasoningTokens,
        metadata: {
            provider_total_tokens: tokenCount(usage.total_tokens),
            reasoning_tokens: reasoningTokens,
        },
    };
}

export function normalizeGeminiUsage(model: string, usage: GeminiUsageMetadata): ModelUsage {
    const promptTokens = tokenCount(usage.promptTokenCount);
    const toolTokens = tokenCount(usage.toolUsePromptTokenCount);
    const candidateTokens = tokenCount(usage.candidatesTokenCount);
    const reasoningTokens = tokenCount(usage.thoughtsTokenCount);
    const inputTokens = promptTokens + toolTokens;
    const outputTokens = candidateTokens + reasoningTokens;

    return {
        model,
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        total_tokens: inputTokens + outputTokens,
        cached_tokens: tokenCount(usage.cachedContentTokenCount),
        reasoning_tokens: reasoningTokens,
        metadata: {
            provider_total_tokens: tokenCount(usage.totalTokenCount),
            reasoning_tokens: reasoningTokens,
            tool_tokens: toolTokens,
        },
    };
}
