import { describe, it, expect } from 'vitest';
import { createToolFunction } from '../utils/create_tool_function.js';

describe('createToolFunction', () => {
    it('should create a basic tool definition from a function', () => {
        const func = async (message: string) => {
            return `Echo: ${message}`;
        };

        const tool = createToolFunction(
            func,
            'Echo back the user message'
        );

        expect(tool.function).toBe(func);
        expect(tool.definition.type).toBe('function');
        expect(tool.definition.function.name).toBe('func');
        expect(tool.definition.function.description).toBe('Echo back the user message');
        expect(tool.definition.function.parameters).toEqual({
            type: 'object',
            properties: {
                message: {
                    type: 'string',
                    description: 'The message parameter'
                }
            },
            required: ['message']
        });
    });

    it('should handle functions with default parameters', () => {
        const greet = async (name: string, greeting = 'Hello') => {
            return `${greeting}, ${name}!`;
        };

        const tool = createToolFunction(greet);

        expect(tool.definition.function.parameters.properties).toEqual({
            name: {
                type: 'string',
                description: 'The name parameter'
            },
            greeting: {
                type: 'string',
                description: 'The greeting parameter'
            }
        });
        expect(tool.definition.function.parameters.required).toEqual(['name']);
    });

    it('should infer parameter types from default values', () => {
        const calculate = async (
            value: number,
            multiply = 2,
            round = true,
            tags = [],
            options = {}
        ) => {
            const result = value * multiply;
            return round ? Math.round(result) : result;
        };

        const tool = createToolFunction(calculate);

        const props = tool.definition.function.parameters.properties;
        expect(props.value.type).toBe('string'); // Can't infer from TypeScript
        expect(props.multiply.type).toBe('number');
        expect(props.round.type).toBe('boolean');
        expect(props.tags.type).toBe('array');
        expect(props.options.type).toBe('object');
    });

    it('should use custom parameter descriptions from paramMap', () => {
        const search = async (query: string, limit: number) => {
            return `Found ${limit} results for "${query}"`;
        };

        const tool = createToolFunction(
            search,
            'Search for information',
            {
                query: 'The search query to execute',
                limit: {
                    type: 'number',
                    description: 'Maximum number of results',
                    optional: true
                }
            }
        );

        const props = tool.definition.function.parameters.properties;
        expect(props.query.description).toBe('The search query to execute');
        expect(props.limit.description).toBe('Maximum number of results');
        expect(props.limit.type).toBe('number');
        expect(tool.definition.function.parameters.required).toEqual(['query']);
    });

    it('should handle enum parameters', () => {
        const format = async (text: string, style: string) => {
            return text; // Simplified
        };

        const tool = createToolFunction(
            format,
            'Format text',
            {
                text: 'Text to format',
                style: {
                    type: 'string',
                    description: 'Formatting style',
                    enum: ['uppercase', 'lowercase', 'title']
                }
            }
        );

        const props = tool.definition.function.parameters.properties;
        expect(props.style.enum).toEqual(['uppercase', 'lowercase', 'title']);
    });

    it('should handle array parameters with items', () => {
        const processItems = async (items: string[]) => {
            return items.join(', ');
        };

        const tool = createToolFunction(
            processItems,
            'Process array of items',
            {
                items: {
                    type: 'array',
                    description: 'Items to process',
                    items: {
                        type: 'string'
                    }
                }
            }
        );

        const props = tool.definition.function.parameters.properties;
        expect(props.items.type).toBe('array');
        expect(props.items.items).toEqual({ type: 'string' });
    });

    it('should handle rest parameters', () => {
        const concat = async (...values: string[]) => {
            return values.join(' ');
        };

        const tool = createToolFunction(concat);

        const props = tool.definition.function.parameters.properties;
        expect(props.values.type).toBe('array');
        expect(props.values.items).toEqual({ type: 'string' });
    });

    it('should use custom function name when provided', () => {
        const func = async () => 'result';

        const tool = createToolFunction(
            func,
            'Custom tool',
            {},
            'Returns a result',
            'my_custom_tool'
        );

        expect(tool.definition.function.name).toBe('my_custom_tool');
        expect(tool.definition.function.description).toBe('Custom tool Returns: Returns a result');
    });

    it('should handle anonymous functions', () => {
        const tool = createToolFunction(
            async (x: number) => x * 2,
            'Double a number'
        );

        expect(tool.definition.function.name).toBe('anonymous_function');
    });

    it('should handle functions with no parameters', () => {
        const getTime = async () => new Date().toISOString();

        const tool = createToolFunction(
            getTime,
            'Get current time'
        );

        expect(tool.definition.function.parameters.properties).toEqual({});
        expect(tool.definition.function.parameters.required).toBeUndefined();
    });

    it('should handle enum as a function', () => {
        const tool = createToolFunction(
            async (choice: string) => choice,
            'Make a choice',
            {
                choice: {
                    type: 'string',
                    description: 'Your choice',
                    enum: () => ['option1', 'option2', 'option3']
                }
            }
        );

        const props = tool.definition.function.parameters.properties;
        expect(props.choice.enum).toEqual(['option1', 'option2', 'option3']);
    });

    it('should clean up function names with spaces', () => {
        const tool = createToolFunction(
            async () => 'test',
            'Test function',
            {},
            undefined,
            'my test function'
        );

        expect(tool.definition.function.name).toBe('my_test_function');
    });

    it('should handle TypeScript parameter type annotations', () => {
        // Simulate a function string with TypeScript annotations
        const func = async (name: string, age: number) => `${name} is ${age} years old`;
        
        const tool = createToolFunction(
            func,
            'Process person data'
        );

        // The function should still extract parameter names correctly
        expect(tool.definition.function.parameters.properties).toHaveProperty('name');
        expect(tool.definition.function.parameters.properties).toHaveProperty('age');
    });
});