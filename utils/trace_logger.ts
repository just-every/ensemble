import { EnsembleTraceEvent, EnsembleTraceLogger } from '../types/types.js';

// Re-export for backward compatibility and shared typing
export type { EnsembleTraceEvent, EnsembleTraceLogger };

let globalTraceLoggers: EnsembleTraceLogger[] = [];
const turnSequenceMap = new Map<string, number>();

function nextSequence(turnId: string): number {
    const next = (turnSequenceMap.get(turnId) || 0) + 1;
    turnSequenceMap.set(turnId, next);
    return next;
}

/**
 * Add a trace logger to the ensemble trace logging system.
 * Multiple trace loggers can be added and they will all be called.
 * Pass null to clear all trace loggers.
 */
export function setEnsembleTraceLogger(logger: EnsembleTraceLogger | null): void {
    if (logger === null) {
        globalTraceLoggers = [];
        turnSequenceMap.clear();
    } else if (!globalTraceLoggers.includes(logger)) {
        globalTraceLoggers.push(logger);
    }
}

/**
 * Add a trace logger without removing existing ones.
 */
export function addEnsembleTraceLogger(logger: EnsembleTraceLogger): void {
    if (!globalTraceLoggers.includes(logger)) {
        globalTraceLoggers.push(logger);
    }
}

/**
 * Remove a specific trace logger from the ensemble trace logging system.
 */
export function removeEnsembleTraceLogger(logger: EnsembleTraceLogger): void {
    const index = globalTraceLoggers.indexOf(logger);
    if (index > -1) {
        globalTraceLoggers.splice(index, 1);
    }
}

/**
 * Get the first registered trace logger for backward compatibility with single-logger usage.
 */
export function getEnsembleTraceLogger(): EnsembleTraceLogger | null {
    return globalTraceLoggers[0] || null;
}

/**
 * Get all registered trace loggers.
 */
export function getAllEnsembleTraceLoggers(): EnsembleTraceLogger[] {
    return [...globalTraceLoggers];
}

/**
 * Emit a trace event to all registered trace loggers.
 * Sequence numbers are assigned per turn when not provided.
 */
export async function emitTraceEvent(
    event: Omit<EnsembleTraceEvent, 'sequence' | 'timestamp'> & { sequence?: number; timestamp?: string }
): Promise<void> {
    if (globalTraceLoggers.length === 0) {
        return;
    }

    const sequence = event.sequence ?? nextSequence(event.turn_id);
    const timestamp = event.timestamp || new Date().toISOString();
    const finalEvent: EnsembleTraceEvent = {
        ...event,
        sequence,
        timestamp,
    };

    const calls = globalTraceLoggers.map(async logger => {
        try {
            await logger.log_trace_event(finalEvent);
        } catch (error) {
            console.error('Error in logger.log_trace_event:', error);
        }
    });

    await Promise.all(calls);

    if (event.type === 'turn_end') {
        turnSequenceMap.delete(event.turn_id);
    }
}
