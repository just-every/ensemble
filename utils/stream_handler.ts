/**
 * Common streaming utilities for model providers
 */

import { ProviderStreamEvent } from '../types/types.js';
import { isPaused, waitWhilePaused } from './pause_controller.js';

export interface StreamHandlerOptions {
    /** Check interval for pause state (ms) */
    pauseCheckInterval?: number;
    /** Abort signal to cancel streaming */
    abortSignal?: AbortSignal;
    /** Provider name for logging */
    providerName?: string;
    /** Model name for logging */
    modelName?: string;
}

/**
 * Base class for handling common streaming patterns across providers
 */
export class StreamHandler<TEvent> {
    constructor(private options: StreamHandlerOptions = {}) {}

    /**
     * Handle a stream with pause support and error handling
     */
    async *handleStream(
        stream: AsyncIterable<TEvent>,
        transformer: (chunk: TEvent) => ProviderStreamEvent | ProviderStreamEvent[] | null
    ): AsyncGenerator<ProviderStreamEvent> {
        const { pauseCheckInterval = 100, abortSignal, providerName = 'Unknown', modelName = 'Unknown' } = this.options;

        try {
            for await (const chunk of stream) {
                // Check for pause before processing each chunk
                if (isPaused()) {
                    console.log(`[${providerName}] System paused during stream for model ${modelName}. Waiting...`);
                    await waitWhilePaused(pauseCheckInterval, abortSignal);
                    console.log(`[${providerName}] System resumed, continuing stream for model ${modelName}`);
                }

                // Transform the chunk into provider events
                const events = transformer(chunk);
                if (events) {
                    if (Array.isArray(events)) {
                        for (const event of events) {
                            yield event;
                        }
                    } else {
                        yield events;
                    }
                }
            }
        } catch (error: any) {
            // Emit error event for stream failures
            yield {
                type: 'error',
                error: error.message || 'Unknown streaming error',
                code: error.code,
                details: error.details,
                recoverable: error.recoverable,
                timestamp: new Date().toISOString(),
            } as ProviderStreamEvent;
        }
    }
}

/**
 * Utility function to create a stream handler with pause support
 */
export function createStreamHandler<TEvent>(options: StreamHandlerOptions = {}): StreamHandler<TEvent> {
    return new StreamHandler<TEvent>(options);
}

/**
 * Common event transformer for message deltas
 */
export function createMessageDeltaTransformer(messageId: string) {
    let order = 0;

    return function transformMessageDelta(content: string): ProviderStreamEvent {
        return {
            type: 'message_delta',
            content,
            message_id: messageId,
            order: order++,
            timestamp: new Date().toISOString(),
        };
    };
}

/**
 * Common event transformer for message completion
 */
export function createMessageCompleteTransformer(messageId: string) {
    return function transformMessageComplete(content: string): ProviderStreamEvent {
        return {
            type: 'message_complete',
            content,
            message_id: messageId,
            timestamp: new Date().toISOString(),
        };
    };
}
