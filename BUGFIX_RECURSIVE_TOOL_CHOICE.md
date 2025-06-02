# Bug Fix: Recursive Tool Choice (v0.1.27)

## Summary

Fixed a critical bug where `tool_choice` would persist in recursive LLM calls made by tools, causing infinite loops.

## The Problem

When a tool was forced via `tool_choice` and that tool made its own LLM request:
1. The parent request had `tool_choice: { type: 'function', function: { name: 'my_tool' } }`
2. The tool `my_tool` was called
3. Inside `my_tool`, it made another LLM request
4. The child request inherited the same `tool_choice`, forcing it to call `my_tool` again
5. This created an infinite loop until `maxToolCalls` was hit

## The Solution

Implemented tracking of tool execution context to detect recursive calls:

```typescript
// Track when executing inside a tool
let isExecutingTool = false;

// Clear tool_choice in recursive calls
const isRecursiveCall = isExecutingTool && !options.preserveToolChoice;
const shouldClearToolChoice = (iteration > 0 || isRecursiveCall) && !options.toolChoiceStrategy;

// Mark tool execution boundaries
isExecutingTool = true;
try {
    result = await tool.function(args);
} finally {
    isExecutingTool = false;
}
```

## Behavior Changes

### Default: tool_choice is cleared in recursive calls
```typescript
// Parent request forces tool
await request(model, messages, {
    tools: [myTool],
    modelSettings: { tool_choice: { type: 'function', function: { name: 'my_tool' } } }
});

// Inside myTool:
const result = await request(model, messages, {
    // tool_choice is NOT inherited - prevents infinite loop
});
```

### Opt-in: Preserve tool_choice when needed
```typescript
const result = await request(model, messages, {
    tools: [...],
    modelSettings: { tool_choice: {...} },
    preserveToolChoice: true  // Explicitly preserve in recursive calls
});
```

## Impact

- Fixes infinite loops in tools that make LLM requests
- No breaking changes for most users
- Opt-in flag for edge cases that need the old behavior
- Works correctly with dynamic `toolChoiceStrategy`

## Files Changed

- `unified_request.ts`: Added recursive call detection and tool execution tracking
- `docs/recursive-tool-choice-fix.md`: Comprehensive documentation
- `examples/recursive-tool-fix.ts`: Demonstration of the fix