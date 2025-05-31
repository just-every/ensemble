# Error Handling & Resilience

## Error Types

```typescript
import { isRateLimitError, isAuthenticationError } from '@just-every/ensemble';
```

## Robust Request Pattern

```typescript
async function robustRequest(model: string, messages: ResponseInput, options?: RequestOptions) {
  const maxRetries = 3;
  let lastError;
  
  for (let i = 0; i < maxRetries; i++) {
    try {
      const events = [];
      for await (const event of request(model, messages, options)) {
        if (event.type === 'error') {
          throw event.error;
        }
        events.push(event);
      }
      return events;
      
    } catch (error) {
      lastError = error;
      
      if (isAuthenticationError(error)) {
        throw error; // Don't retry auth errors
      }
      
      if (isRateLimitError(error)) {
        const waitTime = error.retryAfter || Math.pow(2, i) * 1000;
        console.log(`Rate limited. Waiting ${waitTime}ms...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
        continue;
      }
      
      // Try fallback model
      if (options?.fallbackModels?.[i]) {
        model = options.fallbackModels[i];
        console.log(`Falling back to ${model}`);
        continue;
      }
    }
  }
  
  throw lastError;
}
```

## Using Fallback Models

```typescript
const stream = request('gpt-4o', messages, {
  fallbackModels: ['gpt-4o-mini', 'claude-3.5-haiku']
});
```

## Handling Stream Interruptions

```typescript
const stream = request('claude-3.5-sonnet', messages);

try {
  for await (const event of stream) {
    // Process events
    if (event.type === 'text_delta') {
      console.log(event.delta);
    }
  }
} catch (error) {
  if (error.name === 'AbortError') {
    console.log('Stream was interrupted');
  } else {
    console.error('Stream error:', error);
  }
}
```

## Early Termination

```typescript
const stream = request('claude-3.5-sonnet', [
  { type: 'message', role: 'user', content: 'Count to 100' }
]);

let count = 0;
for await (const event of stream) {
  if (event.type === 'text_delta') {
    count++;
    if (count >= 10) break; // Stop after 10 events
  }
}
```