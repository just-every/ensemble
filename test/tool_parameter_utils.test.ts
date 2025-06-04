import { describe, it, expect, vi } from 'vitest';
import { coerceValue, extractParameterNames, mapNamedToPositionalArgs } from '../utils/tool_parameter_utils.js';
import { createToolFunction } from '../utils/create_tool_function.js';

describe('Tool Parameter Utils', () => {
    describe('coerceValue', () => {
        it('should handle string conversions', () => {
            const [val1, err1] = coerceValue('hello', { type: 'string' }, 'param');
            expect(val1).toBe('hello');
            expect(err1).toBeNull();

            const [val2, err2] = coerceValue(123, { type: 'string' }, 'param');
            expect(val2).toBe('123');
            expect(err2).toBeNull();
        });

        it('should handle number conversions', () => {
            const [val1, err1] = coerceValue(42, { type: 'number' }, 'param');
            expect(val1).toBe(42);
            expect(err1).toBeNull();

            const [val2, err2] = coerceValue('42', { type: 'number' }, 'param');
            expect(val2).toBe(42);
            expect(err2).toBeNull();

            const [val3, err3] = coerceValue('not a number', { type: 'number' }, 'param');
            expect(val3).toBeNull();
            expect(err3).toContain('Cannot convert');
        });

        it('should handle boolean conversions', () => {
            const [val1, err1] = coerceValue(true, { type: 'boolean' }, 'param');
            expect(val1).toBe(true);
            expect(err1).toBeNull();

            const [val2, err2] = coerceValue('true', { type: 'boolean' }, 'param');
            expect(val2).toBe(true);
            expect(err2).toBeNull();

            const [val3, err3] = coerceValue('false', { type: 'boolean' }, 'param');
            expect(val3).toBe(false);
            expect(err3).toBeNull();

            const [val4, err4] = coerceValue(1, { type: 'boolean' }, 'param');
            expect(val4).toBe(true);
            expect(err4).toBeNull();

            const [val5, err5] = coerceValue(0, { type: 'boolean' }, 'param');
            expect(val5).toBe(false);
            expect(err5).toBeNull();
        });

        it('should handle array conversions', () => {
            const [val1, err1] = coerceValue(['a', 'b'], { type: 'array' }, 'param');
            expect(val1).toEqual(['a', 'b']);
            expect(err1).toBeNull();

            const [val2, err2] = coerceValue('["a", "b"]', { type: 'array' }, 'param');
            expect(val2).toEqual(['a', 'b']);
            expect(err2).toBeNull();

            const [val3, err3] = coerceValue('a, b, c', { type: 'array' }, 'param');
            expect(val3).toEqual(['a', 'b', 'c']);
            expect(err3).toBeNull();

            const [val4, err4] = coerceValue('single', { type: 'array' }, 'param');
            expect(val4).toEqual(['single']);
            expect(err4).toBeNull();
        });

        it('should handle object conversions', () => {
            const obj = { foo: 'bar' };
            const [val1, err1] = coerceValue(obj, { type: 'object' }, 'param');
            expect(val1).toEqual(obj);
            expect(err1).toBeNull();

            const [val2, err2] = coerceValue('{"foo": "bar"}', { type: 'object' }, 'param');
            expect(val2).toEqual(obj);
            expect(err2).toBeNull();

            const [val3, err3] = coerceValue('not json', { type: 'object' }, 'param');
            expect(val3).toBeNull();
            expect(err3).toContain('Cannot parse');
        });

        it('should handle optional parameters', () => {
            const [val1, err1] = coerceValue(undefined, { type: 'string', optional: true }, 'param');
            expect(val1).toBeUndefined();
            expect(err1).toBeNull();

            const [val2, err2] = coerceValue('', { type: 'string', optional: true }, 'param');
            expect(val2).toBeUndefined();
            expect(err2).toBeNull();

            const [val3, err3] = coerceValue(undefined, { type: 'string' }, 'param');
            expect(val3).toBeNull();
            expect(err3).toContain('Required parameter');
        });
    });

    describe('extractParameterNames', () => {
        it('should extract parameter names from function', () => {
            const func1 = function(a: string, b: number, c: boolean) {};
            expect(extractParameterNames(func1)).toEqual(['a', 'b', 'c']);

            const func2 = async (name: string, age = 30) => {};
            expect(extractParameterNames(func2)).toEqual(['name', 'age']);

            const func3 = function(...args: string[]) {};
            expect(extractParameterNames(func3)).toEqual(['args']);

            const func4 = (text: string, inject_agent_id: string, abort_signal?: AbortSignal) => {};
            expect(extractParameterNames(func4)).toEqual(['text']);
        });
    });

    describe('mapNamedToPositionalArgs', () => {
        it('should map named args to positional args', () => {
            const tool = createToolFunction(
                async (name: string, age: number, active = true) => 'result',
                'Test tool',
                {
                    name: 'User name',
                    age: { type: 'number', description: 'User age' },
                    active: { type: 'boolean', description: 'Is active', optional: true }
                }
            );

            const namedArgs = { name: 'Alice', age: '25', active: 'false' };
            const positionalArgs = mapNamedToPositionalArgs(namedArgs, tool);

            expect(positionalArgs).toEqual(['Alice', 25, false]);
        });

        it('should handle missing optional parameters', () => {
            const tool = createToolFunction(
                async (required: string, optional = 'default') => 'result',
                'Test tool'
            );

            const namedArgs = { required: 'value' };
            const positionalArgs = mapNamedToPositionalArgs(namedArgs, tool);

            expect(positionalArgs).toEqual(['value', undefined]);
        });

        it('should inject agent ID when needed', () => {
            const tool = createToolFunction(
                async (query: string, inject_agent_id: string) => 'result',
                'Test tool',
                { query: 'Search query' }
            );

            const namedArgs = { query: 'test' };
            const positionalArgs = mapNamedToPositionalArgs(namedArgs, tool, 'agent123');

            expect(positionalArgs).toEqual(['agent123', 'test']);
        });

        it('should inject abort signal when needed', () => {
            const tool = createToolFunction(
                async (data: string, abort_signal?: AbortSignal) => 'result',
                'Test tool'
            );

            const abortController = new AbortController();
            const namedArgs = { data: 'test' };
            const positionalArgs = mapNamedToPositionalArgs(namedArgs, tool, undefined, abortController.signal);

            expect(positionalArgs).toEqual(['test', abortController.signal]);
        });

        it('should throw error for missing required parameters', () => {
            const tool = createToolFunction(
                async (required: string, optional?: string) => 'result',
                'Test tool'
            );

            const namedArgs = { optional: 'value' };
            
            expect(() => mapNamedToPositionalArgs(namedArgs, tool)).toThrow();
        });

        it('should warn about unknown parameters', () => {
            const tool = createToolFunction(
                async (known: string) => 'result',
                'Test tool'
            );

            const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
            
            const namedArgs = { known: 'value', unknown: 'extra' };
            const positionalArgs = mapNamedToPositionalArgs(namedArgs, tool);

            expect(positionalArgs).toEqual(['value']);
            expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('unknown parameter'));

            warnSpy.mockRestore();
        });
    });
});