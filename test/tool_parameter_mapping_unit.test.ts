import { describe, it, expect } from 'vitest';
import { createToolFunction } from '../utils/create_tool_function.js';
import { mapNamedToPositionalArgs } from '../utils/tool_parameter_utils.js';

describe('Tool Parameter Mapping Unit Tests', () => {
    it('should correctly map named parameters from LLM to positional arguments', () => {
        // Create a tool with positional parameters
        const startTaskTool = createToolFunction(
            async (
                name: string,
                task: string,
                context: string,
                warnings: string,
                goal: string,
                type?: string,
                project?: string[]
            ) => {
                return `Task "${name}" created with type: ${type || 'default'}`;
            },
            'Start a new task',
            {
                name: 'Task name',
                task: 'Task description',
                context: 'Task context',
                warnings: 'Any warnings',
                goal: 'Task goal',
                type: {
                    type: 'string',
                    description: 'Task type',
                    optional: true
                },
                project: {
                    type: 'array',
                    description: 'Related projects',
                    items: { type: 'string' },
                    optional: true
                }
            }
        );

        // Simulate named arguments from LLM
        const namedArgs = {
            name: 'Self-Improvement Review',
            task: 'Review the existing code',
            context: 'The primary objective is improvement',
            warnings: 'No specific warnings',
            goal: 'Analyze the project',
            type: 'project_update',
            project: ['magi-self-improvement']
        };

        // Map to positional arguments
        const positionalArgs = mapNamedToPositionalArgs(namedArgs, startTaskTool);

        // Verify the mapping
        expect(positionalArgs).toEqual([
            'Self-Improvement Review',
            'Review the existing code',
            'The primary objective is improvement',
            'No specific warnings',
            'Analyze the project',
            'project_update',
            ['magi-self-improvement']
        ]);
    });

    it('should handle type coercion when mapping parameters', () => {
        const calculateTool = createToolFunction(
            async (a: number, b: number, round = true) => {
                const result = a + b;
                return round ? Math.round(result).toString() : result.toString();
            },
            'Calculate sum',
            {
                a: { type: 'number', description: 'First number' },
                b: { type: 'number', description: 'Second number' },
                round: { type: 'boolean', description: 'Round result', optional: true }
            }
        );

        // Named args with string values that need coercion
        const namedArgs = {
            a: '42.5',
            b: '7.8',
            round: 'false'
        };

        const positionalArgs = mapNamedToPositionalArgs(namedArgs, calculateTool);

        // Verify type coercion worked
        expect(positionalArgs[0]).toBe(42.5);
        expect(positionalArgs[1]).toBe(7.8);
        expect(positionalArgs[2]).toBe(false);
    });

    it('should inject agent ID when tool has injectAgentId flag', () => {
        const agentTool = createToolFunction(
            async (query: string, inject_agent_id: string) => {
                return `Agent ${inject_agent_id} processed: ${query}`;
            },
            'Agent-aware tool',
            {
                query: 'Query to process'
            }
        );

        const namedArgs = {
            query: 'test query'
        };

        const positionalArgs = mapNamedToPositionalArgs(
            namedArgs, 
            agentTool, 
            'custom-agent-123'
        );

        // Agent ID should be injected as first parameter
        expect(positionalArgs).toEqual(['custom-agent-123', 'test query']);
    });

    it('should handle missing optional parameters', () => {
        const greetTool = createToolFunction(
            async (name: string, greeting = 'Hello', punctuation = '!') => {
                return `${greeting}, ${name}${punctuation}`;
            },
            'Greet someone'
        );

        const namedArgs = {
            name: 'World'
            // greeting and punctuation are omitted
        };

        const positionalArgs = mapNamedToPositionalArgs(namedArgs, greetTool);

        // Optional parameters should be undefined
        expect(positionalArgs).toEqual(['World', undefined, undefined]);
    });

    it('should handle array coercion', () => {
        const processTool = createToolFunction(
            async (items: string[], tags: string[] = []) => {
                return `Processing ${items.length} items with ${tags.length} tags`;
            },
            'Process items',
            {
                items: {
                    type: 'array',
                    description: 'Items to process',
                    items: { type: 'string' }
                },
                tags: {
                    type: 'array',
                    description: 'Tags',
                    items: { type: 'string' },
                    optional: true
                }
            }
        );

        const namedArgs = {
            items: 'item1, item2, item3',  // Comma-separated string
            tags: '["tag1", "tag2"]'        // JSON string
        };

        const positionalArgs = mapNamedToPositionalArgs(namedArgs, processTool);

        expect(positionalArgs[0]).toEqual(['item1', 'item2', 'item3']);
        expect(positionalArgs[1]).toEqual(['tag1', 'tag2']);
    });

    it('should throw error for missing required parameters', () => {
        const tool = createToolFunction(
            async (required: string, optional?: string) => 'result',
            'Test tool'
        );

        const namedArgs = {
            optional: 'value'
            // required is missing
        };

        expect(() => mapNamedToPositionalArgs(namedArgs, tool)).toThrow();
    });

    it('should handle object parameters correctly', () => {
        const configTool = createToolFunction(
            async (config: { host: string; port: number }) => {
                return `Connecting to ${config.host}:${config.port}`;
            },
            'Process configuration',
            {
                config: {
                    type: 'object',
                    description: 'Configuration object',
                    properties: {
                        host: { type: 'string' },
                        port: { type: 'number' }
                    }
                }
            }
        );

        const namedArgs = {
            config: '{"host": "localhost", "port": 3000}'  // JSON string
        };

        const positionalArgs = mapNamedToPositionalArgs(namedArgs, configTool);

        expect(positionalArgs[0]).toEqual({ host: 'localhost', port: 3000 });
    });
});