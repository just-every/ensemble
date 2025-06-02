# Ensemble AI - Clean API Guide

This document describes the clean, unified API for the Ensemble AI package.

## Core Request Function

The library provides a single, unified `request()` function that handles all use cases:

```typescript
import { request } from '@just-every/ensemble';

// Simple usage
for await (const event of request('gpt-4o-mini', messages)) {
  if (event.type === 'text_delta') {
    process.stdout.write(event.delta);
  }
}

// With tools
const tools = [weatherTool, calculatorTool];
for await (const event of request('gpt-4o-mini', messages, { tools })) {
  // Tools are automatically executed
}

// Advanced usage with enhanced features
for await (const event of request('gpt-4o-mini', messages, {
  tools,
  useEnhancedMode: true,
  toolHandler: {
    onToolCall: async (call) => {
      console.log('Tool called:', call.function.name);
      return ToolCallAction.EXECUTE;
    }
  },
  loop: {
    maxIterations: 5,
    continueCondition: (ctx) => !ctx.getMetadata('complete')
  }
})) {
  // Handle events with enhanced features
}
```

## Message History Management

Use `MessageHistory` to properly manage conversation state:

```typescript
import { MessageHistory } from '@just-every/ensemble';

const history = new MessageHistory([], {
  maxMessages: 50,
  preserveSystemMessages: true,
  compactToolCalls: true
});

// Add messages
history.add({
  type: 'message',
  role: 'user',
  content: 'Hello!'
});

// Use with request
for await (const event of request('gpt-4o-mini', history.getMessages(), {
  messageHistory: history  // Automatic history management
})) {
  // History is automatically updated
}
```

## Tool Creation

Use the fluent tool builder for easy tool creation:

```typescript
import { tool } from '@just-every/ensemble';

const weatherTool = tool('get_weather')
  .description('Get current weather for a location')
  .string('location', 'City and state/country')
  .enum('units', ['celsius', 'fahrenheit'], 'Temperature units', false)
  .hasSideEffects()
  .implement(async ({ location, units = 'celsius' }) => {
    // Implementation
    return `Weather in ${location}: 22°${units[0].toUpperCase()}`;
  })
  .build();
```

## Control Tools

Pre-built tools for common control patterns:

```typescript
import { createControlTools } from '@just-every/ensemble';

const controlTools = createControlTools({
  onComplete: (result) => {
    console.log('Task completed:', result);
  },
  onError: (error) => {
    console.error('Task error:', error);
  },
  onClarification: (question, options) => {
    console.log('Clarification needed:', question);
  }
});

// Use with request
for await (const event of request('gpt-4o-mini', messages, {
  tools: [...myTools, ...controlTools]
})) {
  // Control tools handle task completion, errors, and clarifications
}
```

## Error Handling

Unified error handling with retry logic:

```typescript
import { EnsembleErrorHandler, ErrorCode } from '@just-every/ensemble';

// Wrap operations with retry logic
try {
  const result = await EnsembleErrorHandler.handleWithRetry(
    async () => {
      // Your operation
      return await someApiCall();
    },
    3, // max retries
    (error) => error.code === ErrorCode.PROVIDER_RATE_LIMIT
  );
} catch (error) {
  console.error('Failed after retries:', 
    EnsembleErrorHandler.getUserMessage(error)
  );
}
```

## Image Generation

```typescript
import { image } from '@just-every/ensemble';

const result = await image('A beautiful sunset over mountains', {
  model: 'dall-e-3',
  size: 'landscape',
  quality: 'hd',
  n: 1
});

console.log(`Generated ${result.images.length} images`);
```

## Embeddings

```typescript
import { embed } from '@just-every/ensemble';

const embedding = await embed('Text to embed', {
  model: 'text-embedding-3-large'
});

console.log(`Embedding dimension: ${embedding.length}`);
```

## OpenAI Compatibility

Drop-in replacement for OpenAI SDK:

```typescript
import OpenAI from '@just-every/ensemble';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// Works exactly like OpenAI SDK
const completion = await openai.chat.completions.create({
  model: 'gpt-4o-mini',
  messages: [{ role: 'user', content: 'Hello!' }]
});
```

## Key Features

1. **Single Entry Point**: One `request()` function for all use cases
2. **Progressive Enhancement**: Start simple, add features as needed
3. **Automatic Tool Execution**: Tools are executed by default
4. **Message History Management**: Prevents loops and duplicates
5. **Type Safety**: Full TypeScript support with proper types
6. **Error Handling**: Unified error handling with retry logic
7. **Provider Agnostic**: Works with all supported providers

## Options Reference

### Basic Options

- `tools`: Array of tool functions
- `maxToolCalls`: Maximum number of tool execution rounds (default: 10)
- `modelSettings`: Model-specific settings
- `agentId`: Agent identifier
- `modelClass`: Preferred model class

### Enhanced Options (with `useEnhancedMode: true`)

- `toolHandler`: Lifecycle hooks for tool execution
- `loop`: Enable multi-turn conversations with conditions
- `toolCategories`: Filter tools by category
- `toolFilter`: Custom tool filtering function
- `toolResultTransformer`: Transform tool results
- `toolChoiceStrategy`: Dynamic tool choice selection
- `eventEmitter`: Custom event handler
- `debug`: Enable debug metrics

## Best Practices

1. **Always use MessageHistory** for multi-turn conversations
2. **Use the tool builder** for creating new tools
3. **Set appropriate limits** to prevent runaway costs
4. **Handle errors gracefully** with the error handler
5. **Use control tools** for task management
6. **Enable enhanced mode** only when needed

## Migration from Other Libraries

### From OpenAI SDK
```typescript
// Before
const openai = new OpenAI();
const completion = await openai.chat.completions.create({...});

// After (drop-in replacement)
import OpenAI from '@just-every/ensemble';
const openai = new OpenAI();
const completion = await openai.chat.completions.create({...});
```

### From Raw API Calls
```typescript
// Before
const response = await fetch('https://api.openai.com/v1/chat/completions', {
  method: 'POST',
  headers: { 'Authorization': `Bearer ${apiKey}` },
  body: JSON.stringify({ model, messages })
});

// After
import { request } from '@just-every/ensemble';
for await (const event of request(model, messages)) {
  // Handle streaming events
}
```