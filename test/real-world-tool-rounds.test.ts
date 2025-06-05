/**
 * Real-world test for tool call rounds to ensure no infinite loops
 * This test uses actual API keys and makes real API calls
 */

import { describe, it, expect } from 'vitest';
import { config } from 'dotenv';
import { Agent, ensembleRequest, convertStreamToMessages, createToolFunction } from '../index.js';
import type { ResponseInput } from '../types/types.js';

// Load environment variables
config();

// Skip these tests in CI or if no API keys are present
const hasApiKeys = !!(
    process.env.OPENAI_API_KEY || 
    process.env.ANTHROPIC_API_KEY || 
    process.env.GOOGLE_API_KEY
);

describe.skipIf(!hasApiKeys || process.env.CI)('Real-world Tool Rounds Tests', () => {
    // Create a simple counter tool that always wants to call itself
    let callCount = 0;
    const recursiveTool = createToolFunction(
        async (currentCount: number) => {
            callCount++;
            console.log(`Tool called ${callCount} times with count: ${currentCount}`);
            // Always suggest calling again
            return `Current count is ${currentCount}. I think we should increment and call again.`;
        },
        'A tool that increments a counter and suggests calling itself again',
        {
            currentCount: {
                type: 'number',
                description: 'The current count value',
            },
        },
        undefined,
        'increment_counter'
    );

    // Test with different models and configurations
    const testConfigs = [
        { model: 'gpt-4.1-mini', provider: 'OpenAI' },
        { model: 'claude-3-5-haiku-latest', provider: 'Anthropic' },
        { model: 'gemini-2.0-flash-lite', provider: 'Google' },
    ];

    for (const config of testConfigs) {
        const hasKey = 
            (config.provider === 'OpenAI' && process.env.OPENAI_API_KEY) ||
            (config.provider === 'Anthropic' && process.env.ANTHROPIC_API_KEY) ||
            (config.provider === 'Google' && process.env.GOOGLE_API_KEY);

        it.skipIf(!hasKey)(`should respect maxToolCallRoundsPerTurn with ${config.provider} (${config.model})`, async () => {
            callCount = 0;

            const agent = new Agent({
                name: 'TestAgent',
                model: config.model,
                tools: [recursiveTool],
                maxToolCallRoundsPerTurn: 3, // Limit to 3 rounds
                maxToolCalls: 10, // High limit to test rounds specifically
                instructions: 'You have a counter tool. When asked to count, use it to increment the counter. Always try to use the tool when it suggests calling again.',
            });

            const messages: ResponseInput = [
                {
                    type: 'message',
                    role: 'user',
                    content: 'Please start counting from 0 and increment as many times as the tool suggests.',
                },
            ];

            console.log(`\nTesting ${config.provider} with model ${config.model}...`);
            
            const stream = ensembleRequest(messages, agent);
            const result = await convertStreamToMessages(stream, messages, agent);

            console.log(`Tool was called ${callCount} times`);
            console.log(`Response: ${result.fullResponse.substring(0, 200)}...`);

            // Should have called the tool multiple times but not more than maxToolCallRoundsPerTurn
            expect(callCount).toBeGreaterThan(0);
            expect(callCount).toBeLessThanOrEqual(3);

            // Response should mention hitting the limit
            expect(result.fullResponse.toLowerCase()).toMatch(/limit|reached|maximum|stop/);
        }, 30000); // 30 second timeout

        it.skipIf(!hasKey)(`should respect maxToolCalls limit with ${config.provider} (${config.model})`, async () => {
            callCount = 0;

            const agent = new Agent({
                name: 'TestAgent',
                model: config.model,
                tools: [recursiveTool],
                maxToolCallRoundsPerTurn: undefined, // No round limit
                maxToolCalls: 2, // Limit total calls to 2
                instructions: 'You have a counter tool. Use it multiple times in parallel if possible.',
            });

            const messages: ResponseInput = [
                {
                    type: 'message',
                    role: 'user',
                    content: 'Call the increment counter tool 5 times in parallel with values 1, 2, 3, 4, and 5.',
                },
            ];

            console.log(`\nTesting maxToolCalls with ${config.provider}...`);

            const stream = ensembleRequest(messages, agent);
            const result = await convertStreamToMessages(stream, messages, agent);

            console.log(`Tool was called ${callCount} times (limit was 2)`);

            // Should respect the maxToolCalls limit
            expect(callCount).toBe(2);
        }, 30000);
    }

    it('should handle tools that return errors gracefully', async () => {
        const errorTool = createToolFunction(
            async () => {
                throw new Error('This tool always fails');
            },
            'A tool that always throws an error',
            {},
            undefined,
            'error_tool'
        );

        const agent = new Agent({
            name: 'ErrorTestAgent',
            model: 'gpt-4.1-mini',
            tools: [errorTool],
            maxToolCallRoundsPerTurn: 2,
            instructions: 'You have an error tool. Try to use it.',
        });

        const messages: ResponseInput = [
            {
                type: 'message',
                role: 'user',
                content: 'Please use the error tool.',
            },
        ];

        const stream = ensembleRequest(messages, agent);
        const result = await convertStreamToMessages(stream, messages, agent);

        // Should handle the error gracefully
        expect(result.fullResponse).toContain('error');
        
        // Should not crash or loop infinitely
        expect(result.messages.length).toBeGreaterThan(0);
    }, 30000);

    it('should handle sequential tool execution correctly', async () => {
        let sequence: string[] = [];

        const sequentialTools = [
            createToolFunction(
                async () => {
                    sequence.push('first');
                    return 'First tool executed';
                },
                'First tool in sequence',
                {},
                undefined,
                'first_tool'
            ),
            createToolFunction(
                async () => {
                    sequence.push('second');
                    return 'Second tool executed';
                },
                'Second tool in sequence',
                {},
                undefined,
                'second_tool'
            ),
        ];

        const agent = new Agent({
            name: 'SequentialAgent',
            model: 'gpt-4.1-mini',
            tools: sequentialTools,
            modelSettings: {
                sequential_tools: true, // Force sequential execution
            },
            instructions: 'You have two tools. When asked to run both, call first_tool then second_tool.',
        });

        const messages: ResponseInput = [
            {
                type: 'message',
                role: 'user',
                content: 'Please run both tools in order.',
            },
        ];

        sequence = [];
        const stream = ensembleRequest(messages, agent);
        await convertStreamToMessages(stream, messages, agent);

        console.log('Sequential execution order:', sequence);

        // Should execute in order
        expect(sequence).toEqual(['first', 'second']);
    }, 30000);
});

// Run a simple smoke test to ensure basic functionality works
describe('Basic Smoke Test', () => {
    it('should complete a simple request without tools', async () => {
        const agent = new Agent({
            name: 'SimpleAgent',
            model: 'gpt-4.1-mini',
            instructions: 'You are a helpful assistant.',
        });

        const messages: ResponseInput = [
            {
                type: 'message',
                role: 'user',
                content: 'Say hello',
            },
        ];

        const stream = ensembleRequest(messages, agent);
        const result = await convertStreamToMessages(stream, messages, agent);

        expect(result.fullResponse.toLowerCase()).toContain('hello');
    }, 15000);
});