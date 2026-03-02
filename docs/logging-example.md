# Trace Logging Example

This guide shows the new trace logging API for `@just-every/ensemble` using:

- `turn_*` events for the overall user turn
- `request_*` events for each model request round within that turn
- `tool_start` / `tool_done` events tied to the request that triggered the tool call

Unlike raw stream logging, this trace API intentionally emits only high-signal lifecycle events, not every thinking or delta event.

Trace logging is currently wired into:

- `ensembleRequest` (chat/tool-call turns)
- `ensembleImage` (image generation turns)
- `ensembleEmbed` (embedding requests)
- `ensembleListen` (transcription requests)
- `ensembleVoice` (voice generation requests)
- `ensembleLive` / `ensembleLiveAudio` (live session requests)

## Event Model

The trace logger emits:

1. `turn_start`
2. `request_start` (includes request payload)
3. `tool_start` / `tool_done` (zero or more)
4. `request_end`
5. Repeat `request_start ... request_end` for additional request rounds
6. `turn_end`

Each event includes:

- `turn_id`: Shared by all events in the same top-level turn
- `request_id`: Shared by all events in the same model request round
- `sequence`: Monotonic sequence per turn
- `timestamp`: ISO timestamp
- `data`: Event-specific metadata

## Complete Example

```typescript
import {
    ensembleRequest,
    setEnsembleTraceLogger,
    EnsembleTraceLogger,
    EnsembleTraceEvent,
    AgentDefinition,
    ResponseInput,
} from '@just-every/ensemble';

// Minimal DB adapter so this example stays framework-agnostic.
interface TraceDB {
    insert(event: EnsembleTraceEvent): Promise<void>;
}

class InMemoryTraceDB implements TraceDB {
    private events: EnsembleTraceEvent[] = [];

    async insert(event: EnsembleTraceEvent): Promise<void> {
        this.events.push(event);
    }

    getAll(): EnsembleTraceEvent[] {
        return [...this.events];
    }
}

class DatabaseTraceLogger implements EnsembleTraceLogger {
    constructor(private db: TraceDB) {}

    async log_trace_event(event: EnsembleTraceEvent): Promise<void> {
        // Store exactly what ensemble emits.
        await this.db.insert(event);
    }
}

async function main() {
    const traceDB = new InMemoryTraceDB();
    const traceLogger = new DatabaseTraceLogger(traceDB);

    // Register trace logger (pass null to clear existing loggers)
    setEnsembleTraceLogger(traceLogger);

    const messages: ResponseInput = [
        { type: 'message', role: 'user', content: 'Find weather in Brisbane and summarize it.' },
    ];

    const agent: AgentDefinition = {
        agent_id: 'weather-agent',
        model: 'gpt-4o-mini',
        tools: [
            {
                definition: {
                    type: 'function',
                    function: {
                        name: 'get_weather',
                        description: 'Get weather for a location',
                        parameters: {
                            type: 'object',
                            properties: {
                                location: { type: 'string', description: 'City name' },
                            },
                            required: ['location'],
                        },
                    },
                },
                function: async (location: string) => {
                    return `Weather for ${location}: 24C and sunny`;
                },
            },
        ],
    };

    // Run request normally. Trace events are logged automatically.
    for await (const event of ensembleRequest(messages, agent)) {
        if (event.type === 'message_complete' && event.content) {
            console.log('Assistant:', event.content);
        }
    }

    // Inspect logged trace events
    console.log('\n=== TRACE EVENTS ===');
    for (const event of traceDB.getAll()) {
        console.log(
            JSON.stringify({
                sequence: event.sequence,
                type: event.type,
                turn_id: event.turn_id,
                request_id: event.request_id,
                tool_call_id: event.tool_call_id,
                data: event.data,
            })
        );
    }
}

if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch(console.error);
}
```

## What `request_start` Contains

`request_start` includes the payload that will be used for that request round. Payload shape depends on operation:

- Chat: `messages`, `model_settings`, `tool_names`
- Image: `prompt`, image `options`
- Embed: `text`, embed `options`
- Voice: `text`, voice `options`
- Listen: source metadata + transcription `options`
- Live: live `config` + request `options`

This makes it straightforward for clients to persist the exact request context before tool calls and final output events arrive.

## Example Event Sequence

```json
{ "sequence": 1, "type": "turn_start", "turn_id": "turn_abc", "data": { "agent_id": "weather-agent" } }
{ "sequence": 2, "type": "request_start", "turn_id": "turn_abc", "request_id": "req_1", "data": { "payload": { "messages": [ ... ] } } }
{ "sequence": 3, "type": "tool_start", "turn_id": "turn_abc", "request_id": "req_1", "tool_call_id": "call_1", "data": { "tool_name": "get_weather" } }
{ "sequence": 4, "type": "tool_done", "turn_id": "turn_abc", "request_id": "req_1", "tool_call_id": "call_1", "data": { "output": "Weather for Brisbane: 24C and sunny" } }
{ "sequence": 5, "type": "request_end", "turn_id": "turn_abc", "request_id": "req_1", "data": { "status": "waiting_for_followup_request" } }
{ "sequence": 6, "type": "request_start", "turn_id": "turn_abc", "request_id": "req_2", "data": { "payload": { "messages": [ ... ] } } }
{ "sequence": 7, "type": "request_end", "turn_id": "turn_abc", "request_id": "req_2", "data": { "status": "completed", "final_response": "Brisbane is 24C and sunny..." } }
{ "sequence": 8, "type": "turn_end", "turn_id": "turn_abc", "data": { "status": "completed", "request_count": 2 } }
```

## Legacy LLM Logger

`setEnsembleLogger` still works for provider-level request/response/error logging. Use `setEnsembleTraceLogger` when you want turn/request/tool lifecycle logging with stable IDs and request payload snapshots.
