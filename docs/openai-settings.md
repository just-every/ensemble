# OpenAI-Specific Settings

The ensemble package now supports OpenAI's new `verbosity` and `service_tier` settings, allowing fine-grained control over response generation.

## Verbosity Setting

Controls how detailed or concise the model's responses are.

### Options:
- `'low'` - Concise, to-the-point responses
- `'medium'` - Balanced detail (default)
- `'high'` - Verbose, detailed responses

### Usage:
```typescript
import { ensembleRequest } from '@just-every/ensemble';

const agent = {
    agent_id: 'my-agent',
    modelSettings: {
        verbosity: 'low', // Keep responses concise
        temperature: 0.7
    }
};

const response = await ensembleRequest(
    messages,
    'gpt-4o',
    agent
);
```

## Service Tier Setting

Specifies the processing type used for serving the request, affecting speed and potentially pricing.

### Options:
- `'auto'` - Uses project default setting
- `'default'` - Standard pricing and performance
- `'flex'` - Flexible processing (may have variable latency)
- `'priority'` - Faster processing (requires special access from OpenAI)

### Usage:
```typescript
const agent = {
    agent_id: 'priority-agent',
    modelSettings: {
        service_tier: 'priority', // Request priority processing
        verbosity: 'medium'
    }
};
```

## Combined Example

```typescript
import { ensembleRequest } from '@just-every/ensemble';
import { AgentDefinition } from '@just-every/ensemble/types';

// Customer support bot: concise responses with flexible processing
const supportBot: AgentDefinition = {
    agent_id: 'support-bot',
    modelSettings: {
        temperature: 0.3,        // Consistent responses
        verbosity: 'low',        // Keep it concise
        service_tier: 'flex',    // Cost-optimized processing
        max_tokens: 150         // Limit response length
    }
};

// Technical documentation generator: detailed responses with standard processing
const docGenerator: AgentDefinition = {
    agent_id: 'doc-generator',
    modelSettings: {
        temperature: 0.5,
        verbosity: 'high',       // Detailed explanations
        service_tier: 'default'  // Standard processing
    }
};
```

## Important Notes

1. **Provider Compatibility**: These settings are OpenAI-specific and will be silently ignored by other providers (Anthropic, Google, etc.).

2. **Priority Access**: The `'priority'` service tier requires special access from OpenAI. Contact their sales team for availability.

3. **Response Behavior**: The actual service tier used may differ from the requested one and will be returned in the response.

4. **Combining with Other Settings**: Verbosity works well with `max_tokens` to control both the style and length of responses.

5. **Cost Implications**: Different service tiers may have different pricing. Check OpenAI's current pricing documentation.

## TypeScript Support

The settings are fully typed in the `ModelSettings` interface:

```typescript
interface ModelSettings {
    // ... other settings ...
    
    // OpenAI-specific settings
    verbosity?: 'low' | 'medium' | 'high';
    service_tier?: 'auto' | 'default' | 'flex' | 'priority';
}
```

## Migration Guide

If you're upgrading from a previous version:

1. No breaking changes - these are optional settings
2. Existing code will continue to work without modification
3. Add the new settings only where you need fine-grained control

## Testing

See `test/openai-settings.test.ts` for unit tests and `examples/openai-verbosity-example.ts` for a complete working example.