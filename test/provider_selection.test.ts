import { describe, it, expect, beforeEach } from 'vitest';
import { getModelProvider } from '../model_providers/model_provider.js';
import { openaiProvider } from '../model_providers/openai.js';
import { claudeProvider } from '../model_providers/claude.js';
import { geminiProvider } from '../model_providers/gemini.js';
import { grokProvider } from '../model_providers/grok.js';
import { deepSeekProvider } from '../model_providers/deepseek.js';
import { openRouterProvider } from '../model_providers/openrouter.js';
import { codexProvider } from '../model_providers/codex.js';
import { OpenAICompatibleProvider, registerOpenAICompatibleModel } from '../model_providers/openai_compatible.js';
import { clearExternalRegistrations, getExternalModel } from '../utils/external_models.js';

beforeEach(() => {
    clearExternalRegistrations();
    process.env.OPENAI_API_KEY =
        process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY.startsWith('sk-')
            ? process.env.OPENAI_API_KEY
            : 'sk-test';
    process.env.ANTHROPIC_API_KEY =
        process.env.ANTHROPIC_API_KEY && process.env.ANTHROPIC_API_KEY.startsWith('sk-ant-')
            ? process.env.ANTHROPIC_API_KEY
            : 'sk-ant-test';
    process.env.GOOGLE_API_KEY = process.env.GOOGLE_API_KEY || 'test';
    process.env.XAI_API_KEY =
        process.env.XAI_API_KEY && process.env.XAI_API_KEY.startsWith('xai-') ? process.env.XAI_API_KEY : 'xai-test';
    process.env.DEEPSEEK_API_KEY =
        process.env.DEEPSEEK_API_KEY && process.env.DEEPSEEK_API_KEY.startsWith('sk-')
            ? process.env.DEEPSEEK_API_KEY
            : 'sk-test';
    process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || 'test';
});

describe('getModelProvider', () => {
    it('returns OpenAI provider', () => {
        expect(getModelProvider('gpt-3.5-turbo')).toBe(openaiProvider);
    });

    it('returns Codex CLI provider for codex-prefixed models', () => {
        expect(getModelProvider('codex-gpt-5.5')).toBe(codexProvider);
        expect(getModelProvider('codex-gpt-5.3-codex')).toBe(codexProvider);
    });

    it('returns OpenAI provider for chatgpt image models', () => {
        expect(getModelProvider('chatgpt-image-latest')).toBe(openaiProvider);
    });

    it('returns OpenAI provider for GPT image models', () => {
        expect(getModelProvider('gpt-image-2')).toBe(openaiProvider);
    });

    it('returns Claude provider', () => {
        expect(getModelProvider('claude-3')).toBe(claudeProvider);
    });

    it('returns Gemini provider', () => {
        expect(getModelProvider('gemini-pro')).toBe(geminiProvider);
    });

    it('returns Grok provider', () => {
        expect(getModelProvider('grok-1')).toBe(grokProvider);
    });

    it('returns DeepSeek provider', () => {
        expect(getModelProvider('deepseek-chat')).toBe(deepSeekProvider);
    });

    it('falls back to OpenRouter provider', () => {
        expect(getModelProvider('unknown-model')).toBe(openRouterProvider);
    });

    it('routes registered OpenAI-compatible models to their custom endpoint provider', () => {
        const provider = registerOpenAICompatibleModel({
            id: 'google/gemma-4-12b',
            endpoint: 'http://127.0.0.1:1234',
            aliases: ['local-gemma'],
        });

        expect(provider).toBeInstanceOf(OpenAICompatibleProvider);
        expect(provider.endpoint).toBe('http://127.0.0.1:1234/v1');
        expect(getModelProvider('google/gemma-4-12b')).toBe(provider);
        expect(getModelProvider('local-gemma')).toBe(provider);
        expect(getExternalModel('local-gemma')?.id).toBe('google/gemma-4-12b');
    });
});
