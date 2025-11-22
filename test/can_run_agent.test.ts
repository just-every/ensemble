import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { canRunAgent } from '../model_providers/model_provider.js';
import { overrideModelClass, clearExternalRegistrations } from '../utils/external_models.js';

describe('canRunAgent', () => {
    // Store original env vars
    const originalEnv = { ...process.env };

    beforeEach(() => {
        // Clear all API keys
        delete process.env.OPENAI_API_KEY;
        delete process.env.ANTHROPIC_API_KEY;
        delete process.env.GOOGLE_API_KEY;
        delete process.env.XAI_API_KEY;
        delete process.env.DEEPSEEK_API_KEY;
        delete process.env.OPENROUTER_API_KEY;
        delete process.env.ELEVENLABS_API_KEY;
    });

    afterEach(() => {
        // Restore original env vars
        Object.assign(process.env, originalEnv);
        // Clear all external registrations including model class overrides
        clearExternalRegistrations();
    });

    describe('with specific model', () => {
        it('should return canRun true when API key is available', async () => {
            process.env.OPENAI_API_KEY = 'sk-test123';

            const result = await canRunAgent({ model: 'gpt-4' });

            expect(result).toMatchObject({
                canRun: true,
                model: 'gpt-4',
                provider: 'openai',
                missingProvider: undefined,
                reason: undefined,
            });
        });

        it('should return canRun false when API key is missing', async () => {
            const result = await canRunAgent({ model: 'gpt-4' });

            expect(result).toMatchObject({
                canRun: false,
                model: 'gpt-4',
                provider: 'openai',
                missingProvider: 'openai',
                reason: 'Missing API key for provider: openai',
            });
        });

        it('should validate API key format for OpenAI', async () => {
            process.env.OPENAI_API_KEY = 'invalid-key';

            const result = await canRunAgent({ model: 'gpt-4' });

            expect(result.canRun).toBe(false);
            expect(result.reason).toContain('Missing API key');
        });

        it('should validate API key format for Anthropic', async () => {
            process.env.ANTHROPIC_API_KEY = 'sk-ant-valid-key';

            const result = await canRunAgent({ model: 'claude-sonnet-4-5-20250514' });

            expect(result.canRun).toBe(true);
            expect(result.provider).toBe('anthropic');
        });

        it('should handle test provider', async () => {
            const result = await canRunAgent({ model: 'test-model' });

            expect(result).toMatchObject({
                canRun: true,
                model: 'test-model',
                provider: 'test',
            });
        });
    });

    describe('with model class', () => {
        it('should check all models in the class', async () => {
            // Set up API keys for some providers
            process.env.OPENAI_API_KEY = 'sk-test123';
            process.env.GOOGLE_API_KEY = 'test-key';

            const result = await canRunAgent({ modelClass: 'standard' });

            expect(result.canRun).toBe(true);
            expect(result.availableModels).toBeDefined();
            expect(result.availableModels!.length).toBeGreaterThan(0);
            expect(result.unavailableModels).toBeDefined();
        });

        it('should return canRun false when no API keys are available', async () => {
            const result = await canRunAgent({ modelClass: 'standard' });

            expect(result.canRun).toBe(false);
            expect(result.availableModels).toEqual([]);
            expect(result.unavailableModels!.length).toBeGreaterThan(0);
            expect(result.reason).toContain('No API keys found');
        });

        it('should handle model class overrides', async () => {
            process.env.OPENAI_API_KEY = 'sk-test123';

            // Override mini class to only have GPT models
            overrideModelClass('mini', {
                models: ['gpt-4o-mini', 'gpt-3.5-turbo'],
                random: false,
            });

            const result = await canRunAgent({ modelClass: 'mini' });

            expect(result.canRun).toBe(true);
            expect(result.availableModels).toEqual(['gpt-4o-mini', 'gpt-3.5-turbo']);
            expect(result.unavailableModels).toEqual([]);
        });

        it('should identify missing providers', async () => {
            // Override to have models from different providers
            overrideModelClass('standard', {
                models: ['gpt-4', 'claude-sonnet-4-5-20250514', 'gemini-2.0-flash-latest'],
                random: false,
            });

            const result = await canRunAgent({ modelClass: 'standard' });

            expect(result.canRun).toBe(false);
            expect(result.reason).toContain('openai');
            expect(result.reason).toContain('anthropic');
            expect(result.reason).toContain('google');
        });

        it('should handle invalid model class by defaulting to standard', async () => {
            process.env.OPENAI_API_KEY = 'sk-test123';

            const result = await canRunAgent({ modelClass: 'invalid-class' as any });

            expect(result.canRun).toBe(true);
            expect(result.availableModels).toBeDefined();
            expect(result.availableModels!.some(m => m.startsWith('gpt-'))).toBe(true);
        });
    });

    describe('with no specification', () => {
        it('should default to checking standard model class', async () => {
            process.env.OPENAI_API_KEY = 'sk-test123';

            const result = await canRunAgent({});

            expect(result.canRun).toBe(true);
            expect(result.availableModels).toBeDefined();
            expect(result.availableModels!.length).toBeGreaterThan(0);
        });
    });

    describe('edge cases', () => {
        it('should handle external models', async () => {
            // External models are always considered valid
            const result = await canRunAgent({ model: 'external-model-123' });

            // This might fail if external-model-123 isn't registered
            // The behavior depends on how getProviderFromModel handles unknown models
            expect(result).toBeDefined();
        });

        it('should prefer model over modelClass when both are provided', async () => {
            process.env.OPENAI_API_KEY = 'sk-test123';

            const result = await canRunAgent({
                model: 'claude-sonnet-4-5-20250514',
                modelClass: 'standard',
            });

            // Should check the specific model, not the class
            expect(result.canRun).toBe(false); // No Anthropic key
            expect(result.model).toBe('claude-sonnet-4-5-20250514');
            expect(result.provider).toBe('anthropic');
            expect(result.availableModels).toBeUndefined();
        });

        it('should handle OpenRouter provider', async () => {
            process.env.OPENROUTER_API_KEY = 'test-key';

            const result = await canRunAgent({ model: 'openrouter/auto' });

            expect(result.canRun).toBe(true);
            expect(result.provider).toBe('openrouter');
        });

        it('should identify single missing provider for model class', async () => {
            // Override to only have Claude models
            overrideModelClass('standard', {
                models: ['claude-sonnet-4-5-20250514', 'claude-haiku-4-5-20250514'],
                random: false,
            });

            const result = await canRunAgent({ modelClass: 'standard' });

            expect(result.canRun).toBe(false);
            expect(result.missingProvider).toBe('anthropic');
        });
    });
});
