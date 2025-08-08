/**
 * Test for GPT-5 models handling multiple function calls with reasoning
 * This test verifies that function call outputs are properly deferred
 * until after all related function calls in a reasoning block
 */

import { describe, it, expect } from 'vitest';
import { ensembleRequest } from '../dist/core/ensemble_request.js';
import { AgentDefinition, ToolFunction } from '../dist/types/types.js';

describe('GPT-5 Multiple Function Calls', () => {
    it('should handle multiple function calls in a reasoning block', { skip: !process.env.OPENAI_API_KEY }, async () => {

        // Define two simple test functions
        const tools: ToolFunction[] = [
            {
                definition: {
                    function: {
                        name: 'get_weather',
                        description: 'Get the current weather in a location',
                        parameters: {
                            type: 'object',
                            properties: {
                                location: {
                                    type: 'string',
                                    description: 'The city and state, e.g. San Francisco, CA',
                                },
                            },
                            required: ['location'],
                        },
                    },
                },
                handler: async (args: any) => {
                    return {
                        temperature: 72,
                        condition: 'sunny',
                        location: args.location,
                    };
                },
            },
            {
                definition: {
                    function: {
                        name: 'get_time',
                        description: 'Get the current time in a timezone',
                        parameters: {
                            type: 'object',
                            properties: {
                                timezone: {
                                    type: 'string',
                                    description: 'The timezone, e.g. America/New_York',
                                },
                            },
                            required: ['timezone'],
                        },
                    },
                },
                handler: async (args: any) => {
                    const date = new Date();
                    return {
                        time: date.toLocaleTimeString('en-US', {
                            timeZone: args.timezone,
                            hour12: true,
                        }),
                        timezone: args.timezone,
                    };
                },
            },
        ];

        const agent: AgentDefinition = {
            agent_id: 'test-gpt5-functions',
            tools,
            modelSettings: {
                temperature: 0.7,
            },
        };

        const messages = [
            {
                type: 'message' as const,
                role: 'user' as const,
                content:
                    'Please get the weather in San Francisco, CA and the current time in America/New_York timezone. Then tell me if it would be a good time for a video call between the two locations.',
            },
        ];

        let hasReceivedToolCalls = false;
        let toolCallCount = 0;
        let hasReceivedFinalMessage = false;
        let reasoningContent = '';
        const errors: string[] = [];

        try {
            // Use gpt-5-nano for testing (cheapest GPT-5 model)
            const response = await ensembleRequest(messages, 'gpt-5-nano', agent, undefined, event => {
                // Track events
                if (event.type === 'tool_start') {
                    hasReceivedToolCalls = true;
                    toolCallCount++;
                    console.log(`Tool call ${toolCallCount}: ${event.tool_call.function.name}`);
                } else if (event.type === 'message_delta' && event.thinking_content) {
                    reasoningContent += event.thinking_content;
                } else if (event.type === 'message_complete' && event.content && event.content.length > 10) {
                    hasReceivedFinalMessage = true;
                    console.log('Final message received:', event.content.substring(0, 100) + '...');
                } else if (event.type === 'error') {
                    errors.push(event.error);
                    console.error('Error during request:', event.error);
                }
            });

            // Verify the response
            expect(errors).toHaveLength(0);
            expect(hasReceivedToolCalls).toBe(true);
            expect(toolCallCount).toBe(2); // Should have called both functions
            expect(hasReceivedFinalMessage).toBe(true);
            expect(response.content).toBeTruthy();
            expect(response.content.length).toBeGreaterThan(20);

            // Log reasoning if present
            if (reasoningContent) {
                console.log('Model reasoning:', reasoningContent.substring(0, 200) + '...');
            }

            console.log('Test passed! GPT-5 successfully handled multiple function calls.');
        } catch (error) {
            // Check if it's the specific error we're trying to fix
            if (error instanceof Error && error.message.includes("required 'reasoning' item")) {
                throw new Error('GPT-5 reasoning/function call ordering error still present: ' + error.message);
            }
            throw error;
        }
    });

    it('should handle function calls with complex message history', { skip: !process.env.OPENAI_API_KEY }, async () => {

        // Simple calculator function for testing
        const tools: ToolFunction[] = [
            {
                definition: {
                    function: {
                        name: 'calculate',
                        description: 'Perform a mathematical calculation',
                        parameters: {
                            type: 'object',
                            properties: {
                                expression: {
                                    type: 'string',
                                    description: 'The mathematical expression to evaluate',
                                },
                            },
                            required: ['expression'],
                        },
                    },
                },
                handler: async (args: any) => {
                    // Simple eval for test purposes (don't use in production!)
                    try {
                        const result = Function(`"use strict"; return (${args.expression})`)();
                        return { result, expression: args.expression };
                    } catch {
                        return { error: 'Invalid expression', expression: args.expression };
                    }
                },
            },
        ];

        const agent: AgentDefinition = {
            agent_id: 'test-gpt5-calculator',
            tools,
        };

        // Create a conversation with existing function calls (simulating message history)
        const messages = [
            {
                type: 'message' as const,
                role: 'user' as const,
                content: 'Calculate 15 * 8',
            },
            {
                type: 'thinking' as const,
                thinking_id: 'rs_test123-0',
                content: 'The user wants me to calculate 15 * 8. This is a simple multiplication.',
            },
            {
                type: 'function_call' as const,
                id: 'fc_test456',
                name: 'calculate',
                arguments: '{"expression": "15 * 8"}',
                call_id: 'call_abc123',
                status: 'completed' as const,
            },
            {
                type: 'function_call_output' as const,
                call_id: 'call_abc123',
                output: '{"result": 120, "expression": "15 * 8"}',
                status: 'completed' as const,
            },
            {
                type: 'message' as const,
                role: 'assistant' as const,
                content: '15 × 8 = 120',
            },
            {
                type: 'message' as const,
                role: 'user' as const,
                content: 'Now calculate (120 + 30) / 5 and then 7 * 9. Show me both results.',
            },
        ];

        let toolCallCount = 0;
        let hasReceivedFinalMessage = false;
        const errors: string[] = [];

        try {
            const response = await ensembleRequest(messages, 'gpt-5-nano', agent, undefined, event => {
                if (event.type === 'tool_start') {
                    toolCallCount++;
                    console.log(`Calculator called ${toolCallCount}: ${event.tool_call.function.arguments}`);
                } else if (event.type === 'message_complete' && event.content && event.content.length > 10) {
                    hasReceivedFinalMessage = true;
                } else if (event.type === 'error') {
                    errors.push(event.error);
                    console.error('Error:', event.error);
                }
            });

            // Verify the response
            expect(errors).toHaveLength(0);
            expect(toolCallCount).toBe(2); // Should calculate both expressions
            expect(hasReceivedFinalMessage).toBe(true);
            expect(response.content).toContain('30'); // (120 + 30) / 5 = 30
            expect(response.content).toContain('63'); // 7 * 9 = 63

            console.log('Complex history test passed!');
        } catch (error) {
            if (error instanceof Error && error.message.includes("required 'reasoning' item")) {
                throw new Error('GPT-5 reasoning/function call ordering error in complex history: ' + error.message);
            }
            throw error;
        }
    });
});
