import { describe, it, expect, vi, afterEach } from 'vitest';
import { isRetryableError, calculateDelay, retryWithBackoff, retryStreamWithBackoff } from '../utils/retry_handler.js';

describe('Retry Handler', () => {
    afterEach(() => {
        vi.clearAllMocks();
        vi.useRealTimers();
    });

    describe('isRetryableError', () => {
        it('should identify network errors as retryable', () => {
            const errors = [
                { code: 'ECONNRESET' },
                { code: 'ETIMEDOUT' },
                { code: 'ENOTFOUND' },
                { code: 'ECONNREFUSED' },
                { code: 'EPIPE' },
                { code: 'EHOSTUNREACH' },
                { code: 'EAI_AGAIN' },
                { code: 'ENETUNREACH' },
                { code: 'ECONNABORTED' },
                { code: 'ESOCKETTIMEDOUT' },
            ];

            errors.forEach(error => {
                expect(isRetryableError(error)).toBe(true);
            });
        });

        it('should identify retryable HTTP status codes', () => {
            const statuses = [408, 429, 500, 502, 503, 504, 522, 524];

            statuses.forEach(status => {
                expect(isRetryableError({ status })).toBe(true);
            });
        });

        it('should identify fetch failures as retryable', () => {
            expect(isRetryableError({ message: 'fetch failed' })).toBe(true);
            expect(
                isRetryableError({
                    message: 'Error: fetch failed sending request',
                })
            ).toBe(true);
            expect(isRetryableError({ message: 'network error occurred' })).toBe(true);
            expect(
                isRetryableError({
                    message: 'Connection reset by peer (ECONNRESET)',
                })
            ).toBe(true);
        });

        it('should identify provider-specific errors as retryable', () => {
            expect(isRetryableError({ message: 'Incomplete JSON segment' })).toBe(true);
            expect(isRetryableError({ message: 'Connection error: timeout' })).toBe(true);
            expect(isRetryableError({ message: 'Request timeout exceeded' })).toBe(true);
        });

        it('should not identify non-retryable errors', () => {
            expect(isRetryableError({ code: 'ENOENT' })).toBe(false);
            expect(isRetryableError({ status: 400 })).toBe(false);
            expect(isRetryableError({ status: 401 })).toBe(false);
            expect(isRetryableError({ status: 403 })).toBe(false);
            expect(isRetryableError({ status: 404 })).toBe(false);
            expect(isRetryableError({ message: 'Invalid API key' })).toBe(false);
        });

        it('should respect custom retryable errors', () => {
            const options = {
                retryableErrors: new Set(['CUSTOM_ERROR']),
                retryableStatusCodes: new Set([418]), // I'm a teapot
            };

            expect(isRetryableError({ code: 'CUSTOM_ERROR' }, options)).toBe(true);
            expect(isRetryableError({ status: 418 }, options)).toBe(true);
        });
    });

    describe('calculateDelay', () => {
        it('should calculate exponential backoff delays', () => {
            expect(calculateDelay(1)).toBeGreaterThanOrEqual(900); // 1000ms ± 10%
            expect(calculateDelay(1)).toBeLessThanOrEqual(1100);

            expect(calculateDelay(2)).toBeGreaterThanOrEqual(1800); // 2000ms ± 10%
            expect(calculateDelay(2)).toBeLessThanOrEqual(2200);

            expect(calculateDelay(3)).toBeGreaterThanOrEqual(3600); // 4000ms ± 10%
            expect(calculateDelay(3)).toBeLessThanOrEqual(4400);
        });

        it('should respect maxDelay', () => {
            const options = { maxDelay: 5000 };

            // Even with high attempt count, delay should not exceed maxDelay + jitter
            const delay = calculateDelay(10, options);
            expect(delay).toBeLessThanOrEqual(5500); // 5000 + 10% jitter
        });

        it('should use custom backoff multiplier', () => {
            const options = { initialDelay: 100, backoffMultiplier: 3 };

            const delay1 = calculateDelay(1, options);
            const delay2 = calculateDelay(2, options);
            const delay3 = calculateDelay(3, options);

            // Remove jitter for comparison (approximate due to jitter)
            expect(delay1).toBeGreaterThanOrEqual(90);
            expect(delay1).toBeLessThanOrEqual(110);

            expect(delay2).toBeGreaterThanOrEqual(270);
            expect(delay2).toBeLessThanOrEqual(330);

            expect(delay3).toBeGreaterThanOrEqual(810);
            expect(delay3).toBeLessThanOrEqual(990);
        });
    });

    describe('retryWithBackoff', () => {
        it('should succeed on first attempt', async () => {
            const fn = vi.fn().mockResolvedValue('success');

            const result = await retryWithBackoff(fn);

            expect(result).toBe('success');
            expect(fn).toHaveBeenCalledTimes(1);
        });

        it('should retry on retryable errors', async () => {
            vi.useFakeTimers();

            const fn = vi
                .fn()
                .mockRejectedValueOnce({ code: 'ECONNRESET' })
                .mockRejectedValueOnce({ status: 503 })
                .mockResolvedValue('success');

            const promise = retryWithBackoff(fn, { maxRetries: 3 });

            // Fast-forward through delays
            await vi.runAllTimersAsync();

            const result = await promise;

            expect(result).toBe('success');
            expect(fn).toHaveBeenCalledTimes(3);
        });

        it('should throw on non-retryable errors', async () => {
            const error = { status: 404, message: 'Not Found' };
            const fn = vi.fn().mockRejectedValue(error);

            await expect(retryWithBackoff(fn)).rejects.toEqual(error);
            expect(fn).toHaveBeenCalledTimes(1);
        });

        it('should throw after max retries', async () => {
            vi.useFakeTimers();

            const error = { code: 'ECONNRESET' };
            const fn = vi.fn().mockRejectedValue(error);

            const promise = retryWithBackoff(fn, { maxRetries: 2 });

            // Handle the promise rejection immediately to avoid unhandled rejection
            const resultPromise = promise.catch(e => e);

            await vi.runAllTimersAsync();

            const result = await resultPromise;
            expect(result).toEqual(error);
            expect(fn).toHaveBeenCalledTimes(3); // initial + 2 retries
        });

        it('should call onRetry callback', async () => {
            vi.useFakeTimers();

            const onRetry = vi.fn();
            const error = { code: 'ETIMEDOUT' };
            const fn = vi.fn().mockRejectedValueOnce(error).mockResolvedValue('success');

            const promise = retryWithBackoff(fn, { onRetry });

            await vi.runAllTimersAsync();
            await promise;

            expect(onRetry).toHaveBeenCalledWith(error, 1);
        });
    });

    describe('retryStreamWithBackoff', () => {
        async function* createStream(values: any[]) {
            for (const value of values) {
                yield value;
            }
        }

        async function* createFailingStream(error: any): AsyncGenerator<any> {
            throw error;
            yield; // Unreachable but satisfies linter
        }

        it('should stream values on success', async () => {
            const createStreamFn = vi.fn(() => createStream([1, 2, 3]));

            const results: number[] = [];
            for await (const value of retryStreamWithBackoff(createStreamFn)) {
                results.push(value);
            }

            expect(results).toEqual([1, 2, 3]);
            expect(createStreamFn).toHaveBeenCalledTimes(1);
        });

        it('should retry stream on retryable error before yielding', async () => {
            vi.useFakeTimers();

            let attempt = 0;
            const createStreamFn = vi.fn(() => {
                attempt++;
                if (attempt < 3) {
                    return createFailingStream({ code: 'ECONNRESET' });
                }
                return createStream(['success']);
            });

            const results: string[] = [];
            const streamPromise = (async () => {
                for await (const value of retryStreamWithBackoff(createStreamFn)) {
                    results.push(value);
                }
            })();

            await vi.runAllTimersAsync();
            await streamPromise;

            expect(results).toEqual(['success']);
            expect(createStreamFn).toHaveBeenCalledTimes(3);
        });

        it('should not retry after yielding has started', async () => {
            async function* partialStream() {
                yield 'first';
                throw { code: 'ECONNRESET' };
            }

            const createStreamFn = vi.fn(() => partialStream());

            const results: string[] = [];
            await expect(async () => {
                for await (const value of retryStreamWithBackoff(createStreamFn)) {
                    results.push(value);
                }
            }).rejects.toEqual({ code: 'ECONNRESET' });

            expect(results).toEqual(['first']);
            expect(createStreamFn).toHaveBeenCalledTimes(1);
        });

        it('should throw on non-retryable stream errors', async () => {
            const error = { status: 401, message: 'Unauthorized' };
            const createStreamFn = vi.fn(() => createFailingStream(error));

            await expect(async () => {
                // eslint-disable-next-line @typescript-eslint/no-unused-vars
                for await (const _value of retryStreamWithBackoff(createStreamFn)) {
                    // Should not reach here
                }
            }).rejects.toEqual(error);

            expect(createStreamFn).toHaveBeenCalledTimes(1);
        });
    });
});
