/**
 * Test utilities for ensemble - Enhanced mocking and testing helpers
 */

import { ProviderStreamEvent, ToolCall } from '../types/types.js';
import { vi } from 'vitest';

export interface MockToolCall {
    name: string;
    arguments: Record<string, any>;
}

export interface MockResponse {
    message?: string;
    toolCalls?: MockToolCall[];
    error?: Error | string;
    delay?: number;
    thinking?: string;
}

export interface MockStreamOptions {
    onToolCall?: (call: ToolCall) => void;
    includeThinking?: boolean;
}

/**
 * Enhanced request mock for testing
 */
export class EnhancedRequestMock {
    private responses: MockResponse[];
    private callIndex = 0;

    constructor(responses: MockResponse | MockResponse[]) {
        this.responses = Array.isArray(responses) ? responses : [responses];
    }

    /**
     * Get a mock function that simulates the request behavior
     */
    getMock() {
        return (model: string, messages: any, options: any) => {
            return this.createAsyncGenerator(options);
        };
    }

    /**
     * Create async generator that yields events
     */
    private async *createAsyncGenerator(options?: MockStreamOptions): AsyncGenerator<ProviderStreamEvent> {
        for (const response of this.responses) {
            // Handle delay
            if (response.delay) {
                await new Promise(resolve => setTimeout(resolve, response.delay));
            }

            // Handle error
            if (response.error) {
                const error = typeof response.error === 'string' ? new Error(response.error) : response.error;
                yield {
                    type: 'error',
                    error: error.message,
                    timestamp: new Date().toISOString(),
                } as ProviderStreamEvent;
                return;
            }

            // Stream thinking if provided
            if (response.thinking && options?.includeThinking) {
                yield {
                    type: 'thinking_start',
                    timestamp: new Date().toISOString(),
                } as any;

                // Stream thinking in chunks
                const chunks = response.thinking.match(/.{1,10}/g) || [];
                for (const chunk of chunks) {
                    yield {
                        type: 'thinking_delta',
                        delta: chunk,
                        timestamp: new Date().toISOString(),
                    } as any;
                }

                yield {
                    type: 'thinking_complete',
                    content: response.thinking,
                    timestamp: new Date().toISOString(),
                } as any;
            }

            // Stream message
            if (response.message) {
                yield {
                    type: 'message_start',
                    timestamp: new Date().toISOString(),
                } as ProviderStreamEvent;

                // Stream message in chunks
                const chunks = response.message.match(/.{1,5}/g) || [];
                for (const chunk of chunks) {
                    yield {
                        type: 'text_delta',
                        delta: chunk,
                        timestamp: new Date().toISOString(),
                    } as any;
                }

                yield {
                    type: 'message_complete',
                    content: response.message,
                    timestamp: new Date().toISOString(),
                } as ProviderStreamEvent;
            }

            // Handle tool calls
            if (response.toolCalls && response.toolCalls.length > 0) {
                const toolCallEvents: ToolCall[] = response.toolCalls.map((call, index) => ({
                    id: `call_${Date.now()}_${index}`,
                    type: 'function' as const,
                    function: {
                        name: call.name,
                        arguments: JSON.stringify(call.arguments),
                    },
                }));

                yield {
                    type: 'tool_start',
                    tool_call: toolCallEvents,
                    timestamp: new Date().toISOString(),
                } as ProviderStreamEvent;

                // Notify callback if provided
                if (options?.onToolCall) {
                    for (const call of toolCallEvents) {
                        options.onToolCall(call);
                    }
                }
            }
        }

        // End stream
        yield {
            type: 'stream_end',
            timestamp: new Date().toISOString(),
        } as ProviderStreamEvent;
    }

    // Chainable API for common patterns
    static success(message = 'Success', result = 'Task completed') {
        return new EnhancedRequestMock({
            message,
            toolCalls: [{ name: 'task_complete', arguments: { result } }],
        });
    }

    static error(message = 'Error occurred', error = 'Task failed') {
        return new EnhancedRequestMock({
            message,
            toolCalls: [{ name: 'task_fatal_error', arguments: { error } }],
        });
    }

    static throws(error: Error | string) {
        return new EnhancedRequestMock({
            error: typeof error === 'string' ? new Error(error) : error,
        });
    }

    static thinking(thinking: string, message: string) {
        return new EnhancedRequestMock({
            thinking,
            message,
        });
    }

    static toolCalls(...calls: MockToolCall[]) {
        return new EnhancedRequestMock({
            message: '',
            toolCalls: calls,
        });
    }

    static sequence(...responses: MockResponse[]) {
        return new EnhancedRequestMock(responses);
    }
}

/**
 * Mock context creator for testing
 */
export function createMockContext(overrides: Partial<any> = {}) {
    return {
        shouldContinue: true,
        metadata: {},
        toolCallCount: 0,
        turnCount: 0,
        startTime: Date.now(),
        messages: [],
        isPaused: false,
        isHalted: false,

        halt: vi.fn(function () {
            this.shouldContinue = false;
            this.isHalted = true;
        }),

        pause: vi.fn(function () {
            this.isPaused = true;
        }),

        resume: vi.fn(function () {
            this.isPaused = false;
        }),

        setMetadata: vi.fn(function (key: string, value: any) {
            this.metadata[key] = value;
        }),

        getMetadata: vi.fn(function (key: string) {
            return this.metadata[key];
        }),

        addMessage: vi.fn(function (message: any) {
            this.messages.push(message);
        }),

        getHistory: vi.fn(function () {
            return this.messages;
        }),

        ...overrides,
    };
}

/**
 * Assertion helpers for ensemble stream events
 */
export class StreamAssertions {
    private events: ProviderStreamEvent[] = [];

    constructor(eventGenerator: AsyncGenerator<ProviderStreamEvent>) {
        // Collect all events
        (async () => {
            for await (const event of eventGenerator) {
                this.events.push(event);
            }
        })();
    }

    /**
     * Wait for events to be collected
     */
    async waitForCompletion(): Promise<void> {
        // Wait a bit for async collection
        await new Promise(resolve => setTimeout(resolve, 100));
    }

    /**
     * Assert a specific event type was emitted
     */
    hasEvent(type: string): boolean {
        return this.events.some(e => e.type === type);
    }

    /**
     * Get all events of a specific type
     */
    getEvents(type: string): ProviderStreamEvent[] {
        return this.events.filter(e => e.type === type);
    }

    /**
     * Assert tool was called
     */
    hasToolCall(name: string): boolean {
        const toolEvents = this.getEvents('tool_start');
        return toolEvents.some(event => {
            if ('tool_call' in event && event.tool_call) {
                return event.tool_call.function.name === name;
            }
            return false;
        });
    }

    /**
     * Get final message content
     */
    getFinalMessage(): string | undefined {
        const messageEvents = this.getEvents('message_complete');
        if (messageEvents.length > 0) {
            const lastEvent = messageEvents[messageEvents.length - 1];
            return 'content' in lastEvent ? lastEvent.content : undefined;
        }
        return undefined;
    }

    /**
     * Check if stream ended with error
     */
    hasError(): boolean {
        return this.hasEvent('error');
    }

    /**
     * Get error message if any
     */
    getError(): string | undefined {
        const errorEvents = this.getEvents('error');
        if (errorEvents.length > 0) {
            const errorEvent = errorEvents[0];
            return 'error' in errorEvent ? errorEvent.error : undefined;
        }
        return undefined;
    }
}
