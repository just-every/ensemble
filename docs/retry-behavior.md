# Retry Behavior

Ensemble now includes automatic retry functionality for handling transient network errors and HTTP failures. This feature helps improve reliability when interacting with AI model providers.

## Overview

The retry mechanism automatically retries failed requests when:
- Network errors occur (connection resets, timeouts, DNS failures)
- Specific HTTP status codes are returned (429, 500, 502, 503, 504, etc.)
- Provider-specific errors occur (e.g., "Incomplete JSON segment")

## Default Behavior

By default, Ensemble will:
- Retry up to 3 times
- Use exponential backoff starting at 1 second
- Apply up to 10% jitter to prevent thundering herd
- Maximum delay between retries is 30 seconds

## Retryable Errors

### Network Errors
- `ECONNRESET` - Connection reset by peer
- `ETIMEDOUT` - Operation timed out
- `ENOTFOUND` - DNS lookup failed
- `ECONNREFUSED` - Connection refused
- `EPIPE` - Broken pipe
- `EHOSTUNREACH` - Host unreachable
- `EAI_AGAIN` - DNS lookup timeout
- `ENETUNREACH` - Network unreachable
- `ECONNABORTED` - Connection aborted
- `ESOCKETTIMEDOUT` - Socket timeout

### HTTP Status Codes
- `408` - Request Timeout
- `429` - Too Many Requests
- `500` - Internal Server Error
- `502` - Bad Gateway
- `503` - Service Unavailable
- `504` - Gateway Timeout
- `522` - Connection Timed Out
- `524` - A Timeout Occurred

### Provider-Specific Errors
- Messages containing "fetch failed"
- Messages containing "network error"
- Messages containing "Incomplete JSON segment"
- Messages containing "Connection error"
- Messages containing "Request timeout"

## Configuration

You can customize retry behavior by providing `retryOptions` in your agent configuration:

```typescript
const agent = {
    model: 'gpt-4',
    retryOptions: {
        // Maximum number of retry attempts (default: 3)
        maxRetries: 5,
        
        // Initial delay in milliseconds before first retry (default: 1000)
        initialDelay: 500,
        
        // Maximum delay in milliseconds between retries (default: 30000)
        maxDelay: 60000,
        
        // Backoff multiplier for exponential backoff (default: 2)
        backoffMultiplier: 1.5,
        
        // Additional error codes to consider retryable
        additionalRetryableErrors: ['CUSTOM_ERROR'],
        
        // Additional HTTP status codes to consider retryable
        additionalRetryableStatusCodes: [418], // I'm a teapot
        
        // Callback when a retry occurs
        onRetry: (error, attempt) => {
            console.log(`Retry attempt ${attempt} after error:`, error.message);
        }
    }
};

// Use with ensembleRequest
for await (const event of ensembleRequest(messages, agent)) {
    // Handle events
}
```

## Disable Retries

To disable retries entirely, set `maxRetries` to 0:

```typescript
const agent = {
    model: 'gpt-4',
    retryOptions: {
        maxRetries: 0
    }
};
```

## Exponential Backoff

The retry delay follows an exponential backoff pattern:
- 1st retry: ~1 second
- 2nd retry: ~2 seconds
- 3rd retry: ~4 seconds
- And so on...

Each delay includes a random jitter of ±10% to prevent multiple clients from retrying at exactly the same time.

## Streaming Behavior

For streaming responses:
- Retries only occur if the error happens before any data has been yielded
- Once streaming begins, errors will not trigger retries to maintain stream integrity
- This ensures partial responses are not duplicated

## Example: Handling Network Failures

```typescript
import { ensembleRequest } from '@just-every/ensemble';

const messages = [
    { type: 'message', role: 'user', content: 'Hello!' }
];

const agent = {
    model: 'claude-3-5-haiku-latest',
    retryOptions: {
        maxRetries: 5,
        onRetry: (error, attempt) => {
            console.log(`Network error on attempt ${attempt}:`, error.code);
        }
    }
};

try {
    for await (const event of ensembleRequest(messages, agent)) {
        if (event.type === 'message_delta') {
            process.stdout.write(event.content);
        }
    }
} catch (error) {
    // This will only be thrown after all retries are exhausted
    console.error('Failed after all retries:', error);
}
```

## Example: Custom Retry Logic

```typescript
const agent = {
    model: 'gpt-4',
    retryOptions: {
        // Retry more aggressively for critical operations
        maxRetries: 10,
        initialDelay: 200,
        backoffMultiplier: 1.5,
        
        // Add custom error codes
        additionalRetryableErrors: ['MYAPP_TIMEOUT'],
        
        // Track retries
        onRetry: async (error, attempt) => {
            await logRetryToDatabase({
                error: error.message,
                attempt,
                timestamp: new Date()
            });
        }
    }
};
```

## Best Practices

1. **Use appropriate retry counts**: For user-facing operations, 3-5 retries is usually sufficient. For background jobs, you might use more.

2. **Monitor retry callbacks**: Use the `onRetry` callback to track retry patterns and identify systemic issues.

3. **Consider timeout implications**: Each retry adds to total request time. Ensure your application timeouts account for retries.

4. **Handle non-retryable errors**: Some errors (like authentication failures) should not be retried. These will fail immediately.

5. **Test retry behavior**: Use network simulation tools to test how your application behaves under poor network conditions.

## Implementation Details

- Retry logic is implemented in the `BaseModelProvider` class
- All providers that extend `BaseModelProvider` automatically get retry functionality
- The retry handler uses a separate utility module for easy testing and maintenance
- Retries preserve the full request context including messages, model settings, and tools