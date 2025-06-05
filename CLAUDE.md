# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

### Build and Development
```bash
npm run build         # Compile TypeScript to JavaScript (dist/)
npm run clean         # Remove dist directory
npm run prepare       # Auto-build on install
```

### Testing
```bash
npm run test          # Run tests once with Vitest
npm run test:watch    # Run tests in watch mode
npm run test:coverage # Run tests with coverage report
```

### Linting
```bash
npm run lint          # Check for lint errors in TypeScript files
npm run lint:fix      # Auto-fix lint issues
```

## Architecture Overview

**@just-every/ensemble** is an LLM provider abstraction layer that provides a unified streaming interface for multiple AI providers (OpenAI, Anthropic, Google, DeepSeek, xAI, OpenRouter).

### Core Components

1. **Provider System** (`/model_providers/`)
   - All providers extend `BaseModelProvider` abstract class
   - Each provider implements `request()`, `embed()`, and optionally `image()` methods
   - Provider selection is automatic based on the model name

2. **Request Flow** (`/core/ensemble_request.ts`)
   - Handles unified streaming for all providers
   - Manages tool calling with automatic parameter mapping
   - Uses `MessageHistory` for conversation management
   - Supports recursive tool execution

3. **Type System** (`/types/`)
   - `types.ts`: Core types for agents, models, streams, and tools
   - `api_types.ts`: Provider-specific API types
   - `tool_types.ts`: Tool calling and function definitions

4. **Model Registry** (`/data/model_data.ts`)
   - Contains all supported models with pricing information
   - Models are categorized by class (small, large, etc.)
   - External models can be registered dynamically

### Key Patterns

- **Streaming Events**: All providers emit standardized events (`start`, `text`, `tool_use`, `finish`, etc.)
- **Tool Calling**: Tools are defined with Zod schemas and automatically handle parameter mapping between providers
- **Message History**: Automatic compaction and management of conversation history
- **Cost Tracking**: Built-in tracking of token usage and API costs
- **State Management**: Support for stateful requests with `StateManager`

### TypeScript Configuration

- ES modules with NodeNext module resolution
- Strict mode is disabled (`"strict": false`)
- Outputs to `./dist/` with source maps and declarations
- All imports must use `.js` extension (even for `.ts` files)