import { describe, it, expect, beforeEach, vi } from 'vitest';
import { costTracker } from '../utils/cost_tracker.js';

describe('Cost Tracker Usage Callbacks', () => {
    beforeEach(() => {
        // Reset cost tracker
        costTracker.reset();
    });

    it('should continue to work with legacy onAddUsage callbacks', () => {
        let callbackCalled = false;
        let callbackUsage: any = null;

        // Add legacy callback
        costTracker.onAddUsage(usage => {
            callbackCalled = true;
            callbackUsage = usage;
        });

        // Add usage
        const returnedUsage = costTracker.addUsage({
            model: 'test-model',
            input_tokens: 100,
            output_tokens: 50,
        });

        // Callback should be called synchronously
        expect(callbackCalled).toBe(true);
        expect(callbackUsage).toBeDefined();
        expect(callbackUsage.model).toBe('test-model');
        expect(callbackUsage.input_tokens).toBe(100);
        expect(callbackUsage.output_tokens).toBe(50);

        // Returned usage should have calculated cost
        expect(returnedUsage).toBeDefined();
        expect(returnedUsage.cost).toBeDefined();
        expect(returnedUsage.timestamp).toBeDefined();
    });

    it('should return usage object with calculated cost', () => {
        // Add usage
        const returnedUsage = costTracker.addUsage({
            model: 'gpt-4o',
            input_tokens: 200,
            output_tokens: 100,
            cached_tokens: 25,
        });

        // Check returned usage
        expect(returnedUsage).toBeDefined();
        expect(returnedUsage.model).toBe('gpt-4o');
        expect(returnedUsage.input_tokens).toBe(200);
        expect(returnedUsage.output_tokens).toBe(100);
        expect(returnedUsage.cached_tokens).toBe(25);
        expect(returnedUsage.cost).toBeGreaterThan(0);
        expect(returnedUsage.timestamp).toBeDefined();
    });

    it('should handle missing token values gracefully', () => {
        // Add usage with missing values
        const returnedUsage = costTracker.addUsage({
            model: 'gpt-4o',
            // No token values provided
        });

        // Should still return valid usage object
        expect(returnedUsage).toBeDefined();
        expect(returnedUsage.model).toBe('gpt-4o');
        expect(returnedUsage.cost).toBe(0);
        expect(returnedUsage.timestamp).toBeDefined();
    });

    it('should handle multiple callbacks', () => {
        const callbackResults: any[] = [];

        // Add multiple callbacks
        costTracker.onAddUsage(usage => {
            callbackResults.push({ callback: 1, usage });
        });

        costTracker.onAddUsage(usage => {
            callbackResults.push({ callback: 2, usage });
        });

        // Add usage
        costTracker.addUsage({
            model: 'test-model',
            input_tokens: 100,
            output_tokens: 50,
        });

        // Both callbacks should be called
        expect(callbackResults).toHaveLength(2);
        expect(callbackResults[0].callback).toBe(1);
        expect(callbackResults[1].callback).toBe(2);
        expect(callbackResults[0].usage.model).toBe('test-model');
        expect(callbackResults[1].usage.model).toBe('test-model');
    });

    it('should handle errors in callbacks gracefully', () => {
        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        let goodCallbackCalled = false;

        // Add failing callback
        costTracker.onAddUsage(() => {
            throw new Error('Callback error');
        });

        // Add good callback
        costTracker.onAddUsage(() => {
            goodCallbackCalled = true;
        });

        // Add usage - should not throw
        expect(() => {
            costTracker.addUsage({
                model: 'test-model',
                input_tokens: 100,
                output_tokens: 50,
            });
        }).not.toThrow();

        // Error should be logged but good callback should still run
        expect(consoleSpy).toHaveBeenCalledWith('Error in cost tracker callback:', expect.any(Error));
        expect(goodCallbackCalled).toBe(true);

        consoleSpy.mockRestore();
    });

    it('should work with addEstimatedUsage', () => {
        let callbackCalled = false;
        let callbackUsage: any = null;

        // Add callback
        costTracker.onAddUsage(usage => {
            callbackCalled = true;
            callbackUsage = usage;
        });

        // Add estimated usage
        const returnedUsage = costTracker.addEstimatedUsage('test-model', 'This is input text', 'This is output text', {
            source: 'test',
        });

        // Check callback was called
        expect(callbackCalled).toBe(true);
        expect(callbackUsage.metadata.estimated).toBe(true);
        expect(callbackUsage.metadata.source).toBe('test');

        // Check returned usage
        expect(returnedUsage).toBeDefined();
        expect(returnedUsage.input_tokens).toBe(5); // "This is input text" = 18 chars / 4 = 5 tokens
        expect(returnedUsage.output_tokens).toBe(5); // "This is output text" = 19 chars / 4 = 5 tokens
        expect(returnedUsage.metadata.estimated).toBe(true);
    });
});
