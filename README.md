# @just-every/ensemble

[![npm version](https://badge.fury.io/js/@just-every%2Fensemble.svg)](https://www.npmjs.com/package/@just-every/ensemble)
[![GitHub Actions](https://github.com/just-every/ensemble/workflows/Release/badge.svg)](https://github.com/just-every/ensemble/actions)

A unified interface for interacting with multiple LLM providers including OpenAI, Anthropic Claude, Google Gemini, Deepseek, Grok, and OpenRouter.

## Why Use an Ensemble Approach?

The ensemble pattern - rotating between multiple LLM providers dynamically - offers compelling advantages over relying on a single model. Research has shown that sampling multiple reasoning chains and using consensus answers can improve performance by double-digit margins on complex tasks. By automating this at runtime rather than prompt-engineering time, ensemble delivers more reliable and robust AI interactions.

Beyond accuracy improvements, ensemble requests provide practical benefits for production systems. Different models carry unique training biases and stylistic patterns - rotating between them dilutes individual quirks and prevents conversations from getting "stuck" in one voice. The approach also ensures resilience: when one provider experiences an outage, quota limit, or latency spike, requests seamlessly route to alternatives. You can optimize costs by routing simple tasks to cheaper models while reserving premium models for complex reasoning. Need regex help? Route to a code-specialized model. Need emotional calibration? Use a dialogue expert. The ensemble gives you this granularity without complex conditional logic.

Perhaps most importantly, the ensemble approach future-proofs your application. Model quality and pricing change weekly in the fast-moving LLM landscape. With ensemble, you can trial newcomers on a small percentage of traffic, compare real metrics, then scale up or roll back within minutes - all without changing your code.

## Features

- **Multi-provider support**: Claude, OpenAI, Gemini, Deepseek, Grok, OpenRouter
- **AsyncGenerator API**: Clean, native async iteration for streaming responses
- **Simple interface**: Direct async generator pattern matches native LLM APIs
- **Tool calling**: Function calling support where available
- **Stream conversion**: Convert streaming events to conversation history for chaining
- **Image processing**: Image-to-text and image utilities
- **Cost tracking**: Token usage and cost monitoring
- **Quota management**: Rate limiting and usage tracking
- **Pluggable logging**: Configurable request/response logging
- **Type safety**: Full TypeScript support

## Installation

```bash
npm install @just-every/ensemble
```

## Quick Start

```typescript
import { request } from '@just-every/ensemble';

// Simple request with AsyncGenerator API
const stream = request('claude-3-5-sonnet-20241022', [
  { type: 'message', role: 'user', content: 'Hello, world!' }
]);

// Process streaming events
for await (const event of stream) {
  if (event.type === 'message_delta') {
    console.log(event.content);
  } else if (event.type === 'message_complete') {
    console.log('Request completed!');
  } else if (event.type === 'error') {
    console.error('Request failed:', event.error);
  }
}

// With tools
const toolStream = request('gpt-4o', [
  { type: 'message', role: 'user', content: 'What is the weather?' }
], {
  tools: [{
    function: async (location: string) => {
      // Tool implementation
      return `Weather in ${location}: Sunny, 72°F`;
    },
    definition: {
      type: 'function',
      function: {
        name: 'get_weather',
        description: 'Get current weather',
        parameters: {
          type: 'object',
          properties: {
            location: { type: 'string' }
          },
          required: ['location']
        }
      }
    }
  }]
});

// Process tool calls
for await (const event of toolStream) {
  if (event.type === 'tool_start') {
    console.log('Tool called:', event.tool_calls[0].function.name);
  } else if (event.type === 'message_delta') {
    console.log(event.content);
  }
}

// Early termination
const earlyStream = request('claude-3-5-sonnet-20241022', [
  { type: 'message', role: 'user', content: 'Count to 100' }
]);

let count = 0;
for await (const event of earlyStream) {
  if (event.type === 'message_delta') {
    count++;
    if (count >= 10) break; // Stop after 10 events
  }
}
```

## API Reference

### Core Functions

#### `request(model, messages, options?)`

Main function for making LLM requests with streaming responses and automatic tool execution.

**Parameters:**
- `model` (string): Model identifier (e.g., 'gpt-4o', 'claude-3.5-sonnet', 'gemini-2.0-flash')
- `messages` (ResponseInput): Array of message objects in the conversation
- `options` (RequestOptions): Optional configuration object

**Returns:** `AsyncGenerator<EnsembleStreamEvent>` - An async generator that yields streaming events

```typescript
interface RequestOptions {
  agentId?: string;              // Identifier for logging/tracking
  tools?: ToolFunction[];         // Array of tool definitions
  toolChoice?: ToolChoice;        // Control tool selection behavior
  maxToolCalls?: number;          // Max rounds of tool execution (default: 10, 0 = disabled)
  processToolCall?: (toolCalls: ToolCall[]) => Promise<any>; // Custom tool handler
  modelSettings?: ModelSettings;  // Temperature, maxTokens, etc.
  modelClass?: ModelClassID;      // 'standard' | 'code' | 'reasoning' | 'monologue'
  responseFormat?: ResponseFormat; // JSON mode or structured output
  maxImageDimension?: number;     // Auto-resize images (default: provider-specific)
  fallbackModels?: string[];      // Models to try if primary fails
}

// Stream event types
type EnsembleStreamEvent = 
  | { type: 'text_delta', delta: string }
  | { type: 'text', text: string }
  | { type: 'message_delta', content: string }
  | { type: 'message_complete', content: string }
  | { type: 'tool_start', tool_calls: ToolCall[] }
  | { type: 'cost_update', usage: TokenUsage }
  | { type: 'stream_end', timestamp: string }
  | { type: 'error', error: Error };
```


### Working with Models

#### Model Selection

```typescript
import { getModelFromClass, findModel, MODEL_REGISTRY } from '@just-every/ensemble';

// Get best model for a specific task type
const codeModel = getModelFromClass('code');      // Returns best available code model
const reasoningModel = getModelFromClass('reasoning'); // For complex reasoning tasks

// Check if a model exists
const modelInfo = findModel('gpt-4o');
if (modelInfo) {
  console.log(`Provider: ${modelInfo.provider}`);
  console.log(`Input cost: $${modelInfo.inputCost}/million tokens`);
}

// List all available models
for (const [modelName, info] of Object.entries(MODEL_REGISTRY)) {
  console.log(`${modelName}: ${info.provider}`);
}
```

#### Model Classes

- **standard**: General-purpose models for everyday tasks
- **code**: Optimized for programming and technical tasks
- **reasoning**: Advanced models for complex logical reasoning
- **monologue**: Models supporting extended thinking/reasoning traces

### Message Types

```typescript
// User/Assistant messages
interface TextMessage {
  type: 'message';
  role: 'user' | 'assistant' | 'developer';
  content: string | MessageContent[];
  status?: 'completed' | 'in_progress';
}

// Multi-modal content
type MessageContent = 
  | { type: 'input_text', text: string }
  | { type: 'input_image', image_url: string, detail?: 'auto' | 'low' | 'high' }
  | { type: 'tool_use', id: string, name: string, arguments: any };

// Tool-related messages
interface FunctionCall {
  type: 'function_call';
  id: string;
  name: string;
  arguments: string;
}

interface FunctionCallOutput {
  type: 'function_call_output';
  id: string;
  output: string;
}
```

## Common Use Cases

### 1. Basic Conversations

```typescript
import { request } from '@just-every/ensemble';

// Simple Q&A
for await (const event of request('gpt-4o-mini', [
  { type: 'message', role: 'user', content: 'Explain quantum computing in simple terms' }
])) {
  if (event.type === 'text_delta') {
    process.stdout.write(event.delta);
  }
}

// Multi-turn conversation
const messages = [
  { type: 'message', role: 'developer', content: 'You are a helpful coding assistant' },
  { type: 'message', role: 'user', content: 'How do I center a div in CSS?' },
  { type: 'message', role: 'assistant', content: 'Here are several ways...' },
  { type: 'message', role: 'user', content: 'What about using flexbox?' }
];

for await (const event of request('claude-3.5-sonnet', messages)) {
  // Handle streaming response
}
```

### 2. Tool Calling & Function Execution

```typescript
// Define tools with TypeScript types
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

// Use with automatic execution
for await (const event of request('gpt-4o', [
  { type: 'message', role: 'user', content: 'What\'s the weather in Tokyo and New York?' }
], { tools: [weatherTool] })) {
  if (event.type === 'tool_start') {
    console.log('Calling tool:', event.tool_calls[0].function.name);
  } else if (event.type === 'text_delta') {
    process.stdout.write(event.delta);
  }
}
```

### 3. Model Selection Strategies

```typescript
import { getModelFromClass, request } from '@just-every/ensemble';

// Route based on task type
async function intelligentRequest(task: string, messages: ResponseInput) {
  let model: string;
  
  if (task.includes('code') || task.includes('debug')) {
    model = getModelFromClass('code'); // Best code model
  } else if (task.includes('analyze') || task.includes('reasoning')) {
    model = getModelFromClass('reasoning'); // Best reasoning model
  } else {
    model = getModelFromClass('standard'); // Cost-effective general model
  }
  
  console.log(`Using ${model} for ${task}`);
  
  return request(model, messages, {
    fallbackModels: ['gpt-4o-mini', 'claude-3-5-haiku'] // Fallback options
  });
}

// Use model rotation for consensus
async function consensusRequest(messages: ResponseInput) {
  const models = ['gpt-4o', 'claude-3.5-sonnet', 'gemini-2.0-flash'];
  const responses = [];
  
  for (const model of models) {
    const stream = request(model, messages);
    const result = await convertStreamToMessages(stream);
    responses.push(result.fullResponse);
  }
  
  // Analyze responses for consensus
  return analyzeConsensus(responses);
}
```

### 4. Structured Output & JSON Mode

```typescript
// JSON mode for reliable parsing
const jsonStream = request('gpt-4o', [
  { type: 'message', role: 'user', content: 'List 3 programming languages with their pros/cons as JSON' }
], {
  responseFormat: { type: 'json_object' }
});

let jsonContent = '';
for await (const event of jsonStream) {
  if (event.type === 'text_delta') {
    jsonContent += event.delta;
  }
}

const data = JSON.parse(jsonContent);

// Structured output with schema validation
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

const structuredStream = request('gpt-4o', [
  { type: 'message', role: 'user', content: 'Generate a developer profile' }
], {
  responseFormat: {
    type: 'json_schema',
    json_schema: {
      name: 'developer_profile',
      schema: schema,
      strict: true
    }
  }
});
```

### 5. Image Processing

```typescript
// Analyze images with vision models
const imageStream = request('gpt-4o', [
  {
    type: 'message',
    role: 'user',
    content: [
      { type: 'input_text', text: 'What\'s in this image? Describe any text you see.' },
      { 
        type: 'input_image', 
        image_url: 'data:image/jpeg;base64,...',
        detail: 'high' // 'auto' | 'low' | 'high'
      }
    ]
  }
], {
  maxImageDimension: 2048 // Auto-resize large images
});

// Multiple images
const comparison = request('claude-3.5-sonnet', [
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

### 6. Error Handling & Resilience

```typescript
import { isRateLimitError, isAuthenticationError } from '@just-every/ensemble';

async function robustRequest(model: string, messages: ResponseInput, options?: RequestOptions) {
  const maxRetries = 3;
  let lastError;
  
  for (let i = 0; i < maxRetries; i++) {
    try {
      const events = [];
      for await (const event of request(model, messages, options)) {
        if (event.type === 'error') {
          throw event.error;
        }
        events.push(event);
      }
      return events;
      
    } catch (error) {
      lastError = error;
      
      if (isAuthenticationError(error)) {
        throw error; // Don't retry auth errors
      }
      
      if (isRateLimitError(error)) {
        const waitTime = error.retryAfter || Math.pow(2, i) * 1000;
        console.log(`Rate limited. Waiting ${waitTime}ms...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
        continue;
      }
      
      // Try fallback model
      if (options?.fallbackModels?.[i]) {
        model = options.fallbackModels[i];
        console.log(`Falling back to ${model}`);
        continue;
      }
    }
  }
  
  throw lastError;
}
```

## Utilities

### Cost & Usage Tracking

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

### Stream Conversion & Chaining

```typescript
import { convertStreamToMessages, chainRequests } from '@just-every/ensemble';

// Convert stream to conversation history
const stream = request('claude-3.5-sonnet', [
  { type: 'message', role: 'user', content: 'Write a haiku about coding' }
]);

const result = await convertStreamToMessages(stream);
console.log(result.messages);     // Full conversation history
console.log(result.fullResponse); // Just the assistant's response

// Chain multiple models for multi-step tasks
const analysis = await chainRequests([
  {
    model: getModelFromClass('code'),
    systemPrompt: 'Analyze this code for bugs and security issues',
  },
  {
    model: getModelFromClass('reasoning'),
    systemPrompt: 'Prioritize the issues found and suggest fixes',
  },
  {
    model: 'gpt-4o-mini',
    systemPrompt: 'Summarize the analysis in 3 bullet points',
  }
], [
  { type: 'message', role: 'user', content: codeToAnalyze }
]);
```

### Image Utilities

```typescript
import { resizeImageForModel, imageToText } from '@just-every/ensemble';

// Auto-resize for specific model requirements
const resized = await resizeImageForModel(
  base64ImageData,
  'gpt-4o', // Different models have different size limits
  { maxDimension: 2048 }
);

// Extract text from images
const extractedText = await imageToText(imageBuffer);
console.log('Found text:', extractedText);
```

### Logging & Debugging

```typescript
import { setEnsembleLogger, EnsembleLogger } from '@just-every/ensemble';

// Production-ready logger example
class ProductionLogger implements EnsembleLogger {
  log_llm_request(agentId: string, providerName: string, model: string, requestData: unknown, timestamp?: Date): string {
    const requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    // Log to your monitoring system
    logger.info('LLM Request', {
      requestId,
      agentId,
      provider: providerName,
      model,
      timestamp,
      // Be careful not to log sensitive data
      messageCount: (requestData as any).messages?.length,
      hasTools: !!(requestData as any).tools?.length
    });
    
    return requestId;
  }

  log_llm_response(requestId: string | undefined, responseData: unknown, timestamp?: Date): void {
    const response = responseData as any;
    
    logger.info('LLM Response', {
      requestId,
      timestamp,
      inputTokens: response.usage?.input_tokens,
      outputTokens: response.usage?.output_tokens,
      totalCost: response.usage?.total_cost,
      cached: response.usage?.cache_creation_input_tokens > 0
    });
  }

  log_llm_error(requestId: string | undefined, errorData: unknown, timestamp?: Date): void {
    logger.error('LLM Error', {
      requestId,
      timestamp,
      error: errorData,
      // Include retry information if available
      retryAfter: (errorData as any).retryAfter
    });
  }
}

// Enable logging globally
setEnsembleLogger(new ProductionLogger());

// Debug mode for development
if (process.env.NODE_ENV === 'development') {
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
}
```

## Advanced Topics

### Custom Model Providers

```typescript
import { ModelProvider, registerExternalModel } from '@just-every/ensemble';

// Register a custom model
registerExternalModel({
  id: 'my-custom-model',
  provider: 'custom',
  inputCost: 0.001,
  outputCost: 0.002,
  contextWindow: 8192,
  maxOutput: 4096,
  supportsTools: true,
  supportsVision: false,
  supportsStreaming: true
});

// Use your custom model
const stream = request('my-custom-model', messages);
```

### Performance Optimization

```typescript
// Batch processing with concurrency control
async function batchProcess(items: string[], concurrency = 3) {
  const results = [];
  const queue = [...items];
  
  async function worker() {
    while (queue.length > 0) {
      const item = queue.shift()!;
      const stream = request('gpt-4o-mini', [
        { type: 'message', role: 'user', content: `Process: ${item}` }
      ]);
      
      const result = await convertStreamToMessages(stream);
      results.push({ item, result: result.fullResponse });
    }
  }
  
  // Run workers concurrently
  await Promise.all(Array(concurrency).fill(null).map(() => worker()));
  return results;
}

// Stream multiple requests in parallel
async function parallelStreaming(prompts: string[]) {
  const streams = prompts.map(prompt => 
    request('claude-3.5-haiku', [
      { type: 'message', role: 'user', content: prompt }
    ])
  );
  
  // Process all streams concurrently
  const results = await Promise.all(
    streams.map(stream => convertStreamToMessages(stream))
  );
  
  return results.map(r => r.fullResponse);
}
```

## Environment Variables

Set up API keys for the providers you want to use:

```bash
ANTHROPIC_API_KEY=your_key_here
OPENAI_API_KEY=your_key_here
GOOGLE_API_KEY=your_key_here
DEEPSEEK_API_KEY=your_key_here
XAI_API_KEY=your_key_here
OPENROUTER_API_KEY=your_key_here
```

## License

MIT
