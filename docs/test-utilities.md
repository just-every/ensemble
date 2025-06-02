# Test Utilities

As of version 0.1.29, test utilities have been moved to a separate entry point to avoid loading vitest in production environments.

## Migration Guide

### Before (v0.1.28 and earlier)
```typescript
// This would load vitest in production!
import { EnhancedRequestMock, createMockContext } from '@just-every/ensemble';
```

### After (v0.1.29+)
```typescript
// Import from the test entry point
import { EnhancedRequestMock, createMockContext } from '@just-every/ensemble/test';
```

### Alternative Import for Legacy Module Resolution
If you're using `"moduleResolution": "node"` in your tsconfig.json, you may need to use the direct import path:
```typescript
// For projects with legacy module resolution
import { EnhancedRequestMock, createMockContext } from '@just-every/ensemble/dist/utils/test_utils.js';
```

## Available Test Utilities

### EnhancedRequestMock
A fluent API for mocking ensemble request responses in tests.

```typescript
import { EnhancedRequestMock } from '@just-every/ensemble/test';

const mock = EnhancedRequestMock.success('Task completed', 'Result data')
    .withTool('search', { query: 'test' }, 'Search results')
    .withDelay(100);
```

### createMockContext
Creates a mock RequestContext for testing tool handlers.

```typescript
import { createMockContext } from '@just-every/ensemble/test';

const context = createMockContext({
    messages: [...],
    metadata: { user_id: '123' }
});
```

### StreamAssertions
Utilities for asserting on stream events in tests.

```typescript
import { StreamAssertions } from '@just-every/ensemble/test';

const assertions = new StreamAssertions();
await assertions.expectEvent(stream, 'text_delta', 'Hello');
```

## Why This Change?

The test utilities depend on vitest, which should not be loaded in production environments. By moving them to a separate entry point:

1. Production builds no longer include vitest dependencies
2. Applications without vitest installed won't get errors
3. Reduced bundle size and faster installation times
4. Clear separation between production and test code

## Full Example

```typescript
import { describe, it, expect, vi } from 'vitest';
import { EnhancedRequestMock, createMockContext } from '@just-every/ensemble/test';
import type { RequestContext } from '@just-every/ensemble/test';

describe('My Tool Handler', () => {
    it('should handle tool execution', async () => {
        const context = createMockContext();
        const mock = EnhancedRequestMock.success('Done')
            .withTool('my_tool', { param: 'value' }, 'Tool result');
        
        // Mock the request function
        vi.mocked(request).mockImplementation(mock.toGenerator());
        
        // Test your code that uses ensemble
        const result = await myFunction(context);
        expect(result).toBe('expected');
    });
});
```