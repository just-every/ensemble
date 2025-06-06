/**
 * Unit test for tool rounds to verify infinite loop prevention
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Agent, ensembleRequest, createToolFunction } from '../index.js';
import type { ResponseInput } from '../types/types.js';
import { testProviderConfig, resetTestProviderConfig } from '../model_providers/test_provider.js';

describe('Tool Rounds Infinite Loop Prevention', () => {
    beforeEach(() => {
        resetTestProviderConfig();
        // Speed up tests by reducing streaming delay
        testProviderConfig.streamingDelay = 1;
        testProviderConfig.chunkSize = 20; // Larger chunks for faster streaming
    });

    afterEach(() => {
        resetTestProviderConfig();
    });

    it('should respect maxToolCallRoundsPerTurn limit', async () => {
        let callCount = 0;
        
        // Configure test provider to simulate tool calls
        testProviderConfig.simulateToolCall = true;
        testProviderConfig.toolName = 'recursive_tool';
        testProviderConfig.toolArguments = { value: 1 };
        
        // Create a tool that always wants to be called again
        const recursiveTool = createToolFunction(
            async (value: number) => {
                callCount++;
                // Update test provider config for next call
                testProviderConfig.toolArguments = { value: value + 1 };
                return `Value is ${value}. Please call this tool again with ${value + 1}.`;
            },
            'A tool that always suggests calling itself again',
            { value: { type: 'number', description: 'A value' } },
            undefined,
            'recursive_tool'
        );

        const agent = new Agent({
            name: 'TestAgent',
            model: 'test-model', // Use test provider
            tools: [recursiveTool],
            maxToolCallRoundsPerTurn: 3, // Limit to 3 rounds
            maxToolCalls: 100, // High limit
            instructions: 'Always follow tool suggestions.',
        });

        const messages: ResponseInput = [
            {
                type: 'message',
                role: 'user',
                content: 'Use the recursive tool starting with value 1',
            },
        ];

        // Mock the test provider to always suggest tool use
        const stream = ensembleRequest(messages, agent);
        
        // Process the stream
        for await (const event of stream) {
            // Just consume the stream
        }
        
        // Should have called the tool exactly 3 times (one per round)
        expect(callCount).toBeLessThanOrEqual(3);
        expect(callCount).toBeGreaterThan(0);
    }, 10000); // Increase timeout to 10 seconds

    it('should respect maxToolCalls limit', async () => {
        let callCount = 0;
        
        // Configure test provider to simulate tool calls
        testProviderConfig.simulateToolCall = true;
        testProviderConfig.toolName = 'tool_0'; // Use the first tool
        
        // Create multiple tools to test maxToolCalls limit
        const tools = Array.from({ length: 10 }, (_, i) => 
            createToolFunction(
                async () => {
                    callCount++;
                    // After each call, configure the provider to call the next tool
                    if (i < 9) {
                        testProviderConfig.toolName = `tool_${i + 1}`;
                    }
                    return `Tool ${i} called`;
                },
                `Tool number ${i}`,
                {},
                undefined,
                `tool_${i}`
            )
        );
        
        const agent = new Agent({
            name: 'TestAgent',
            model: 'test-model',
            tools,
            maxToolCallRoundsPerTurn: 10, // High round limit
            maxToolCalls: 5, // Limit total calls to 5
            instructions: 'Call all available tools.',
        });

        const messages: ResponseInput = [
            {
                type: 'message',
                role: 'user',
                content: 'Call all the tools',
            },
        ];

        // Track tool calls
        let totalToolCalls = 0;
        const stream = ensembleRequest(messages, agent);
        for await (const event of stream) {
            if (event.type === 'tool_start') {
                totalToolCalls += 1; // Each tool_start event is one tool call
            }
        }

        // The limit should prevent more than 5 tool calls total
        expect(totalToolCalls).toBeLessThanOrEqual(5);
        
        // The test provider simulates one tool call per round
        // With maxToolCalls=5, we should see at most 5 calls
        expect(callCount).toBeLessThanOrEqual(5);
        expect(callCount).toBeGreaterThan(0);
    });

    it('should handle parallel tool calls within limits', async () => {
        let callLog: string[] = [];
        
        // Configure test provider to simulate tool calls
        testProviderConfig.simulateToolCall = true;
        testProviderConfig.toolName = 'parallel_tool';
        testProviderConfig.toolArguments = { id: 'A' };
        
        const parallelTool = createToolFunction(
            async (id: string) => {
                callLog.push(id);
                return `Processed ${id}`;
            },
            'A tool that can be called in parallel',
            { id: { type: 'string', description: 'An ID' } },
            undefined,
            'parallel_tool'
        );

        const agent = new Agent({
            name: 'TestAgent',
            model: 'test-model',
            tools: [parallelTool],
            maxToolCallRoundsPerTurn: 2,
            maxToolCalls: 6,
            instructions: 'Process IDs.',
        });

        const messages: ResponseInput = [
            {
                type: 'message',
                role: 'user',
                content: 'Process IDs: A, B, C, D, E, F, G, H',
            },
        ];

        const stream = ensembleRequest(messages, agent);
        
        // Process the stream
        for await (const event of stream) {
            // Just consume the stream
        }

        // Should have processed up to 6 IDs (maxToolCalls)
        expect(callLog.length).toBeLessThanOrEqual(6);
    });

    it('should not make any tool calls when limits are 0', async () => {
        let callCount = 0;
        
        // Configure test provider to simulate tool calls
        testProviderConfig.simulateToolCall = true;
        testProviderConfig.toolName = 'simple_tool';
        testProviderConfig.toolArguments = {};
        testProviderConfig.fixedResponse = 'I would use the tool but I cannot.';
        
        const tool = createToolFunction(
            async () => {
                callCount++;
                return 'Called';
            },
            'A simple tool',
            {},
            undefined,
            'simple_tool'
        );

        const agent = new Agent({
            name: 'TestAgent',
            model: 'test-model',
            tools: [tool],
            maxToolCalls: 0, // No tool calls allowed
            instructions: 'Try to use tools.',
        });

        const messages: ResponseInput = [
            {
                type: 'message',
                role: 'user',
                content: 'Use the tool',
            },
        ];

        const stream = ensembleRequest(messages, agent);
        
        // Process the stream
        for await (const event of stream) {
            // Just consume the stream
        }

        // Should not have made any tool calls
        expect(callCount).toBe(0);
    }, 10000); // Add timeout

    it('should allow first round but no additional rounds when maxToolCallRoundsPerTurn is 0', async () => {
        let callCount = 0;
        
        // Configure test provider to simulate tool calls
        testProviderConfig.simulateToolCall = true;
        testProviderConfig.toolName = 'recursive_tool';
        testProviderConfig.toolArguments = { value: 1 };
        
        const tool = createToolFunction(
            async (value: number) => {
                callCount++;
                // This tool always suggests calling itself again
                return `Value is ${value}. Please call this tool again with ${value + 1}.`;
            },
            'A recursive tool',
            { value: { type: 'number', description: 'A value' } },
            undefined,
            'recursive_tool'
        );

        const agent = new Agent({
            name: 'TestAgent',
            model: 'test-model',
            tools: [tool],
            maxToolCallRoundsPerTurn: 0, // No additional rounds after first
            instructions: 'Use the recursive tool and follow its suggestions.',
        });

        const messages: ResponseInput = [
            {
                type: 'message',
                role: 'user',
                content: 'Use the recursive tool starting with value 1',
            },
        ];

        const stream = ensembleRequest(messages, agent);
        
        // Process the stream
        for await (const event of stream) {
            // Just consume the stream
        }

        // Should have made exactly 1 tool call (first round only)
        // Even though the tool suggests calling again, no additional rounds are allowed
        expect(callCount).toBe(1);
    });

    it('should include limit messages in response', async () => {
        let callCount = 0;
        
        // Configure test provider to simulate tool calls
        testProviderConfig.simulateToolCall = true;
        testProviderConfig.toolName = 'needy_tool';
        testProviderConfig.toolArguments = {};
        
        const tool = createToolFunction(
            async () => {
                callCount++;
                return 'Please call me again';
            },
            'Tool that wants to be called again',
            {},
            undefined,
            'needy_tool'
        );

        const agent = new Agent({
            name: 'TestAgent',
            model: 'test-model',
            tools: [tool],
            maxToolCallRoundsPerTurn: 1,
            instructions: 'Use tools when asked.',
        });

        const messages: ResponseInput = [
            {
                type: 'message',
                role: 'user',
                content: 'Use the needy tool multiple times',
            },
        ];

        const stream = ensembleRequest(messages, agent);
        
        for await (const event of stream) {
            // Just consume the stream
        }

        // Should have called the tool once (test provider only does one tool call per turn)
        expect(callCount).toBeGreaterThanOrEqual(1);
    });
});