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
- 📝 **Message History** - Automatic conversation management with compaction

## Installation

```bash
npm install @just-every/ensemble
```

## Quick Start

```typescript
import { ensembleRequest } from '@just-every/ensemble';

const messages = [
    { type: 'message', role: 'user', content: 'Hello, how are you?' }
];

const agent = {
    model: 'gpt-4',
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
- [API Reference](docs/api.md) - Full API documentation

## Core Concepts

### Tools

Define tools that LLMs can call:

```typescript
const agent = {
    model: 'gpt-4',
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

### Advanced Features

- **Parallel Tool Execution** - Tools run concurrently by default
- **Sequential Mode** - Enforce one-at-a-time execution
- **Timeout Handling** - Automatic timeout with background tracking
- **Result Summarization** - Long outputs are intelligently summarized
- **Abort Signals** - Graceful cancellation support

## License

MIT