export interface RetryOptions {
    maxRetries?: number;
    initialDelay?: number;
    maxDelay?: number;
    backoffMultiplier?: number;
    retryableErrors?: Set<string>;
    retryableStatusCodes?: Set<number>;
    onRetry?: (error: any, attempt: number) => void;
}

export const DEFAULT_RETRY_OPTIONS: Required<Omit<RetryOptions, 'onRetry'>> = {
    maxRetries: 3,
    initialDelay: 1000,
    maxDelay: 30000,
    backoffMultiplier: 2,
    retryableErrors: new Set([
        'ECONNRESET',
        'ETIMEDOUT',
        'ENOTFOUND',
        'ECONNREFUSED',
        'EPIPE',
        'EHOSTUNREACH',
        'EAI_AGAIN',
        'ENETUNREACH',
        'ECONNABORTED',
        'ESOCKETTIMEDOUT',
    ]),
    retryableStatusCodes: new Set([
        408, // Request Timeout
        429, // Too Many Requests
        500, // Internal Server Error
        502, // Bad Gateway
        503, // Service Unavailable
        504, // Gateway Timeout
        522, // Connection Timed Out
        524, // A Timeout Occurred
    ]),
};

export function isRetryableError(error: any, options: RetryOptions = {}): boolean {
    const opts = { ...DEFAULT_RETRY_OPTIONS, ...options };

    // Check for network errors
    if (error.code && opts.retryableErrors.has(error.code)) {
        return true;
    }

    // Check for HTTP status codes
    if (error.status && opts.retryableStatusCodes.has(error.status)) {
        return true;
    }

    // Check for fetch failures
    if (
        error.message &&
        (error.message.includes('fetch failed') ||
            error.message.includes('network error') ||
            error.message.includes('ECONNRESET') ||
            error.message.includes('ETIMEDOUT'))
    ) {
        return true;
    }

    // Check for specific provider errors that should be retried
    if (
        error.message &&
        (error.message.includes('Incomplete JSON segment') ||
            error.message.includes('Connection error') ||
            error.message.includes('Request timeout'))
    ) {
        return true;
    }

    return false;
}

export function calculateDelay(attempt: number, options: RetryOptions = {}): number {
    const opts = { ...DEFAULT_RETRY_OPTIONS, ...options };
    const baseDelay = opts.initialDelay * Math.pow(opts.backoffMultiplier, attempt - 1);
    const delay = Math.min(baseDelay, opts.maxDelay);

    // Add jitter (±10%) to prevent thundering herd
    const jitter = delay * 0.1 * (Math.random() * 2 - 1);
    return Math.round(delay + jitter);
}

export async function retryWithBackoff<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
    const opts = { ...DEFAULT_RETRY_OPTIONS, ...options };
    let lastError: any;

    for (let attempt = 1; attempt <= opts.maxRetries + 1; attempt++) {
        try {
            return await fn();
        } catch (error) {
            lastError = error;

            // If it's not retryable or we've exhausted retries, throw
            if (!isRetryableError(error, opts) || attempt > opts.maxRetries) {
                throw error;
            }

            // Calculate delay and notify
            const delay = calculateDelay(attempt, opts);
            if (opts.onRetry) {
                opts.onRetry(error, attempt);
            }

            // Wait before retrying
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }

    throw lastError;
}

export async function* retryStreamWithBackoff<T>(
    createStream: () => AsyncGenerator<T>,
    options: RetryOptions = {}
): AsyncGenerator<T> {
    const opts = { ...DEFAULT_RETRY_OPTIONS, ...options };
    let lastError: any;
    const buffer: T[] = [];
    let hasStartedYielding = false;

    for (let attempt = 1; attempt <= opts.maxRetries + 1; attempt++) {
        try {
            const stream = createStream();

            // If we've already started yielding, skip buffered items
            if (hasStartedYielding) {
                let skipCount = buffer.length;
                for await (const item of stream) {
                    if (skipCount > 0) {
                        skipCount--;
                        continue;
                    }
                    yield item;
                }
            } else {
                // First attempt or haven't started yielding yet
                for await (const item of stream) {
                    buffer.push(item);
                    hasStartedYielding = true;
                    yield item;
                }
            }

            // Success - stream completed
            return;
        } catch (error) {
            lastError = error;

            // If we've already started yielding, we can't retry
            if (hasStartedYielding) {
                throw error;
            }

            // If it's not retryable or we've exhausted retries, throw
            if (!isRetryableError(error, opts) || attempt > opts.maxRetries) {
                throw error;
            }

            // Calculate delay and notify
            const delay = calculateDelay(attempt, opts);
            if (opts.onRetry) {
                opts.onRetry(error, attempt);
            }

            // Wait before retrying
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }

    throw lastError;
}
