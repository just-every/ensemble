# Logging Example

This example demonstrates how to implement a custom logger for @just-every/ensemble that captures all LLM requests and responses in a JSON array format.

## Complete Example

```typescript
import {
    EnsembleLogger,
    setEnsembleLogger,
    ensembleRequest,
    AgentDefinition,
} from '@just-every/ensemble';

// Define types for our log entries
interface LogEntry {
    id: string;
    type: 'request' | 'response' | 'error';
    timestamp: Date;
    agentId?: string;
    provider?: string;
    model?: string;
    data: unknown;
}

interface RequestResponsePair {
    requestId: string;
    request?: LogEntry;
    response?: LogEntry;
    error?: LogEntry;
    duration?: number;
}

// Implement a JSON Array Logger
export class JSONArrayLogger implements EnsembleLogger {
    private logs: RequestResponsePair[] = [];
    private pendingRequests: Map<string, RequestResponsePair> = new Map();

    log_llm_request(
        agentId: string,
        providerName: string,
        model: string,
        requestData: unknown,
        timestamp?: Date
    ): string {
        const requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const logEntry: LogEntry = {
            id: requestId,
            type: 'request',
            timestamp: timestamp || new Date(),
            agentId,
            provider: providerName,
            model,
            data: requestData,
        };

        const pair: RequestResponsePair = {
            requestId,
            request: logEntry,
        };

        this.pendingRequests.set(requestId, pair);
        
        console.log(`[Logger] Request ${requestId} - ${model} via ${providerName}`);
        
        return requestId;
    }

    log_llm_response(
        requestId: string | undefined,
        responseData: unknown,
        timestamp?: Date
    ): void {
        if (!requestId) {
            console.warn('[Logger] Response logged without request ID');
            return;
        }

        const pair = this.pendingRequests.get(requestId);
        if (pair) {
            const responseEntry: LogEntry = {
                id: `res_${requestId}`,
                type: 'response',
                timestamp: timestamp || new Date(),
                data: responseData,
            };

            pair.response = responseEntry;
            
            // Calculate duration if we have both request and response
            if (pair.request) {
                pair.duration = responseEntry.timestamp.getTime() - pair.request.timestamp.getTime();
            }

            // Move from pending to completed logs
            this.logs.push(pair);
            this.pendingRequests.delete(requestId);
            
            console.log(`[Logger] Response ${requestId} - Duration: ${pair.duration}ms`);
        }
    }

    log_llm_error(
        requestId: string | undefined,
        errorData: unknown,
        timestamp?: Date
    ): void {
        if (!requestId) {
            console.warn('[Logger] Error logged without request ID');
            return;
        }

        const pair = this.pendingRequests.get(requestId) || { requestId };
        
        const errorEntry: LogEntry = {
            id: `err_${requestId}`,
            type: 'error',
            timestamp: timestamp || new Date(),
            data: errorData,
        };

        pair.error = errorEntry;
        
        // Move from pending to completed logs (even if we don't have the request)
        this.logs.push(pair);
        this.pendingRequests.delete(requestId);
        
        console.log(`[Logger] Error ${requestId}:`, errorData);
    }

    // Helper methods to access the logs
    getAllLogs(): RequestResponsePair[] {
        return [...this.logs];
    }

    getLogsByModel(model: string): RequestResponsePair[] {
        return this.logs.filter(pair => pair.request?.model === model);
    }

    getLogsByProvider(provider: string): RequestResponsePair[] {
        return this.logs.filter(pair => pair.request?.provider === provider);
    }

    getErrorLogs(): RequestResponsePair[] {
        return this.logs.filter(pair => pair.error !== undefined);
    }

    exportAsJSON(): string {
        return JSON.stringify(this.logs, null, 2);
    }

    exportSummary(): object {
        const summary = {
            totalRequests: this.logs.length,
            pendingRequests: this.pendingRequests.size,
            errors: this.logs.filter(p => p.error).length,
            averageDuration: 0,
            byModel: {} as Record<string, number>,
            byProvider: {} as Record<string, number>,
        };

        let totalDuration = 0;
        let durationCount = 0;

        for (const pair of this.logs) {
            if (pair.duration) {
                totalDuration += pair.duration;
                durationCount++;
            }

            if (pair.request?.model) {
                summary.byModel[pair.request.model] = (summary.byModel[pair.request.model] || 0) + 1;
            }

            if (pair.request?.provider) {
                summary.byProvider[pair.request.provider] = (summary.byProvider[pair.request.provider] || 0) + 1;
            }
        }

        summary.averageDuration = durationCount > 0 ? totalDuration / durationCount : 0;

        return summary;
    }

    clearLogs(): void {
        this.logs = [];
        this.pendingRequests.clear();
    }
}

// Usage Example
async function main() {
    // Create and set the logger
    const logger = new JSONArrayLogger();
    setEnsembleLogger(logger);

    // Define some example messages
    const messages = [
        { role: 'user' as const, content: 'What is the weather like today?' },
    ];

    // Make some requests with different models
    const agents: AgentDefinition[] = [
        { modelClass: 'mini' },
        { model: 'gpt-4o-mini' },
        { model: 'claude-3-5-haiku-latest' },
    ];

    console.log('Starting LLM requests...\n');

    // Execute requests
    for (const agent of agents) {
        try {
            console.log(`Making request with agent:`, agent);
            
            for await (const event of ensembleRequest(messages, agent)) {
                if (event.type === 'message_complete') {
                    console.log(`Response: ${event.content}\n`);
                }
            }
        } catch (error) {
            console.error(`Error with agent ${JSON.stringify(agent)}:`, error);
        }
    }

    // Display the collected logs
    console.log('\n=== LOG SUMMARY ===');
    console.log(JSON.stringify(logger.exportSummary(), null, 2));

    console.log('\n=== ALL LOGS (JSON) ===');
    console.log(logger.exportAsJSON());

    // Example: Get logs for a specific model
    const gptLogs = logger.getLogsByModel('gpt-4o-mini');
    console.log(`\n=== GPT-4O-MINI LOGS (${gptLogs.length} requests) ===`);
    console.log(JSON.stringify(gptLogs, null, 2));

    // Example: Get error logs
    const errorLogs = logger.getErrorLogs();
    if (errorLogs.length > 0) {
        console.log(`\n=== ERROR LOGS (${errorLogs.length} errors) ===`);
        console.log(JSON.stringify(errorLogs, null, 2));
    }
}

// Run the example
if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch(console.error);
}
```

## Key Features

1. **Request ID Generation**: Each request gets a unique ID for tracking
2. **Request-Response Pairing**: Automatically matches responses to their requests
3. **Duration Tracking**: Calculates how long each request took
4. **Error Handling**: Captures and logs errors with their request context
5. **Export Options**: Export as JSON or get summaries
6. **Filtering**: Filter logs by model, provider, or error status

## Output Example

When you run this logger, you'll get output like:

```json
{
  "totalRequests": 3,
  "pendingRequests": 0,
  "errors": 0,
  "averageDuration": 523.5,
  "byModel": {
    "gpt-4o-mini": 1,
    "claude-3-5-haiku-latest": 1,
    "gemini-2.0-flash-thinking-exp-1219": 1
  },
  "byProvider": {
    "openai": 1,
    "anthropic": 1,
    "google": 1
  }
}
```

And detailed logs like:

```json
[
  {
    "requestId": "req_1234567890_abc123",
    "request": {
      "id": "req_1234567890_abc123",
      "type": "request",
      "timestamp": "2024-01-15T10:30:00.000Z",
      "agentId": "agent_123",
      "provider": "openai",
      "model": "gpt-4o-mini",
      "data": {
        "messages": [
          {
            "role": "user",
            "content": "What is the weather like today?"
          }
        ],
        "temperature": 0.7
      }
    },
    "response": {
      "id": "res_req_1234567890_abc123",
      "type": "response",
      "timestamp": "2024-01-15T10:30:00.523Z",
      "data": {
        "content": "I don't have access to real-time weather data...",
        "usage": {
          "promptTokens": 15,
          "completionTokens": 45,
          "totalTokens": 60
        }
      }
    },
    "duration": 523
  }
]
```

## Integration Tips

1. **Persistence**: You can easily extend this logger to save logs to a file or database
2. **Filtering**: Add more sophisticated filtering based on your needs
3. **Analytics**: Use the collected data for performance monitoring and cost analysis
4. **Debugging**: The structured logs make it easy to debug issues with specific requests
5. **Compliance**: Can be extended to handle data retention policies or PII redaction