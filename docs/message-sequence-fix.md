# Message Sequence Fix for Tool Calls

## Problem

The ensemble library was experiencing a bug where assistant text messages could be inserted between `tool_use` blocks and their corresponding `tool_result` blocks. This violates Claude's API requirements, which mandate that tool results must immediately follow their corresponding tool calls.

### Example of Invalid Sequence
```
1. Assistant message with tool_use
2. Assistant text message (from the same response) ❌
3. Tool result
```

This resulted in the following error:
```
Error: 400 {"type":"error","error":{"type":"invalid_request_error","message":"messages.5: `tool_use` ids were found without `tool_result` blocks immediately after: call_304fa59b-c7e9-419b-84e5-1efb8bf67b26. Each `tool_use` block must have a corresponding `tool_result` block in the next message."}}
```

## Solution

The fix implements a message reordering mechanism in the `MessageHistory` class that ensures proper sequencing of tool calls and their results.

### Key Features

1. **Automatic Reordering**: The `ensureToolResultSequence()` method is called automatically when retrieving messages via `getMessages()`.

2. **Tool Result Pairing**: Function calls (`function_call`) are always immediately followed by their corresponding outputs (`function_call_output`).

3. **Orphaned Output Handling**: Tool results without matching tool calls are converted to regular user messages.

4. **Missing Output Handling**: Tool calls without results get an artificial error output to maintain proper sequencing.

### Implementation Details

The solution adds the `ensureToolResultSequence()` method to `MessageHistory` class that:

- Iterates through all messages
- When it finds a `function_call`, it searches for the matching `function_call_output`
- If found later in the array, it moves the output immediately after the call
- If not found, it creates an error output
- Orphaned outputs are converted to regular messages

### Valid Sequence After Fix
```
1. Assistant message with tool_use
2. Tool result ✅
3. Assistant text message (if any)
```

## Usage

The fix is applied automatically when using the MessageHistory class. No changes are required to existing code that uses the ensemble library.

```typescript
const history = new MessageHistory();
// Add messages...
const messages = await history.getMessages(); // Automatically reordered
```

## Testing

The fix includes comprehensive tests in `test/message_sequence_fix.test.ts` that verify:
- Tool results immediately follow tool calls
- Orphaned tool results are handled correctly
- Missing tool results get error outputs
- Multiple interleaved tool calls are sequenced properly