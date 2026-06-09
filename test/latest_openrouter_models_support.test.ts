import { describe, expect, it } from 'vitest';
import { findModel } from '../data/model_data.js';
import { getModelFromAgent, getProviderFromModel } from '../model_providers/model_provider.js';

describe('latest OpenRouter model support', () => {
    it('registers GLM-5.1 with OpenRouter pricing and aliases', async () => {
        const model = findModel('GLM-5.1');

        expect(model?.id).toBe('z-ai/glm-5.1');
        expect(await getModelFromAgent({ agent_id: 'glm', model: 'glm-5.1' } as any)).toBe('z-ai/glm-5.1');
        expect(getProviderFromModel('z-ai/glm-5.1')).toBe('openrouter');
        expect(model?.cost).toMatchObject({
            input_per_million: 0.98,
            cached_input_per_million: 0.182,
            output_per_million: 3.08,
        });
        expect(model?.features).toMatchObject({
            context_length: 202752,
            input_modality: ['text'],
            output_modality: ['text'],
            tool_use: true,
            streaming: true,
            json_output: true,
            reasoning_output: true,
        });
    });

    it('registers Kimi K2.6 with multimodal OpenRouter details', async () => {
        const model = findModel('Kimi K2.6');

        expect(model?.id).toBe('moonshotai/kimi-k2.6');
        expect(await getModelFromAgent({ agent_id: 'kimi', model: 'kimi-k2-6' } as any)).toBe('moonshotai/kimi-k2.6');
        expect(getProviderFromModel('moonshotai/kimi-k2.6')).toBe('openrouter');
        expect(model?.cost).toMatchObject({
            input_per_million: 0.684,
            cached_input_per_million: 0.144,
            output_per_million: 3.42,
        });
        expect(model?.features).toMatchObject({
            context_length: 262144,
            max_output_tokens: 262144,
            input_modality: ['text', 'image'],
            output_modality: ['text'],
            tool_use: true,
            streaming: true,
            json_output: true,
            reasoning_output: true,
        });
    });

    it('registers DeepSeek V4 Pro and Flash as OpenRouter models', async () => {
        const pro = findModel('DeepSeek-V4');
        const flash = findModel('DeepSeek-V4-Flash');

        expect(pro?.id).toBe('deepseek/deepseek-v4-pro');
        expect(await getModelFromAgent({ agent_id: 'deepseek-pro', model: 'deepseek-v4-pro' } as any)).toBe(
            'deepseek/deepseek-v4-pro'
        );
        expect(getProviderFromModel('deepseek/deepseek-v4-pro')).toBe('openrouter');
        expect(pro?.cost).toMatchObject({
            input_per_million: 0.435,
            cached_input_per_million: 0.003625,
            output_per_million: 0.87,
        });
        expect(pro?.features).toMatchObject({
            context_length: 1048576,
            max_output_tokens: 384000,
            input_modality: ['text'],
            output_modality: ['text'],
            tool_use: true,
            streaming: true,
            json_output: true,
            reasoning_output: true,
        });

        expect(flash?.id).toBe('deepseek/deepseek-v4-flash');
        expect(await getModelFromAgent({ agent_id: 'deepseek-flash', model: 'deepseek-v4-flash' } as any)).toBe(
            'deepseek/deepseek-v4-flash'
        );
        expect(flash?.cost).toMatchObject({
            input_per_million: 0.0983,
            cached_input_per_million: 0.0197,
            output_per_million: 0.1966,
        });
        expect(flash?.features?.max_output_tokens).toBe(131072);
    });

    it('registers Xiaomi MiMo V2.5 and MiMo V2.5 Pro as OpenRouter models', async () => {
        const model = findModel('MiMo-V2.5');
        const pro = findModel('mimo-v2-5-pro');

        expect(model?.id).toBe('xiaomi/mimo-v2.5');
        expect(await getModelFromAgent({ agent_id: 'mimo', model: 'mimo-v2-5' } as any)).toBe('xiaomi/mimo-v2.5');
        expect(getProviderFromModel('xiaomi/mimo-v2.5')).toBe('openrouter');
        expect(model?.openrouter_id).toBe('xiaomi/mimo-v2.5');
        expect(model?.cost).toMatchObject({
            input_per_million: 0.14,
            cached_input_per_million: 0.0028,
            output_per_million: 0.28,
        });
        expect(model?.features).toMatchObject({
            context_length: 1048576,
            max_output_tokens: 131072,
            input_modality: ['text', 'audio', 'image', 'video'],
            output_modality: ['text'],
            tool_use: true,
            streaming: true,
            json_output: true,
            reasoning_output: true,
        });

        expect(pro?.id).toBe('xiaomi/mimo-v2.5-pro');
        expect(await getModelFromAgent({ agent_id: 'mimo-pro', model: 'mimo-v2.5-pro' } as any)).toBe(
            'xiaomi/mimo-v2.5-pro'
        );
        expect(getProviderFromModel('xiaomi/mimo-v2.5-pro')).toBe('openrouter');
        expect(pro?.openrouter_id).toBe('xiaomi/mimo-v2.5-pro');
        expect(pro?.cost).toMatchObject({
            input_per_million: 0.435,
            cached_input_per_million: 0.0036,
            output_per_million: 0.87,
        });
        expect(pro?.features).toMatchObject({
            context_length: 1048576,
            max_output_tokens: 131072,
            input_modality: ['text'],
            output_modality: ['text'],
            tool_use: true,
            streaming: true,
            json_output: true,
            reasoning_output: true,
        });
    });

    it('registers MiniMax M3 with current OpenRouter pricing and multimodal details', async () => {
        const model = findModel('MiniMax M3');

        expect(model?.id).toBe('minimax/minimax-m3');
        expect(await getModelFromAgent({ agent_id: 'minimax-m3', model: 'minimax-m3' } as any)).toBe(
            'minimax/minimax-m3'
        );
        expect(getProviderFromModel('minimax/minimax-m3')).toBe('openrouter');
        expect(model?.openrouter_id).toBe('minimax/minimax-m3');
        expect(model?.cost).toMatchObject({
            input_per_million: 0.3,
            cached_input_per_million: 0.06,
            output_per_million: 1.2,
        });
        expect(model?.features).toMatchObject({
            context_length: 1048576,
            max_output_tokens: 512000,
            input_modality: ['text', 'image', 'video'],
            output_modality: ['text'],
            tool_use: true,
            streaming: true,
            json_output: true,
            reasoning_output: true,
        });
    });

    it('registers Tencent Hy3 Preview with reasoning suffix aliases', async () => {
        const model = findModel('Hy3 Preview');

        expect(model?.id).toBe('tencent/hy3-preview');
        expect(await getModelFromAgent({ agent_id: 'hy3', model: 'hy3-preview' } as any)).toBe('tencent/hy3-preview');
        expect(await getModelFromAgent({ agent_id: 'hy3-low', model: 'hy3-preview-low' } as any)).toBe(
            'tencent/hy3-preview-low'
        );
        expect(await getModelFromAgent({ agent_id: 'hy3-high', model: 'hy3-preview-high' } as any)).toBe(
            'tencent/hy3-preview-high'
        );
        expect(await getModelFromAgent({ agent_id: 'hy3-none', model: 'hy3-preview-none' } as any)).toBe(
            'tencent/hy3-preview-none'
        );
        expect(await getModelFromAgent({ agent_id: 'hy3-disabled', model: 'hy3-preview-disabled' } as any)).toBe(
            'tencent/hy3-preview-disabled'
        );
        expect(getProviderFromModel('tencent/hy3-preview')).toBe('openrouter');
        expect(getProviderFromModel('tencent/hy3-preview-high')).toBe('openrouter');
        expect(model?.cost).toMatchObject({
            input_per_million: 0.063,
            cached_input_per_million: 0.021,
            output_per_million: 0.21,
        });
        expect(model?.features).toMatchObject({
            context_length: 262144,
            input_modality: ['text'],
            output_modality: ['text'],
            tool_use: true,
            streaming: true,
            json_output: false,
            reasoning_output: true,
        });
    });

    it('registers Qwen 3.7 Max as the current OpenRouter Qwen flagship', async () => {
        const model = findModel('qwen3.7-max');

        expect(model?.id).toBe('qwen/qwen3.7-max');
        expect(await getModelFromAgent({ agent_id: 'qwen-37-max', model: 'qwen-3.7-max' } as any)).toBe(
            'qwen/qwen3.7-max'
        );
        expect(getProviderFromModel('qwen/qwen3.7-max')).toBe('openrouter');
        expect(model?.openrouter_id).toBe('qwen/qwen3.7-max');
        expect(model?.cost).toMatchObject({
            input_per_million: 1.25,
            cached_input_per_million: 0.25,
            output_per_million: 3.75,
        });
        expect(model?.features).toMatchObject({
            context_length: 1000000,
            max_output_tokens: 65536,
            input_modality: ['text'],
            output_modality: ['text'],
            tool_use: true,
            streaming: true,
            json_output: true,
            reasoning_output: true,
        });
    });

    it('registers Qwen 3.6 Plus and current smaller Qwen 3.6 variants', async () => {
        const plus = findModel('Qwen 3.6');
        const flash = findModel('qwen3.6-flash');
        const a3b = findModel('qwen3.6-35b-a3b');
        const maxPreview = findModel('qwen3.6-max-preview');
        const dense = findModel('qwen3.6-27b');

        expect(plus?.id).toBe('qwen/qwen3.6-plus');
        expect(await getModelFromAgent({ agent_id: 'qwen-plus', model: 'qwen-3.6-plus' } as any)).toBe(
            'qwen/qwen3.6-plus'
        );
        expect(getProviderFromModel('qwen/qwen3.6-plus')).toBe('openrouter');
        expect(plus?.cost).toMatchObject({
            input_per_million: 0.325,
            output_per_million: 1.95,
        });
        expect(plus?.features).toMatchObject({
            context_length: 1000000,
            max_output_tokens: 65536,
            input_modality: ['text', 'image', 'video'],
            output_modality: ['text'],
            tool_use: true,
            streaming: true,
            json_output: true,
            reasoning_output: true,
        });

        expect(flash?.id).toBe('qwen/qwen3.6-flash');
        expect(await getModelFromAgent({ agent_id: 'qwen-flash', model: 'qwen-3.6-flash' } as any)).toBe(
            'qwen/qwen3.6-flash'
        );
        expect(getProviderFromModel('qwen/qwen3.6-flash')).toBe('openrouter');
        expect(flash?.cost).toMatchObject({
            input_per_million: 0.1875,
            output_per_million: 1.125,
        });
        expect(flash?.features).toMatchObject({
            context_length: 1000000,
            max_output_tokens: 65536,
            input_modality: ['text', 'image', 'video'],
            output_modality: ['text'],
            tool_use: true,
            streaming: true,
            json_output: true,
            reasoning_output: true,
        });

        expect(a3b?.id).toBe('qwen/qwen3.6-35b-a3b');
        expect(a3b?.cost).toMatchObject({
            input_per_million: 0.14,
            output_per_million: 1.0,
        });
        expect(a3b?.features?.max_output_tokens).toBe(262140);

        expect(maxPreview?.id).toBe('qwen/qwen3.6-max-preview');
        expect(await getModelFromAgent({ agent_id: 'qwen-max-preview', model: 'qwen-3.6-max-preview' } as any)).toBe(
            'qwen/qwen3.6-max-preview'
        );
        expect(getProviderFromModel('qwen/qwen3.6-max-preview')).toBe('openrouter');
        expect(maxPreview?.cost).toMatchObject({
            input_per_million: 1.04,
            cached_input_per_million: 1.3,
            output_per_million: 6.24,
        });
        expect(maxPreview?.features).toMatchObject({
            context_length: 262144,
            max_output_tokens: 65536,
            input_modality: ['text'],
            output_modality: ['text'],
            tool_use: true,
            streaming: true,
            json_output: true,
            reasoning_output: true,
        });

        expect(dense?.id).toBe('qwen/qwen3.6-27b');
        expect(dense?.cost).toMatchObject({
            input_per_million: 0.29,
            output_per_million: 3.2,
        });
        expect(dense?.features?.max_output_tokens).toBe(262140);
    });
});
