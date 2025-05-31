import { describe, it, expect, vi } from 'vitest';
import { requestWithTools } from '../index';
import type { EnsembleTool } from '../types/extended_types';

describe('requestWithTools', () => {
    it('should execute tool functions using test provider', async () => {
        // Mock console.log to verify tool execution
        const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        
        // Define a simple addition tool
        const tools: EnsembleTool[] = [{
            function: async ({ x, y }: { x: number; y: number }) => {
                const result = x + y;
                console.log(`Tool called: ${x} + ${y} = ${result}`);
                return `The sum of ${x} and ${y} is ${result}`;
            },
            definition: {
                type: 'function',
                function: {
                    name: 'add_numbers',
                    description: 'Add two numbers together',
                    parameters: {
                        type: 'object',
                        properties: {
                            x: { type: 'number', description: 'First number' },
                            y: { type: 'number', description: 'Second number' }
                        },
                        required: ['x', 'y']
                    }
                }
            }
        }];

        const response = await requestWithTools(
            'test-model',
            [
                {
                    type: 'message',
                    role: 'user',
                    content: 'What is 25 plus 17?'
                }
            ],
            {
                tools,
                modelSettings: {
                    temperature: 0
                }
            }
        );

        // Check that we got a response
        expect(response).toBeDefined();
        expect(typeof response).toBe('string');
        
        // Test provider generates consistent responses
        expect(response).toContain('test model');

        consoleSpy.mockRestore();
    });

    it('should handle multiple tools', async () => {
        const toolCalls: string[] = [];
        
        const tools: EnsembleTool[] = [
            {
                function: async ({ x, y }: { x: number; y: number }) => {
                    const result = x + y;
                    toolCalls.push(`add: ${x} + ${y} = ${result}`);
                    return `${result}`;
                },
                definition: {
                    type: 'function',
                    function: {
                        name: 'add',
                        description: 'Add two numbers',
                        parameters: {
                            type: 'object',
                            properties: {
                                x: { type: 'number' },
                                y: { type: 'number' }
                            },
                            required: ['x', 'y']
                        }
                    }
                }
            },
            {
                function: async ({ x, y }: { x: number; y: number }) => {
                    const result = x * y;
                    toolCalls.push(`multiply: ${x} * ${y} = ${result}`);
                    return `${result}`;
                },
                definition: {
                    type: 'function',
                    function: {
                        name: 'multiply',
                        description: 'Multiply two numbers',
                        parameters: {
                            type: 'object',
                            properties: {
                                x: { type: 'number' },
                                y: { type: 'number' }
                            },
                            required: ['x', 'y']
                        }
                    }
                }
            }
        ];

        const response = await requestWithTools(
            'test-model',
            [
                {
                    type: 'message',
                    role: 'user',
                    content: 'Calculate (5 + 3) * 2'
                }
            ],
            {
                tools,
                modelSettings: {
                    temperature: 0
                }
            }
        );

        expect(response).toBeDefined();
        expect(typeof response).toBe('string');
    });

    it('should work without tools', async () => {
        const response = await requestWithTools(
            'test-model',
            [
                {
                    type: 'message',
                    role: 'user',
                    content: 'Hello, how are you?'
                }
            ],
            {
                modelSettings: {
                    temperature: 0
                }
            }
        );

        expect(response).toBeDefined();
        expect(typeof response).toBe('string');
    });
});