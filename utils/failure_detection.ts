import type { ErrorEvent, OperationStatusEvent, ProviderStreamEvent } from '../types/types.js';

function createGuardError(operationName: string, kind: 'aborted' | 'timed_out', timeoutMs?: number): Error {
    const error = new Error(
        kind === 'aborted' ? `${operationName} aborted` : `${operationName} timed out after ${timeoutMs}ms`
    ) as Error & {
        code?: string;
        recoverable?: boolean;
    };

    error.code = kind === 'aborted' ? 'ABORT_ERR' : 'ETIMEDOUT';
    error.recoverable = false;
    if (kind === 'aborted') {
        error.name = 'AbortError';
    }

    return error;
}

export function createOperationStatusEvent(
    event: Omit<OperationStatusEvent, 'type' | 'timestamp'>
): OperationStatusEvent {
    return {
        type: 'operation_status',
        timestamp: new Date().toISOString(),
        ...event,
    };
}

export function isTerminalFailureEvent(event: ProviderStreamEvent): boolean {
    if (event.type === 'operation_status') {
        const statusEvent = event as OperationStatusEvent;
        return statusEvent.status === 'failed' && statusEvent.terminal === true;
    }

    if (event.type === 'error') {
        const errorEvent = event as ErrorEvent;
        return errorEvent.recoverable === false;
    }

    return false;
}

export function getEventError(event: ProviderStreamEvent): string | undefined {
    if (event.type === 'operation_status' || event.type === 'error') {
        return (event as OperationStatusEvent | ErrorEvent).error;
    }

    return undefined;
}

export function toTerminalErrorEvent(
    event: Omit<ErrorEvent, 'type' | 'timestamp' | 'recoverable'> & { recoverable?: boolean }
): ErrorEvent {
    return {
        type: 'error',
        timestamp: new Date().toISOString(),
        ...event,
        recoverable: event.recoverable ?? false,
    };
}

export async function raceWithAbortAndTimeout<T>(
    operation: Promise<T> | (() => Promise<T>),
    options: {
        operationName: string;
        abortSignal?: AbortSignal;
        timeoutMs?: number;
    }
): Promise<T> {
    const { operationName, abortSignal, timeoutMs } = options;

    if (abortSignal?.aborted) {
        throw createGuardError(operationName, 'aborted');
    }

    let abortListener: (() => void) | undefined;
    let timeoutId: NodeJS.Timeout | undefined;

    const guardPromise = new Promise<T>((_, reject) => {
        if (abortSignal) {
            abortListener = () => reject(createGuardError(operationName, 'aborted'));
            abortSignal.addEventListener('abort', abortListener, { once: true });
        }

        if (typeof timeoutMs === 'number' && timeoutMs > 0) {
            timeoutId = setTimeout(() => {
                reject(createGuardError(operationName, 'timed_out', timeoutMs));
            }, timeoutMs);
        }
    });

    const operationPromise =
        typeof operation === 'function'
            ? Promise.resolve().then(() => operation())
            : operation;

    try {
        return await Promise.race([operationPromise, guardPromise]);
    } finally {
        if (abortSignal && abortListener) {
            abortSignal.removeEventListener('abort', abortListener);
        }

        if (timeoutId) {
            clearTimeout(timeoutId);
        }

        operationPromise.catch(() => {
            // Ignore the eventual provider rejection if the guard won the race.
        });
    }
}

export async function* streamWithAbortAndTimeout<T>(
    stream: AsyncGenerator<T>,
    options: {
        operationName: string;
        abortSignal?: AbortSignal;
        timeoutMs?: number;
    }
): AsyncGenerator<T> {
    const { operationName, abortSignal, timeoutMs } = options;

    if (abortSignal?.aborted) {
        throw createGuardError(operationName, 'aborted');
    }

    let abortListener: (() => void) | undefined;
    let timeoutId: NodeJS.Timeout | undefined;
    let streamCompleted = false;

    const guardPromise = new Promise<IteratorResult<T>>((_, reject) => {
        if (abortSignal) {
            abortListener = () => reject(createGuardError(operationName, 'aborted'));
            abortSignal.addEventListener('abort', abortListener, { once: true });
        }

        if (typeof timeoutMs === 'number' && timeoutMs > 0) {
            timeoutId = setTimeout(() => {
                reject(createGuardError(operationName, 'timed_out', timeoutMs));
            }, timeoutMs);
        }
    });

    try {
        while (true) {
            const nextPromise = stream.next();
            let iteration: IteratorResult<T>;

            try {
                iteration = await Promise.race([nextPromise, guardPromise]);
            } catch (error) {
                nextPromise.catch(() => {
                    // Ignore the eventual provider rejection if the guard won the race.
                });
                throw error;
            }

            if (iteration.done) {
                streamCompleted = true;
                return;
            }

            yield iteration.value;
        }
    } finally {
        if (abortSignal && abortListener) {
            abortSignal.removeEventListener('abort', abortListener);
        }

        if (timeoutId) {
            clearTimeout(timeoutId);
        }

        if (!streamCompleted && typeof stream.return === 'function') {
            void stream.return(undefined).catch(() => {
                // Ignore cleanup failures from provider iterators.
            });
        }
    }
}
