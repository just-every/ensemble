# Tool Choice Fix Documentation

## Problem

When `tool_choice` is set in `modelSettings` to force a specific tool use (e.g., `{ type: 'function', function: { name: 'tool_name' } }`), the setting persists across iterations in the request loop, causing the model to repeatedly call the same tool infinitely.

## Root Cause

The `tool_choice` setting in `modelSettings` was being passed to every iteration of the request loop without modification. When set to force a specific function, the model would:

1. Call the tool (as requested by tool_choice)
2. Receive the tool result
3. Make another request with the same tool_choice setting
4. Call the tool again (because tool_choice still forces it)
5. Repeat indefinitely

## Solution

The fix in `unified_request.ts` ensures that `tool_choice` is cleared after the first iteration unless a dynamic `toolChoiceStrategy` is provided:

```typescript
// After the first iteration, clear any forced tool_choice to prevent loops
// unless we have a dynamic strategy
if (iteration > 0 && !options.toolChoiceStrategy) {
    if (roundOptions.modelSettings?.tool_choice) {
        // Create a new modelSettings object without tool_choice
        roundOptions.modelSettings = { ...roundOptions.modelSettings };
        delete roundOptions.modelSettings.tool_choice;
    }
}
```

## How It Works

1. **First Iteration (iteration = 0)**:
   - `tool_choice` is preserved as specified
   - Model calls the requested tool

2. **Subsequent Iterations (iteration > 0)**:
   - If no `toolChoiceStrategy` is provided, `tool_choice` is removed
   - Model can now respond naturally with the tool results
   - Prevents infinite loops

3. **With Dynamic Strategy**:
   - If `toolChoiceStrategy` is provided, it controls `tool_choice` for each iteration
   - Allows for complex multi-step tool interactions

## Usage Examples

### Basic Usage (Fixed)
```typescript
// This will now work correctly without infinite loops
for await (const event of request('gpt-4o', messages, {
    tools: [weatherTool],
    modelSettings: {
        tool_choice: { type: 'function', function: { name: 'get_weather' } }
    }
})) {
    // Tool is called once, then model responds with results
}
```

### With Dynamic Strategy
```typescript
// Dynamic control over tool choice per iteration
for await (const event of request('gpt-4o', messages, {
    tools: [tool1, tool2],
    useEnhancedMode: true,
    toolChoiceStrategy: (callCount, turnCount) => {
        if (callCount === 0) {
            // Force tool1 on first call
            return { type: 'function', function: { name: 'tool1' } };
        } else if (callCount === 1) {
            // Force tool2 on second call
            return { type: 'function', function: { name: 'tool2' } };
        } else {
            // Let model decide after that
            return 'auto';
        }
    }
})) {
    // Controlled multi-step tool execution
}
```

## Benefits

1. **Prevents Infinite Loops**: Tool choice no longer causes endless tool calls
2. **Maintains Flexibility**: Dynamic strategies still work as expected
3. **Backward Compatible**: Existing code continues to work
4. **Intuitive Behavior**: Model behaves as users expect after tool execution