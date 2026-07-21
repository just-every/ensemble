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
            input_per_million: 0.966,
            cached_input_per_million: 0.1794,
            output_per_million: 3.036,
        });
        expect(model?.features).toMatchObject({
            context_length: 204800,
            input_modality: ['text'],
            output_modality: ['text'],
            tool_use: true,
            streaming: true,
            json_output: true,
            reasoning_output: true,
        });
    });

    it('registers GLM-5.2 as the current OpenRouter GLM alias target', async () => {
        const model = findModel('GLM-5.2');

        expect(model?.id).toBe('z-ai/glm-5.2');
        expect(await getModelFromAgent({ agent_id: 'glm-latest', model: 'glm-5' } as any)).toBe('z-ai/glm-5.2');
        expect(getProviderFromModel('z-ai/glm-5.2')).toBe('openrouter');
        expect(model?.cost).toMatchObject({
            input_per_million: 0.7756,
            cached_input_per_million: 0.14404,
            output_per_million: 2.4376,
        });
        expect(model?.features).toMatchObject({
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

    it('registers Kimi K2.7 Code with OpenRouter routing', async () => {
        const model = findModel('Kimi K2.7 Code');

        expect(model?.id).toBe('moonshotai/kimi-k2.7-code');
        expect(await getModelFromAgent({ agent_id: 'kimi-code', model: 'kimi-k2-7-code' } as any)).toBe(
            'moonshotai/kimi-k2.7-code'
        );
        expect(getProviderFromModel('moonshotai/kimi-k2.7-code')).toBe('openrouter');
        expect(model?.cost).toMatchObject({
            input_per_million: 0.82,
            cached_input_per_million: 0.16,
            output_per_million: 3.75,
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

    it('registers DeepSeek V4 directly while retaining explicit OpenRouter IDs', async () => {
        const pro = findModel('DeepSeek-V4');
        const flash = findModel('DeepSeek-V4-Flash');

        expect(pro?.id).toBe('deepseek-v4-pro');
        expect(await getModelFromAgent({ agent_id: 'deepseek-pro', model: 'deepseek-v4-pro' } as any)).toBe(
            'deepseek-v4-pro'
        );
        expect(getProviderFromModel('deepseek-v4-pro')).toBe('deepseek');
        expect(getProviderFromModel('deepseek/deepseek-v4-pro')).toBe('openrouter');
        expect(pro?.cost).toMatchObject({
            input_per_million: 0.435,
            cached_input_per_million: 0.003625,
            output_per_million: 0.87,
        });
        expect(pro?.features).toMatchObject({
            context_length: 1000000,
            max_output_tokens: 384000,
            input_modality: ['text'],
            output_modality: ['text'],
            tool_use: true,
            streaming: true,
            json_output: true,
            reasoning_output: true,
        });

        expect(flash?.id).toBe('deepseek-v4-flash');
        expect(await getModelFromAgent({ agent_id: 'deepseek-flash', model: 'deepseek-v4-flash' } as any)).toBe(
            'deepseek-v4-flash'
        );
        expect(flash?.cost).toMatchObject({
            input_per_million: 0.14,
            cached_input_per_million: 0.0028,
            output_per_million: 0.28,
        });
        expect(flash?.features?.max_output_tokens).toBe(384000);
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
            context_length: 1050000,
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
            context_length: 1050000,
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

    it('registers Tencent Hy3 with reasoning suffix aliases and legacy preview aliases', async () => {
        const model = findModel('Hy3');

        expect(model?.id).toBe('tencent/hy3');
        expect(findModel('Hy3 Preview')?.id).toBe('tencent/hy3');
        expect(await getModelFromAgent({ agent_id: 'hy3', model: 'hy3-preview' } as any)).toBe('tencent/hy3');
        expect(await getModelFromAgent({ agent_id: 'hy3-low', model: 'hy3-preview-low' } as any)).toBe(
            'tencent/hy3-low'
        );
        expect(await getModelFromAgent({ agent_id: 'hy3-high', model: 'hy3-preview-high' } as any)).toBe(
            'tencent/hy3-high'
        );
        expect(await getModelFromAgent({ agent_id: 'hy3-none', model: 'hy3-preview-none' } as any)).toBe(
            'tencent/hy3-none'
        );
        expect(await getModelFromAgent({ agent_id: 'hy3-disabled', model: 'hy3-preview-disabled' } as any)).toBe(
            'tencent/hy3-disabled'
        );
        expect(getProviderFromModel('tencent/hy3')).toBe('openrouter');
        expect(getProviderFromModel('tencent/hy3-high')).toBe('openrouter');
        expect(model?.cost).toMatchObject({
            input_per_million: 0.14,
            cached_input_per_million: 0.035,
            output_per_million: 0.58,
        });
        expect(model?.features).toMatchObject({
            context_length: 262144,
            max_output_tokens: 262144,
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
            input_per_million: 1.475,
            cached_input_per_million: 0.295,
            output_per_million: 4.425,
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

    it('registers Qwen 3.7 Plus as the current multimodal Qwen 3.7 option', async () => {
        const model = findModel('qwen3.7-plus');

        expect(model?.id).toBe('qwen/qwen3.7-plus');
        expect(await getModelFromAgent({ agent_id: 'qwen-37-plus', model: 'qwen-3.7-plus' } as any)).toBe(
            'qwen/qwen3.7-plus'
        );
        expect(getProviderFromModel('qwen/qwen3.7-plus')).toBe('openrouter');
        expect(model?.openrouter_id).toBe('qwen/qwen3.7-plus');
        expect(model?.cost).toMatchObject({
            input_per_million: 0.32,
            cached_input_per_million: 0.064,
            output_per_million: 1.28,
        });
        expect(model?.features).toMatchObject({
            context_length: 1000000,
            max_output_tokens: 65536,
            input_modality: ['text', 'image'],
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
        expect(a3b?.features?.max_output_tokens).toBe(262144);

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
            input_per_million: 0.45,
            cached_input_per_million: 0.15,
            output_per_million: 2.7,
        });
        expect(dense?.features?.max_output_tokens).toBe(65536);
    });
});
