/**
 * Utilities for handling tool parameter extraction and coercion
 */

import { ToolParameter } from '../types/types.js';

/**
 * Coerce a value to match the expected parameter type
 * Returns [coercedValue, error] tuple
 */
export function coerceValue(
    value: any,
    paramSpec: ToolParameter,
    paramName: string
): [any, string | null] {
    const expectedType = paramSpec.type || 'string';

    // Handle undefined/null
    if (value === undefined || value === null) {
        if (paramSpec.optional) {
            return [undefined, null];
        }
        return [null, `Required parameter "${paramName}" is missing`];
    }

    // Handle empty strings for optional params
    if (value === '' && paramSpec.optional) {
        return [undefined, null];
    }

    const actualType = Array.isArray(value) ? 'array' : typeof value;

    // Type coercion based on expected type
    switch (expectedType) {
        case 'string':
            if (actualType === 'string') {
                return [value, null];
            }
            // Convert to string
            return [String(value), null];

        case 'number':
            if (actualType === 'number') {
                return [value, null];
            }
            if (actualType === 'string') {
                const num = Number(value);
                if (!isNaN(num)) {
                    return [num, null];
                }
                return [null, `Cannot convert "${value}" to number`];
            }
            return [null, `Expected number but got ${actualType}`];

        case 'boolean':
            if (actualType === 'boolean') {
                return [value, null];
            }
            if (actualType === 'string') {
                const lower = value.toLowerCase();
                if (lower === 'true') return [true, null];
                if (lower === 'false') return [false, null];
                return [null, `Cannot convert "${value}" to boolean`];
            }
            if (actualType === 'number') {
                return [value !== 0, null];
            }
            return [null, `Expected boolean but got ${actualType}`];

        case 'array':
            if (actualType === 'array') {
                return [value, null];
            }
            if (actualType === 'string') {
                try {
                    const parsed = JSON.parse(value);
                    if (Array.isArray(parsed)) {
                        return [parsed, null];
                    }
                } catch {
                    // Try splitting comma-separated values
                    if (value.includes(',')) {
                        return [value.split(',').map(s => s.trim()), null];
                    }
                }
                // Single value to array
                return [[value], null];
            }
            // Wrap single value in array
            return [[value], null];

        case 'object':
            if (actualType === 'object' && !Array.isArray(value)) {
                return [value, null];
            }
            if (actualType === 'string') {
                try {
                    const parsed = JSON.parse(value);
                    if (typeof parsed === 'object' && !Array.isArray(parsed)) {
                        return [parsed, null];
                    }
                } catch {
                    return [null, `Cannot parse "${value}" as object`];
                }
            }
            return [null, `Expected object but got ${actualType}`];

        case 'null':
            return [null, null];

        default:
            return [value, null];
    }
}

/**
 * Extract parameter names from a function in order
 */
export function extractParameterNames(func: (...args: any[]) => any): string[] {
    const funcStr = func.toString();

    // Clean up multiline parameter definitions
    const cleanFuncStr = funcStr.replaceAll(/\n\s*/g, ' ');
    const paramMatch = cleanFuncStr.match(/\(([^)]*)\)/);

    if (!paramMatch || !paramMatch[1]) {
        return [];
    }

    const params = paramMatch[1]
        .split(',')
        .map(p => p.trim())
        .filter(Boolean);

    const paramNames: string[] = [];

    for (const param of params) {
        let paramName = param;

        // Handle default values
        if (paramName.includes('=')) {
            paramName = paramName.split('=')[0].trim();
        }

        // Handle TypeScript type annotations
        if (paramName.includes(':')) {
            paramName = paramName.split(':')[0].trim();
        }

        // Handle rest parameters
        if (paramName.startsWith('...')) {
            paramName = paramName.substring(3);
        }

        // Skip special parameters
        if (paramName === 'inject_agent_id' || paramName === 'abort_signal') {
            continue;
        }

        paramNames.push(paramName);
    }

    return paramNames;
}

/**
 * Map named arguments to positional arguments based on function definition
 */
export function mapNamedToPositionalArgs(
    namedArgs: Record<string, any>,
    tool: any,
    injectAgentId?: string,
    abortSignal?: AbortSignal
): any[] {
    // Get parameter names and specs
    const paramNames = extractParameterNames(tool.function);
    const paramSpecs = tool.definition.function.parameters.properties || {};
    const requiredParams = tool.definition.function.parameters.required || [];

    // Filter out unknown parameters
    Object.keys(namedArgs).forEach(key => {
        if (!paramNames.includes(key)) {
            console.warn(
                `Removing unknown parameter "${key}" for tool "${tool.definition.function.name}"`
            );
            delete namedArgs[key];
        }
    });

    // Map to positional arguments with type coercion
    const positionalArgs: any[] = [];

    for (const paramName of paramNames) {
        const value = namedArgs[paramName];
        const paramSpec = paramSpecs[paramName] || { type: 'string' };

        // Skip empty values for optional params
        if (
            (value === undefined || value === '') &&
            !requiredParams.includes(paramName)
        ) {
            positionalArgs.push(undefined);
            continue;
        }

        // Apply type coercion
        const [coercedValue, error] = coerceValue(value, paramSpec, paramName);

        if (error && requiredParams.includes(paramName)) {
            throw new Error(
                JSON.stringify({
                    error: {
                        param: paramName,
                        expected:
                            paramSpec.type +
                            (paramSpec.items?.type
                                ? `<${paramSpec.items.type}>`
                                : ''),
                        received: String(value),
                        message: error,
                    },
                })
            );
        } else if (error) {
            console.warn(
                `Parameter coercion warning for ${paramName}: ${error}`
            );
        }

        positionalArgs.push(coercedValue);
    }

    // Inject special parameters if needed
    if (tool.injectAgentId && injectAgentId) {
        positionalArgs.unshift(injectAgentId);
    }

    if (tool.injectAbortSignal && abortSignal) {
        positionalArgs.push(abortSignal);
    }

    return positionalArgs;
}
