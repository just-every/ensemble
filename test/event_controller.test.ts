import { describe, it, expect, beforeEach } from 'vitest';
import type { ProviderStreamEvent } from '../types/types.js';
import {
    getEventController,
    setEventHandler,
    emitEvent,
    hasEventHandler,
} from '../utils/event_controller.js';

describe('EventController', () => {
    beforeEach(() => {
        // Clear any existing event handler
        setEventHandler(null);
    });

    it('should start with no event handler', () => {
        expect(hasEventHandler()).toBe(false);
    });

    it('should set and clear event handler', () => {
        const handler = (_event: ProviderStreamEvent) => {};

        setEventHandler(handler);
        expect(hasEventHandler()).toBe(true);
        expect(getEventController().getEventHandler()).toBe(handler);

        setEventHandler(null);
        expect(hasEventHandler()).toBe(false);
        expect(getEventController().getEventHandler()).toBe(null);
    });

    it('should emit events to the handler', async () => {
        const capturedEvents: ProviderStreamEvent[] = [];
        const handler = (event: ProviderStreamEvent) => {
            capturedEvents.push(event);
        };

        setEventHandler(handler);

        const testEvent: ProviderStreamEvent = {
            type: 'message_delta',
            content: 'test',
            timestamp: new Date().toISOString(),
        };

        await emitEvent(testEvent);

        expect(capturedEvents).toHaveLength(1);
        expect(capturedEvents[0]).toEqual(testEvent);
    });

    it('should handle async event handlers', async () => {
        const capturedEvents: ProviderStreamEvent[] = [];
        const handler = async (event: ProviderStreamEvent) => {
            await new Promise(resolve => setTimeout(resolve, 10));
            capturedEvents.push(event);
        };

        setEventHandler(handler);

        const testEvent: ProviderStreamEvent = {
            type: 'tool_start',
            tool_call: {
                id: 'test-id',
                type: 'function',
                function: { name: 'test', arguments: '{}' },
            },
            timestamp: new Date().toISOString(),
        };

        await emitEvent(testEvent);

        expect(capturedEvents).toHaveLength(1);
        expect(capturedEvents[0]).toEqual(testEvent);
    });

    it('should not throw when emitting without a handler', async () => {
        const testEvent: ProviderStreamEvent = {
            type: 'error',
            error: 'test error',
            timestamp: new Date().toISOString(),
        };

        await expect(emitEvent(testEvent)).resolves.not.toThrow();
    });

    it('should handle errors in event handler gracefully', async () => {
        const handler = () => {
            throw new Error('Handler error');
        };

        setEventHandler(handler);

        const testEvent: ProviderStreamEvent = {
            type: 'message_complete',
            content: 'test',
            timestamp: new Date().toISOString(),
        };

        // Should not throw even if handler throws
        await expect(emitEvent(testEvent)).resolves.not.toThrow();
    });

    it('should use singleton instance', () => {
        const controller1 = getEventController();
        const controller2 = getEventController();

        expect(controller1).toBe(controller2);
    });
});
