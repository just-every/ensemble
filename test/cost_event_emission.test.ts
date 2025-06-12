import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { costTracker } from '../utils/cost_tracker.js';
import { setEventHandler } from '../utils/event_controller.js';
import { CostUpdateEvent, ProviderStreamEvent } from '../types/types.js';

describe('Automatic Cost Event Emission', () => {
    let capturedEvents: ProviderStreamEvent[] = [];

    beforeEach(() => {
        // Reset cost tracker
        costTracker.reset();

        // Clear captured events
        capturedEvents = [];

        // Set up event handler to capture events
        setEventHandler(event => {
            capturedEvents.push(event);
        });
    });

    afterEach(() => {
        // Clear event handler
        setEventHandler(null);
    });

    it('should automatically emit cost_update event when usage is added', async () => {
        // Add usage
        costTracker.addUsage({
            model: 'test-model',
            input_tokens: 100,
            output_tokens: 50,
            cached_tokens: 10,
        });

        // Wait a bit for async event emission
        await new Promise(resolve => setTimeout(resolve, 10));

        // Check that a cost_update event was emitted
        expect(capturedEvents).toHaveLength(1);

        const event = capturedEvents[0] as CostUpdateEvent;
        expect(event.type).toBe('cost_update');
        expect(event.usage).toEqual({
            input_tokens: 100,
            output_tokens: 50,
            total_tokens: 150,
            cached_tokens: 10,
        });
        expect(event.timestamp).toBeDefined();
    });

    it('should not emit cost_update event when no event handler is set', async () => {
        // Clear event handler
        setEventHandler(null);

        // Add usage
        costTracker.addUsage({
            model: 'test-model',
            input_tokens: 100,
            output_tokens: 50,
        });

        // Wait a bit
        await new Promise(resolve => setTimeout(resolve, 10));

        // No events should be captured
        expect(capturedEvents).toHaveLength(0);
    });

    it('should handle missing token values gracefully', async () => {
        // Add usage with missing values
        costTracker.addUsage({
            model: 'test-model',
            // No token values provided
        });

        // Wait a bit for async event emission
        await new Promise(resolve => setTimeout(resolve, 10));

        // Check event was emitted with defaults
        expect(capturedEvents).toHaveLength(1);

        const event = capturedEvents[0] as CostUpdateEvent;
        expect(event.usage).toEqual({
            input_tokens: 0,
            output_tokens: 0,
            total_tokens: 0,
            cached_tokens: undefined,
        });
    });

    it('should emit multiple events for multiple usage additions', async () => {
        // Add multiple usages
        costTracker.addUsage({
            model: 'test-model',
            input_tokens: 100,
            output_tokens: 50,
        });

        costTracker.addUsage({
            model: 'gpt-4o',
            input_tokens: 200,
            output_tokens: 100,
            cached_tokens: 25,
        });

        // Wait a bit for async event emission
        await new Promise(resolve => setTimeout(resolve, 10));

        // Check that two events were emitted
        expect(capturedEvents).toHaveLength(2);

        const event1 = capturedEvents[0] as CostUpdateEvent;
        expect(event1.usage.input_tokens).toBe(100);
        expect(event1.usage.output_tokens).toBe(50);
        expect(event1.usage.total_tokens).toBe(150);

        const event2 = capturedEvents[1] as CostUpdateEvent;
        expect(event2.usage.input_tokens).toBe(200);
        expect(event2.usage.output_tokens).toBe(100);
        expect(event2.usage.total_tokens).toBe(300);
        expect(event2.usage.cached_tokens).toBe(25);
    });

    it('should continue to work with legacy onAddUsage callbacks', async () => {
        let callbackCalled = false;
        let callbackUsage: any = null;

        // Add legacy callback
        costTracker.onAddUsage(usage => {
            callbackCalled = true;
            callbackUsage = usage;
        });

        // Add usage
        costTracker.addUsage({
            model: 'test-model',
            input_tokens: 100,
            output_tokens: 50,
        });

        // Wait a bit
        await new Promise(resolve => setTimeout(resolve, 10));

        // Both event and callback should work
        expect(capturedEvents).toHaveLength(1);
        expect(callbackCalled).toBe(true);
        expect(callbackUsage).toBeDefined();
        expect(callbackUsage.model).toBe('test-model');
    });

    it('should handle errors in event emission gracefully', async () => {
        // Set up a failing event handler
        const consoleSpy = vi
            .spyOn(console, 'error')
            .mockImplementation(() => {});
        setEventHandler(() => {
            throw new Error('Event handler error');
        });

        // Add usage - should not throw
        expect(() => {
            costTracker.addUsage({
                model: 'test-model',
                input_tokens: 100,
                output_tokens: 50,
            });
        }).not.toThrow();

        // Wait a bit
        await new Promise(resolve => setTimeout(resolve, 10));

        // Error should be logged
        expect(consoleSpy).toHaveBeenCalledWith(
            expect.stringContaining(
                '[EventController] Error in event handler:'
            ),
            expect.any(Error)
        );

        consoleSpy.mockRestore();
    });
});
