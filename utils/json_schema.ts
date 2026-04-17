import type { ToolParameter } from '../types/types.js';

type ValidationResult = {
    ok: boolean;
    error?: string;
};

function describePath(path: string): string {
    return path === '$' ? 'response' : path;
}

function joinPath(path: string, segment: string | number): string {
    return typeof segment === 'number' ? `${path}[${segment}]` : `${path}.${segment}`;
}

function getAllowedTypes(schema: any): string[] {
    if (typeof schema?.type === 'string') {
        return [schema.type];
    }
    if (Array.isArray(schema?.type)) {
        return schema.type.filter((type: unknown): type is string => typeof type === 'string');
    }
    return [];
}

function matchesType(value: unknown, type: string): boolean {
    switch (type) {
        case 'array':
            return Array.isArray(value);
        case 'object':
            return value !== null && typeof value === 'object' && !Array.isArray(value);
        case 'string':
            return typeof value === 'string';
        case 'number':
            return typeof value === 'number' && Number.isFinite(value);
        case 'integer':
            return typeof value === 'number' && Number.isInteger(value);
        case 'boolean':
            return typeof value === 'boolean';
        case 'null':
            return value === null;
        default:
            return true;
    }
}

function areJsonValuesEqual(left: unknown, right: unknown): boolean {
    if (left === right) {
        return true;
    }

    if (left === null || right === null) {
        return left === right;
    }

    if (Array.isArray(left) || Array.isArray(right)) {
        if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
            return false;
        }

        return left.every((entry, index) => areJsonValuesEqual(entry, right[index]));
    }

    if (typeof left === 'object' && typeof right === 'object') {
        const leftRecord = left as Record<string, unknown>;
        const rightRecord = right as Record<string, unknown>;
        const leftKeys = Object.keys(leftRecord);
        const rightKeys = Object.keys(rightRecord);

        if (leftKeys.length !== rightKeys.length) {
            return false;
        }

        return leftKeys.every(key => key in rightRecord && areJsonValuesEqual(leftRecord[key], rightRecord[key]));
    }

    return false;
}

function getObjectProperties(schema: any): Record<string, unknown> | undefined {
    return schema?.properties && typeof schema.properties === 'object'
        ? (schema.properties as Record<string, unknown>)
        : undefined;
}

function getRequiredPropertiesForValidation(schema: any, properties?: Record<string, unknown>): string[] {
    if (Array.isArray(schema?.required)) {
        return schema.required.filter((entry: unknown): entry is string => typeof entry === 'string');
    }

    return [];
}

function collectAllowedObjectKeys(value: Record<string, unknown>, schema: any, path: string): Set<string> {
    const allowedKeys = new Set<string>();
    const properties = getObjectProperties(schema);

    if (properties) {
        for (const key of Object.keys(properties)) {
            allowedKeys.add(key);
        }
    }

    if (Array.isArray(schema?.anyOf)) {
        for (const candidate of schema.anyOf) {
            if (!validateAgainstSchema(value, candidate, path).ok) {
                continue;
            }
            for (const key of collectAllowedObjectKeys(value, candidate, path)) {
                allowedKeys.add(key);
            }
        }
    }

    if (Array.isArray(schema?.oneOf)) {
        for (const candidate of schema.oneOf) {
            if (!validateAgainstSchema(value, candidate, path).ok) {
                continue;
            }
            for (const key of collectAllowedObjectKeys(value, candidate, path)) {
                allowedKeys.add(key);
            }
        }
    }

    if (Array.isArray(schema?.allOf)) {
        for (const candidate of schema.allOf) {
            for (const key of collectAllowedObjectKeys(value, candidate, path)) {
                allowedKeys.add(key);
            }
        }
    }

    return allowedKeys;
}

function shouldTreatAllOfObjectAsClosed(schema: any): boolean {
    if (schema?.additionalProperties === false) {
        return true;
    }

    if (!Array.isArray(schema?.allOf)) {
        return false;
    }

    const objectBranches = schema.allOf.filter((candidate: unknown) => {
        if (!candidate || typeof candidate !== 'object') {
            return false;
        }

        const objectCandidate = candidate as Record<string, unknown>;
        return objectCandidate.type === 'object' || typeof objectCandidate.properties === 'object';
    });

    return objectBranches.length > 0 && objectBranches.every((candidate: any) => candidate?.additionalProperties === false);
}

function shouldRelaxAllOfObjectBranches(schema: any): boolean {
    if (!Array.isArray(schema?.allOf)) {
        return false;
    }

    const objectBranches = schema.allOf.filter((candidate: unknown) => {
        if (!candidate || typeof candidate !== 'object') {
            return false;
        }

        const objectCandidate = candidate as Record<string, unknown>;
        return objectCandidate.type === 'object' || typeof objectCandidate.properties === 'object';
    });

    return objectBranches.length > 0 && objectBranches.every((candidate: any) => candidate?.additionalProperties === false);
}

function relaxAllOfObjectBranch(candidate: any): any {
    if (!candidate || typeof candidate !== 'object') {
        return candidate;
    }

    if (candidate.additionalProperties !== false) {
        return candidate;
    }

    return {
        ...candidate,
        additionalProperties: undefined,
    };
}

function isValidMultipleOf(value: number, step: number): boolean {
    if (!Number.isFinite(step) || step <= 0) {
        return true;
    }

    const quotient = value / step;
    const roundedQuotient = Math.round(quotient);
    const tolerance = Number.EPSILON * Math.max(1, Math.abs(quotient)) * 16;

    return Math.abs(quotient - roundedQuotient) <= tolerance;
}

function validateAgainstSchema(value: unknown, schema: any, path = '$'): ValidationResult {
    if (!schema || typeof schema !== 'object') {
        return { ok: true };
    }

    if (schema.const !== undefined && !areJsonValuesEqual(value, schema.const)) {
        return {
            ok: false,
            error: `${describePath(path)} must equal ${JSON.stringify(schema.const)}`,
        };
    }

    if (Array.isArray(schema.enum) && !schema.enum.some((entry: unknown) => areJsonValuesEqual(entry, value))) {
        return {
            ok: false,
            error: `${describePath(path)} must be one of ${schema.enum.map((entry: unknown) => JSON.stringify(entry)).join(', ')}`,
        };
    }

    const allowedTypes = getAllowedTypes(schema);
    if (allowedTypes.length > 0 && !allowedTypes.some(type => matchesType(value, type))) {
        return {
            ok: false,
            error: `${describePath(path)} must be ${allowedTypes.join(' or ')}`,
        };
    }

    if (Array.isArray(schema.anyOf)) {
        const anyOfValid = schema.anyOf.some((candidate: unknown) => validateAgainstSchema(value, candidate, path).ok);
        if (!anyOfValid) {
            return {
                ok: false,
                error: `${describePath(path)} did not match any allowed schema variant`,
            };
        }
    }

    if (Array.isArray(schema.oneOf)) {
        const matches = schema.oneOf.filter((candidate: unknown) => validateAgainstSchema(value, candidate, path).ok).length;
        if (matches !== 1) {
            return {
                ok: false,
                error: `${describePath(path)} must match exactly one schema variant`,
            };
        }
    }

    const relaxAllOfObjectBranches = shouldRelaxAllOfObjectBranches(schema);
    if (Array.isArray(schema.allOf)) {
        for (const candidate of schema.allOf) {
            const candidateSchema =
                relaxAllOfObjectBranches && value !== null && typeof value === 'object' && !Array.isArray(value)
                    ? relaxAllOfObjectBranch(candidate)
                    : candidate;
            const result = validateAgainstSchema(value, candidateSchema, path);
            if (!result.ok) {
                return result;
            }
        }
    }

    if (typeof value === 'string') {
        if (typeof schema.minLength === 'number' && value.length < schema.minLength) {
            return {
                ok: false,
                error: `${describePath(path)} must be at least ${schema.minLength} characters`,
            };
        }
        if (typeof schema.maxLength === 'number' && value.length > schema.maxLength) {
            return {
                ok: false,
                error: `${describePath(path)} must be at most ${schema.maxLength} characters`,
            };
        }
        if (typeof schema.pattern === 'string') {
            let regex: RegExp;
            try {
                regex = new RegExp(schema.pattern);
            } catch (error) {
                return {
                    ok: false,
                    error: `${describePath(path)} uses invalid pattern ${schema.pattern}: ${error instanceof Error ? error.message : String(error)}`,
                };
            }
            if (!regex.test(value)) {
                return {
                    ok: false,
                    error: `${describePath(path)} must match pattern ${schema.pattern}`,
                };
            }
        }
    }

    if (typeof value === 'number') {
        if (typeof schema.minimum === 'number' && value < schema.minimum) {
            return {
                ok: false,
                error: `${describePath(path)} must be >= ${schema.minimum}`,
            };
        }
        if (typeof schema.maximum === 'number' && value > schema.maximum) {
            return {
                ok: false,
                error: `${describePath(path)} must be <= ${schema.maximum}`,
            };
        }
        if (typeof schema.multipleOf === 'number' && !isValidMultipleOf(value, schema.multipleOf)) {
            return {
                ok: false,
                error: `${describePath(path)} must be a multiple of ${schema.multipleOf}`,
            };
        }
    }

    if (Array.isArray(value)) {
        if (typeof schema.minItems === 'number' && value.length < schema.minItems) {
            return {
                ok: false,
                error: `${describePath(path)} must contain at least ${schema.minItems} items`,
            };
        }
        if (typeof schema.maxItems === 'number' && value.length > schema.maxItems) {
            return {
                ok: false,
                error: `${describePath(path)} must contain at most ${schema.maxItems} items`,
            };
        }
        if (schema.items) {
            for (const [index, item] of value.entries()) {
                const itemSchema = Array.isArray(schema.items) ? schema.items[index] : schema.items;

                if (itemSchema === undefined) {
                    if (schema.additionalItems === false) {
                        return {
                            ok: false,
                            error: `${describePath(joinPath(path, index))} is not allowed`,
                        };
                    }

                    if (schema.additionalItems && typeof schema.additionalItems === 'object') {
                        const result = validateAgainstSchema(item, schema.additionalItems, joinPath(path, index));
                        if (!result.ok) {
                            return result;
                        }
                    }
                    continue;
                }

                const result = validateAgainstSchema(item, itemSchema, joinPath(path, index));
                if (!result.ok) {
                    return result;
                }
            }
        }
    }

    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
        const objectValue = value as Record<string, unknown>;
        const properties = getObjectProperties(schema);
        const required = getRequiredPropertiesForValidation(schema, properties);

        for (const key of required) {
            if (!(key in objectValue)) {
                return {
                    ok: false,
                    error: `${describePath(joinPath(path, key))} is required`,
                };
            }
        }

        if (properties) {
            for (const [key, childSchema] of Object.entries(properties)) {
                if (!(key in objectValue)) {
                    continue;
                }
                const result = validateAgainstSchema(objectValue[key], childSchema, joinPath(path, key));
                if (!result.ok) {
                    return result;
                }
            }
        }

        const allowedKeys = collectAllowedObjectKeys(objectValue, schema, path);
        const isClosedObject = shouldTreatAllOfObjectAsClosed(schema);
        for (const key of Object.keys(objectValue)) {
            if (allowedKeys.has(key)) {
                continue;
            }

            if (isClosedObject) {
                return {
                    ok: false,
                    error: `${describePath(joinPath(path, key))} is not allowed`,
                };
            }

            if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
                const result = validateAgainstSchema(objectValue[key], schema.additionalProperties, joinPath(path, key));
                if (!result.ok) {
                    return result;
                }
            }
        }
    }

    return { ok: true };
}

/**
 * Process a JSON schema to make it compatible with OpenAI's strict JSON mode.
 */
function deriveRequiredProperties(
    sourceSchema: any,
    propertyNames: string[],
    mode: 'tool_parameters' | 'json_schema'
): string[] | undefined {
    if (!sourceSchema?.properties || typeof sourceSchema.properties !== 'object') {
        return undefined;
    }

    if (mode === 'tool_parameters') {
        if (Array.isArray(sourceSchema.required)) {
            const explicitlyRequired = new Set(sourceSchema.required);
            return propertyNames.filter(name => explicitlyRequired.has(name));
        }

        return propertyNames.filter(name => sourceSchema.properties?.[name]?.optional !== true);
    }

    return propertyNames;
}

export function processSchemaForOpenAI(
    schema: any,
    originalProperties?: Record<string, ToolParameter>,
    mode: 'tool_parameters' | 'json_schema' = 'tool_parameters'
): any {
    const processedSchema = JSON.parse(JSON.stringify(schema));

    const processSchemaRecursively = (currentSchema: any, sourceSchema?: any) => {
        if (!currentSchema || typeof currentSchema !== 'object') return;

        if (currentSchema.optional === true) {
            delete currentSchema.optional;
        }

        if (Array.isArray(currentSchema.oneOf)) {
            currentSchema.anyOf = currentSchema.oneOf;
            delete currentSchema.oneOf;
        }

        const variantSourceSchemas = {
            anyOf: sourceSchema?.anyOf ?? sourceSchema?.oneOf,
            allOf: sourceSchema?.allOf,
        };

        const unsupportedKeywords = [
            'minimum',
            'maximum',
            'minItems',
            'maxItems',
            'minLength',
            'maxLength',
            'pattern',
            'format',
            'multipleOf',
            'patternProperties',
            'unevaluatedProperties',
            'propertyNames',
            'minProperties',
            'maxProperties',
            'unevaluatedItems',
            'contains',
            'minContains',
            'maxContains',
            'uniqueItems',
            'default',
        ];
        unsupportedKeywords.forEach(keyword => {
            if (currentSchema[keyword] !== undefined) {
                delete currentSchema[keyword];
            }
        });

        const isObject =
            currentSchema.type === 'object' ||
            (currentSchema.type === undefined && currentSchema.properties !== undefined);

        for (const key of ['anyOf', 'allOf'] as const) {
            if (Array.isArray(currentSchema[key])) {
                currentSchema[key].forEach((variantSchema: any, index: number) =>
                    processSchemaRecursively(variantSchema, variantSourceSchemas[key]?.[index])
                );
            }
        }

        if (isObject && currentSchema.properties) {
            for (const propName in currentSchema.properties) {
                processSchemaRecursively(currentSchema.properties[propName], sourceSchema?.properties?.[propName]);
            }
        }

        if (currentSchema.type === 'array' && currentSchema.items !== undefined) {
            if (Array.isArray(currentSchema.items)) {
                currentSchema.items.forEach((itemSchema: any, index: number) =>
                    processSchemaRecursively(itemSchema, sourceSchema?.items?.[index])
                );
            } else if (typeof currentSchema.items === 'object') {
                processSchemaRecursively(currentSchema.items, sourceSchema?.items);
            }
        }

        if (isObject) {
            currentSchema.additionalProperties = false;
            if (currentSchema.properties) {
                const currentRequired = deriveRequiredProperties(
                    sourceSchema,
                    Object.keys(currentSchema.properties),
                    mode
                );
                if (currentRequired && currentRequired.length > 0) {
                    currentSchema.required = currentRequired;
                } else {
                    delete currentSchema.required;
                }
            } else {
                delete currentSchema.required;
            }
        }
    };

    processSchemaRecursively(processedSchema, schema);

    if (mode === 'tool_parameters' && originalProperties && !Array.isArray(schema?.required)) {
        const topLevelRequired = deriveRequiredProperties(
            { properties: originalProperties, required: schema?.required },
            Object.keys(originalProperties),
            mode
        );
        if (topLevelRequired && topLevelRequired.length > 0) {
            processedSchema.required = topLevelRequired;
        } else {
            delete processedSchema.required;
        }
    }

    if (processedSchema.properties && processedSchema.additionalProperties === undefined) {
        processedSchema.additionalProperties = false;
    }

    return processedSchema;
}

export function validateJsonResponseContent(
    content: string,
    schema?: Record<string, unknown>
): { ok: true; value: unknown } | { ok: false; error: string } {
    let parsed: unknown;

    try {
        parsed = JSON.parse(content);
    } catch (error) {
        return {
            ok: false,
            error: `Structured output was not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
        };
    }

    if (schema) {
        const validation = validateAgainstSchema(parsed, schema);
        if (!validation.ok) {
            return {
                ok: false,
                error: `Structured output failed schema validation: ${validation.error}`,
            };
        }
    }

    return { ok: true, value: parsed };
}
