# Utility Functions

## Stream Conversion

### convertStreamToMessages

Convert streaming events to conversation history for chaining requests:

```typescript
import { convertStreamToMessages } from '@just-every/ensemble';

const stream = request('claude-3.5-sonnet', [
  { type: 'message', role: 'user', content: 'Write a haiku about coding' }
]);

const result = await convertStreamToMessages(stream);
console.log(result.messages);     // Full conversation history
console.log(result.fullResponse); // Just the assistant's response
console.log(result.toolCalls);    // Any tool calls made
```

## Image Utilities

### resizeImageForModel

Auto-resize images for specific model requirements:

```typescript
import { resizeImageForModel } from '@just-every/ensemble';

const resized = await resizeImageForModel(
  base64ImageData,
  'gpt-4o', // Different models have different size limits
  { maxDimension: 2048 }
);
```

### imageToText

Extract text from images:

```typescript
import { imageToText } from '@just-every/ensemble';

const extractedText = await imageToText(imageBuffer);
console.log('Found text:', extractedText);
```

## Cost Tracking

### CostTracker

Track usage and costs across all requests:

```typescript
import { costTracker } from '@just-every/ensemble';

// Get usage for a specific model
const usage = costTracker.getModelUsage('gpt-4o');
console.log(`Total cost: $${usage.total_cost}`);
console.log(`Requests: ${usage.request_count}`);

// Get all usage
const allUsage = costTracker.getAllUsage();

// Clear usage data
costTracker.clearUsage();
```

## Quota Management

### QuotaTracker

Manage API rate limits and quotas:

```typescript
import { quotaTracker } from '@just-every/ensemble';

// Check if request can be made
if (quotaTracker.canMakeRequest('gpt-4o', 'openai')) {
  // Safe to proceed
}

// Track usage
quotaTracker.trackUsage('openai', 'gpt-4o', {
  model: 'gpt-4o',
  input_tokens: 100,
  output_tokens: 200
});

// Get quota summary
const summary = quotaTracker.getQuotaSummary();
console.log(summary);
```

## Performance Optimization

### Batch Processing

```typescript
async function batchProcess(items: string[], concurrency = 3) {
  const results = [];
  const queue = [...items];
  
  async function worker() {
    while (queue.length > 0) {
      const item = queue.shift()!;
      const stream = request('gpt-4o-mini', [
        { type: 'message', role: 'user', content: `Process: ${item}` }
      ]);
      
      const result = await convertStreamToMessages(stream);
      results.push({ item, result: result.fullResponse });
    }
  }
  
  // Run workers concurrently
  await Promise.all(Array(concurrency).fill(null).map(() => worker()));
  return results;
}
```

### Parallel Streaming

```typescript
async function parallelStreaming(prompts: string[]) {
  const streams = prompts.map(prompt => 
    request('claude-3.5-haiku', [
      { type: 'message', role: 'user', content: prompt }
    ])
  );
  
  // Process all streams concurrently
  const results = await Promise.all(
    streams.map(stream => convertStreamToMessages(stream))
  );
  
  return results.map(r => r.fullResponse);
}
```