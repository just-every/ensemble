import { describe, expect, it } from 'vitest';
import { findModel } from '../data/model_data.js';
import { getModelFromAgent, getProviderFromModel } from '../model_providers/model_provider.js';

describe('August 2026 OpenRouter refresh', () => {
    it.each([
        {
            alias: 'qwen-3.8-max',
            id: 'qwen/qwen3.8-max',
            cost: {
                input_per_million: 2,
                cached_input_per_million: 0.25,
                cache_write_input_per_million: 2.5,
                output_per_million: 6,
            },
            maxOutput: 131072,
        },
        {
            alias: 'inkling-small',
            id: 'thinkingmachines/inkling-small',
            cost: { input_per_million: 0.45, cached_input_per_million: 0.1, output_per_million: 1.2 },
            maxOutput: 262144,
        },
        {
            alias: 'muse-spark-1.2',
            id: 'meta/muse-spark-1.2',
            cost: { input_per_million: 1.25, cached_input_per_million: 0.15, output_per_million: 4.25 },
            maxOutput: undefined,
        },
    ])('registers $id from the live catalog', async ({ alias, id, cost, maxOutput }) => {
        const model = findModel(alias);
        expect(model).toMatchObject({ id, provider: 'openrouter', openrouter_id: id, cost });
        expect(model?.features?.max_output_tokens).toBe(maxOutput);
        expect(await getModelFromAgent({ agent_id: alias, model: alias } as any)).toBe(id);
        expect(getProviderFromModel(id)).toBe('openrouter');
    });

    it('refreshes remaining material live-catalog price and limit drift', () => {
        expect(findModel('qwen3.5-397b-a17b')).toMatchObject({
            cost: { input_per_million: 0.5, cached_input_per_million: 0.3, output_per_million: 3.6 },
            features: { max_output_tokens: 262144, structured_output: true },
        });
        expect(findModel('gpt-oss-120b')).toMatchObject({
            cost: { input_per_million: 0.03, cached_input_per_million: 0.03, output_per_million: 0.17 },
            features: { max_output_tokens: 131072, structured_output: true },
        });
        expect(findModel('qwen3')).toMatchObject({
            cost: { input_per_million: 0.23, output_per_million: 2.3 },
        });
        expect(findModel('meta-llama/llama-4-maverick')).toMatchObject({
            cost: { input_per_million: 0.2, output_per_million: 0.696 },
            features: { structured_output: true },
        });
        expect(findModel('deepseek/deepseek-v4-pro')).toMatchObject({
            cost: {
                input_per_million: 0.63168,
                cached_input_per_million: 0.053298,
                output_per_million: 1.26336,
            },
            features: { max_output_tokens: 393216, structured_output: true },
        });
        expect(findModel('meta/muse-spark-1.1')).toBeUndefined();
    });
});
