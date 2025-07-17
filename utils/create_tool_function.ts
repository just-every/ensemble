import { ToolFunction, ToolParameter, ToolParameterType, ToolParameterMap } from '../types/types.js';

const validToolParameterTypes: ToolParameterType[] = ['string', 'number', 'boolean', 'array', 'object', 'null'];

/**
 * Create a tool definition from a function
 *
 * @param func - Function to create definition for
 * @param description - Tool description
 * @param paramMap - Optional mapping of function params to API params
 * @param returns - Optional description of what the function returns
 * @param functionName - Optional custom function name (defaults to function.name)
 * @param allow_summary - Whether to allow summary of tool results (defaults to true)
 * @returns Tool definition object
 *
 * @example
 * // Simple function with inferred parameters
 * const weatherTool = createToolFunction(
 *   async (city: string, unit = 'celsius') => {
 *     return `Weather in ${city}: 22° ${unit}`;
 *   },
 *   'Get current weather for a city'
 * );
 *
 * @example
 * // Function with parameter descriptions
 * const searchTool = createToolFunction(
 *   async (query: string, limit = 10) => {
 *     // Implementation
 *     return `Found ${limit} results for "${query}"`;
 *   },
 *   'Search for information',
 *   {
 *     query: 'The search query string',
 *     limit: {
 *       type: 'number',
 *       description: 'Maximum number of results to return',
 *       optional: true
 *     }
 *   }
 * );
 *
 * @example
 * // Function with enum parameters
 * const formatTool = createToolFunction(
 *   async (text: string, format: string) => {
 *     return text.toUpperCase(); // Example
 *   },
 *   'Format text in different styles',
 *   {
 *     text: 'The text to format',
 *     format: {
 *       type: 'string',
 *       description: 'The format style to apply',
 *       enum: ['uppercase', 'lowercase', 'title', 'camel']
 *     }
 *   }
 * );
 *
 * @example
 * // Function with special parameters (inject_agent_id, abort_signal)
 * const agentTool = createToolFunction(
 *   async (query: string, inject_agent_id: string, abort_signal?: AbortSignal) => {
 *     // inject_agent_id and abort_signal are automatically handled
 *     return `Agent ${inject_agent_id} processed: ${query}`;
 *   },
 *   'Tool that uses agent context',
 *   {
 *     query: 'The query to process'
 *   }
 * );
 */
export function createToolFunction(
    func: (...args: any[]) => Promise<any> | any,
    description?: string,
    paramMap?: ToolParameterMap,
    returns?: string,
    functionName?: string,
    allow_summary: boolean = true
): ToolFunction {
    const funcStr = func.toString();
    const funcName = (functionName || '').replaceAll(' ', '_') || func.name;

    if (!funcName) {
        throw new Error('[createToolFunction] Function name is required');
    }

    let toolDescription = description || `Tool for ${funcName}`;
    if (returns) {
        toolDescription += ` Returns: ${returns}`;
    }

    // Clean up multiline parameter definitions
    const cleanFuncStr = funcStr.replaceAll(/\n\s*/g, ' ');
    const paramMatch = cleanFuncStr.match(/\(([^)]*)\)/);

    const properties: Record<string, ToolParameter> = {};
    const required: string[] = [];

    let injectAgentId = false;
    let injectAbortSignal = false;

    const params = paramMap
        ? Object.keys(paramMap)
        : paramMatch && paramMatch[1]
          ? paramMatch[1]
                .split(',')
                .map(p => p.trim())
                .filter(Boolean)
          : [];

    for (const paramUnknown of params) {
        if (typeof paramUnknown !== 'string') {
            console.warn(`Skipping non-string parameter in function signature analysis: ${paramUnknown}`);
            continue;
        }
        const param = paramUnknown as string;

        // Extract parameter name and default value
        const paramParts = param.split('=').map(p => p.trim());
        let paramName = paramParts[0].trim();
        const defaultValue = paramParts.length > 1 ? paramParts[1].trim() : undefined;

        // Handle TypeScript type annotations (e.g., "city: string" -> "city")
        if (paramName.includes(':')) {
            paramName = paramName.split(':')[0].trim();
        }

        // Handle rest parameters
        const isRestParam = paramName.startsWith('...');
        const cleanParamName = isRestParam ? paramName.substring(3) : paramName;

        // Handle special parameters
        if (cleanParamName === 'inject_agent_id') {
            injectAgentId = true;
            continue; // Skip adding to parameters
        }

        if (cleanParamName === 'abort_signal') {
            injectAbortSignal = true;
            continue; // Skip adding to parameters
        }

        // Check if we have custom mapping for this parameter
        const paramInfoRaw: ToolParameter | string | undefined = paramMap?.[cleanParamName];
        let paramInfoObj: ToolParameter | undefined = undefined;
        let paramInfoDesc: string | undefined = undefined;

        if (typeof paramInfoRaw === 'string') {
            paramInfoDesc = paramInfoRaw;
            paramInfoObj = { type: 'string', description: paramInfoRaw };
        } else if (typeof paramInfoRaw === 'object' && paramInfoRaw !== null) {
            paramInfoObj = paramInfoRaw;
            paramInfoDesc =
                typeof paramInfoRaw.description === 'function' ? paramInfoRaw.description() : paramInfoRaw.description;
        }

        const apiParamName = cleanParamName;

        // Determine parameter type based on default value or param map
        let paramType: ToolParameterType = 'string'; // Default type

        // Check type from paramInfoObj first
        if (paramInfoObj?.type && validToolParameterTypes.includes(paramInfoObj.type)) {
            paramType = paramInfoObj.type;
        } else if (isRestParam) {
            // Rest parameters are arrays
            paramType = 'array';
        } else if (defaultValue !== undefined) {
            // Infer type from default value
            if (defaultValue === 'false' || defaultValue === 'true') {
                paramType = 'boolean';
            } else if (!isNaN(Number(defaultValue)) && !defaultValue.startsWith('"') && !defaultValue.startsWith("'")) {
                paramType = 'number';
            } else if (defaultValue === '[]' || defaultValue.startsWith('[')) {
                paramType = 'array';
            } else if (defaultValue === '{}' || defaultValue.startsWith('{')) {
                paramType = 'object';
            }
        }

        // Use description from paramInfo if available, otherwise default
        const finalDescription = paramInfoDesc || `The ${cleanParamName} parameter`;

        // Create parameter definition
        const paramDef: any = {
            type: paramType,
            description: finalDescription,
        };

        // Handle array items definition
        if (paramType === 'array') {
            if (paramInfoObj?.items) {
                paramDef.items = paramInfoObj.items;
            } else {
                // Fallback to default string items if not specified
                paramDef.items = {
                    type: 'string',
                };
            }
        }

        // Handle object properties and required
        if (paramType === 'object') {
            if (paramInfoObj?.properties) {
                paramDef.properties = paramInfoObj.properties;
            } else {
                // Object parameters without properties will cause errors with strict mode
                throw new Error(
                    `[createToolFunction] Parameter '${cleanParamName}' is of type 'object' but has no 'properties' defined. ` +
                        `Object parameters must define their structure when used with strict mode. ` +
                        `Either provide a 'properties' field or use a different type like 'string' for JSON data.`
                );
            }
            if (paramInfoObj?.required) {
                paramDef.required = paramInfoObj.required;
            }
        }

        // Handle enum
        if (paramInfoObj?.enum) {
            if (typeof paramInfoObj.enum === 'function') {
                // Check if it's an async function by looking at its constructor
                const enumFn = paramInfoObj.enum;
                const fnStr = enumFn.toString();
                const isAsync =
                    fnStr.includes('__awaiter') ||
                    fnStr.startsWith('async ') ||
                    enumFn.constructor.name === 'AsyncFunction';

                if (isAsync) {
                    // For async functions, pass the function through
                    // The provider will need to handle async enum resolution
                    paramDef.enum = enumFn;
                } else {
                    // For sync functions, call it immediately for backward compatibility
                    paramDef.enum = enumFn();
                }
            } else {
                paramDef.enum = paramInfoObj.enum;
            }
        }

        // Handle additional properties from the extended interface
        if (paramInfoObj?.minimum !== undefined) {
            paramDef.minimum = paramInfoObj.minimum;
        }
        if (paramInfoObj?.maximum !== undefined) {
            paramDef.maximum = paramInfoObj.maximum;
        }
        if (paramInfoObj?.default !== undefined) {
            paramDef.default = paramInfoObj.default;
        } else if (defaultValue !== undefined) {
            paramDef.default = defaultValue;
        }
        if (paramInfoObj?.minLength !== undefined) {
            paramDef.minLength = paramInfoObj.minLength;
        }
        if (paramInfoObj?.maxLength !== undefined) {
            paramDef.maxLength = paramInfoObj.maxLength;
        }
        if (paramInfoObj?.pattern !== undefined) {
            paramDef.pattern = paramInfoObj.pattern;
        }
        if (paramInfoObj?.minItems !== undefined) {
            paramDef.minItems = paramInfoObj.minItems;
        }
        if (paramInfoObj?.additionalProperties !== undefined) {
            paramDef.additionalProperties = paramInfoObj.additionalProperties;
        }

        properties[apiParamName] = paramDef;

        // If parameter has no default value and is not marked optional, it's required
        if (paramDef.default === undefined && !paramInfoObj?.optional) {
            required.push(apiParamName);
        }
    }

    // If the underlying function signature expects an inject_agent_id argument
    // but we built the paramNames list from paramMap (thereby skipping it),
    // we still need to flag injectAgentId so that the caller knows to inject it
    if (!injectAgentId && /\(\s*[^)]*\binject_agent_id\b/.test(funcStr)) {
        injectAgentId = true;
    }

    // Similarly check for abort_signal if paramMap omitted it but the function
    // signature includes it so we can inject the abort signal automatically
    if (!injectAbortSignal && /\(\s*[^)]*\babort_signal\b/.test(funcStr)) {
        injectAbortSignal = true;
    }

    // Create and return tool definition
    return {
        function: func,
        definition: {
            type: 'function',
            function: {
                name: funcName,
                description: toolDescription,
                parameters: {
                    type: 'object',
                    properties,
                    required: required.length > 0 ? required : undefined,
                },
            },
        },
        ...(injectAgentId && { injectAgentId }),
        ...(injectAbortSignal && { injectAbortSignal }),
        allow_summary,
    };
}
