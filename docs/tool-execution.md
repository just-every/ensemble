# Tool Execution Guide

This guide covers the advanced tool execution features in Ensemble, including timeout handling, sequential execution, background processing, and result summarization.

## Table of Contents
- [Overview](#overview)
- [Basic Tool Execution](#basic-tool-execution)
- [Advanced Features](#advanced-features)
  - [Timeout Handling](#timeout-handling)
  - [Sequential Execution](#sequential-execution)
  - [Background Tool Tracking](#background-tool-tracking)
  - [Result Processing](#result-processing)
- [Configuration](#configuration)
- [Examples](#examples)

## Overview

Ensemble provides a comprehensive tool execution system that handles:
- Parallel and sequential tool execution
- Automatic timeout management
- Background tool tracking
- Result summarization and truncation
- Tool lifecycle callbacks

## Basic Tool Execution

Tools are executed automatically when an LLM requests them:

```typescript
import { ensembleRequest } from '@just-every/ensemble';

const agent = {
    model: 'o3',
    agent_id: 'my-agent',
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
            // Your implementation
            return `Weather in ${location}: Sunny, 72°F`;
        }
    }]
};

// Tools are called automatically when the LLM requests them
for await (const event of ensembleRequest(messages, agent)) {
    // Handle events
}
```

## Advanced Features

### Timeout Handling

Tools can be configured to timeout after a specified duration. This is useful for long-running operations:

```typescript
import { FUNCTION_TIMEOUT_MS } from '@just-every/ensemble';

// Default timeout is 30 seconds
// Tools with status tracking will timeout and continue in background
const agent = {
    model: 'o3',
    tools: [
        // This tool enables status tracking for the agent
        {
            definition: {
                type: 'function',
                function: {
                    name: 'get_running_tools',
                    description: 'Get list of running tools',
                    parameters: { type: 'object', properties: {}, required: [] }
                }
            },
            function: async () => {
                const tools = runningToolTracker.getAllRunningTools();
                return JSON.stringify(tools);
            }
        },
        // This tool will timeout after 30s
        {
            definition: {
                type: 'function',
                function: {
                    name: 'long_running_task',
                    description: 'A task that takes a long time',
                    parameters: { type: 'object', properties: {}, required: [] }
                }
            },
            function: async () => {
                await new Promise(resolve => setTimeout(resolve, 60000));
                return 'Task completed';
            }
        }
    ]
};
```

Some tools are excluded from timeout by default:
- `wait_for_running_tool`
- `run_shell_command_with_output`
- `execute_code`
- `debug_code`
- `test_code`

### Sequential Execution

Enable sequential tool execution to ensure tools run one at a time:

```typescript
const agent = {
    model: 'o3',
    modelSettings: {
        sequential_tools: true // Tools will execute one at a time
    },
    tools: [/* your tools */]
};
```

### Background Tool Tracking

Track and manage tools running in the background:

```typescript
import { runningToolTracker } from '@just-every/ensemble';

// Monitor tool completions
runningToolTracker.onCompletion((event) => {
    console.log(`Tool ${event.toolName} completed in ${event.duration}ms`);
    if (event.timedOut) {
        console.log('This tool timed out but completed in background');
    }
});

// Get running tools
const runningTools = runningToolTracker.getAllRunningTools();

// Wait for a specific tool
const result = await runningToolTracker.waitForTool('tool-id', 5000);

// Abort a running tool
runningToolTracker.abortRunningTool('tool-id');
```

### Result Processing

Long tool results are automatically summarized or truncated:

```typescript
import { TOOL_CONFIGS } from '@just-every/ensemble';

// Configure tool-specific handling
const myToolConfig = {
    read_source: {
        skipSummarization: true,
        maxLength: 1000,
        truncationMessage: '\n\n[Full output truncated]'
    }
};

// Results over 1000 characters are summarized by default
// Unless the tool is configured to skip summarization
```

## Configuration

### Tool Execution Configuration

```typescript
// config/tool_execution.ts
export const FUNCTION_TIMEOUT_MS = 30000; // 30 seconds

export const EXCLUDED_FROM_TIMEOUT_FUNCTIONS = new Set([
    'wait_for_running_tool',
    'run_shell_command_with_output',
    // Add your tools here
]);

export const SKIP_SUMMARIZATION_TOOLS = new Set([
    'read_source',
    'get_page_content',
    'read_file',
    'list_files',
]);

export const TOOL_CONFIGS = {
    read_source: {
        skipSummarization: true,
        maxLength: 1000,
        truncationMessage: '\n\n[Use write_source to save full output]',
    },
    // Add custom configurations
};
```

### Tool Lifecycle Callbacks

```typescript
const agent = {
    model: 'o3',
    
    // Called before tool execution
    onToolCall: async (toolCall) => {
        console.log(`Executing tool: ${toolCall.function.name}`);
        
        // Return SKIP to skip this tool
        // Return HALT to stop all tool execution
        return ToolCallAction.CONTINUE;
    },
    
    // Called after successful execution
    onToolResult: async (result) => {
        console.log(`Tool completed: ${result.output}`);
    },
    
    // Called on tool error
    onToolError: async (result) => {
        console.error(`Tool failed: ${result.output}`);
    }
};
```

## Examples

### Example 1: Tool with Abort Signal

```typescript
const tool = {
    definition: {
        type: 'function',
        function: {
            name: 'interruptible_task',
            description: 'A task that can be interrupted',
            parameters: { type: 'object', properties: {}, required: [] }
        }
    },
    function: async (signal?: AbortSignal) => {
        for (let i = 0; i < 100; i++) {
            if (signal?.aborted) {
                return 'Task was cancelled';
            }
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        return 'Task completed';
    },
    injectAbortSignal: true // Automatically inject abort signal
};
```

### Example 2: Tool with Agent ID

```typescript
const tool = {
    definition: {
        type: 'function',
        function: {
            name: 'agent_specific_tool',
            description: 'A tool that needs agent context',
            parameters: {
                type: 'object',
                properties: {
                    message: { type: 'string' }
                },
                required: ['message']
            }
        }
    },
    function: async (agentId: string, message: string) => {
        return `Agent ${agentId} says: ${message}`;
    },
    injectAgentId: true // Agent ID is injected as first parameter
};
```

### Example 3: Custom Result Processing

```typescript
import { processToolResult, shouldSummarizeResult } from '@just-every/ensemble';

// Manually process a tool result
const toolCall = {
    id: 'test-id',
    type: 'function',
    function: {
        name: 'my_tool',
        arguments: '{}'
    }
};

const rawResult = 'Very long output...'.repeat(1000);
const processedResult = await processToolResult(toolCall, rawResult);

// Check if summarization is needed
if (shouldSummarizeResult('my_tool', rawResult.length)) {
    console.log('This result will be summarized');
}
```

### Example 4: Sequential Queue Management

```typescript
import { runSequential } from '@just-every/ensemble';

// Ensure operations run sequentially for an agent
const result1 = await runSequential('agent-1', async () => {
    // This runs first
    return 'result1';
});

const result2 = await runSequential('agent-1', async () => {
    // This waits for result1 to complete
    return 'result2';
});

// Different agents run in parallel
const result3 = await runSequential('agent-2', async () => {
    // This runs immediately, parallel to agent-1
    return 'result3';
});
```

## Best Practices

1. **Enable Status Tracking**: Include status tracking tools (`get_running_tools`, `wait_for_running_tool`) to enable timeout handling.

2. **Use Sequential Execution Carefully**: Only enable sequential execution when tools have dependencies or shared state.

3. **Configure Tool-Specific Handling**: Use `TOOL_CONFIGS` to customize how each tool's results are processed.

4. **Handle Timeouts Gracefully**: Tools that timeout continue running in the background. Use the running tool tracker to monitor completion.

5. **Implement Abort Signals**: For long-running tools, implement abort signal support to allow graceful cancellation.

6. **Test Tool Interactions**: Test tools both individually and in combination to ensure they work correctly together.