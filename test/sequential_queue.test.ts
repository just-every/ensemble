import { describe, it, expect, beforeEach } from 'vitest';
import { SequentialQueue, runSequential } from '../utils/sequential_queue.js';

describe('SequentialQueue', () => {
    let queue: SequentialQueue;

    beforeEach(() => {
        queue = new SequentialQueue();
    });

    describe('runSequential', () => {
        it('should execute functions sequentially', async () => {
            const results: number[] = [];
            const delay = (ms: number) =>
                new Promise(resolve => setTimeout(resolve, ms));

            const fn1 = async () => {
                await delay(50);
                results.push(1);
                return 1;
            };

            const fn2 = async () => {
                await delay(20);
                results.push(2);
                return 2;
            };

            const fn3 = async () => {
                results.push(3);
                return 3;
            };

            // Start all functions at once
            const [r1, r2, r3] = await Promise.all([
                queue.runSequential('agent1', fn1),
                queue.runSequential('agent1', fn2),
                queue.runSequential('agent1', fn3),
            ]);

            // Results should be in order despite different delays
            expect(results).toEqual([1, 2, 3]);
            expect(r1).toBe(1);
            expect(r2).toBe(2);
            expect(r3).toBe(3);
        });

        it('should handle errors without breaking the queue', async () => {
            const results: string[] = [];

            const fn1 = async () => {
                results.push('fn1');
                return 'fn1';
            };

            const fn2 = async () => {
                throw new Error('fn2 error');
            };

            const fn3 = async () => {
                results.push('fn3');
                return 'fn3';
            };

            const promise1 = queue.runSequential('agent1', fn1);
            const promise2 = queue.runSequential('agent1', fn2);
            const promise3 = queue.runSequential('agent1', fn3);

            await expect(promise1).resolves.toBe('fn1');
            await expect(promise2).rejects.toThrow('fn2 error');
            await expect(promise3).resolves.toBe('fn3');

            expect(results).toEqual(['fn1', 'fn3']);
        });

        it('should run different agents in parallel', async () => {
            const results: string[] = [];
            const delay = (ms: number) =>
                new Promise(resolve => setTimeout(resolve, ms));

            const fn1 = async () => {
                await delay(50);
                results.push('agent1-1');
                return 'agent1-1';
            };

            const fn2 = async () => {
                await delay(20);
                results.push('agent2-1');
                return 'agent2-1';
            };

            const fn3 = async () => {
                results.push('agent1-2');
                return 'agent1-2';
            };

            // Start functions for different agents
            const promises = Promise.all([
                queue.runSequential('agent1', fn1),
                queue.runSequential('agent2', fn2),
                queue.runSequential('agent1', fn3),
            ]);

            await promises;

            // agent2 should complete before agent1 since they run in parallel
            expect(results[0]).toBe('agent2-1');
            expect(results[1]).toBe('agent1-1');
            expect(results[2]).toBe('agent1-2');
        });
    });

    describe('getQueueSize', () => {
        it('should return correct queue size', async () => {
            const delay = (ms: number) =>
                new Promise(resolve => setTimeout(resolve, ms));

            const fn1 = () => delay(100);
            const fn2 = () => delay(50);
            const fn3 = () => delay(50);

            // Add functions to queue
            queue.runSequential('agent1', fn1);
            queue.runSequential('agent1', fn2);
            queue.runSequential('agent1', fn3);

            // Queue size should be 2 (fn2 and fn3 waiting)
            expect(queue.getQueueSize('agent1')).toBe(2);
            expect(queue.getQueueSize('agent2')).toBe(0);
        });
    });

    describe('isProcessing', () => {
        it('should indicate when queue is processing', async () => {
            const delay = (ms: number) =>
                new Promise(resolve => setTimeout(resolve, ms));

            expect(queue.isProcessing('agent1')).toBe(false);

            const promise = queue.runSequential('agent1', () => delay(50));
            expect(queue.isProcessing('agent1')).toBe(true);

            await promise;
            expect(queue.isProcessing('agent1')).toBe(false);
        });
    });

    describe('clearQueue', () => {
        it('should clear pending items and reject them', async () => {
            const delay = (ms: number) =>
                new Promise(resolve => setTimeout(resolve, ms));
            const results: string[] = [];

            const fn1 = async () => {
                await delay(100);
                results.push('fn1');
                return 'fn1';
            };

            const fn2 = async () => {
                results.push('fn2');
                return 'fn2';
            };

            const fn3 = async () => {
                results.push('fn3');
                return 'fn3';
            };

            const promise1 = queue.runSequential('agent1', fn1);
            const promise2 = queue.runSequential('agent1', fn2).catch(e => e);
            const promise3 = queue.runSequential('agent1', fn3).catch(e => e);

            // Clear queue while fn1 is running
            setTimeout(() => queue.clearQueue('agent1'), 50);

            await expect(promise1).resolves.toBe('fn1');
            await expect(promise2).resolves.toEqual(new Error('Queue cleared'));
            await expect(promise3).resolves.toEqual(new Error('Queue cleared'));

            expect(results).toEqual(['fn1']);
        });
    });

    describe('clearAll', () => {
        it('should clear all queues', async () => {
            const delay = (ms: number) =>
                new Promise(resolve => setTimeout(resolve, ms));

            // Add items to multiple queues
            const fn1 = async () => {
                await delay(200);
                return 'agent1-result';
            };

            const fn2 = async () => {
                await delay(200);
                return 'agent2-result';
            };

            const fn3 = async () => {
                return 'agent1-queued';
            };

            const promise1 = queue.runSequential('agent1', fn1);
            const promise2 = queue.runSequential('agent2', fn2);
            const promise3 = queue.runSequential('agent1', fn3).catch(e => e);

            // Clear all queues after a short delay
            setTimeout(() => queue.clearAll(), 50);

            // The currently running functions should complete
            await expect(promise1).resolves.toBe('agent1-result');
            await expect(promise2).resolves.toBe('agent2-result');

            // The queued function should be rejected
            await expect(promise3).resolves.toEqual(new Error('Queue cleared'));

            // After clearing, new items should work
            const promise4 = queue.runSequential('agent1', () => 'test');
            await expect(promise4).resolves.toBe('test');
        });
    });
});

describe('runSequential helper', () => {
    it('should use singleton queue', async () => {
        const results: number[] = [];

        const fn1 = async () => {
            results.push(1);
            return 1;
        };

        const fn2 = async () => {
            results.push(2);
            return 2;
        };

        const [r1, r2] = await Promise.all([
            runSequential('agent1', fn1),
            runSequential('agent1', fn2),
        ]);

        expect(results).toEqual([1, 2]);
        expect(r1).toBe(1);
        expect(r2).toBe(2);
    });
});
