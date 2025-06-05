/**
 * Enhanced tool handling types for the Ensemble library
 * Provides unified interface for tool execution across different systems (MAGI, MECH, etc.)
 */

import { ResponseInput } from './types.js';

/**
 * Actions that can be taken when a tool call is intercepted
 */
export enum ToolCallAction {
    EXECUTE = 'execute', // Execute the tool normally
    SKIP = 'skip', // Skip this tool call
    HALT = 'halt', // Stop all execution immediately
    DEFER = 'defer', // Let the system decide
    RETRY = 'retry', // Retry the tool call
    REPLACE = 'replace', // Replace with different result
}

/**
 * Stateful context for request execution
 */
export interface RequestContext {
    // Core state
    shouldContinue: boolean;
    metadata: Record<string, any>;

    // Execution tracking
    toolCallCount: number;
    turnCount: number;
    startTime: number;

    // History management
    messages: ResponseInput;

    // Methods
    halt(): void;
    pause(): void;
    resume(): void;
    setMetadata(key: string, value: any): void;
    getMetadata<T = any>(key: string): T | undefined;
    addMessage(message: any): void;
    getHistory(): ResponseInput;

    // Optional agent context (for MAGI)
    agent?: any;

    // Execution state
    isPaused: boolean;
    isHalted: boolean;
}

/**
 * Factory function to create a request context
 */
export function createRequestContext(
    initialData?: Partial<RequestContext>
): RequestContext {
    const context: RequestContext = {
        // Default values
        shouldContinue: true,
        metadata: {},
        toolCallCount: 0,
        turnCount: 0,
        startTime: Date.now(),
        messages: [],
        isPaused: false,
        isHalted: false,

        // Apply initial data
        ...initialData,

        // Methods
        halt() {
            this.shouldContinue = false;
            this.isHalted = true;
        },

        pause() {
            this.isPaused = true;
        },

        resume() {
            this.isPaused = false;
        },

        setMetadata(key: string, value: any) {
            this.metadata[key] = value;
        },

        getMetadata<T = any>(key: string): T | undefined {
            return this.metadata[key] as T;
        },

        addMessage(message: any) {
            this.messages.push(message);
        },

        getHistory(): ResponseInput {
            return [...this.messages];
        },
    };

    return context;
}
