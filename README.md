# @just-every/ensemble

[![npm version](https://badge.fury.io/js/@just-every%2Fensemble.svg)](https://www.npmjs.com/package/@just-every/ensemble)
[![GitHub Actions](https://github.com/just-every/ensemble/workflows/Release/badge.svg)](https://github.com/just-every/ensemble/actions)

A unified interface for interacting with multiple LLM providers (OpenAI, Anthropic, Google, etc.) with streaming support, tool calling, and embeddings.

## Installation

```bash
npm install @just-every/ensemble
```

## Quick Start

```typescript
import { request } from '@just-every/ensemble';

// Simple streaming request
for await (const event of request('gpt-4o-mini', [
  { type: 'message', role: 'user', content: 'Hello!' }
])) {
  if (event.type === 'text_delta') {
    process.stdout.write(event.delta);
  }
}
```

## Core Functions

### `request(model, messages, options?)`

Make streaming LLM requests with automatic tool execution.

```typescript
// Basic usage
const stream = request('claude-3.5-sonnet', [
  { type: 'message', role: 'user', content: 'Explain quantum computing' }
]);

for await (const event of stream) {
  if (event.type === 'text_delta') {
    process.stdout.write(event.delta);
  } else if (event.type === 'cost_update') {
    console.log(`Cost: $${event.usage.total_cost}`);
  }
}

// With tools
const tools = [{
  function: async ({ city }) => `Weather in ${city}: Sunny, 72°F`,
  definition: {
    type: 'function',
    function: {
      name: 'get_weather',
      description: 'Get weather for a city',
      parameters: {
        type: 'object',
        properties: {
          city: { type: 'string' }
        },
        required: ['city']
      }
    }
  }
}];

const stream = request('gpt-4o', [
  { type: 'message', role: 'user', content: 'What\'s the weather in Paris?' }
], { tools });
```

### `embed(text, options?)`

Generate embeddings for semantic search and RAG applications.

```typescript
// Simple embedding
const embedding = await embed('Hello, world!');
console.log(`Dimension: ${embedding.length}`); // e.g., 1536

// With specific model
const embedding = await embed('Search query', { 
  model: 'text-embedding-3-large' 
});

// Calculate similarity
function cosineSimilarity(a: number[], b: number[]): number {
  const dotProduct = a.reduce((sum, val, i) => sum + val * b[i], 0);
  const normA = Math.sqrt(a.reduce((sum, val) => sum + val * val, 0));
  const normB = Math.sqrt(b.reduce((sum, val) => sum + val * val, 0));
  return dotProduct / (normA * normB);
}

const similarity = cosineSimilarity(embedding1, embedding2);
```

### `chainRequests(messages, requests)`

Chain multiple LLM calls, using the output of one as input to the next.

```typescript
import { chainRequests } from '@just-every/ensemble';

const result = await chainRequests(
  [{ type: 'message', role: 'user', content: 'Analyze this code for bugs: ...' }],
  [
    {
      model: 'gpt-4o',
      systemPrompt: 'You are a code reviewer. Find bugs and security issues.'
    },
    {
      model: 'claude-3.5-sonnet',
      systemPrompt: 'Prioritize the issues found and suggest fixes.'
    },
    {
      model: 'gpt-4o-mini',
      systemPrompt: 'Summarize the analysis in 3 bullet points.'
    }
  ]
);

console.log(result.fullResponse);
```

## Supported Providers

- **OpenAI**: GPT-4o, GPT-4o-mini, o1-preview, o1-mini
- **Anthropic**: Claude 3.5 Sonnet, Claude 3.5 Haiku
- **Google**: Gemini 2.0 Flash, Gemini 1.5 Pro
- **DeepSeek**: DeepSeek Chat, DeepSeek Coder
- **xAI**: Grok 2, Grok Beta
- **OpenRouter**: Access to 100+ models

## OpenAI SDK Compatibility

Drop-in replacement for the OpenAI SDK:

```typescript
// Instead of: import OpenAI from 'openai';
import OpenAIEnsemble from '@just-every/ensemble/openai-compat';

const completion = await OpenAIEnsemble.chat.completions.create({
  model: 'claude-3.5-sonnet',  // Use any supported model!
  messages: [{ role: 'user', content: 'Hello!' }],
  stream: true
});
```

## Environment Variables

```bash
ANTHROPIC_API_KEY=your_key_here
OPENAI_API_KEY=your_key_here
GOOGLE_API_KEY=your_key_here
DEEPSEEK_API_KEY=your_key_here
XAI_API_KEY=your_key_here
OPENROUTER_API_KEY=your_key_here
```

## Documentation

- [Model Selection & Management](./docs/models.md)
- [Advanced Usage](./docs/advanced-usage.md)
- [Error Handling](./docs/error-handling.md)
- [OpenAI Compatibility](./docs/openai-compatibility.md)
- [Utility Functions](./docs/utilities.md)

## Examples

See the [examples](./examples) directory for:
- [Basic usage](./examples/basic-request.ts)
- [Tool calling](./examples/tool-calling.ts)
- [Embeddings & semantic search](./examples/embeddings.ts)
- [Model rotation](./examples/model-rotation.ts)
- [Stream conversion](./examples/stream-conversion.ts)

## License

MIT