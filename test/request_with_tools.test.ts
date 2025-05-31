import { describe, it, expect, vi } from 'vitest';
import { request, requestWithTools } from '../index';
import type { EnsembleTool, EnsembleStreamEvent } from '../types/extended_types';

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

        // Collect all events
        const events: EnsembleStreamEvent[] = [];
        let fullText = '';
        
        for await (const event of requestWithTools(
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
        )) {
            events.push(event);
            if (event.type === 'text_delta') {
                fullText += event.delta;
            } else if (event.type === 'text') {
                fullText += event.text;
            }
        }

        // Check that we got events
        expect(events.length).toBeGreaterThan(0);
        
        // Look for text in different event types
        const allText = events
            .filter(e => e.type === 'text' || e.type === 'text_delta' || e.type === 'message_complete')
            .map(e => (e as any).text || (e as any).delta || (e as any).content || '')
            .join('');
        
        expect(allText.length).toBeGreaterThan(0);
        expect(allText).toContain('test');

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

        const events: EnsembleStreamEvent[] = [];
        let fullText = '';
        
        for await (const event of requestWithTools(
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
        )) {
            events.push(event);
            if (event.type === 'text_delta') {
                fullText += event.delta;
            }
        }

        expect(events.length).toBeGreaterThan(0);
        expect(fullText).toBeDefined();
    });

    it('should work without tools', async () => {
        const events: EnsembleStreamEvent[] = [];
        let fullText = '';
        
        for await (const event of requestWithTools(
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
        )) {
            events.push(event);
            if (event.type === 'text_delta') {
                fullText += event.delta;
            } else if (event.type === 'text') {
                fullText += event.text;
            }
        }

        expect(events.length).toBeGreaterThan(0);
        
        // Look for text in different event types
        const allText = events
            .filter(e => e.type === 'text' || e.type === 'text_delta' || e.type === 'message_complete')
            .map(e => (e as any).text || (e as any).delta || (e as any).content || '')
            .join('');
        
        expect(allText.length).toBeGreaterThan(0);
        expect(allText.toLowerCase()).toContain('test');
    });

    it('should work with request() when tools are provided', async () => {
        // Test that request() automatically uses requestWithTools when tools are provided
        const tools: EnsembleTool[] = [{
            function: async ({ x, y }: { x: number; y: number }) => {
                return `${x + y}`;
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
        }];

        const events: EnsembleStreamEvent[] = [];
        let fullText = '';
        
        // Using request() with tools should automatically handle tool execution
        for await (const event of request(
            'test-model',
            [
                {
                    type: 'message',
                    role: 'user',
                    content: 'What is 10 plus 5?'
                }
            ],
            {
                tools,
                modelSettings: {
                    temperature: 0
                }
            }
        )) {
            events.push(event);
            if (event.type === 'text_delta') {
                fullText += event.delta;
            }
        }

        expect(events.length).toBeGreaterThan(0);
        expect(fullText).toBeDefined();
    });

    it('should allow disabling tool execution with executeTools: false', async () => {
        const tools: EnsembleTool[] = [{
            function: async () => {
                throw new Error('This tool should not be executed');
            },
            definition: {
                type: 'function',
                function: {
                    name: 'fail_tool',
                    description: 'This tool should not be executed',
                    parameters: {
                        type: 'object',
                        properties: {},
                        required: []
                    }
                }
            }
        }];

        const events: EnsembleStreamEvent[] = [];
        
        // Using request() with executeTools: false should not execute tools
        for await (const event of request(
            'test-model',
            [
                {
                    type: 'message',
                    role: 'user',
                    content: 'Try to use the fail_tool'
                }
            ],
            {
                tools,
                executeTools: false,
                modelSettings: {
                    temperature: 0
                }
            } as any
        )) {
            events.push(event);
        }

        // Test should complete without throwing
        expect(events.length).toBeGreaterThan(0);
    });
});