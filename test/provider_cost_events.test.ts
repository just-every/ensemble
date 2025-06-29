import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { costTracker } from '../utils/cost_tracker.js';
import { setEventHandler, hasEventHandler } from '../utils/event_controller.js';

describe('Provider Cost Event Behavior', () => {
    beforeEach(() => {
        costTracker.reset();
    });

    afterEach(() => {
        setEventHandler(null);
    });

    it('should track when global event handler is set or not', () => {
        // Test hasEventHandler function
        setEventHandler(null);
        expect(hasEventHandler()).toBe(false);

        setEventHandler(() => {});
        expect(hasEventHandler()).toBe(true);

        setEventHandler(null);
        expect(hasEventHandler()).toBe(false);
    });

    it('should maintain backwards compatibility with existing usage patterns', () => {
        // Test that addUsage still works regardless of event handler state
        let callbackUsage: any = null;
        costTracker.onAddUsage(usage => {
            callbackUsage = usage;
        });

        // Test with no global handler
        setEventHandler(null);
        const usage1 = costTracker.addUsage({
            model: 'gpt-4o',
            input_tokens: 100,
            output_tokens: 50,
        });
        expect(usage1).toBeDefined();
        expect(usage1.cost).toBeDefined();
        expect(callbackUsage).toBeDefined();

        // Test with global handler
        callbackUsage = null;
        setEventHandler(() => {});
        const usage2 = costTracker.addUsage({
            model: 'gpt-4o',
            input_tokens: 200,
            output_tokens: 100,
        });
        expect(usage2).toBeDefined();
        expect(usage2.cost).toBeDefined();
        expect(callbackUsage).toBeDefined();
    });

    it('should demonstrate the concept of conditional event emission', () => {
        // This test demonstrates the logic providers should use
        function shouldYieldCostEvent(): boolean {
            return !hasEventHandler();
        }

        // When no global handler is set, providers should yield events
        setEventHandler(null);
        expect(shouldYieldCostEvent()).toBe(true);

        // When global handler is set, providers should NOT yield events
        setEventHandler(() => {});
        expect(shouldYieldCostEvent()).toBe(false);
    });
});
