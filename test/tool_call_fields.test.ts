import { describe, it, expect } from 'vitest';
import { ToolCall } from '../types/types.js';

describe('ToolCall Interface', () => {
    it('should allow additional fields like runningToolId', () => {
        // Test that ToolCall interface accepts additional fields
        const toolCall: ToolCall = {
            id: 'test-123',
            type: 'function',
            call_id: 'call-456',
            function: {
                name: 'test_function',
                arguments: '{"param": "value"}'
            },
            // Additional fields that should be preserved
            runningToolId: 'running-789',
            customField: 'custom-value',
            metadata: {
                userId: 'user-123',
                timestamp: Date.now()
            }
        };

        // Verify the standard fields
        expect(toolCall.id).toBe('test-123');
        expect(toolCall.type).toBe('function');
        expect(toolCall.call_id).toBe('call-456');
        expect(toolCall.function.name).toBe('test_function');
        expect(toolCall.function.arguments).toBe('{"param": "value"}');

        // Verify additional fields are preserved
        expect(toolCall.runningToolId).toBe('running-789');
        expect(toolCall.customField).toBe('custom-value');
        expect(toolCall.metadata).toEqual({
            userId: 'user-123',
            timestamp: expect.any(Number)
        });
    });

    it('should preserve additional fields when spreading ToolCall objects', () => {
        const originalToolCall: ToolCall = {
            id: 'test-123',
            type: 'function',
            function: {
                name: 'test_function',
                arguments: '{}'
            },
            runningToolId: 'running-789',
            customData: { key: 'value' }
        };

        // Spread the object to simulate what happens during streaming
        const copiedToolCall: ToolCall = {
            ...originalToolCall,
            // Update some standard field
            call_id: 'new-call-id'
        };

        // Verify standard fields
        expect(copiedToolCall.id).toBe('test-123');
        expect(copiedToolCall.call_id).toBe('new-call-id');
        
        // Verify additional fields are preserved during spread
        expect(copiedToolCall.runningToolId).toBe('running-789');
        expect(copiedToolCall.customData).toEqual({ key: 'value' });
    });

    it('should work with Object.assign to preserve additional fields', () => {
        const baseToolCall: ToolCall = {
            id: 'test-123',
            type: 'function',
            function: {
                name: 'test_function',
                arguments: '{}'
            }
        };

        const additionalFields = {
            runningToolId: 'running-456',
            priority: 'high',
            tags: ['important', 'async']
        };

        // Simulate adding additional fields (like what might happen in streaming)
        const enhancedToolCall = Object.assign(baseToolCall, additionalFields);

        // Verify all fields are present
        expect(enhancedToolCall.runningToolId).toBe('running-456');
        expect(enhancedToolCall.priority).toBe('high');
        expect(enhancedToolCall.tags).toEqual(['important', 'async']);
        
        // Verify standard fields still work
        expect(enhancedToolCall.id).toBe('test-123');
        expect(enhancedToolCall.function.name).toBe('test_function');
    });
});