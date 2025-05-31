import { ToolFunction } from '../types.js';

export type ToolParameterType = 'string' | 'number' | 'boolean' | 'array' | 'object';

export interface ToolParameter {
    type: ToolParameterType;
    description: string | (() => string);
    enum?: string[] | (() => string[]);
    items?: {
        type: ToolParameterType;
        enum?: string[];
    } | {
        type: 'object';
        properties: Record<string, ToolParameter>;
        required?: string[];
    };
    optional?: boolean;
}

export type ToolParameterMap = Record<string, string | ToolParameter>;

const validToolParameterTypes: ToolParameterType[] = ['string', 'number', 'boolean', 'array', 'object'];

/**
 * Create a tool definition from a function
 *
 * @param func - Function to create definition for
 * @param description - Tool description
 * @param paramMap - Optional mapping of function params to API params
 * @param returns - Optional description of what the function returns
 * @param functionName - Optional custom function name (defaults to function.name)
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
 */
export function createToolFunction(
    func: (...args: any[]) => Promise<any> | any,
    description?: string,
    paramMap?: ToolParameterMap,
    returns?: string,
    functionName?: string
): ToolFunction {
    const funcStr = func.toString();
    const funcName = (functionName || '').replace(/\s+/g, '_') || func.name || 'anonymous_function';

    let toolDescription = description || `Tool for ${funcName}`;
    if (returns) {
        toolDescription += ` Returns: ${returns}`;
    }

    // Clean up multiline parameter definitions
    const cleanFuncStr = funcStr.replace(/\n\s*/g, ' ');
    const paramMatch = cleanFuncStr.match(/\(([^)]*)\)/);

    const properties: Record<string, any> = {};
    const required: string[] = [];

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
            console.warn(
                `Skipping non-string parameter in function signature analysis: ${paramUnknown}`
            );
            continue;
        }
        const param = paramUnknown as string;

        // Extract parameter name and default value
        const paramParts = param.split('=').map(p => p.trim());
        let paramName = paramParts[0].trim();
        const defaultValue =
            paramParts.length > 1 ? paramParts[1].trim() : undefined;

        // Handle TypeScript type annotations (e.g., "city: string" -> "city")
        if (paramName.includes(':')) {
            paramName = paramName.split(':')[0].trim();
        }

        // Handle rest parameters
        const isRestParam = paramName.startsWith('...');
        const cleanParamName = isRestParam ? paramName.substring(3) : paramName;

        // Check if we have custom mapping for this parameter
        const paramInfoRaw: ToolParameter | string | undefined =
            paramMap?.[cleanParamName];
        let paramInfoObj: ToolParameter | undefined = undefined;
        let paramInfoDesc: string | undefined = undefined;

        if (typeof paramInfoRaw === 'string') {
            paramInfoDesc = paramInfoRaw;
            paramInfoObj = { type: 'string', description: paramInfoRaw };
        } else if (typeof paramInfoRaw === 'object' && paramInfoRaw !== null) {
            paramInfoObj = paramInfoRaw;
            paramInfoDesc =
                typeof paramInfoRaw.description === 'function'
                    ? paramInfoRaw.description()
                    : paramInfoRaw.description;
        }

        const apiParamName = cleanParamName;

        // Determine parameter type based on default value or param map
        let paramType: ToolParameterType = 'string'; // Default type

        // Check type from paramInfoObj first
        if (
            paramInfoObj?.type &&
            validToolParameterTypes.includes(paramInfoObj.type)
        ) {
            paramType = paramInfoObj.type;
        } else if (isRestParam) {
            // Rest parameters are arrays
            paramType = 'array';
        } else if (defaultValue !== undefined) {
            // Infer type from default value
            if (defaultValue === 'false' || defaultValue === 'true') {
                paramType = 'boolean';
            } else if (
                !isNaN(Number(defaultValue)) &&
                !defaultValue.startsWith('"') &&
                !defaultValue.startsWith("'")
            ) {
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

        // Handle enum
        if (paramInfoObj?.enum) {
            if (typeof paramInfoObj.enum === 'function') {
                paramDef.enum = paramInfoObj.enum();
            } else {
                paramDef.enum = paramInfoObj.enum;
            }
        }

        properties[apiParamName] = paramDef;

        // If parameter has no default value and is not marked optional, it's required
        if (defaultValue === undefined && !paramInfoObj?.optional) {
            required.push(apiParamName);
        }
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
    };
}