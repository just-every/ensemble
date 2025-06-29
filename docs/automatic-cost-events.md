# Automatic Cost Event Emission

As of version 0.3.0, the ensemble library automatically emits `cost_update` events whenever token usage is recorded by any model provider. This provides a unified way to track costs across all requests without needing to manually set up callbacks.

## How It Works

When any model provider records token usage via `costTracker.addUsage()`, a `cost_update` event is automatically emitted through the global event controller if an event handler is set.

## Event Structure

```typescript
interface CostUpdateEvent {
    type: 'cost_update';
    usage: {
        input_tokens: number;
        output_tokens: number;
        total_tokens?: number;
        cached_tokens?: number;
    };
    timestamp: string;
}
```

## Basic Usage

```typescript
import { setEventHandler, ensembleRequest, CostUpdateEvent } from '@just-every/ensemble';

// Set up a global event handler
setEventHandler((event) => {
    if (event.type === 'cost_update') {
        const costEvent = event as CostUpdateEvent;
        console.log(`Tokens used - Input: ${costEvent.usage.input_tokens}, Output: ${costEvent.usage.output_tokens}`);
    }
});

// Make requests - cost events will be emitted automatically
const stream = ensembleRequest([
    { role: 'user', content: 'Hello!' }
], { model: 'gpt-3.5-turbo' });

for await (const event of stream) {
    // Process stream events
}
```

## Advanced Cost Tracking

You can build sophisticated cost monitoring systems using these events:

```typescript
class CostTracker {
    private modelCosts = new Map<string, number>();
    
    constructor() {
        setEventHandler(this.handleEvent.bind(this));
    }
    
    private handleEvent(event: ProviderStreamEvent) {
        if (event.type === 'cost_update') {
            // Track costs by model, time period, etc.
            this.recordCost(event as CostUpdateEvent);
        }
    }
    
    private recordCost(event: CostUpdateEvent) {
        // Implementation details...
    }
}
```

## Performance Considerations

- Events are emitted asynchronously to avoid blocking the main execution flow
- Events are only emitted if an event handler is set (checked via `hasEventHandler()`)
- Errors in event handlers are caught and logged, preventing them from affecting the main flow

## Backwards Compatibility

The existing `costTracker.onAddUsage()` callback mechanism continues to work alongside the automatic event emission. Both will be triggered when usage is recorded.

## When Events Are Emitted

Cost events are emitted in the following scenarios:

1. **After streaming completes** - Most providers emit usage data after the full response
2. **For embeddings** - When embedding requests complete
3. **For image generation** - When images are generated
4. **For cached tokens** - When providers report cache usage (e.g., Claude, GPT-4)

## Limitations

- The `cost_update` event doesn't include the model name (this would require changes to the ModelUsage interface)
- Events are emitted at the provider level, not per-message
- Some providers may not report token usage for certain operations

## See Also

- [Event Controller Documentation](./event-controller.md)
- [Cost Tracking Example](../examples/cost-event-tracking.ts)
- [Tool Execution Events](./tool-execution.md)