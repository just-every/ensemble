import { describe, it, expect, vi } from 'vitest';
import { getModelFromAgent, getModelFromClass } from '../model_providers/model_provider.js';
import { AgentDefinition } from '../types/types.js';

// Mock the quota tracker
vi.mock('../utils/quota_tracker.js', () => ({
    quotaTracker: {
        hasQuota: () => true,
    },
}));

// Mock environment variables for testing
process.env.OPENAI_API_KEY = 'sk-test';
process.env.GOOGLE_API_KEY = 'test-key';
process.env.ANTHROPIC_API_KEY = 'sk-ant-test';

describe('Model Scoring and Disabling', () => {
    it('should respect disabled models', async () => {
        const agent: AgentDefinition = {
            modelClass: 'standard',
            disabledModels: ['gpt-4.1', 'claude-haiku-4-5-20250514'],
        };

        // Run multiple times to ensure disabled models are never selected
        for (let i = 0; i < 10; i++) {
            const model = await getModelFromAgent(agent);
            expect(model).not.toBe('gpt-4.1');
            expect(model).not.toBe('claude-haiku-4-5-20250514');
        }
    });

    it('should apply weighted selection based on model scores', async () => {
        const agent: AgentDefinition = {
            modelClass: 'standard',
            modelScores: {
                'gpt-4.1': 90, // Should be selected most often
                'gemini-2.5-flash-preview-05-20-low': 10, // Should be selected rarely
            },
        };

        // Track selection counts
        const selectionCounts: Record<string, number> = {};
        const iterations = 100;

        for (let i = 0; i < iterations; i++) {
            const model = await getModelFromAgent(agent);
            selectionCounts[model] = (selectionCounts[model] || 0) + 1;
        }

        // With 90:10 weighting, gpt-4.1 should be selected significantly more often
        // We'll allow some variance but expect at least 70% for the high-weight model
        const gptCount = selectionCounts['gpt-4.1'] || 0;
        const geminiCount = selectionCounts['gemini-2.5-flash-preview-05-20-low'] || 0;

        // Only check if both models were available
        if (gptCount > 0 && geminiCount > 0) {
            expect(gptCount).toBeGreaterThan(geminiCount * 3); // At least 3x more
        }
    });

    it('should combine disabled models and scores', async () => {
        const agent: AgentDefinition = {
            modelClass: 'standard',
            disabledModels: ['deepseek-chat', 'grok-3-mini-fast'],
            modelScores: {
                'gpt-4.1': 80,
                'gemini-2.5-flash-preview-05-20-low': 20,
                'claude-haiku-4-5-20250514': 50,
            },
        };

        // Run multiple times
        for (let i = 0; i < 20; i++) {
            const model = await getModelFromAgent(agent);
            // Should never select disabled models
            expect(model).not.toBe('deepseek-chat');
            expect(model).not.toBe('grok-3-mini-fast');
            // Should only select from scored models that aren't disabled
            expect([
                'gpt-5-mini',
                'gemini-2.5-flash-preview-05-20',
                'gemini-2.5-flash',
                'gemini-3-pro-preview',
                'gemini-3-pro',
                'claude-haiku-4-5-20250514',
                'claude-sonnet-4-5-20250514',
            ]).toContain(model);
        }
    });

    it('should handle all models being disabled gracefully', async () => {
        const agent: AgentDefinition = {
            modelClass: 'mini',
            disabledModels: [
                'gpt-4.1-nano',
                'claude-haiku-4-5-20250514',
                'gemini-2.0-flash-lite',
                'grok-3-mini',
                'meta-llama/llama-4-scout',
                'mistral/ministral-8b',
            ],
        };

        // Should still return a model (fallback behavior)
        const model = await getModelFromAgent(agent);
        expect(model).toBeTruthy();
    });

    it('should work with getModelFromClass directly', async () => {
        const modelScores = {
            'gpt-4.1': 100,
            'gemini-2.5-flash-preview-05-20-low': 0, // Zero weight, should never be selected
        };

        // Run multiple times
        let zeroWeightSelected = false;
        for (let i = 0; i < 20; i++) {
            const model = await getModelFromClass('standard', [], ['deepseek-chat'], modelScores);
            expect(model).not.toBe('deepseek-chat'); // Should never select disabled

            // With a score of 0, gemini should never be selected when gpt-4.1 is available
            if (model === 'gemini-2.5-flash-preview-05-20-low') {
                zeroWeightSelected = true;
            }
        }

        // Zero-weight model should not be selected when other models have positive weights
        expect(zeroWeightSelected).toBe(false);
    });

    it('should use default score of 50 for unscored models', async () => {
        const agent: AgentDefinition = {
            modelClass: 'standard',
            modelScores: {
                'gpt-4.1': 100, // Explicit high score
                // Other models will get default score of 50
            },
        };

        const selectedModels = new Set<string>();
        for (let i = 0; i < 20; i++) {
            const model = await getModelFromAgent(agent);
            selectedModels.add(model);
        }

        // Should select multiple models, not just the scored one
        expect(selectedModels.size).toBeGreaterThan(1);
    });
});
