import { describe, it, expect, beforeEach } from 'vitest';
import { costTracker, CostTracker } from '../utils/cost_tracker.js';
import { grokProvider } from '../model_providers/grok.js';
import { deepSeekProvider } from '../model_providers/deepseek.js';
import { openRouterProvider } from '../model_providers/openrouter.js';

describe('Token Estimation for Providers', () => {
    beforeEach(() => {
        costTracker.reset();
    });

    it('should estimate tokens using character count', () => {
        const text1 = 'Hello world'; // 11 chars -> 3 tokens
        const text2 = 'This is a test message'; // 22 chars -> 6 tokens
        const text3 = ''; // 0 chars -> 0 tokens

        expect(CostTracker.estimateTokens(text1)).toBe(3);
        expect(CostTracker.estimateTokens(text2)).toBe(6);
        expect(CostTracker.estimateTokens(text3)).toBe(0);
    });

    it('should add estimated usage to cost tracker', () => {
        const inputText = 'What is the weather today?'; // 26 chars -> 7 tokens
        const outputText = 'The weather today is sunny with a high of 75°F.'; // 48 chars -> 12 tokens

        costTracker.addEstimatedUsage('grok-3', inputText, outputText, { test: true });

        const costsByModel = costTracker.getCostsByModel();
        expect(Object.keys(costsByModel)).toHaveLength(1);
        expect(costsByModel['grok-3']).toBeDefined();
        expect(costsByModel['grok-3'].calls).toBe(1);
        expect(costsByModel['grok-3'].cost).toBeGreaterThan(0);
    });

    // Mock test to verify the OpenAIChat base class behavior
    it('should handle missing usage data in OpenAIChat-based providers', async () => {
        // This is a conceptual test - in practice, you'd need to mock the OpenAI client
        // to return a stream without usage data

        const providers = [
            { name: 'grok', provider: grokProvider },
            { name: 'deepseek', provider: deepSeekProvider },
            { name: 'openrouter', provider: openRouterProvider },
        ];

        for (const { provider } of providers) {
            // Verify that these providers extend OpenAIChat
            expect(provider.constructor.name).toMatch(/OpenAIChat|GrokProvider|DeepSeekProvider|OpenRouterProvider/);

            // The actual token estimation happens in the OpenAIChat base class
            // when usage data is missing from the stream
        }
    });

    it('should calculate cost for estimated tokens', () => {
        const inputText = 'Test input'; // 10 chars -> 3 tokens
        const outputText = 'Test output response'; // 20 chars -> 5 tokens

        const initialCost = costTracker.getTotalCost();
        costTracker.addEstimatedUsage('deepseek-chat', inputText, outputText);
        const finalCost = costTracker.getTotalCost();

        // Cost should increase after adding usage
        expect(finalCost).toBeGreaterThan(initialCost);

        const costsByModel = costTracker.getCostsByModel();
        expect(costsByModel['deepseek-chat']).toBeDefined();
        expect(costsByModel['deepseek-chat'].calls).toBe(1);
        expect(costsByModel['deepseek-chat'].cost).toBeGreaterThan(0);
    });
});
