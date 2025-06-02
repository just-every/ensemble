/**
 * Unified error handling for the ensemble library
 */

import { EnsembleStreamEvent } from '../types.js';

export enum ErrorCode {
    // Provider errors
    PROVIDER_NOT_FOUND = 'PROVIDER_NOT_FOUND',
    PROVIDER_AUTH_FAILED = 'PROVIDER_AUTH_FAILED',
    PROVIDER_RATE_LIMIT = 'PROVIDER_RATE_LIMIT',
    PROVIDER_QUOTA_EXCEEDED = 'PROVIDER_QUOTA_EXCEEDED',
    
    // Tool errors
    TOOL_NOT_FOUND = 'TOOL_NOT_FOUND',
    TOOL_EXECUTION_FAILED = 'TOOL_EXECUTION_FAILED',
    TOOL_TIMEOUT = 'TOOL_TIMEOUT',
    TOOL_VALIDATION_FAILED = 'TOOL_VALIDATION_FAILED',
    
    // Request errors
    MAX_TOOL_CALLS_EXCEEDED = 'MAX_TOOL_CALLS_EXCEEDED',
    LOOP_TIMEOUT = 'LOOP_TIMEOUT',
    INVALID_REQUEST = 'INVALID_REQUEST',
    
    // System errors
    UNKNOWN_ERROR = 'UNKNOWN_ERROR'
}

export interface EnsembleError extends Error {
    code: ErrorCode;
    details?: any;
    recoverable?: boolean;
    retry?: {
        attempts: number;
        delay: number;
    };
}

export class EnsembleErrorHandler {
    private static retryDelays = [1000, 2000, 4000, 8000]; // Exponential backoff
    
    /**
     * Create a standardized error
     */
    static createError(
        code: ErrorCode, 
        message: string, 
        details?: any,
        recoverable = false
    ): EnsembleError {
        const error = new Error(message) as EnsembleError;
        error.code = code;
        error.details = details;
        error.recoverable = recoverable;
        return error;
    }
    
    /**
     * Handle error with retry logic
     */
    static async handleWithRetry<T>(
        operation: () => Promise<T>,
        maxRetries = 3,
        isRetryable?: (error: any) => boolean
    ): Promise<T> {
        let lastError: any;
        
        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            try {
                return await operation();
            } catch (error) {
                lastError = error;
                
                // Check if we should retry
                const shouldRetry = isRetryable ? isRetryable(error) : 
                    this.isRetryableError(error);
                    
                if (!shouldRetry || attempt === maxRetries) {
                    throw error;
                }
                
                // Wait before retrying
                const delay = this.retryDelays[Math.min(attempt, this.retryDelays.length - 1)];
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
        
        throw lastError;
    }
    
    /**
     * Default retry logic
     */
    static isRetryableError(error: any): boolean {
        if (error?.code) {
            return [
                ErrorCode.PROVIDER_RATE_LIMIT,
                ErrorCode.TOOL_TIMEOUT,
                ErrorCode.PROVIDER_QUOTA_EXCEEDED
            ].includes(error.code);
        }
        
        // Check for common retryable HTTP errors
        if (error?.status) {
            return [429, 502, 503, 504].includes(error.status);
        }
        
        return false;
    }
    
    /**
     * Convert error to stream event
     */
    static toStreamEvent(error: any): EnsembleStreamEvent {
        const ensembleError = error as EnsembleError;
        
        return {
            type: 'error',
            error: error.message || 'Unknown error',
            code: ensembleError.code,
            details: ensembleError.details,
            recoverable: ensembleError.recoverable,
            timestamp: new Date().toISOString()
        } as EnsembleStreamEvent;
    }
    
    /**
     * Extract user-friendly error message
     */
    static getUserMessage(error: any): string {
        const ensembleError = error as EnsembleError;
        
        switch (ensembleError.code) {
            case ErrorCode.PROVIDER_AUTH_FAILED:
                return 'Authentication failed. Please check your API key.';
            case ErrorCode.PROVIDER_RATE_LIMIT:
                return 'Rate limit exceeded. Please try again later.';
            case ErrorCode.TOOL_NOT_FOUND:
                return `Tool "${ensembleError.details?.toolName}" not found.`;
            case ErrorCode.MAX_TOOL_CALLS_EXCEEDED:
                return 'Maximum number of tool calls exceeded.';
            default:
                return error.message || 'An unexpected error occurred.';
        }
    }
}