import { describe, it, expect, beforeEach } from 'vitest';
import { getModelProvider } from '../model_providers/model_provider.js';
import { openaiProvider } from '../model_providers/openai.js';
import { claudeProvider } from '../model_providers/claude.js';
import { geminiProvider } from '../model_providers/gemini.js';
import { grokProvider } from '../model_providers/grok.js';
import { deepSeekProvider } from '../model_providers/deepseek.js';
import { openRouterProvider } from '../model_providers/openrouter.js';

beforeEach(() => {
  process.env.OPENAI_API_KEY = 'sk-test';
  process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
  process.env.GOOGLE_API_KEY = 'test';
  process.env.XAI_API_KEY = 'xai-test';
  process.env.DEEPSEEK_API_KEY = 'sk-test';
  process.env.OPENROUTER_API_KEY = 'test';
});

describe('getModelProvider', () => {
  it('returns OpenAI provider', () => {
    expect(getModelProvider('gpt-3.5-turbo')).toBe(openaiProvider);
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
});
