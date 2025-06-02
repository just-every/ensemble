# Migration Guide: Simplified API

This guide helps you migrate to the new simplified APIs that resolve common issues and make workflows cleaner.

## Key Improvements

1. **Unified Request Function**: Combines standard and enhanced request functionality
2. **Message History Management**: Prevents infinite loops and manages conversation state
3. **Fluent Tool Builder**: Simplified tool creation with better type safety
4. **Error Handling**: Unified error handling with retry logic

## Migration Examples

### 1. Tool Creation

**Before:**
```typescript
const weatherTool = {
    definition: {
        type: 'function',
        function: {
            name: 'get_weather',
            description: 'Get weather for a location',
            parameters: {
                type: 'object',
                properties: {
                    location: { type: 'string' },
                    units: { type: 'string', enum: ['celsius', 'fahrenheit'] }
                },
                required: ['location']
            }
        }
    },
    function: async ({ location, units = 'celsius' }) => {
        return `Weather in ${location}: 22°${units[0].toUpperCase()}`;
    }
};
```

**After:**
```typescript
import { tool } from 'ensemble-ai';

const weatherTool = tool('get_weather')
    .description('Get weather for a location')
    .string('location', 'The city and state/country')
    .enum('units', ['celsius', 'fahrenheit'], 'Temperature units', false)
    .implement(async ({ location, units = 'celsius' }) => {
        return `Weather in ${location}: 22°${units[0].toUpperCase()}`;
    })
    .build();
```

### 2. Request with Tool Loops

**Before (Issue: Potential infinite loops):**
```typescript
let messages = [...initialMessages];
let toolCallCount = 0;

while (toolCallCount < maxToolCalls) {
    for await (const event of request(model, messages, { tools })) {
        // Process events
        // Manually manage message history
        // Risk of duplicate messages
    }
    toolCallCount++;
}
```

**After:**
```typescript
import { unifiedRequest, MessageHistory } from 'ensemble-ai';

const history = new MessageHistory(initialMessages, {
    compactToolCalls: true,
    preserveSystemMessages: true
});

for await (const event of unifiedRequest(model, history.getMessages(), {
    tools,
    messageHistory: history,
    maxToolCalls: 10
})) {
    // History is automatically managed
    // Tool calls are properly tracked
    // No duplicate messages
}
```

### 3. Enhanced Tool Handling

**Before:**
```typescript
// Complex setup for enhanced features
const enhancedOpts = {
    tools,
    toolHandler: {
        onToolCall: async (call, context) => {
            // Handle tool call
        },
        onToolComplete: async (call, result, context) => {
            // Handle completion
        }
    },
    loop: {
        maxIterations: 5,
        continueCondition: (ctx) => !ctx.isHalted
    }
};

for await (const event of enhancedRequest(model, messages, enhancedOpts)) {
    // Process events
}
```

**After:**
```typescript
for await (const event of unifiedRequest(model, messages, {
    tools,
    useEnhancedMode: true, // Automatically enables enhanced features
    toolHandler: {
        onToolCall: async (call) => {
            // Simplified handler
        }
    },
    loop: true // Simple boolean or config object
})) {
    // Same functionality, cleaner API
}
```

### 4. Error Handling

**Before:**
```typescript
try {
    const result = await someOperation();
} catch (error) {
    if (error.status === 429) {
        // Manual retry logic
        await new Promise(resolve => setTimeout(resolve, 1000));
        try {
            const result = await someOperation();
        } catch (retryError) {
            throw retryError;
        }
    }
}
```

**After:**
```typescript
import { EnsembleErrorHandler } from 'ensemble-ai';

const result = await EnsembleErrorHandler.handleWithRetry(
    someOperation,
    3, // max retries
    (error) => error.status === 429 // retry condition
);
```

### 5. Control Tools

**Before:**
```typescript
// Manually create control tools
const completeTask = {
    definition: {
        type: 'function',
        function: {
            name: 'task_complete',
            description: 'Mark task complete',
            parameters: {
                type: 'object',
                properties: {
                    result: { type: 'string' }
                },
                required: ['result']
            }
        }
    },
    function: async ({ result }) => {
        // Handle completion
        return 'Task completed';
    }
};
```

**After:**
```typescript
import { createControlTools } from 'ensemble-ai';

const controlTools = createControlTools({
    onComplete: (result) => {
        console.log('Task completed:', result);
    },
    onError: (error) => {
        console.error('Task error:', error);
    }
});
// Automatically creates task_complete, report_error, and request_clarification tools
```

## Best Practices

1. **Always use MessageHistory** for multi-turn conversations
2. **Use the tool builder** for type-safe tool creation
3. **Enable useEnhancedMode** when you need advanced features
4. **Use EnsembleErrorHandler** for consistent error handling
5. **Set appropriate limits** (maxMessages, maxToolCalls) to prevent runaway costs

## Backward Compatibility

The original `request()` and `enhancedRequest()` functions remain available and unchanged. You can migrate gradually:

1. Start by using the tool builder for new tools
2. Add MessageHistory to existing code
3. Gradually move to unifiedRequest for new features
4. Update error handling as needed

## Common Issues Resolved

1. **Infinite tool loops**: MessageHistory tracks and compacts tool calls
2. **Duplicate messages**: Automatic deduplication in history
3. **Complex tool creation**: Fluent builder API
4. **Inconsistent error handling**: Unified error system
5. **Message management**: Automatic trimming and preservation

## Example: Complete Migration

```typescript
// Old approach
import { request } from 'ensemble-ai';

const messages = [
    { type: 'message', role: 'user', content: 'Hello' }
];

const tools = [{
    definition: { /* complex definition */ },
    function: async (args) => { /* implementation */ }
}];

for await (const event of request('gpt-4o', messages, { tools })) {
    // Handle events
}

// New approach
import { unifiedRequest, MessageHistory, tool } from 'ensemble-ai';

const history = new MessageHistory([
    { type: 'message', role: 'user', content: 'Hello' }
]);

const myTool = tool('my_tool')
    .description('Tool description')
    .string('param', 'Parameter description')
    .implement(async ({ param }) => { /* implementation */ })
    .build();

for await (const event of unifiedRequest('gpt-4o', history.getMessages(), {
    tools: [myTool],
    messageHistory: history
})) {
    // Handle events with automatic history management
}
```