import type { ErrorEvent, OperationStatusEvent, ProviderStreamEvent } from '../types/types.js';

export interface FailureClassification {
    error: string;
    recoverable: boolean;
    terminal: boolean;
    code?: string;
    details?: unknown;
    reason?: string;
}

const RETRYABLE_ERROR_CODES = new Set([
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
]);

const RETRYABLE_STATUS_CODES = new Set([408, 429, 500, 502, 503, 504, 522, 524]);

const RETRYABLE_MESSAGE_SNIPPETS = [
    'fetch failed',
    'network error',
    'ECONNRESET',
    'ETIMEDOUT',
    'Incomplete JSON segment',
    'Connection error',
    'Request timeout',
];

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

interface FailureNormalizationOptions extends Partial<Omit<FailureClassification, 'terminal'>> {
    retryableErrors?: Iterable<string>;
    retryableStatusCodes?: Iterable<number>;
}

function stringifyFailureMessage(value: unknown): string {
    if (typeof value === 'string') return value;
    if (value instanceof Error) return value.message;
    if (value === undefined) return 'Unknown error';
    if (value === null) return 'null';

    try {
        return JSON.stringify(value);
    } catch {
        return String(value);
    }
}

export function normalizeFailure(failure: unknown, overrides: FailureNormalizationOptions = {}): FailureClassification {
    const candidate = failure as {
        error?: unknown;
        message?: unknown;
        code?: string;
        status?: number;
        details?: unknown;
        recoverable?: boolean;
        reason?: string;
        name?: string;
    };

    const code = overrides.code ?? candidate?.code;
    let recoverable = overrides.recoverable ?? candidate?.recoverable;
    const rawMessage =
        overrides.error ??
        candidate?.error ??
        candidate?.message ??
        (failure instanceof Error ? failure.message : failure);
    const message = stringifyFailureMessage(rawMessage);

    if (
        recoverable === undefined &&
        (code === 'ETIMEDOUT' || code === 'ABORT_ERR' || code === 'ABORT_ERROR' || candidate?.name === 'AbortError')
    ) {
        recoverable = false;
    }

    if (recoverable === undefined) {
        const retryableErrors =
            overrides.retryableErrors !== undefined
                ? new Set([...RETRYABLE_ERROR_CODES, ...overrides.retryableErrors])
                : RETRYABLE_ERROR_CODES;
        const retryableStatusCodes =
            overrides.retryableStatusCodes !== undefined
                ? new Set([...RETRYABLE_STATUS_CODES, ...overrides.retryableStatusCodes])
                : RETRYABLE_STATUS_CODES;
        recoverable =
            (typeof code === 'string' && retryableErrors.has(code)) ||
            (typeof candidate?.status === 'number' && retryableStatusCodes.has(candidate.status)) ||
            RETRYABLE_MESSAGE_SNIPPETS.some(snippet => message.includes(snippet));
    }

    return {
        error: message,
        recoverable,
        terminal: !recoverable,
        code,
        details: overrides.details ?? candidate?.details,
        reason: overrides.reason ?? candidate?.reason,
    };
}

export function selectMoreSevereFailure(
    current: FailureClassification | undefined,
    next: FailureClassification
): FailureClassification {
    if (!current) {
        return next;
    }

    if (next.terminal && !current.terminal) {
        return next;
    }

    return current;
}

export function toErrorEvent(
    failure: FailureClassification,
    event: Omit<ErrorEvent, 'type' | 'timestamp' | 'error' | 'recoverable' | 'code' | 'details'> = {}
): ErrorEvent {
    return {
        type: 'error',
        timestamp: new Date().toISOString(),
        ...event,
        error: failure.error,
        code: failure.code,
        details: failure.details,
        recoverable: failure.recoverable,
    };
}

export function createProviderErrorEvent(
    error: unknown,
    options: {
        prefix: string;
        request_id?: string;
        reason?: string;
        recoverable?: boolean;
        details?: unknown;
        retryableErrors?: Iterable<string>;
        retryableStatusCodes?: Iterable<number>;
    }
): ErrorEvent {
    const failure = normalizeFailure(error, {
        recoverable: options.recoverable,
        reason: options.reason,
        details: options.details,
        retryableErrors: options.retryableErrors,
        retryableStatusCodes: options.retryableStatusCodes,
    });

    return toErrorEvent(
        {
            ...failure,
            error: `${options.prefix}${failure.error}`,
        },
        {
            request_id: options.request_id,
        }
    );
}

export function isTerminalFailureEvent(event: ProviderStreamEvent): boolean {
    if (event.type === 'operation_status') {
        const statusEvent = event as OperationStatusEvent;
        return statusEvent.status === 'failed' && statusEvent.terminal === true;
    }

    if (event.type === 'error') {
        return (event as ErrorEvent).recoverable === false;
    }

    return false;
}

export class RequestLifecycleController {
    private state: 'idle' | 'running' | 'retrying' | 'completed' | 'failed' = 'idle';
    private requestId?: string;

    begin(requestId: string): OperationStatusEvent | null {
        if (this.isTerminal()) {
            return null;
        }

        if (!this.requestId) {
            this.requestId = requestId;
        }

        if (this.state !== 'idle') {
            this.state = 'running';
            return null;
        }

        this.state = 'running';

        return createOperationStatusEvent({
            operation: 'request',
            request_id: this.requestId,
            status: 'started',
            terminal: false,
            will_continue: true,
        });
    }

    retrying(failure: FailureClassification, attempt: number, maxAttempts: number): OperationStatusEvent | null {
        if (this.isTerminal() || !this.requestId) {
            return null;
        }

        this.state = 'retrying';
        return createOperationStatusEvent({
            operation: 'request',
            request_id: this.requestId,
            status: 'retrying',
            error: failure.error,
            reason: failure.reason ?? 'retryable_failure',
            recoverable: true,
            terminal: false,
            will_continue: true,
            attempt,
            max_attempts: maxAttempts,
        });
    }

    complete(): OperationStatusEvent | null {
        if (this.isTerminal() || !this.requestId) {
            return null;
        }

        this.state = 'completed';
        return createOperationStatusEvent({
            operation: 'request',
            request_id: this.requestId,
            status: 'completed',
            terminal: true,
            recoverable: false,
            will_continue: false,
        });
    }

    fail(failure: FailureClassification, attempt: number, maxAttempts: number): OperationStatusEvent | null {
        if (this.isTerminal() || !this.requestId) {
            return null;
        }

        this.state = 'failed';
        return createOperationStatusEvent({
            operation: 'request',
            request_id: this.requestId,
            status: 'failed',
            error: failure.error,
            reason: failure.reason ?? 'terminal_failure',
            recoverable: false,
            terminal: true,
            will_continue: false,
            attempt,
            max_attempts: maxAttempts,
        });
    }

    getRequestId(): string | undefined {
        return this.requestId;
    }

    isTerminal(): boolean {
        return this.state === 'completed' || this.state === 'failed';
    }
}

export function createOperationGuard(options: {
    operationName: string;
    abortSignal?: AbortSignal;
    timeoutMs?: number;
}): { signal: AbortSignal; abort: (reason?: Error) => void; cleanup: () => void } {
    const { operationName, abortSignal, timeoutMs } = options;
    const controller = new AbortController();

    const abortWith = (reason: Error) => {
        if (!controller.signal.aborted) {
            controller.abort(reason);
        }
    };

    if (abortSignal?.aborted) {
        abortWith(createGuardError(operationName, 'aborted'));
    }

    let timeoutId: NodeJS.Timeout | undefined;
    let abortListener: (() => void) | undefined;

    if (abortSignal) {
        abortListener = () => abortWith(createGuardError(operationName, 'aborted'));
        abortSignal.addEventListener('abort', abortListener, { once: true });
    }

    if (typeof timeoutMs === 'number' && timeoutMs > 0) {
        timeoutId = setTimeout(() => {
            abortWith(createGuardError(operationName, 'timed_out', timeoutMs));
        }, timeoutMs);
    }

    return {
        signal: controller.signal,
        abort: (reason?: Error) => {
            abortWith(reason ?? createGuardError(operationName, 'aborted'));
        },
        cleanup: () => {
            if (abortSignal && abortListener) {
                abortSignal.removeEventListener('abort', abortListener);
            }
            if (timeoutId) {
                clearTimeout(timeoutId);
            }
        },
    };
}

export async function* streamWithAbortAndTimeout<T>(
    stream: AsyncGenerator<T>,
    options: {
        abortSignal?: AbortSignal;
    }
): AsyncGenerator<T> {
    const { abortSignal } = options;

    if (abortSignal?.aborted) {
        throw abortSignal.reason ?? createGuardError('Operation', 'aborted');
    }

    let abortListener: (() => void) | undefined;
    let streamCompleted = false;

    const abortPromise = new Promise<IteratorResult<T>>((_, reject) => {
        if (!abortSignal) {
            return;
        }

        abortListener = () => reject(abortSignal.reason ?? createGuardError('Operation', 'aborted'));
        abortSignal.addEventListener('abort', abortListener, { once: true });
    });

    try {
        while (true) {
            const nextPromise = stream.next();
            let iteration: IteratorResult<T>;

            try {
                iteration = abortSignal ? await Promise.race([nextPromise, abortPromise]) : await nextPromise;
            } catch (error) {
                nextPromise.catch(() => {
                    // Ignore the eventual provider rejection if the abort guard won the race.
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

        if (!streamCompleted && typeof stream.return === 'function') {
            void stream.return(undefined).catch(() => {
                // Ignore cleanup failures from provider iterators.
            });
        }
    }
}
