/**
 * Standardized error types for the ensemble system
 */

import { ModelProviderID } from '../data/model_data.js';

/**
 * Base error class for all ensemble errors
 */
export class EnsembleError extends Error {
    constructor(
        message: string,
        public code: string,
        public recoverable: boolean = false,
        public details?: Record<string, unknown>
    ) {
        super(message);
        this.name = 'EnsembleError';
    }
}

/**
 * Error thrown by model providers
 */
export class ProviderError extends EnsembleError {
    constructor(
        public provider: ModelProviderID,
        message: string,
        code: string,
        recoverable: boolean = false,
        details?: Record<string, unknown>
    ) {
        super(message, code, recoverable, details);
        this.name = 'ProviderError';
    }
}

/**
 * Error thrown during tool execution
 */
export class ToolExecutionError extends EnsembleError {
    constructor(
        public toolName: string,
        message: string,
        code: string = 'TOOL_EXECUTION_ERROR',
        recoverable: boolean = true,
        details?: Record<string, unknown>
    ) {
        super(message, code, recoverable, details);
        this.name = 'ToolExecutionError';
    }
}

/**
 * Error thrown when request is aborted
 */
export class AbortError extends EnsembleError {
    constructor(message: string = 'Operation aborted') {
        super(message, 'ABORT_ERROR', false);
        this.name = 'AbortError';
    }
}

/**
 * Error thrown when system is paused and operation is cancelled
 */
export class PauseAbortError extends AbortError {
    constructor() {
        super('Operation aborted while waiting for pause');
        this.name = 'PauseAbortError';
    }
}

/**
 * Error thrown when quota is exceeded
 */
export class QuotaExceededError extends EnsembleError {
    constructor(
        public provider: ModelProviderID,
        public model: string,
        message: string,
        details?: Record<string, unknown>
    ) {
        super(message, 'QUOTA_EXCEEDED', false, details);
        this.name = 'QuotaExceededError';
    }
}

/**
 * Error thrown when model is not found or not available
 */
export class ModelNotFoundError extends EnsembleError {
    constructor(
        public model: string,
        message?: string
    ) {
        super(
            message || `Model '${model}' not found or not available`,
            'MODEL_NOT_FOUND',
            false
        );
        this.name = 'ModelNotFoundError';
    }
}

/**
 * Error thrown when configuration is invalid
 */
export class ConfigurationError extends EnsembleError {
    constructor(message: string, details?: Record<string, unknown>) {
        super(message, 'CONFIGURATION_ERROR', false, details);
        this.name = 'ConfigurationError';
    }
}