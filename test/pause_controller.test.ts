import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
    getPauseController,
    isPaused,
    pause,
    resume,
    waitWhilePaused,
} from '../utils/pause_controller.js';

describe('PauseController', () => {
    beforeEach(() => {
        // Reset pause state before each test
        resume();
    });

    describe('isPaused', () => {
        it('should return false by default', () => {
            expect(isPaused()).toBe(false);
        });

        it('should return true after pause', () => {
            pause();
            expect(isPaused()).toBe(true);
        });

        it('should return false after resume', () => {
            pause();
            resume();
            expect(isPaused()).toBe(false);
        });
    });

    describe('pause and resume', () => {
        it('should emit events when pausing', () => {
            const controller = getPauseController();
            const pauseHandler = vi.fn();
            controller.on('paused', pauseHandler);

            pause();
            expect(pauseHandler).toHaveBeenCalledTimes(1);

            // Should not emit again if already paused
            pause();
            expect(pauseHandler).toHaveBeenCalledTimes(1);

            controller.off('paused', pauseHandler);
        });

        it('should emit events when resuming', () => {
            const controller = getPauseController();
            const resumeHandler = vi.fn();
            controller.on('resumed', resumeHandler);

            pause();
            resume();
            expect(resumeHandler).toHaveBeenCalledTimes(1);

            // Should not emit again if already resumed
            resume();
            expect(resumeHandler).toHaveBeenCalledTimes(1);

            controller.off('resumed', resumeHandler);
        });
    });

    describe('waitWhilePaused', () => {
        it('should resolve immediately when not paused', async () => {
            const start = Date.now();
            await waitWhilePaused(100);
            const duration = Date.now() - start;
            expect(duration).toBeLessThan(50); // Should be nearly instant
        });

        it('should wait while paused and continue after resume', async () => {
            pause();
            
            let resolved = false;
            const waitPromise = waitWhilePaused(50).then(() => {
                resolved = true;
            });

            // Wait a bit - should still be waiting
            await new Promise(resolve => setTimeout(resolve, 100));
            expect(resolved).toBe(false);

            // Resume and wait for resolution
            resume();
            await waitPromise;
            expect(resolved).toBe(true);
        });

        it('should respect abort signal', async () => {
            pause();
            
            const controller = new AbortController();
            
            // Start waiting with abort signal
            const waitPromise = waitWhilePaused(50, controller.signal);
            
            // Abort after a short delay
            setTimeout(() => controller.abort(), 100);
            
            // Should throw when aborted
            await expect(waitPromise).rejects.toThrow('Operation aborted while waiting for pause');
        });

        it('should handle multiple concurrent waiters', async () => {
            pause();
            
            let resolved1 = false;
            let resolved2 = false;
            let resolved3 = false;
            
            const wait1 = waitWhilePaused(50).then(() => { resolved1 = true; });
            const wait2 = waitWhilePaused(100).then(() => { resolved2 = true; });
            const wait3 = waitWhilePaused(150).then(() => { resolved3 = true; });
            
            // All should be waiting
            await new Promise(resolve => setTimeout(resolve, 100));
            expect(resolved1).toBe(false);
            expect(resolved2).toBe(false);
            expect(resolved3).toBe(false);
            
            // Resume and wait for all
            resume();
            await Promise.all([wait1, wait2, wait3]);
            
            expect(resolved1).toBe(true);
            expect(resolved2).toBe(true);
            expect(resolved3).toBe(true);
        });
    });

    describe('singleton behavior', () => {
        it('should return the same controller instance', () => {
            const controller1 = getPauseController();
            const controller2 = getPauseController();
            expect(controller1).toBe(controller2);
        });

        it('should share state across all access methods', () => {
            pause();
            expect(isPaused()).toBe(true);
            expect(getPauseController().isPaused()).toBe(true);
            
            getPauseController().resume();
            expect(isPaused()).toBe(false);
        });
    });
});