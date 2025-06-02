# Recursive Tool Choice Fix

## Bug Description

In version 0.1.26 and earlier, when `tool_choice` was set to force a specific tool and that tool internally made another LLM request, the `tool_choice` setting would persist in the recursive call, causing an infinite loop.

## Root Cause

The code only cleared `tool_choice` when `iteration > 0` (after the first iteration of a multi-turn conversation). However, when a tool makes a recursive LLM call, the iteration counter starts fresh at 0, so `tool_choice` was never cleared.

## The Fix

The fix introduces a mechanism to track when we're executing inside a tool and clears `tool_choice` appropriately:

```typescript
// Track if we're currently executing within a tool
let isExecutingTool = false;

// In executeRound function:
const isRecursiveCall = isExecutingTool && !options.preserveToolChoice;
const shouldClearToolChoice = (iteration > 0 || isRecursiveCall) && !options.toolChoiceStrategy;

// When executing tools:
isExecutingTool = true;
try {
    result = await tool.function(args);
} finally {
    isExecutingTool = false;
}
```

## How It Works

1. **Tracking Tool Execution**: A module-level variable `isExecutingTool` tracks when we're inside a tool function.

2. **Detecting Recursive Calls**: When a new request is made while `isExecutingTool` is true, it's a recursive call.

3. **Clearing tool_choice**: In recursive calls, `tool_choice` is automatically cleared unless:
   - A dynamic `toolChoiceStrategy` is provided
   - `preserveToolChoice: true` is explicitly set

## Usage Examples

### Default Behavior (tool_choice cleared in recursive calls)

```typescript
const notifyTool = tool('notify_user')
    .description('Notify the user')
    .string('message', 'Message to send')
    .implement(async ({ message }) => {
        // This recursive call won't have tool_choice set
        const response = await request('gpt-4o', [
            { type: 'message', role: 'user', content: 'Process this: ' + message }
        ], {
            // tool_choice is NOT inherited here
        });
        
        return 'User notified';
    })
    .build();

// Initial request with forced tool_choice
await request('gpt-4o', messages, {
    tools: [notifyTool],
    modelSettings: {
        tool_choice: { type: 'function', function: { name: 'notify_user' } }
    }
});
```

### Preserving tool_choice (when needed)

```typescript
const complexTool = tool('complex_operation')
    .implement(async (args) => {
        // Explicitly preserve tool_choice in recursive call
        const result = await request('gpt-4o', messages, {
            tools: [...],
            modelSettings: {
                tool_choice: { type: 'function', function: { name: 'helper_tool' } }
            },
            preserveToolChoice: true  // Keep tool_choice in recursive call
        });
        
        return result;
    })
    .build();
```

### Dynamic Tool Choice Strategy

```typescript
// toolChoiceStrategy always takes precedence
await request('gpt-4o', messages, {
    tools: [...],
    toolChoiceStrategy: (callCount, turnCount) => {
        // This strategy applies even in recursive calls
        return callCount === 0 ? 'required' : 'auto';
    }
});
```

## Migration Guide

### If your code relies on tool_choice persisting in recursive calls:

Add `preserveToolChoice: true` to your recursive requests:

```typescript
// Before (relied on bug):
const result = await request(model, messages, {
    tools: [...],
    modelSettings: { tool_choice: {...} }
});

// After (explicit preservation):
const result = await request(model, messages, {
    tools: [...],
    modelSettings: { tool_choice: {...} },
    preserveToolChoice: true
});
```

### For most users:

No changes needed. The fix prevents infinite loops that were occurring with forced tool_choice.

## Benefits

1. **Prevents Infinite Loops**: Tools can safely make LLM requests without causing recursion
2. **Intuitive Behavior**: tool_choice only applies to the immediate request
3. **Backward Compatible**: Existing code continues to work
4. **Flexible**: Can explicitly preserve tool_choice when needed

## Testing

You can verify the fix works by running the example:

```bash
npm run build
node dist/examples/recursive-tool-fix.js
```

The example demonstrates a tool making its own LLM request without causing an infinite loop.