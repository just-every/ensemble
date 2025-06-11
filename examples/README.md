# Ensemble Examples

This directory contains examples demonstrating various features of the Ensemble library.

## Basic Examples

- [basic-request.ts](./basic-request.ts) - Simple LLM request with streaming
- [tool-calling.ts](./tool-calling.ts) - Basic tool calling example
- [embeddings.ts](./embeddings.ts) - Generate embeddings
- [voice-generation.ts](./voice-generation.ts) - Text-to-Speech generation
- [voice-generation-gemini.ts](./voice-generation-gemini.ts) - Gemini TTS with advanced features

## Advanced Examples

- [parallel-tools.ts](./parallel-tools.ts) - Parallel tool execution
- [sequential-tools.ts](./sequential-tools.ts) - Sequential tool execution
- [timeout-handling.ts](./timeout-handling.ts) - Tool timeout and background tracking
- [result-processing.ts](./result-processing.ts) - Result summarization and truncation
- [tool-lifecycle.ts](./tool-lifecycle.ts) - Tool lifecycle callbacks
- [abort-signals.ts](./abort-signals.ts) - Graceful cancellation with abort signals
- [model-configuration.ts](./model-configuration.ts) - Customize model classes and selection

## Running Examples

```bash
# Install dependencies
npm install

# Run an example
npx tsx examples/basic-request.ts
```

Make sure to set your API keys as environment variables:

```bash
export OPENAI_API_KEY=your-key
export ANTHROPIC_API_KEY=your-key
export GOOGLE_API_KEY=your-key
```