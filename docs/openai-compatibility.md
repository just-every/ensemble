# OpenAI SDK Compatibility

Ensemble provides a drop-in replacement for the OpenAI SDK, allowing you to use any supported model with OpenAI's familiar API.

## Migration from OpenAI SDK

```typescript
// Before:
import OpenAI from 'openai';
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// After:
import OpenAIEnsemble from '@just-every/ensemble/openai-compat';
const openai = OpenAIEnsemble;

// Your existing code works unchanged!
const completion = await openai.chat.completions.create({
  model: 'claude-3.5-sonnet',  // Use any supported model!
  messages: [
    { role: 'system', content: 'You are a helpful assistant.' },
    { role: 'user', content: 'Hello!' }
  ],
  temperature: 0.7
});

console.log(completion.choices[0].message.content);
```

## Streaming

```typescript
const stream = await openai.chat.completions.create({
  model: 'gpt-4o-mini',
  messages: [{ role: 'user', content: 'Tell me a story' }],
  stream: true
});

for await (const chunk of stream) {
  process.stdout.write(chunk.choices[0].delta.content || '');
}
```

## Tool/Function Calling

```typescript
const tools = [{
  type: 'function',
  function: {
    name: 'get_weather',
    description: 'Get the current weather',
    parameters: {
      type: 'object',
      properties: {
        location: { type: 'string' }
      },
      required: ['location']
    }
  }
}];

const completion = await openai.chat.completions.create({
  model: 'gpt-4o',
  messages: [{ role: 'user', content: 'What\'s the weather in Paris?' }],
  tools,
  tool_choice: 'auto'
});
```

## Legacy Completions API

```typescript
const completion = await openai.completions.create({
  model: 'deepseek-chat',
  prompt: 'Once upon a time',
  max_tokens: 100
});

console.log(completion.choices[0].text);
```

## Responses API (New)

```typescript
// OpenAI's newer stateful API
const response = await openai.responses.create({
  model: 'gpt-4o',
  input: 'Explain quantum computing',
  instructions: 'Explain in simple terms suitable for a high school student',
  tools: [
    { name: 'web_search' },
    { name: 'file_search' }
  ]
});

console.log(response.content);
```

## Supported Features

- All chat.completions.create parameters (temperature, tools, response_format, etc.)
- Streaming and non-streaming responses
- Tool/function calling
- Legacy completions.create API
- New responses.create API
- Proper TypeScript types matching OpenAI's SDK