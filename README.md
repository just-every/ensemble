# @just-every/ensemble

[![npm version](https://badge.fury.io/js/@just-every%2Fensemble.svg)](https://www.npmjs.com/package/@just-every/ensemble)
[![GitHub Actions](https://github.com/just-every/ensemble/workflows/Release/badge.svg)](https://github.com/just-every/ensemble/actions)

A unified interface for interacting with multiple LLM providers (OpenAI, Anthropic, Google, etc.) with streaming support, tool calling, and embeddings.

## Features

- 🔄 **Unified Streaming Interface** - Consistent event-based streaming across all providers
- 🛠️ **Advanced Tool Calling** - Parallel/sequential execution, timeouts, and background tracking
- 📊 **Cost & Quota Tracking** - Built-in usage monitoring and cost calculation
- 🎯 **Smart Result Processing** - Automatic summarization and truncation for long outputs
- 🔌 **Multi-Provider Support** - OpenAI, Anthropic, Google, DeepSeek, xAI, OpenRouter
- 🖼️ **Multi-Modal** - Support for text, images, and embeddings
- 📝 **Automatic History Compaction** - Handle unlimited conversation length with intelligent summarization
- 🤖 **Agent Framework** - Advanced agent capabilities with verification and tool management

## Installation

```bash
npm install @just-every/ensemble
```

## Environment Setup

Set your provider API keys as environment variables before running examples or using the library:

```bash
export OPENAI_API_KEY=your-openai-key
export ANTHROPIC_API_KEY=your-anthropic-key
export GOOGLE_API_KEY=your-google-key
export XAI_API_KEY=your-xai-key
export DEEPSEEK_API_KEY=your-deepseek-key
export OPENROUTER_API_KEY=your-openrouter-key
```

These variables enable access to the respective providers. Only the keys you need are required.

## Quick Start

```typescript
import { ensembleRequest } from '@just-every/ensemble';

const messages = [
    { type: 'message', role: 'user', content: 'Hello, how are you?' }
];

const agent = {
    model: 'o3',
    agent_id: 'assistant'
};

for await (const event of ensembleRequest(messages, agent)) {
    if (event.type === 'message_delta') {
        process.stdout.write(event.content);
    }
}
```

## Documentation

- [Tool Execution Guide](docs/tool-execution.md) - Advanced tool calling features
- [Examples](examples/) - Complete working examples
- Generated [API Reference](docs/api) with `npm run docs`
  Run `npm run docs` to regenerate the HTML documentation.

## Core Concepts

### Tools

Define tools that LLMs can call:

```typescript
const agent = {
    model: 'o3',
    tools: [{
        definition: {
            type: 'function',
            function: {
                name: 'get_weather',
                description: 'Get weather for a location',
                parameters: {
                    type: 'object',
                    properties: {
                        location: { type: 'string' }
                    },
                    required: ['location']
                }
            }
        },
        function: async (location: string) => {
            return `Weather in ${location}: Sunny, 72°F`;
        }
    }]
};
```

### Streaming Events

All providers emit standardized events:

- `message_start` / `message_delta` / `message_complete` - Message streaming
- `tool_start` / `tool_delta` / `tool_done` - Tool execution
- `cost_update` - Token usage and cost tracking
- `error` - Error handling

### Agent Configuration

Configure agent behavior with these optional properties:

```typescript
const agent = {
    model: 'claude-3-sonnet',
    maxToolCalls: 200,              // Maximum total tool calls (default: 200)
    maxToolCallRoundsPerTurn: 5,    // Maximum sequential rounds of tool calls (default: Infinity)
    tools: [...],                   // Available tools for the agent
    modelSettings: {                // Provider-specific settings
        temperature: 0.7,
        max_tokens: 4096
    }
};
```

Key configuration options:
- `maxToolCalls` - Limits the total number of tool calls across all rounds
- `maxToolCallRoundsPerTurn` - Limits sequential rounds where each round can have multiple parallel tool calls
- `modelSettings` - Provider-specific parameters like temperature, max_tokens, etc.

### Advanced Features

- **Parallel Tool Execution** - Tools run concurrently by default within each round
- **Sequential Mode** - Enforce one-at-a-time execution
- **Timeout Handling** - Automatic timeout with background tracking
- **Result Summarization** - Long outputs are intelligently summarized
- **Abort Signals** - Graceful cancellation support

## License

MIT