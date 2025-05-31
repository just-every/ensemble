# Advanced Usage

## Tool Calling & Function Execution

### Using createToolFunction (Recommended)

The easiest way to create tools is with the `createToolFunction` utility:

```typescript
import { createToolFunction } from '@just-every/ensemble';

// Simple weather tool - types are preserved
const weatherTool = createToolFunction(
  async (city: string, unit = 'celsius') => {
    // Real implementation would call weather API
    const temp = unit === 'celsius' ? 22 : 72;
    return `${temp}°${unit[0].toUpperCase()} in ${city}`;
  },
  'Get current weather for a city',
  {
    city: 'The city to get weather for',
    unit: {
      type: 'string',
      description: 'Temperature unit',
      enum: ['celsius', 'fahrenheit'],
      optional: true
    }
  }
);

// Even simpler - let it infer everything
const timeTool = createToolFunction(
  async () => new Date().toLocaleTimeString(),
  'Get the current time'
);

// Complex tool with multiple parameter types
const searchTool = createToolFunction(
  async (query: string, limit = 10, filters = {}) => {
    // Implementation
    return `Found ${limit} results for "${query}"`;
  },
  'Search for information',
  {
    query: 'Search query',
    limit: {
      type: 'number',
      description: 'Max results',
      optional: true
    },
    filters: {
      type: 'object',
      description: 'Search filters',
      optional: true
    }
  }
);

// Tool with special parameters (automatically injected)
const contextAwareTool = createToolFunction(
  async (query: string, inject_agent_id: string, abort_signal?: AbortSignal) => {
    // inject_agent_id is automatically provided by the system
    // abort_signal allows cancellation of long-running operations
    if (abort_signal?.aborted) {
      return 'Operation cancelled';
    }
    return `Agent ${inject_agent_id} processed: ${query}`;
  },
  'Context-aware tool',
  {
    query: 'The query to process'
  }
);

// Tool with variable arguments
const commandTool = createToolFunction(
  async (command: string, ...args: string[]) => {
    return `Executed: ${command} ${args.join(' ')}`;
  },
  'Execute command with arguments'
);
```

### Manual Tool Definition

For more control, you can define tools manually:

```typescript
interface WeatherParams {
  city: string;
  unit?: 'celsius' | 'fahrenheit';
}

const weatherTool: ToolFunction = {
  function: async ({ city, unit = 'celsius' }: WeatherParams) => {
    // Real implementation would call weather API
    const temp = unit === 'celsius' ? 22 : 72;
    return `${temp}°${unit[0].toUpperCase()} in ${city}`;
  },
  definition: {
    type: 'function',
    function: {
      name: 'get_weather',
      description: 'Get current weather for a city',
      parameters: {
        type: 'object',
        properties: {
          city: { type: 'string', description: 'City name' },
          unit: { 
            type: 'string', 
            enum: ['celsius', 'fahrenheit'],
            description: 'Temperature unit'
          }
        },
        required: ['city']
      }
    }
  }
};
```

### Using Tools

```typescript
const stream = request('gpt-4o', [
  { type: 'message', role: 'user', content: 'What\'s the weather in Tokyo?' }
], { tools: [weatherTool] });

for await (const event of stream) {
  if (event.type === 'tool_start') {
    console.log('Calling tool:', event.tool_calls[0].function.name);
  } else if (event.type === 'text_delta') {
    process.stdout.write(event.delta);
  }
}
```

### Disabling Tool Execution

```typescript
// Send tools to model but handle execution manually
const stream = request('claude-3.5-sonnet', messages, {
  tools: [weatherTool],
  maxToolCalls: 0  // Disable automatic execution
});
```

## Structured Output & JSON Mode

### JSON Mode

```typescript
const stream = request('gpt-4o', [
  { type: 'message', role: 'user', content: 'List 3 programming languages as JSON' }
], {
  modelSettings: {
    force_json: true
  }
});

let jsonContent = '';
for await (const event of stream) {
  if (event.type === 'text_delta') {
    jsonContent += event.delta;
  }
}

const data = JSON.parse(jsonContent);
```

### Structured Output with Schema

```typescript
const schema = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    age: { type: 'number' },
    skills: { 
      type: 'array',
      items: { type: 'string' }
    }
  },
  required: ['name', 'age', 'skills']
};

const stream = request('gpt-4o', [
  { type: 'message', role: 'user', content: 'Generate a developer profile' }
], {
  modelSettings: {
    json_schema: {
      name: 'developer_profile',
      schema: schema,
      strict: true
    }
  }
});
```

## Image Processing

### Analyzing Images

```typescript
const stream = request('gpt-4o', [
  {
    type: 'message',
    role: 'user',
    content: [
      { type: 'input_text', text: 'What\'s in this image?' },
      { 
        type: 'input_image', 
        image_url: 'data:image/jpeg;base64,...',
        detail: 'high'
      }
    ]
  }
], {
  modelSettings: {
    max_image_dimension: 2048  // Auto-resize large images
  }
});
```

### Multiple Images

```typescript
const stream = request('claude-3.5-sonnet', [
  {
    type: 'message',
    role: 'user',
    content: [
      { type: 'input_text', text: 'Compare these two designs:' },
      { type: 'input_image', image_url: 'https://example.com/design1.png' },
      { type: 'input_image', image_url: 'https://example.com/design2.png' }
    ]
  }
]);
```

## Cost & Usage Tracking

```typescript
import { costTracker, quotaTracker } from '@just-every/ensemble';

// Track costs across requests
for await (const event of request('gpt-4o', messages)) {
  if (event.type === 'cost_update') {
    console.log(`Tokens: ${event.usage.input_tokens} in, ${event.usage.output_tokens} out`);
    console.log(`Cost: $${event.usage.total_cost.toFixed(4)}`);
  }
}

// Get cumulative costs
const usage = costTracker.getAllUsage();
for (const [model, stats] of Object.entries(usage)) {
  console.log(`${model}: $${stats.total_cost.toFixed(2)} for ${stats.request_count} requests`);
}

// Check quotas before making requests
if (quotaTracker.canMakeRequest('gpt-4o', 'openai')) {
  // Safe to proceed
} else {
  const resetTime = quotaTracker.getResetTime('openai');
  console.log(`Quota exceeded. Resets at ${resetTime}`);
}
```

## Logging & Debugging

```typescript
import { setEnsembleLogger } from '@just-every/ensemble';

// Simple console logger
setEnsembleLogger({
  log_llm_request: (agent, provider, model, data) => {
    console.log(`[${new Date().toISOString()}] → ${provider}/${model}`);
    return Date.now().toString();
  },
  log_llm_response: (id, data) => {
    const response = data as any;
    console.log(`[${new Date().toISOString()}] ← ${response.usage?.total_tokens} tokens`);
  },
  log_llm_error: (id, error) => {
    console.error(`[${new Date().toISOString()}] ✗ Error:`, error);
  }
});
```