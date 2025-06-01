# Enhanced Tool Handling

The ensemble library provides a powerful enhanced tool handling system that unifies tool execution patterns across different systems like MAGI and MECH while maintaining backward compatibility.

## Overview

The enhanced tool handling system provides:

- **Lifecycle Hooks**: Control tool execution with pre/post hooks
- **Execution Control**: Sequential, parallel, or batch execution modes
- **Tool Filtering**: Category-based and custom filtering
- **Loop Management**: Multi-round execution with conditions
- **Dynamic Strategies**: Adapt tool choice based on context
- **Result Transformation**: Modify tool outputs before model consumption
- **Metrics & Debugging**: Track execution performance

## Basic Usage

```typescript
import { enhancedRequest } from '@just-every/ensemble/utils/enhanced_request';
import { ToolCallAction } from '@just-every/ensemble/types/tool_types';

const stream = enhancedRequest('gpt-4', messages, {
    tools: myTools,
    toolHandler: {
        onToolCall: async (toolCall, context) => {
            console.log('About to execute:', toolCall.function.name);
            return ToolCallAction.EXECUTE;
        },
        onToolComplete: async (toolCall, result, context) => {
            console.log('Tool completed:', toolCall.function.name);
        }
    }
});
```

## Enhanced Tool Function

Tools can include additional metadata for better control:

```typescript
interface EnhancedToolFunction extends ToolFunction {
    // Categorization
    category?: 'control' | 'utility' | 'meta' | 'custom' | string;
    priority?: number;           // Lower = higher priority
    sideEffects?: boolean;       // Affects system state
    
    // Agent-specific (MAGI)
    agentId?: string;           // Agent-specific tools
    requiresContext?: string[]; // Required context fields
    
    // Execution constraints
    maxExecutions?: number;     // Max calls per session
    cooldown?: number;          // Milliseconds between calls
    timeout?: number;           // Max execution time
}
```

## Tool Handler

The tool handler provides lifecycle hooks for tool execution:

```typescript
const toolHandler = {
    // Context passed to all tool calls
    context: myAgentOrContext,
    
    // Called before tool execution
    onToolCall: async (toolCall, context) => {
        // Return an action:
        // - EXECUTE: Run the tool normally
        // - SKIP: Skip this tool call
        // - HALT: Stop all execution
        // - REPLACE: Use replacement result
        
        if (dangerousOperation(toolCall)) {
            return ToolCallAction.SKIP;
        }
        
        return ToolCallAction.EXECUTE;
    },
    
    // Called after successful execution
    onToolComplete: async (toolCall, result, context) => {
        logToolExecution(toolCall, result);
    },
    
    // Called on tool errors
    onToolError: async (toolCall, error, context) => {
        // Return a value to use as the tool result
        // or undefined to use default error handling
        return `Tool failed: ${error.message}`;
    },
    
    // Custom executor (replaces tool.function)
    executor: async (tool, args, context) => {
        // Custom execution logic
        return customExecute(tool, args);
    },
    
    // Execution mode
    executionMode: 'sequential', // or 'parallel', 'batch'
    
    // Error handling strategy
    errorStrategy: 'return-error', // or 'throw', 'retry', 'custom'
    
    // Retry configuration
    retryConfig: {
        maxAttempts: 3,
        backoff: 'exponential',
        initialDelay: 1000
    }
};
```

## Loop Control

Enable multi-round execution with conditions:

```typescript
const options = {
    loop: {
        maxIterations: 100,
        maxDuration: 300000, // 5 minutes
        
        // Continue condition checked each iteration
        continueCondition: (context) => {
            return !context.getMetadata('taskComplete');
        },
        
        // Called at the start of each iteration
        onIteration: async (iteration, context) => {
            if (iteration % 10 === 0) {
                console.log(`Iteration ${iteration}`);
            }
        },
        
        breakOnError: false, // Continue on errors
        resetToolCount: true // Reset count each iteration
    }
};
```

## Tool Filtering & Organization

Filter and organize available tools:

```typescript
const options = {
    // Filter by category
    toolCategories: ['control', 'utility'],
    
    // Custom filter function
    toolFilter: (tool) => {
        return tool.priority < 10 && !tool.dangerous;
    },
    
    // Sort tools (return ordered array)
    toolPriority: (tools) => {
        return tools.sort((a, b) => a.priority - b.priority);
    }
};
```

## Dynamic Tool Choice Strategy

Adapt tool selection based on execution state:

```typescript
const options = {
    toolChoiceStrategy: (callCount, turnCount, context) => {
        // First call: let model choose
        if (callCount === 0) {
            return 'auto';
        }
        
        // Many calls: encourage specific tool
        if (callCount > 10) {
            return {
                type: 'function',
                function: { name: 'task_complete' }
            };
        }
        
        // Near limit: disable tools
        if (callCount >= context.maxToolCalls - 2) {
            return 'none';
        }
        
        return 'auto';
    }
};
```

## Result Transformation

Transform tool results before the model sees them:

```typescript
const options = {
    toolResultTransformer: {
        // Transform the raw result
        transform: (toolName, result, context) => {
            if (toolName === 'get_data') {
                return summarizeData(result);
            }
            return result;
        },
        
        // Add additional information
        augment: (toolName, result, metrics) => {
            if (toolName === 'expensive_operation') {
                return `${result}\nExecution time: ${metrics.duration}ms`;
            }
            return result;
        },
        
        // Format for model consumption
        format: (toolName, result) => {
            return `Tool ${toolName} returned: ${result}`;
        },
        
        // Validate results
        validate: (toolName, result) => {
            if (!result) {
                return { valid: false, error: 'Empty result' };
            }
            return { valid: true };
        }
    }
};
```

## Request Context

The request context maintains state across iterations:

```typescript
import { createRequestContext } from '@just-every/ensemble/types/tool_types';

const context = createRequestContext({
    metadata: {
        taskId: '123',
        userId: 'user-456'
    }
});

// Use context in request
const stream = enhancedRequest(model, messages, options, context);

// Access context methods
context.setMetadata('progress', 0.5);
context.getMetadata('progress'); // 0.5

context.addMessage({ type: 'message', role: 'system', content: 'Hint' });
context.getHistory(); // All messages

context.halt(); // Stop execution
context.pause(); // Pause execution
context.resume(); // Resume execution
```

## Event Handling

Control which events are emitted and process them:

```typescript
const options = {
    // Filter events
    allowedEvents: ['message_delta', 'tool_start', 'tool_done'],
    
    // Custom event handler
    eventEmitter: async (event, context) => {
        if (event.type === 'tool_start') {
            await notifyToolStart(event, context);
        }
    },
    
    // Called when stream completes
    onStreamComplete: async (response, context) => {
        // Return false to stop loop
        if (response.toolCalls.length === 0) {
            return false;
        }
        return true;
    }
};
```

## Performance Options

Optimize tool execution:

```typescript
const options = {
    // Cache identical tool calls
    cacheToolResults: true,
    
    // Maximum parallel tool executions
    parallelExecution: 3,
    
    // Tool execution limits
    maxToolCalls: 20,          // Total across all iterations
    maxToolCallsPerTurn: 5,    // Per conversation turn
};
```

## Debugging

Enable detailed debugging information:

```typescript
const options = {
    debug: {
        logToolCalls: true,     // Log when tools are called
        logToolResults: true,   // Log tool results
        logMessages: false,     // Log all messages
        logMetrics: true        // Log execution metrics
    }
};
```

## Integration Examples

### MAGI Integration

```typescript
const stream = enhancedRequest(agent.model, messages, {
    toolHandler: {
        context: agent,
        executor: async (tool, args, context) => {
            return processToolCall({ tool_calls: [{ function: tool, args }] }, context);
        },
        onToolCall: async (toolCall, context) => {
            sendStatus('tool_start', { name: toolCall.function.name });
            return ToolCallAction.EXECUTE;
        },
        onToolComplete: async (toolCall, result, context) => {
            sendStatus('tool_done', { name: toolCall.function.name });
        }
    },
    maxToolCallsPerTurn: agent.maxToolCallRoundsPerTurn,
    allowedEvents: allowedEvents,
    eventEmitter: (event) => comm.send(event)
});
```

### MECH Integration

```typescript
const context = createRequestContext();
const stream = enhancedRequest(model, messages, {
    toolHandler: {
        context,
        onToolComplete: async (toolCall, result, ctx) => {
            if (toolCall.function.name === 'task_complete') {
                ctx.halt();
                ctx.setMetadata('outcome', result);
            }
        }
    },
    loop: {
        maxIterations: 100,
        continueCondition: (ctx) => !ctx.getMetadata('outcome')
    },
    toolCategories: ['control', 'utility']
}, context);
```

## Migration Guide

The enhanced request is backward compatible. To migrate:

1. Replace `request()` with `enhancedRequest()`
2. Move `processToolCall` to `toolHandler.executor`
3. Add lifecycle hooks as needed
4. Configure loop settings if using multi-round execution

```typescript
// Before
const stream = request(model, messages, {
    tools,
    processToolCall: myHandler,
    maxToolCalls: 10
});

// After
const stream = enhancedRequest(model, messages, {
    tools,
    toolHandler: {
        executor: myHandler
    },
    maxToolCalls: 10
});
```

## Best Practices

1. **Use Categories**: Organize tools into logical categories
2. **Set Priorities**: Use priority to control execution order
3. **Add Constraints**: Use maxExecutions and cooldown to prevent abuse
4. **Handle Errors**: Provide onToolError handlers for graceful failures
5. **Monitor Metrics**: Use debug mode to track performance
6. **Cache Results**: Enable caching for expensive idempotent operations
7. **Validate Results**: Use validators to ensure tool output quality