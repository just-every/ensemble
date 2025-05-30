import { z } from 'zod';
import { ModelProviderID, ModelClassID, ToolParameterType } from './types.js';

/**
 * Validation schemas for Ensemble types using Zod
 */

// Tool parameter schemas
export const ToolParameterTypeSchema = z.enum([
  'string',
  'number',
  'boolean',
  'object',
  'array',
  'null'
] as const);

export const ToolParameterSchema: z.ZodType<any> = z.lazy(() =>
  z.object({
    type: ToolParameterTypeSchema.optional(),
    description: z.union([z.string(), z.function()]).optional(),
    enum: z.union([
      z.array(z.string()),
      z.function().returns(z.promise(z.array(z.string())))
    ]).optional(),
    items: z.union([
      ToolParameterSchema,
      z.object({
        type: ToolParameterTypeSchema,
        enum: z.union([
          z.array(z.string()),
          z.function().returns(z.promise(z.array(z.string())))
        ]).optional()
      })
    ]).optional(),
    properties: z.record(z.string(), ToolParameterSchema).optional(),
    required: z.array(z.string()).optional(),
    optional: z.boolean().optional(),
    minItems: z.number().optional(),
    additionalProperties: z.boolean().optional(),
    default: z.unknown().optional(),
    minimum: z.number().optional(),
    maximum: z.number().optional(),
    minLength: z.number().optional(),
    maxLength: z.number().optional(),
    pattern: z.string().optional()
  }).strict()
);

export const ToolDefinitionSchema = z.object({
  type: z.literal('function'),
  function: z.object({
    name: z.string().regex(/^[a-zA-Z0-9_-]+$/, 'Tool name must be alphanumeric with underscores and dashes'),
    description: z.string().min(1, 'Tool description is required'),
    parameters: z.object({
      type: z.literal('object'),
      properties: z.record(z.string(), ToolParameterSchema),
      required: z.array(z.string())
    })
  })
});

// Message content schemas
export const ResponseContentTextSchema = z.object({
  type: z.literal('input_text'),
  text: z.string()
});

export const ResponseContentImageSchema = z.object({
  type: z.literal('input_image'),
  detail: z.enum(['high', 'low', 'auto']),
  file_id: z.string().optional(),
  image_url: z.string().url().optional()
});

export const ResponseContentFileInputSchema = z.object({
  type: z.literal('input_file'),
  file_data: z.string().optional(),
  file_id: z.string().optional(),
  filename: z.string().optional()
});

export const ResponseContentSchema = z.union([
  z.string(),
  z.array(z.union([
    ResponseContentTextSchema,
    ResponseContentImageSchema,
    ResponseContentFileInputSchema
  ]))
]);

// Message schemas
export const ResponseInputMessageSchema = z.object({
  type: z.literal('message'),
  name: z.string().optional(),
  content: ResponseContentSchema,
  role: z.enum(['user', 'system', 'developer']),
  status: z.enum(['in_progress', 'completed', 'incomplete']).optional(),
  model: z.string().optional(),
  timestamp: z.number().optional()
});

export const ResponseThinkingMessageSchema = z.object({
  type: z.literal('thinking'),
  content: ResponseContentSchema,
  signature: ResponseContentSchema.optional(),
  thinking_id: z.string().optional(),
  role: z.literal('assistant'),
  status: z.enum(['in_progress', 'completed', 'incomplete']).optional(),
  model: z.string().optional(),
  timestamp: z.number().optional()
});

export const ResponseOutputMessageSchema = z.object({
  id: z.string().optional(),
  type: z.literal('message'),
  content: ResponseContentSchema,
  role: z.literal('assistant'),
  status: z.enum(['in_progress', 'completed', 'incomplete']),
  model: z.string().optional(),
  timestamp: z.number().optional()
});

export const ResponseInputFunctionCallSchema = z.object({
  type: z.literal('function_call'),
  call_id: z.string(),
  name: z.string(),
  arguments: z.string(),
  id: z.string().optional(),
  status: z.enum(['in_progress', 'completed', 'incomplete']).optional(),
  model: z.string().optional(),
  timestamp: z.number().optional()
});

export const ResponseInputFunctionCallOutputSchema = z.object({
  type: z.literal('function_call_output'),
  call_id: z.string(),
  name: z.string().optional(),
  output: z.string(),
  id: z.string().optional(),
  status: z.enum(['in_progress', 'completed', 'incomplete']).optional(),
  model: z.string().optional(),
  timestamp: z.number().optional()
});

export const ResponseInputSchema = z.array(z.union([
  ResponseInputMessageSchema,
  ResponseThinkingMessageSchema,
  ResponseOutputMessageSchema,
  ResponseInputFunctionCallSchema,
  ResponseInputFunctionCallOutputSchema
]));

// Model and provider schemas
export const ModelProviderIDSchema = z.enum([
  'openai',
  'anthropic',
  'google',
  'xai',
  'deepseek',
  'openrouter',
  'test'
] as const);

export const ModelClassIDSchema = z.enum([
  'standard',
  'mini',
  'reasoning',
  'reasoning_mini',
  'monologue',
  'metacognition',
  'code',
  'writing',
  'summary',
  'vision',
  'vision_mini',
  'search',
  'image_generation',
  'embedding'
] as const);

// Options schemas
export const ModelSettingsSchema = z.object({
  temperature: z.number().min(0).max(2).optional(),
  top_p: z.number().min(0).max(1).optional(),
  top_k: z.number().positive().optional(),
  max_tokens: z.number().positive().optional(),
  stop_sequence: z.string().optional(),
  seed: z.number().optional(),
  text: z.object({ format: z.string() }).optional(),
  tool_choice: z.union([
    z.literal('auto'),
    z.literal('none'),
    z.literal('required'),
    z.object({
      type: z.string(),
      function: z.object({ name: z.string() })
    })
  ]).optional(),
  sequential_tools: z.boolean().optional(),
  json_schema: z.object({
    name: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/, 'Invalid schema name'),
    schema: z.record(z.unknown()),
    type: z.literal('json_schema'),
    description: z.string().optional(),
    strict: z.boolean().nullable().optional()
  }).optional(),
  force_json: z.boolean().optional()
});

// Request validation
export const RequestOptionsSchema = z.object({
  model: z.string().min(1, 'Model name is required'),
  messages: ResponseInputSchema,
  temperature: z.number().min(0).max(2).optional(),
  max_tokens: z.number().positive().optional(),
  top_p: z.number().min(0).max(1).optional(),
  stream: z.boolean().optional(),
  tools: z.array(ToolDefinitionSchema).optional(),
  tool_choice: z.union([
    z.literal('auto'),
    z.literal('none'),
    z.literal('required'),
    z.object({
      type: z.literal('function'),
      function: z.object({ name: z.string() })
    })
  ]).optional()
});

// API response validation helpers
export const validateAPIResponse = <T>(
  schema: z.ZodSchema<T>,
  data: unknown,
  context: string
): T => {
  try {
    return schema.parse(data);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const issues = error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ');
      throw new Error(`${context} validation failed: ${issues}`);
    }
    throw error;
  }
};

// Stream event validation
export const StreamEventTypeSchema = z.enum([
  'connected',
  'command_start',
  'command_done',
  'project_create',
  'project_update',
  'process_start',
  'process_running',
  'process_updated',
  'process_done',
  'process_failed',
  'process_waiting',
  'process_terminated',
  'agent_start',
  'agent_updated',
  'agent_done',
  'agent_status',
  'message_start',
  'message_delta',
  'message_complete',
  'talk_start',
  'talk_delta',
  'talk_complete',
  'audio_stream',
  'tool_start',
  'tool_delta',
  'tool_done',
  'file_start',
  'file_delta',
  'file_complete',
  'cost_update',
  'system_status',
  'system_update',
  'quota_update',
  'screenshot',
  'design_grid',
  'console',
  'error',
  'tool_wait_start',
  'tool_waiting',
  'tool_wait_complete',
  'task_wait_start',
  'task_waiting',
  'task_wait_complete',
  'git_pull_request',
  'stream_end'
] as const);

// Usage validation
export const ModelUsageSchema = z.object({
  model: z.string(),
  cost: z.number().optional(),
  input_tokens: z.number().nonnegative().optional(),
  output_tokens: z.number().nonnegative().optional(),
  cached_tokens: z.number().nonnegative().optional(),
  image_count: z.number().nonnegative().optional(),
  metadata: z.record(z.unknown()).optional(),
  timestamp: z.date().optional(),
  isFreeTierUsage: z.boolean().optional()
});

// Helper functions for common validations
export const validateModel = (model: string): string => {
  return z.string().min(1, 'Model name cannot be empty').parse(model);
};

export const validateMessages = (messages: unknown): unknown => {
  return ResponseInputSchema.parse(messages);
};

export const validateTools = (tools: unknown): unknown => {
  return z.array(ToolDefinitionSchema).parse(tools);
};

export const validateTemperature = (temperature?: number): number | undefined => {
  if (temperature === undefined) return undefined;
  return z.number().min(0).max(2).parse(temperature);
};

export const validateMaxTokens = (maxTokens?: number): number | undefined => {
  if (maxTokens === undefined) return undefined;
  return z.number().positive().int().parse(maxTokens);
};