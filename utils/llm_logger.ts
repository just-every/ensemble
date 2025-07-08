import { EnsembleLogger } from '../types/types.js';

// Re-export for backward compatibility
export type { EnsembleLogger };

// Store multiple loggers
let globalLoggers: EnsembleLogger[] = [];

/**
 * Add a logger to the ensemble logging system.
 * Multiple loggers can be added and they will all be called.
 * Pass null to clear all loggers.
 */
export function setEnsembleLogger(logger: EnsembleLogger | null): void {
    if (logger === null) {
        // Clear all loggers
        globalLoggers = [];
    } else {
        // Add logger if not already present
        if (!globalLoggers.includes(logger)) {
            globalLoggers.push(logger);
        }
    }
}

/**
 * Add a logger without removing existing ones.
 * This is an alias for clarity.
 */
export function addEnsembleLogger(logger: EnsembleLogger): void {
    if (!globalLoggers.includes(logger)) {
        globalLoggers.push(logger);
    }
}

/**
 * Remove a specific logger from the ensemble logging system.
 */
export function removeEnsembleLogger(logger: EnsembleLogger): void {
    const index = globalLoggers.indexOf(logger);
    if (index > -1) {
        globalLoggers.splice(index, 1);
    }
}

/**
 * Get all registered loggers.
 * Returns the first logger for backward compatibility when used as a single logger.
 */
export function getEnsembleLogger(): EnsembleLogger | null {
    return globalLoggers[0] || null;
}

/**
 * Get all registered loggers.
 */
export function getAllEnsembleLoggers(): EnsembleLogger[] {
    return [...globalLoggers];
}

export function log_llm_request(
    agentId: string,
    providerName: string,
    model: string,
    requestData: unknown,
    timestamp?: Date,
    requestId?: string
): string {
    // Collect request IDs from all loggers
    const requestIds: string[] = [];

    for (const logger of globalLoggers) {
        try {
            const loggerRequestId = logger.log_llm_request(
                agentId,
                providerName,
                model,
                requestData,
                timestamp,
                requestId
            );
            if (loggerRequestId) {
                requestIds.push(loggerRequestId);
            }
        } catch (error) {
            console.error('Error in logger.log_llm_request:', error);
        }
    }

    // Return the first request ID for backward compatibility, or the provided requestId if no loggers returned one
    return requestIds[0] || requestId || '';
}

export function log_llm_response(requestId: string | undefined, responseData: unknown, timestamp?: Date): void {
    for (const logger of globalLoggers) {
        try {
            logger.log_llm_response(requestId, responseData, timestamp);
        } catch (error) {
            console.error('Error in logger.log_llm_response:', error);
        }
    }
}

export function log_llm_error(requestId: string | undefined, errorData: unknown, timestamp?: Date): void {
    for (const logger of globalLoggers) {
        try {
            logger.log_llm_error(requestId, errorData, timestamp);
        } catch (error) {
            console.error('Error in logger.log_llm_error:', error);
        }
    }
}
