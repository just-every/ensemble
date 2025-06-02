# Clean API Summary

## Overview

The Ensemble AI package now has a clean, unified API with all legacy code removed. The package provides a single entry point for all LLM interactions while maintaining powerful features for advanced use cases.

## What Was Removed

1. **Old `request()` function** - Replaced with unified version
2. **`enhancedRequest()` function** - Merged into unified request
3. **Separate enhanced_request.ts file** - Functionality integrated into unified_request.ts
4. **Legacy documentation** - Removed old enhanced tool handling docs
5. **Duplicate type definitions** - Consolidated into clean exports

## Clean Architecture

### Core Components

1. **`request()`** - Single unified function for all LLM requests
   - Automatically detects when enhanced features are needed
   - Supports both simple and advanced use cases
   - Maintains streaming interface

2. **`MessageHistory`** - Proper conversation state management
   - Prevents infinite loops
   - Automatically compacts tool calls
   - Preserves system messages

3. **`tool()` builder** - Fluent API for tool creation
   - Type-safe parameter definition
   - Built-in parameter types
   - Enhanced features support

4. **`EnsembleErrorHandler`** - Unified error handling
   - Retry logic with exponential backoff
   - User-friendly error messages
   - Stream event conversion

5. **Control Tools** - Pre-built task management tools
   - `task_complete`
   - `report_error`
   - `request_clarification`

## Key Exports

```typescript
// Main request function
export { request } from '@just-every/ensemble';

// Message history management
export { MessageHistory } from '@just-every/ensemble';

// Tool creation
export { tool, ToolBuilder, createControlTools, createToolBatch } from '@just-every/ensemble';

// Error handling
export { EnsembleErrorHandler, ErrorCode } from '@just-every/ensemble';

// Types
export type { UnifiedRequestOptions, RequestAgent } from '@just-every/ensemble';

// Other APIs
export { embed, image } from '@just-every/ensemble';

// OpenAI compatibility
export { default as OpenAI } from '@just-every/ensemble';
```

## Usage Patterns

### Simple Usage
```typescript
for await (const event of request('gpt-4o-mini', messages)) {
  if (event.type === 'text_delta') {
    process.stdout.write(event.delta);
  }
}
```

### With Tools
```typescript
const weatherTool = tool('get_weather')
  .description('Get weather')
  .string('location')
  .implement(async ({ location }) => `Weather in ${location}: Sunny`)
  .build();

for await (const event of request('gpt-4o-mini', messages, { tools: [weatherTool] })) {
  // Tools are automatically executed
}
```

### Enhanced Features
```typescript
for await (const event of request('gpt-4o-mini', messages, {
  tools,
  useEnhancedMode: true,
  toolHandler: {
    onToolCall: async (call) => ToolCallAction.EXECUTE
  },
  loop: {
    maxIterations: 5,
    continueCondition: (ctx) => !ctx.isHalted
  }
})) {
  // Advanced features enabled
}
```

## Benefits of Clean API

1. **Simplicity** - Single entry point for all use cases
2. **Progressive Enhancement** - Start simple, add features as needed
3. **Type Safety** - Full TypeScript support without conflicts
4. **No Legacy Baggage** - Clean codebase without compatibility cruft
5. **Better Performance** - Optimized message handling
6. **Easier Testing** - Unified interface simplifies testing
7. **Clear Mental Model** - One way to do things

## Migration Impact

Since this is a new package, there's no migration needed. Users start with the clean API from day one.

## Future-Proof Design

The unified API is designed to accommodate future features without breaking changes:
- New options can be added to `UnifiedRequestOptions`
- Tool builder can be extended with new parameter types
- Message history can gain new capabilities
- Error handler can support new error types

All while maintaining the same clean, simple interface.