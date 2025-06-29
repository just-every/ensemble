# Cost Event Emission in Streams

As of version 0.3.0+, the ensemble library emits `cost_update` events directly in provider response streams. This provides a unified way to track costs in real-time as responses are generated.

## How It Works

Model providers now emit `cost_update` events as part of their response streams. When token usage data is available (either from the API or through estimation), providers yield a `cost_update` event that can be consumed alongside other stream events.

## Event Structure

```typescript
interface CostUpdateEvent {
    type: 'cost_update';
    usage: {
        model: string;
        input_tokens: number;
        output_tokens: number;
        total_tokens: number;
        cached_tokens?: number;
        cost?: number;
        metadata?: {
            estimated?: boolean;
            [key: string]: any;
        };
    };
}
```

## Basic Usage

```typescript
import { ensembleRequest } from '@just-every/ensemble';

// Make requests - cost events are included in the stream
const stream = ensembleRequest([
    { role: 'user', content: 'Hello!' }
], { model: 'gpt-3.5-turbo' });

for await (const event of stream) {
    if (event.type === 'cost_update') {
        console.log(`Tokens used - Input: ${event.usage.input_tokens}, Output: ${event.usage.output_tokens}`);
        console.log(`Cost: $${event.usage.cost?.toFixed(6)}`);
    }
}
```

## Token Estimation

For providers that don't return token usage data (e.g., XAI, DeepSeek, OpenRouter), the library automatically estimates tokens using a character-based approximation (1 token ≈ 4 characters). These estimates are marked with `metadata.estimated = true`.

```typescript
for await (const event of stream) {
    if (event.type === 'cost_update') {
        if (event.usage.metadata?.estimated) {
            console.log('Note: Token counts are estimated');
        }
        console.log(`Tokens: ${event.usage.total_tokens}`);
    }
}
```

## Advanced Cost Tracking

You can build sophisticated cost monitoring systems using these events:

```typescript
class StreamCostTracker {
    private modelCosts = new Map<string, number>();
    
    async processStream(stream: AsyncGenerator<ProviderStreamEvent>) {
        for await (const event of stream) {
            if (event.type === 'cost_update') {
                this.recordCost(event.usage);
            }
            // Handle other events...
        }
    }
    
    private recordCost(usage: ModelUsage) {
        const current = this.modelCosts.get(usage.model) || 0;
        this.modelCosts.set(usage.model, current + (usage.cost || 0));
    }
}
```

## When Events Are Emitted

Cost events are emitted in the following scenarios:

1. **After streaming completes** - Most providers emit usage data after the full response
2. **For embeddings** - When embedding requests complete
3. **For image generation** - When images are generated
4. **For cached tokens** - When providers report cache usage (e.g., Claude, GPT-4)
5. **With token estimation** - When providers don't return usage data

## Provider Support

| Provider | Real Usage Data | Token Estimation |
|----------|----------------|------------------|
| OpenAI | ✅ | - |
| Anthropic (Claude) | ✅ | - |
| Google (Gemini) | ✅ | ✅ (fallback) |
| XAI (Grok) | ❌ | ✅ |
| DeepSeek | ❌ | ✅ |
| OpenRouter | ❌ | ✅ |

## Backwards Compatibility

The `costTracker.onAddUsage()` callback mechanism continues to work for custom integrations. Callbacks are triggered synchronously when usage is recorded.

```typescript
import { costTracker } from '@just-every/ensemble';

// Legacy callback approach still works
costTracker.onAddUsage((usage) => {
    console.log(`Usage recorded for ${usage.model}`);
});
```

## Performance Considerations

- Cost events are yielded synchronously as part of the stream
- Token estimation is lightweight (simple character counting)
- No duplicate events - each provider emits exactly one cost_update per request

## See Also

- [Event Controller Documentation](./event-controller.md)
- [Cost Tracking Example](../examples/cost-event-tracking.ts)
- [Tool Execution Events](./tool-execution.md)