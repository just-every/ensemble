# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

### Development
- `npm run build` - Compile TypeScript to JavaScript
- `npm run clean` - Remove dist directory
- `npm test` - Run all tests once
- `npm run test:watch` - Run tests in watch mode
- `npm run test:coverage` - Run tests with coverage report

### Testing
- Run a single test file: `npm test test/filename.test.ts`
- Run tests matching a pattern: `npm test -- -t "pattern"`

### Release
- `npm run release` - Interactive release (prompts for version)
- `npm run release:patch` - Release patch version
- `npm run release:minor` - Release minor version
- `npm run release:major` - Release major version

## Architecture

This is a TypeScript library that provides a unified interface for multiple LLM providers (Claude, OpenAI, Gemini, DeepSeek, Grok, OpenRouter).

### Core Design Pattern
The library uses a **provider abstraction pattern** where all LLM providers implement the `ModelProvider` interface. The main entry point `request()` function in `index.ts` automatically selects the appropriate provider based on the model name.

### Key Components

1. **Model Providers** (`model_providers/`): Each provider implements the `ModelProvider` interface with:
   - `supportsModel()`: Check if provider handles a specific model
   - `createRequestGenerator()`: Return an AsyncGenerator for streaming responses
   - Message format conversion (internal → provider-specific)
   - Tool/function calling adaptation
   - Image processing integration

2. **Model Registry** (`model_data.ts`): 
   - `MODEL_REGISTRY`: Maps model names to their configurations (provider, input/output costs)
   - `MODEL_CLASSES`: Groups models by capability (standard, reasoning, code, vision)
   - Model scoring system for automatic selection

3. **Streaming Architecture**: 
   - Uses AsyncGenerators throughout for efficient streaming
   - `EnsembleStreamEvent` types handle all streaming events uniformly
   - Delta buffering for text accumulation

4. **Utilities** (`utils/`):
   - `AsyncQueue`: Bridges callback APIs to async iteration
   - `StreamConverter`: Converts stream events to conversation history
   - `ImageUtils`: Handles image resizing and conversion
   - `QuotaTracker`: Manages API rate limits
   - `CostTracker`: Tracks token usage and costs

### Adding New Features

When adding a new provider:
1. Create provider file in `model_providers/` implementing `ModelProvider`
2. Add model entries to `MODEL_REGISTRY` in `model_data.ts`
3. Update `getModelProvider()` in `model_providers/model_provider.ts`
4. Add tests in `test/`

When modifying streaming behavior:
- The streaming pipeline flows through: Provider → AsyncGenerator → Delta Buffer → Client
- All providers must emit standardized `EnsembleStreamEvent` types
- Image handling is done through `ImageUtils` before sending to providers