/**
 * Test utilities entry point for @just-every/ensemble
 * 
 * Import test utilities from this entry point to avoid loading vitest in production:
 * ```typescript
 * import { EnhancedRequestMock, createMockContext } from '@just-every/ensemble/test';
 * ```
 */

// Export test utilities
export { EnhancedRequestMock, createMockContext, StreamAssertions } from './utils/test_utils.js';
export type { MockToolCall, MockResponse, MockStreamOptions } from './utils/test_utils.js';

// Re-export commonly needed types for testing
export type {
    EnsembleStreamEvent,
    ToolCall,
    ToolFunction,
    ResponseInput
} from './types.js';

// Re-export RequestContext from tool_types
export type { RequestContext } from './types/tool_types.js';