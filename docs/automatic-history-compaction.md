# Automatic History Compaction

Ensemble now includes automatic history compaction to manage long conversations efficiently. This feature ensures that your agents can handle extended conversations without running into context length limitations.

## Overview

When conversation history approaches 70% of a model's context limit, ensemble automatically:
1. Summarizes older messages into a compact form
2. Preserves recent messages in full detail
3. Maintains conversation continuity
4. Keeps system messages intact

## How It Works

### Automatic Triggering
- Monitors token usage relative to model's context length
- Triggers at 70% of context capacity (configurable)
- Uses the model specified in the Agent or ensembleRequest

### Compaction Process
1. **Preservation**: System messages are always preserved
2. **Summarization**: Older messages (first ~70%) are summarized using a fast summary model
3. **Retention**: Recent messages (last ~30%) are kept in full
4. **Reconstruction**: History is rebuilt with summary + recent messages

### Token Estimation
- Simple character-based estimation (4 characters ≈ 1 token)
- Handles all message types: text, tool calls, and tool outputs
- Updates automatically as messages are added

## Usage

### Basic Usage
```typescript
// Automatic compaction is enabled by default when using an agent with a model
const agent = new Agent({
    name: 'AssistantAgent',
    model: 'gpt-4.1-mini', // Has 1M context, compacts at 700k tokens
    instructions: 'You are a helpful assistant.'
});

// Just use ensembleRequest normally - compaction happens automatically
const stream = ensembleRequest(messages, agent);
```

### Custom Configuration
```typescript
import { MessageHistory } from '@just-every/ensemble';

// Create history with custom compaction settings
const history = new MessageHistory(messages, {
    modelId: 'gemini-2.5-flash-preview-05-20',
    compactionThreshold: 0.8, // Compact at 80% instead of default 70%
    preserveSystemMessages: true,
    compactToolCalls: true
});
```

### Disable Compaction
```typescript
// Set threshold to 0 to disable automatic compaction
const history = new MessageHistory(messages, {
    modelId: 'gpt-4.1',
    compactionThreshold: 0 // Disables compaction
});
```

## Examples

### Long Conversation Example
```typescript
const agent = new Agent({
    name: 'ConversationAgent',
    model: 'claude-3-5-haiku-latest', // 200k context
    instructions: 'Engage in detailed technical discussions.'
});

// Have a long conversation
for (let i = 0; i < 100; i++) {
    const userMessage = `Question ${i}: [detailed technical question]`;
    
    const stream = ensembleRequest([
        ...conversationHistory,
        { type: 'message', role: 'user', content: userMessage }
    ], agent);
    
    const result = await convertStreamToMessages(stream, messages, agent);
    conversationHistory.push(...result.messages);
    
    // Compaction happens automatically when needed
    // Older exchanges are summarized, recent ones preserved
}
```

### With History Thread
```typescript
const agent = new Agent({
    name: 'ThreadAgent',
    model: 'gpt-4.1',
    historyThread: existingConversation, // Uses this as base history
    instructions: 'Continue the conversation with context.'
});

// History thread is automatically managed with compaction
const stream = ensembleRequest(newMessages, agent);
```

## Summary Format

When compaction occurs, older messages are summarized into a system message:

```
[System] [Previous conversation summary]:
The conversation began with discussions about API design patterns. The user asked about REST vs GraphQL trade-offs, and we explored authentication strategies. Key decisions made:
- Chose GraphQL for the main API
- Implemented JWT-based authentication
- Set up rate limiting at 100 req/min
Tool calls included database schema generation and code examples for resolver implementations.
```

## Benefits

1. **Unlimited Conversations**: Continue conversations indefinitely without context limits
2. **Performance**: Maintains optimal performance by keeping context size manageable
3. **Context Preservation**: Important decisions and context are preserved in summaries
4. **Automatic**: No manual intervention required - happens transparently
5. **Configurable**: Adjust thresholds based on your needs

## Best Practices

1. **Model Selection**: Use models with larger contexts for extended conversations
2. **System Messages**: Keep system instructions concise as they're always preserved
3. **Threshold Tuning**: Lower thresholds (0.5-0.6) for very long conversations
4. **Summary Quality**: The summary model (modelClass: 'summary') provides fast, accurate summaries

## Technical Details

- **Character to Token Ratio**: Estimates 4 characters per token
- **Summary Model**: Uses fast models from the 'summary' class
- **Async Operations**: All compaction operations are asynchronous
- **Memory Efficient**: Only processes messages when approaching limits