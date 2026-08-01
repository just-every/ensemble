import type { ModelUsage } from '../types/types.js';

export interface AnthropicUsageAccumulator {
    inputTokens: number;
    outputTokens: number;
    cacheCreationTokens: number;
    cacheReadTokens: number;
    cacheWrite5mTokens: number;
    cacheWrite1hTokens: number;
    reasoningTokens: number;
}

export interface AnthropicUsageSample {
    input_tokens?: number | null;
    output_tokens?: number | null;
    cache_creation_input_tokens?: number | null;
    cache_read_input_tokens?: number | null;
    cache_creation?: {
        ephemeral_5m_input_tokens?: number | null;
        ephemeral_1h_input_tokens?: number | null;
    } | null;
    output_tokens_details?: {
        thinking_tokens?: number | null;
    } | null;
}

function tokenCount(value: number | null | undefined): number {
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

export function createAnthropicUsageAccumulator(): AnthropicUsageAccumulator {
    return {
        inputTokens: 0,
        outputTokens: 0,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
        cacheWrite5mTokens: 0,
        cacheWrite1hTokens: 0,
        reasoningTokens: 0,
    };
}

/** Anthropic streaming usage fields are cumulative, so retain maxima instead of summing events. */
export function mergeAnthropicUsage(accumulator: AnthropicUsageAccumulator, usage: AnthropicUsageSample): void {
    accumulator.inputTokens = Math.max(accumulator.inputTokens, tokenCount(usage.input_tokens));
    accumulator.outputTokens = Math.max(accumulator.outputTokens, tokenCount(usage.output_tokens));
    accumulator.cacheCreationTokens = Math.max(
        accumulator.cacheCreationTokens,
        tokenCount(usage.cache_creation_input_tokens)
    );
    accumulator.cacheReadTokens = Math.max(accumulator.cacheReadTokens, tokenCount(usage.cache_read_input_tokens));
    accumulator.cacheWrite5mTokens = Math.max(
        accumulator.cacheWrite5mTokens,
        tokenCount(usage.cache_creation?.ephemeral_5m_input_tokens)
    );
    accumulator.cacheWrite1hTokens = Math.max(
        accumulator.cacheWrite1hTokens,
        tokenCount(usage.cache_creation?.ephemeral_1h_input_tokens)
    );
    accumulator.cacheCreationTokens = Math.max(
        accumulator.cacheCreationTokens,
        accumulator.cacheWrite5mTokens + accumulator.cacheWrite1hTokens
    );
    accumulator.reasoningTokens = Math.max(
        accumulator.reasoningTokens,
        tokenCount(usage.output_tokens_details?.thinking_tokens)
    );
}

export function normalizeAnthropicUsage(model: string, accumulator: AnthropicUsageAccumulator): ModelUsage | undefined {
    const classifiedCacheCreationTokens = accumulator.cacheWrite5mTokens + accumulator.cacheWrite1hTokens;
    if (classifiedCacheCreationTokens !== accumulator.cacheCreationTokens) {
        throw new Error(
            `Anthropic cache creation usage for ${model} lacks an exact TTL breakdown: ` +
                `${accumulator.cacheCreationTokens} total versus ${classifiedCacheCreationTokens} classified tokens`
        );
    }

    const inputTokens = accumulator.inputTokens + accumulator.cacheReadTokens + accumulator.cacheCreationTokens;
    if (inputTokens === 0 && accumulator.outputTokens === 0) {
        return undefined;
    }

    return {
        model,
        input_tokens: inputTokens,
        output_tokens: accumulator.outputTokens,
        total_tokens: inputTokens + accumulator.outputTokens,
        cached_tokens: accumulator.cacheReadTokens,
        cache_write_tokens: accumulator.cacheWrite5mTokens,
        cache_write_1h_tokens: accumulator.cacheWrite1hTokens,
        reasoning_tokens: accumulator.reasoningTokens,
        metadata: {
            base_input_tokens: accumulator.inputTokens,
            cache_creation_input_tokens: accumulator.cacheCreationTokens,
            cache_read_input_tokens: accumulator.cacheReadTokens,
            cache_creation_5m_input_tokens: accumulator.cacheWrite5mTokens,
            cache_creation_1h_input_tokens: accumulator.cacheWrite1hTokens,
            reasoning_tokens: accumulator.reasoningTokens,
        },
    };
}
