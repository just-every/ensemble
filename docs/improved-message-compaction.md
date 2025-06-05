# Improved Message History Compaction

The ensemble library now features an enhanced message history compaction system that better preserves conversation context while managing token limits efficiently.

## Overview

The new hybrid compaction approach combines multiple strategies to maintain conversation continuity:

1. **Pinned Messages** - Important messages can be pinned to prevent compaction
2. **Chronological Micro-logs** - One-line summaries of each interaction
3. **Structured Information Extraction** - Automatic extraction of entities, decisions, todos, and tool usage
4. **Recent Tail Preservation** - Keeps the most recent messages intact
5. **AI-Powered Summarization** - Creates detailed summaries of older content

## Key Features

### Message Pinning

Pin important messages to ensure they're never removed during compaction:

```typescript
const history = new MessageHistory();

// Add an important message
await history.add({
    type: 'message',
    role: 'user',
    content: 'IMPORTANT: API key is XYZ123, never expose it publicly',
});

// Pin the message (by index)
history.pinMessage(history.count() - 1);
```

### Micro-Log Tracking

Every message is automatically summarized into a one-line entry:

```typescript
const microLog = history.getMicroLog();
// Returns:
// [
//   { timestamp: 1234567890, role: 'user', summary: 'Asked about weather API' },
//   { timestamp: 1234567891, role: 'assistant', summary: 'Explained how to use OpenWeather API' },
//   { timestamp: 1234567892, role: 'tool', summary: 'Called fetch_weather()' }
// ]
```

### Information Extraction

The system automatically extracts key information from conversations:

```typescript
const info = history.getExtractedInfo();
// Returns:
// {
//   entities: Set { '/src/app.ts', 'https://api.example.com', 'user@email.com' },
//   decisions: ['implement caching using Redis', 'use JWT for authentication'],
//   todos: ['Add error handling for network failures', 'Write unit tests'],
//   tools: [
//     { name: 'read_file', purpose: 'Information retrieval' },
//     { name: 'write_file', purpose: 'Content creation' }
//   ]
// }
```

## Compaction Process

When the message history approaches the token limit, the compaction process:

1. **Separates pinned and unpinned messages** - Pinned messages are always preserved
2. **Calculates token budgets** - Determines how much space to allocate for each section
3. **Preserves recent messages** - Keeps the most recent 30% of messages intact
4. **Creates hybrid summary** containing:
   - Conversation flow from micro-logs
   - Extracted entities, decisions, and todos
   - AI-generated detailed summary
5. **Reconstructs history** with pinned messages, summary, and recent tail

## Configuration

```typescript
const history = new MessageHistory([], {
    modelId: 'gpt-4',              // Model for context-aware compaction
    compactionThreshold: 0.7,       // Compact at 70% of context limit
    preserveSystemMessages: true,   // Always keep system messages
    compactToolCalls: true,         // Compact consecutive tool calls
});
```

## Example Summary Format

After compaction, older messages are replaced with a structured summary:

```
[Previous Conversation Summary]

## Conversation Flow
- user: Asked about building a React app with TypeScript
- assistant: Provided project structure and setup instructions
- tool: Called create_file()
- user: Requested offline functionality with IndexedDB
- assistant: Explained offline-first architecture

## Key Information

### Entities
- /src/index.tsx
- /package.json
- https://reactjs.org
- IndexedDB

### Decisions
- Use React with TypeScript for the frontend
- Implement offline-first architecture
- Store data in IndexedDB for offline access

### Pending Tasks
- Create proper project structure with components folder
- Research specific libraries for offline sync
- Implement data synchronization logic

### Tools Used
- create_file: Content creation
- search_documentation: Information retrieval

## Detailed Summary
The user is building a React TypeScript web application with offline capabilities. 
The project has been initialized with basic files, and the architecture decisions 
include using IndexedDB for local storage and implementing sync mechanisms for 
when the app comes back online.
```

## Best Practices

1. **Pin Critical Information** - Pin messages containing API keys, important decisions, or context that must be preserved
2. **Use Descriptive Messages** - Clear, descriptive messages extract better information
3. **Monitor Token Usage** - Set appropriate compaction thresholds based on your model's context
4. **Review Extracted Info** - Periodically check what information is being extracted and preserved

## API Reference

### MessageHistory Methods

- `pinMessage(index: number): void` - Pin a message by index
- `getMicroLog(): MicroLogEntry[]` - Get the conversation micro-log
- `getExtractedInfo(): ExtractedInfo` - Get extracted entities, decisions, todos, and tools
- `getMessages(): ResponseInput` - Get current messages (including any summaries)

### Types

```typescript
interface MicroLogEntry {
    timestamp?: number;
    role: string;
    summary: string;
}

interface ExtractedInfo {
    entities: Set<string>;
    decisions: string[];
    todos: string[];
    tools: Array<{ name: string; purpose: string }>;
}
```

## Migration

The new compaction system is backward compatible. Existing code will continue to work, with the additional benefits of:

- Better context preservation through micro-logs
- Automatic information extraction
- More intelligent summarization

To take full advantage of the new features, consider:

1. Pinning important messages
2. Using the extracted information for context awareness
3. Adjusting compaction thresholds based on your use case