import { ModelProviderID } from './model_data.js';

/**
 * Base error class for all Ensemble errors
 */
export class EnsembleError extends Error {
  constructor(
    message: string,
    public code: string,
    public context?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'EnsembleError';
  }
}

/**
 * Error thrown when a provider encounters an error
 */
export class ProviderError extends EnsembleError {
  constructor(
    public provider: ModelProviderID,
    message: string,
    code: string,
    public originalError?: unknown,
    context?: Record<string, unknown>
  ) {
    super(`[${provider}] ${message}`, code, context);
    this.name = 'ProviderError';
  }
}

/**
 * Error thrown when API rate limits are exceeded
 */
export class RateLimitError extends ProviderError {
  constructor(
    provider: ModelProviderID,
    public retryAfter?: number,
    context?: Record<string, unknown>
  ) {
    super(
      provider,
      `Rate limit exceeded${retryAfter ? `, retry after ${retryAfter}s` : ''}`,
      'RATE_LIMIT',
      undefined,
      context
    );
    this.name = 'RateLimitError';
  }
}

/**
 * Error thrown when API quota is exceeded
 */
export class QuotaExceededError extends ProviderError {
  constructor(
    provider: ModelProviderID,
    public quotaType: 'tokens' | 'requests' | 'cost',
    context?: Record<string, unknown>
  ) {
    super(
      provider,
      `${quotaType} quota exceeded`,
      'QUOTA_EXCEEDED',
      undefined,
      context
    );
    this.name = 'QuotaExceededError';
  }
}

/**
 * Error thrown when authentication fails
 */
export class AuthenticationError extends ProviderError {
  constructor(
    provider: ModelProviderID,
    message: string = 'Authentication failed',
    context?: Record<string, unknown>
  ) {
    super(provider, message, 'AUTH_FAILED', undefined, context);
    this.name = 'AuthenticationError';
  }
}

/**
 * Error thrown when a model is not found or not supported
 */
export class ModelNotFoundError extends EnsembleError {
  constructor(
    public model: string,
    public availableModels?: string[]
  ) {
    super(
      `Model '${model}' not found or not supported`,
      'MODEL_NOT_FOUND',
      { model, availableModels }
    );
    this.name = 'ModelNotFoundError';
  }
}

/**
 * Error thrown when no provider is available for a model
 */
export class NoProviderError extends EnsembleError {
  constructor(
    public model: string,
    public missingProviders?: ModelProviderID[]
  ) {
    super(
      `No valid provider found for model '${model}'. Please check your API keys.`,
      'NO_PROVIDER',
      { model, missingProviders }
    );
    this.name = 'NoProviderError';
  }
}

/**
 * Error thrown when input validation fails
 */
export class ValidationError extends EnsembleError {
  constructor(
    message: string,
    public field?: string,
    public value?: unknown
  ) {
    super(message, 'VALIDATION_ERROR', { field, value });
    this.name = 'ValidationError';
  }
}

/**
 * Error thrown when streaming is interrupted
 */
export class StreamInterruptedError extends EnsembleError {
  constructor(
    message: string = 'Stream interrupted',
    public reason?: string
  ) {
    super(message, 'STREAM_INTERRUPTED', { reason });
    this.name = 'StreamInterruptedError';
  }
}

/**
 * Error thrown when image processing fails
 */
export class ImageProcessingError extends EnsembleError {
  constructor(
    message: string,
    public operation: 'resize' | 'convert' | 'validate',
    context?: Record<string, unknown>
  ) {
    super(message, 'IMAGE_PROCESSING_ERROR', { operation, ...context });
    this.name = 'ImageProcessingError';
  }
}

/**
 * Error thrown when tool execution fails
 */
export class ToolExecutionError extends EnsembleError {
  constructor(
    public toolName: string,
    message: string,
    public parameters?: Record<string, unknown>
  ) {
    super(
      `Tool '${toolName}' execution failed: ${message}`,
      'TOOL_EXECUTION_ERROR',
      { toolName, parameters }
    );
    this.name = 'ToolExecutionError';
  }
}

/**
 * Type guard to check if an error is an Ensemble error
 */
export function isEnsembleError(error: unknown): error is EnsembleError {
  return error instanceof EnsembleError;
}

/**
 * Type guard to check if an error is a provider error
 */
export function isProviderError(error: unknown): error is ProviderError {
  return error instanceof ProviderError;
}

/**
 * Type guard to check if an error is a rate limit error
 */
export function isRateLimitError(error: unknown): error is RateLimitError {
  return error instanceof RateLimitError;
}

/**
 * Helper to create appropriate error from provider response
 */
export function createProviderError(
  provider: ModelProviderID,
  error: unknown
): ProviderError {
  if (error instanceof ProviderError) {
    return error;
  }

  const errorObj = error as any;
  
  // Check for rate limit patterns
  if (
    errorObj?.status === 429 ||
    errorObj?.code === 'rate_limit_exceeded' ||
    errorObj?.message?.toLowerCase().includes('rate limit')
  ) {
    const retryAfter = errorObj?.headers?.['retry-after'] || 
                      errorObj?.retryAfter || 
                      undefined;
    return new RateLimitError(provider, retryAfter);
  }

  // Check for authentication patterns
  if (
    errorObj?.status === 401 ||
    errorObj?.status === 403 ||
    errorObj?.code === 'unauthorized' ||
    errorObj?.message?.toLowerCase().includes('api key') ||
    errorObj?.message?.toLowerCase().includes('authentication')
  ) {
    return new AuthenticationError(provider, errorObj?.message);
  }

  // Check for quota patterns
  if (
    errorObj?.code === 'quota_exceeded' ||
    errorObj?.message?.toLowerCase().includes('quota')
  ) {
    return new QuotaExceededError(provider, 'tokens');
  }

  // Generic provider error
  return new ProviderError(
    provider,
    errorObj?.message || 'Unknown error',
    errorObj?.code || 'UNKNOWN',
    error
  );
}