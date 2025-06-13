import { ModelProvider } from './model_provider.js';
import { ModelProviderID } from '../data/model_data.js';
import {
    ProviderStreamEvent,
    ResponseInput,
    AgentDefinition,
} from '../types/types.js';
import { isValidBase64, detectImageType } from '../utils/image_validation.js';
import {
    retryStreamWithBackoff,
    RetryOptions,
} from '../utils/retry_handler.js';

/**
 * Abstract base class for model providers that implements common functionality
 */
export abstract class BaseModelProvider implements ModelProvider {
    public provider_id: string;

    constructor(protected providerId: ModelProviderID) {
        this.provider_id = providerId;
    }

    abstract createResponseStream(
        messages: ResponseInput,
        model: string,
        agent: AgentDefinition
    ): AsyncGenerator<ProviderStreamEvent>;

    /**
     * Create a response stream with automatic retry on network errors
     */
    async *createResponseStreamWithRetry(
        messages: ResponseInput,
        model: string,
        agent: AgentDefinition
    ): AsyncGenerator<ProviderStreamEvent> {
        const retryOptions: RetryOptions = {
            maxRetries: agent.retryOptions?.maxRetries ?? 3,
            initialDelay: agent.retryOptions?.initialDelay ?? 1000,
            maxDelay: agent.retryOptions?.maxDelay ?? 30000,
            backoffMultiplier: agent.retryOptions?.backoffMultiplier ?? 2,
            onRetry: (error, attempt) => {
                console.error(
                    `${this.providerId} error ${model}: Retry attempt ${attempt} after error:`,
                    error.message || error
                );
                agent.retryOptions?.onRetry?.(error, attempt);
            },
        };

        if (agent.retryOptions?.additionalRetryableErrors) {
            retryOptions.retryableErrors = new Set([
                ...(retryOptions.retryableErrors || []),
                ...agent.retryOptions.additionalRetryableErrors,
            ]);
        }

        if (agent.retryOptions?.additionalRetryableStatusCodes) {
            retryOptions.retryableStatusCodes = new Set([
                ...(retryOptions.retryableStatusCodes || []),
                ...agent.retryOptions.additionalRetryableStatusCodes,
            ]);
        }

        yield* retryStreamWithBackoff(
            () => this.createResponseStream(messages, model, agent),
            retryOptions
        );
    }

    /**
     * Validate base64 string
     * @deprecated Use isValidBase64 from utils/image_validation.js
     */
    protected isValidBase64(str: string): boolean {
        return isValidBase64(str);
    }

    /**
     * Detect image type from base64 data
     * @deprecated Use detectImageType from utils/image_validation.js
     */
    protected detectImageType(base64Data: string): string | null {
        return detectImageType(base64Data);
    }
}
