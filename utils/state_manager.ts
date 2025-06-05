/**
 * State management utilities for ensemble requests
 */

import { RequestContext } from '../types/tool_types.js';

/**
 * State manager for tracking request state
 */
export class StateManager {
    private state: Map<string, any> = new Map();

    /**
     * Get a value from state
     */
    get<T = any>(key: string, defaultValue?: T): T | undefined {
        return this.state.has(key) ? this.state.get(key) : defaultValue;
    }

    /**
     * Set a value in state
     */
    set(key: string, value: any): void {
        this.state.set(key, value);
    }

    /**
     * Check if a key exists
     */
    has(key: string): boolean {
        return this.state.has(key);
    }

    /**
     * Delete a key from state
     */
    delete(key: string): boolean {
        return this.state.delete(key);
    }

    /**
     * Clear all state
     */
    clear(): void {
        this.state.clear();
    }

    /**
     * Get all state as object
     */
    toObject(): Record<string, any> {
        const obj: Record<string, any> = {};
        for (const [key, value] of this.state) {
            obj[key] = value;
        }
        return obj;
    }

    /**
     * Load state from object
     */
    fromObject(obj: Record<string, any>): void {
        this.clear();
        for (const [key, value] of Object.entries(obj)) {
            this.set(key, value);
        }
    }
}

/**
 * Extended RequestContext with state management
 */
export class RequestContextWithState implements RequestContext {
    private stateManager: StateManager;
    shouldContinue: boolean = true;
    metadata: Record<string, any> = {};
    toolCallCount: number = 0;
    turnCount: number = 0;
    startTime: number = Date.now();
    messages: any[] = [];
    isPaused: boolean = false;
    isHalted: boolean = false;
    agent?: any;

    constructor(
        private options: {
            stateManager?: StateManager;
            onHalt?: () => void;
            onPause?: () => void;
            onResume?: () => void;
        } = {}
    ) {
        this.stateManager = options.stateManager || new StateManager();
    }

    halt(): void {
        this.shouldContinue = false;
        this.isHalted = true;
        this.options.onHalt?.();
    }

    pause(): void {
        this.isPaused = true;
        this.options.onPause?.();
    }

    resume(): void {
        this.isPaused = false;
        this.options.onResume?.();
    }

    setMetadata(key: string, value: any): void {
        this.metadata[key] = value;
    }

    getMetadata<T = any>(key: string): T | undefined {
        return this.metadata[key] as T | undefined;
    }

    addMessage(message: any): void {
        this.messages.push(message);
    }

    getHistory(): any[] {
        return this.messages;
    }

    // State management convenience methods

    /**
     * Increment a counter in state
     */
    incrementCounter(key: string): number {
        const current = this.stateManager.get(key, 0) as number;
        const next = current + 1;
        this.stateManager.set(key, next);
        return next;
    }

    /**
     * Decrement a counter in state
     */
    decrementCounter(key: string): number {
        const current = this.stateManager.get(key, 0) as number;
        const next = Math.max(0, current - 1);
        this.stateManager.set(key, next);
        return next;
    }

    /**
     * Update a score (model performance, etc)
     */
    updateScore(key: string, score: number): void {
        const scores = this.stateManager.get('scores', {}) as Record<
            string,
            number
        >;
        scores[key] = score;
        this.stateManager.set('scores', scores);
    }

    /**
     * Get a score
     */
    getScore(key: string, defaultScore = 50): number {
        const scores = this.stateManager.get('scores', {}) as Record<
            string,
            number
        >;
        return scores[key] || defaultScore;
    }

    /**
     * Get all scores
     */
    getAllScores(): Record<string, number> {
        return this.stateManager.get('scores', {}) as Record<string, number>;
    }

    /**
     * Track a disabled model
     */
    disableModel(model: string, reason?: string): void {
        const disabled = this.stateManager.get('disabledModels', {}) as Record<
            string,
            string | boolean
        >;
        disabled[model] = reason || true;
        this.stateManager.set('disabledModels', disabled);
    }

    /**
     * Check if a model is disabled
     */
    isModelDisabled(model: string): boolean {
        const disabled = this.stateManager.get('disabledModels', {}) as Record<
            string,
            string | boolean
        >;
        return model in disabled;
    }

    /**
     * Get disabled models
     */
    getDisabledModels(): string[] {
        const disabled = this.stateManager.get('disabledModels', {}) as Record<
            string,
            string | boolean
        >;
        return Object.keys(disabled);
    }

    /**
     * Enable a model
     */
    enableModel(model: string): void {
        const disabled = this.stateManager.get('disabledModels', {}) as Record<
            string,
            string | boolean
        >;
        delete disabled[model];
        this.stateManager.set('disabledModels', disabled);
    }

    /**
     * Track request timing
     */
    recordRequestTime(model: string, duration: number): void {
        const timings = this.stateManager.get('requestTimings', {}) as Record<
            string,
            number[]
        >;
        if (!timings[model]) {
            timings[model] = [];
        }
        timings[model].push(duration);
        this.stateManager.set('requestTimings', timings);
    }

    /**
     * Get average request time for a model
     */
    getAverageRequestTime(model: string): number | null {
        const timings = this.stateManager.get('requestTimings', {}) as Record<
            string,
            number[]
        >;
        const modelTimings = timings[model];
        if (!modelTimings || modelTimings.length === 0) {
            return null;
        }
        const sum = modelTimings.reduce((a, b) => a + b, 0);
        return sum / modelTimings.length;
    }

    /**
     * Get the underlying state manager
     */
    getStateManager(): StateManager {
        return this.stateManager;
    }
}

/**
 * Create a RequestContext with state management
 */
export function createRequestContextWithState(options?: {
    stateManager?: StateManager;
    metadata?: Record<string, any>;
    messages?: any[];
    onHalt?: () => void;
    onPause?: () => void;
    onResume?: () => void;
}): RequestContextWithState {
    const context = new RequestContextWithState(options);

    if (options?.metadata) {
        context.metadata = options.metadata;
    }

    if (options?.messages) {
        context.messages = options.messages;
    }

    return context;
}
