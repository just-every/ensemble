import { describe, it, expect } from 'vitest';
import { createToolFunction } from '../utils/create_tool_function.js';

describe('createToolFunction object parameter validation', () => {
    it('should throw error when object parameter has no properties defined', () => {
        expect(() => {
            createToolFunction(
                async () => {
                    return { success: true };
                },
                'Make an API call',
                {
                    endpoint: { type: 'string', description: 'API endpoint URL' },
                    method: { type: 'string', description: 'HTTP method' },
                    data: { type: 'object', description: 'Request body data' },
                },
                undefined,
                'call_api'
            );
        }).toThrowError(/Parameter 'data' is of type 'object' but has no 'properties' defined/);
    });

    it('should not throw error when object parameter has properties defined', () => {
        const tool = createToolFunction(
            async () => {
                return { success: true };
            },
            'Make an API call',
            {
                endpoint: { type: 'string', description: 'API endpoint URL' },
                method: { type: 'string', description: 'HTTP method' },
                data: {
                    type: 'object',
                    description: 'Request body data',
                    properties: {
                        name: { type: 'string', description: 'Name field' },
                        value: { type: 'number', description: 'Value field' },
                    },
                },
            },
            undefined,
            'call_api'
        );

        expect(tool.definition.function.name).toBe('call_api');
        expect(tool.definition.function.parameters.properties.data.properties).toBeDefined();
    });

    it('should allow string type for JSON data instead of object', () => {
        const tool = createToolFunction(
            async () => {
                return { success: true };
            },
            'Make an API call',
            {
                endpoint: { type: 'string', description: 'API endpoint URL' },
                method: { type: 'string', description: 'HTTP method' },
                data: { type: 'string', description: 'Request body data as JSON string' },
            },
            undefined,
            'call_api'
        );

        expect(tool.definition.function.name).toBe('call_api');
        expect(tool.definition.function.parameters.properties.data.type).toBe('string');
    });

    it('should work with optional object parameters', () => {
        // When marked as optional, object parameters should still require properties
        expect(() => {
            createToolFunction(
                async () => {
                    return { success: true };
                },
                'Make an API call',
                {
                    endpoint: { type: 'string', description: 'API endpoint URL' },
                    data: {
                        type: 'object',
                        description: 'Optional request body data',
                        optional: true,
                        // Still missing properties - should throw error
                    },
                },
                undefined,
                'call_api'
            );
        }).toThrowError(/Parameter 'data' is of type 'object' but has no 'properties' defined/);
    });
});
