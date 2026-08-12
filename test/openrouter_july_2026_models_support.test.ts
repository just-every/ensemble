import { describe, expect, it } from 'vitest';
import { findModel } from '../data/model_data.js';
import { getModelFromAgent, getProviderFromModel } from '../model_providers/model_provider.js';

const MODEL_CASES = [
    {
        name: 'Kimi K3',
        lookup: 'Kimi K3',
        alias: 'kimi-k3',
        id: 'moonshotai/kimi-k3',
        modelClass: 'reasoning',
        cost: {
            input_per_million: 3.0,
            cached_input_per_million: 0.3,
            output_per_million: 15.0,
        },
        features: {
            context_length: 1_048_576,
            input_modality: ['text', 'image'],
            output_modality: ['text'],
            tool_use: true,
            streaming: true,
            json_output: true,
            structured_output: true,
            reasoning_output: true,
        },
    },
    {
        name: 'LongCat 2.0',
        lookup: 'LongCat 2.0',
        alias: 'longcat-2',
        id: 'meituan/longcat-2.0',
        modelClass: 'reasoning',
        cost: {
            input_per_million: 0.3,
            cached_input_per_million: 0.006,
            output_per_million: 1.2,
        },
        features: {
            context_length: 1_048_756,
            max_output_tokens: 262144,
            input_modality: ['text'],
            output_modality: ['text'],
            tool_use: true,
            streaming: true,
            json_output: false,
            reasoning_output: true,
        },
    },
    {
        name: 'Inkling',
        lookup: 'Inkling',
        alias: 'inkling',
        id: 'thinkingmachines/inkling',
        modelClass: 'reasoning',
        cost: {
            input_per_million: 0.95,
            cached_input_per_million: 0.16,
            output_per_million: 4.05,
        },
        features: {
            context_length: 524_288,
            input_modality: ['text', 'image', 'audio'],
            output_modality: ['text'],
            tool_use: true,
            streaming: true,
            json_output: false,
            reasoning_output: true,
            max_output_tokens: 262144,
        },
    },
    {
        name: 'Muse Spark 1.2',
        lookup: 'Muse Spark 1.2',
        alias: 'muse-spark-1.2',
        id: 'meta/muse-spark-1.2',
        modelClass: 'reasoning',
        cost: {
            input_per_million: 1.25,
            cached_input_per_million: 0.15,
            output_per_million: 4.25,
        },
        features: {
            context_length: 1_048_576,
            input_modality: ['text', 'image', 'audio', 'video'],
            output_modality: ['text'],
            tool_use: true,
            streaming: true,
            json_output: true,
            structured_output: true,
            reasoning_output: true,
        },
    },
    {
        name: 'KAT-Coder Pro V2.5',
        lookup: 'KAT-Coder-Pro V2.5',
        alias: 'kat-coder-pro-v2-5',
        id: 'kwaipilot/kat-coder-pro-v2.5',
        modelClass: 'code',
        cost: {
            input_per_million: 0.74,
            cached_input_per_million: 0.15,
            output_per_million: 2.96,
        },
        features: {
            context_length: 256000,
            max_output_tokens: 80000,
            input_modality: ['text'],
            output_modality: ['text'],
            tool_use: true,
            streaming: true,
            json_output: true,
            structured_output: true,
        },
    },
    {
        name: 'KAT-Coder Air V2.5',
        lookup: 'KAT-Coder-Air V2.5',
        alias: 'kat-coder-air-v2-5',
        id: 'kwaipilot/kat-coder-air-v2.5',
        modelClass: 'code',
        cost: {
            input_per_million: 0.15,
            cached_input_per_million: 0.03,
            output_per_million: 0.6,
        },
        features: {
            context_length: 256000,
            max_output_tokens: 80000,
            input_modality: ['text'],
            output_modality: ['text'],
            tool_use: true,
            streaming: true,
            json_output: true,
            structured_output: true,
        },
    },
] as const;

describe('July 2026 OpenRouter model additions', () => {
    it.each(MODEL_CASES)('registers $name with current routing and metadata', async modelCase => {
        const model = findModel(modelCase.lookup);

        expect(model?.id).toBe(modelCase.id);
        expect(model?.openrouter_id).toBe(modelCase.id);
        expect(model?.provider).toBe('openrouter');
        expect(model?.class).toBe(modelCase.modelClass);
        expect(model?.cost).toMatchObject(modelCase.cost);
        expect(model?.features).toMatchObject(modelCase.features);
        expect(await getModelFromAgent({ agent_id: `test-${modelCase.alias}`, model: modelCase.alias } as any)).toBe(
            modelCase.id
        );
        expect(getProviderFromModel(modelCase.alias)).toBe('openrouter');
    });

    it('preserves Kimi K3 reasoning-effort suffixes while routing through OpenRouter', async () => {
        expect(await getModelFromAgent({ agent_id: 'test-kimi-k3-high', model: 'kimi-k3-high' } as any)).toBe(
            'moonshotai/kimi-k3-high'
        );
        expect(getProviderFromModel('kimi-k3-high')).toBe('openrouter');
    });
});
