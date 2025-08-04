import { describe, it, expect, vi } from 'vitest';
import { executeToolWithLifecycle } from '../utils/tool_execution_manager.js';
import { ToolCall, ToolFunction, AgentDefinition } from '../types/types.js';

describe('Tool Result Conversion', () => {
    const createMockAgent = (): AgentDefinition => ({
        agent_id: 'test-agent',
        name: 'Test Agent',
    });

    const createToolCall = (name: string, args = '{}'): ToolCall => ({
        id: 'test-call-1',
        type: 'function',
        function: {
            name,
            arguments: args,
        },
    });

    it('should handle string results', async () => {
        const tool: ToolFunction = {
            definition: {
                type: 'function',
                function: {
                    name: 'string_tool',
                    description: 'Returns a string',
                    parameters: {
                        type: 'object',
                        properties: {},
                    },
                },
            },
            function: vi.fn(async () => 'Hello, world!'),
        };

        const result = await executeToolWithLifecycle(createToolCall('string_tool'), tool, createMockAgent());

        expect(result).toBe('Hello, world!');
    });

    it('should handle object results with JSON.stringify', async () => {
        const tool: ToolFunction = {
            definition: {
                type: 'function',
                function: {
                    name: 'object_tool',
                    description: 'Returns an object',
                    parameters: {
                        type: 'object',
                        properties: {},
                    },
                },
            },
            function: vi.fn(async () => ({ name: 'John', age: 30, active: true })),
        };

        const result = await executeToolWithLifecycle(createToolCall('object_tool'), tool, createMockAgent());

        // Should be pretty-printed JSON
        expect(result).toBe('{\n  "name": "John",\n  "age": 30,\n  "active": true\n}');
    });

    it('should handle array results', async () => {
        const tool: ToolFunction = {
            definition: {
                type: 'function',
                function: {
                    name: 'array_tool',
                    description: 'Returns an array',
                    parameters: {
                        type: 'object',
                        properties: {},
                    },
                },
            },
            function: vi.fn(async () => ['apple', 'banana', 'cherry']),
        };

        const result = await executeToolWithLifecycle(createToolCall('array_tool'), tool, createMockAgent());

        expect(result).toBe('[\n  "apple",\n  "banana",\n  "cherry"\n]');
    });

    it('should handle number results', async () => {
        const tool: ToolFunction = {
            definition: {
                type: 'function',
                function: {
                    name: 'number_tool',
                    description: 'Returns a number',
                    parameters: {
                        type: 'object',
                        properties: {},
                    },
                },
            },
            function: vi.fn(async () => 42),
        };

        const result = await executeToolWithLifecycle(createToolCall('number_tool'), tool, createMockAgent());

        expect(result).toBe('42');
    });

    it('should handle boolean results', async () => {
        const tool: ToolFunction = {
            definition: {
                type: 'function',
                function: {
                    name: 'boolean_tool',
                    description: 'Returns a boolean',
                    parameters: {
                        type: 'object',
                        properties: {},
                    },
                },
            },
            function: vi.fn(async () => true),
        };

        const result = await executeToolWithLifecycle(createToolCall('boolean_tool'), tool, createMockAgent());

        expect(result).toBe('true');
    });

    it('should handle null results', async () => {
        const tool: ToolFunction = {
            definition: {
                type: 'function',
                function: {
                    name: 'null_tool',
                    description: 'Returns null',
                    parameters: {
                        type: 'object',
                        properties: {},
                    },
                },
            },
            function: vi.fn(async () => null),
        };

        const result = await executeToolWithLifecycle(createToolCall('null_tool'), tool, createMockAgent());

        expect(result).toBe('');
    });

    it('should handle undefined results', async () => {
        const tool: ToolFunction = {
            definition: {
                type: 'function',
                function: {
                    name: 'undefined_tool',
                    description: 'Returns undefined',
                    parameters: {
                        type: 'object',
                        properties: {},
                    },
                },
            },
            function: vi.fn(async () => undefined),
        };

        const result = await executeToolWithLifecycle(createToolCall('undefined_tool'), tool, createMockAgent());

        expect(result).toBe('');
    });

    it('should handle complex nested objects', async () => {
        const tool: ToolFunction = {
            definition: {
                type: 'function',
                function: {
                    name: 'complex_tool',
                    description: 'Returns complex data',
                    parameters: {
                        type: 'object',
                        properties: {},
                    },
                },
            },
            function: vi.fn(async () => ({
                status: 'success',
                data: {
                    users: [
                        { id: 1, name: 'Alice' },
                        { id: 2, name: 'Bob' },
                    ],
                    metadata: {
                        total: 2,
                        page: 1,
                    },
                },
                timestamp: '2024-01-01T00:00:00Z',
            })),
        };

        const result = await executeToolWithLifecycle(createToolCall('complex_tool'), tool, createMockAgent());

        // Parse back to verify structure
        const parsed = JSON.parse(result);
        expect(parsed.status).toBe('success');
        expect(parsed.data.users).toHaveLength(2);
        expect(parsed.data.metadata.total).toBe(2);
    });

    it('should handle objects with circular references gracefully', async () => {
        const tool: ToolFunction = {
            definition: {
                type: 'function',
                function: {
                    name: 'circular_tool',
                    description: 'Returns circular reference',
                    parameters: {
                        type: 'object',
                        properties: {},
                    },
                },
            },
            function: vi.fn(async () => {
                const obj: any = { name: 'circular' };
                obj.self = obj; // Create circular reference
                return obj;
            }),
        };

        // Mock console.warn to verify it's called
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

        const result = await executeToolWithLifecycle(createToolCall('circular_tool'), tool, createMockAgent());

        // Should fall back to String() for circular references
        expect(result).toBe('[object Object]');
        expect(warnSpy).toHaveBeenCalledWith(
            'Failed to JSON.stringify tool result, falling back to String():',
            expect.any(Error)
        );

        warnSpy.mockRestore();
    });

    it('should handle empty objects with proper formatting', async () => {
        const tool: ToolFunction = {
            definition: {
                type: 'function',
                function: {
                    name: 'empty_object_tool',
                    description: 'Returns empty object',
                    parameters: {
                        type: 'object',
                        properties: {},
                    },
                },
            },
            function: vi.fn(async () => ({})),
        };

        const result = await executeToolWithLifecycle(createToolCall('empty_object_tool'), tool, createMockAgent());

        expect(result).toBe('{}');
    });

    it('should handle empty arrays with proper formatting', async () => {
        const tool: ToolFunction = {
            definition: {
                type: 'function',
                function: {
                    name: 'empty_array_tool',
                    description: 'Returns empty array',
                    parameters: {
                        type: 'object',
                        properties: {},
                    },
                },
            },
            function: vi.fn(async () => []),
        };

        const result = await executeToolWithLifecycle(createToolCall('empty_array_tool'), tool, createMockAgent());

        expect(result).toBe('[]');
    });

    it('should handle single key object with proper grammar', async () => {
        const tool: ToolFunction = {
            definition: {
                type: 'function',
                function: {
                    name: 'single_key_tool',
                    description: 'Returns single key object',
                    parameters: {
                        type: 'object',
                        properties: {},
                    },
                },
            },
            function: vi.fn(async () => ({ status: 'ok' })),
        };

        const result = await executeToolWithLifecycle(createToolCall('single_key_tool'), tool, createMockAgent());

        expect(result).toBe('{\n  "status": "ok"\n}');
    });

    it('should handle Error objects with proper string representation', async () => {
        const tool: ToolFunction = {
            definition: {
                type: 'function',
                function: {
                    name: 'error_tool',
                    description: 'Returns an Error object',
                    parameters: {
                        type: 'object',
                        properties: {},
                    },
                },
            },
            function: vi.fn(async () => new Error('Something went wrong')),
        };

        const result = await executeToolWithLifecycle(createToolCall('error_tool'), tool, createMockAgent());

        expect(result).toBe('Error: Something went wrong');
    });

    it('should handle custom Error objects', async () => {
        class CustomError extends Error {
            constructor(message: string) {
                super(message);
                this.name = 'CustomError';
            }
        }

        const tool: ToolFunction = {
            definition: {
                type: 'function',
                function: {
                    name: 'custom_error_tool',
                    description: 'Returns a custom Error object',
                    parameters: {
                        type: 'object',
                        properties: {},
                    },
                },
            },
            function: vi.fn(async () => new CustomError('Custom error occurred')),
        };

        const result = await executeToolWithLifecycle(createToolCall('custom_error_tool'), tool, createMockAgent());

        expect(result).toBe('CustomError: Custom error occurred');
    });
});
