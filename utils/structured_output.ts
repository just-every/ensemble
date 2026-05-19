import type { ResponseJSONSchema } from '../types/types.js';
import { processSchemaForOpenAI } from './json_schema.js';

type ChatResponseFormat = {
    type: 'json_schema';
    json_schema: {
        name: string;
        description?: string;
        strict?: boolean | null;
        schema: Record<string, unknown>;
    };
};

function firstSchemaType(schema: Record<string, unknown>): string | undefined {
    if (typeof schema.type === 'string') return schema.type;
    if (Array.isArray(schema.type)) {
        return schema.type.find((value): value is string => typeof value === 'string' && value !== 'null');
    }
    return undefined;
}

function exampleFromSchema(schema: unknown, depth = 0): unknown {
    if (!schema || typeof schema !== 'object' || depth > 4) return null;

    const typedSchema = schema as Record<string, any>;
    if (typedSchema.const !== undefined) return typedSchema.const;
    if (Array.isArray(typedSchema.enum) && typedSchema.enum.length > 0) return typedSchema.enum[0];

    if (Array.isArray(typedSchema.anyOf) && typedSchema.anyOf.length > 0) {
        return exampleFromSchema(typedSchema.anyOf[0], depth + 1);
    }
    if (Array.isArray(typedSchema.oneOf) && typedSchema.oneOf.length > 0) {
        return exampleFromSchema(typedSchema.oneOf[0], depth + 1);
    }

    const type = firstSchemaType(typedSchema);
    if (type === 'object' || typedSchema.properties) {
        const example: Record<string, unknown> = {};
        const properties =
            typedSchema.properties && typeof typedSchema.properties === 'object' ? typedSchema.properties : {};
        const keys = Object.keys(properties);
        const required = Array.isArray(typedSchema.required)
            ? typedSchema.required.filter((value: unknown): value is string => typeof value === 'string')
            : keys;

        for (const key of required.length > 0 ? required : keys) {
            example[key] = exampleFromSchema(properties[key], depth + 1);
        }
        return example;
    }
    if (type === 'array') return [exampleFromSchema(typedSchema.items, depth + 1)];
    if (type === 'string') return typeof typedSchema.description === 'string' ? typedSchema.description : 'string';
    if (type === 'integer') return Number.isFinite(typedSchema.minimum) ? Math.ceil(typedSchema.minimum) : 1;
    if (type === 'number') return Number.isFinite(typedSchema.minimum) ? typedSchema.minimum : 1;
    if (type === 'boolean') return true;
    if (type === 'null') return null;

    return null;
}

export function createChatJsonSchemaResponseFormat(jsonSchema: ResponseJSONSchema): ChatResponseFormat {
    const { type: _type, schema, ...jsonSchemaConfig } = jsonSchema;

    return {
        type: 'json_schema',
        json_schema: {
            ...jsonSchemaConfig,
            schema: processSchemaForOpenAI(schema, undefined, 'json_schema'),
        },
    };
}

export function getJsonSchemaFromResponseFormat(responseFormat: unknown): ResponseJSONSchema | undefined {
    if (!responseFormat || typeof responseFormat !== 'object') return undefined;

    const typedFormat = responseFormat as { type?: unknown; json_schema?: unknown };
    if (typedFormat.type !== 'json_schema' || !typedFormat.json_schema || typeof typedFormat.json_schema !== 'object') {
        return undefined;
    }

    const jsonSchema = typedFormat.json_schema as ResponseJSONSchema;
    if (!jsonSchema.schema || typeof jsonSchema.schema !== 'object') return undefined;
    return jsonSchema;
}

export function createJsonSchemaInstruction(jsonSchema: ResponseJSONSchema): string {
    const example = exampleFromSchema(jsonSchema.schema);

    return [
        'Respond only with valid JSON.',
        'Do not include markdown fences, prose, comments, or any text outside the JSON value.',
        'The response must match this JSON Schema:',
        JSON.stringify(jsonSchema.schema, null, 2),
        'Example JSON output:',
        JSON.stringify(example, null, 2),
    ].join('\n');
}

export function appendJsonSchemaInstruction<T>(messages: T[], jsonSchema: ResponseJSONSchema): T[] {
    return [
        ...messages,
        {
            role: 'system',
            content: createJsonSchemaInstruction(jsonSchema),
        } as T,
    ];
}
