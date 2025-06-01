/**
 * Enhanced tool handling types for the Ensemble library
 * Provides unified interface for tool execution across different systems (MAGI, MECH, etc.)
 */

import { ToolFunction, ToolCall, StreamEvent, ResponseInput } from '../types.js';

/**
 * Actions that can be taken when a tool call is intercepted
 */
export enum ToolCallAction {
    EXECUTE = 'execute',      // Execute the tool normally
    SKIP = 'skip',           // Skip this tool call
    HALT = 'halt',           // Stop all execution immediately
    DEFER = 'defer',         // Let the system decide
    RETRY = 'retry',         // Retry the tool call
    REPLACE = 'replace'      // Replace with different result
}

/**
 * Tool execution metrics for tracking performance
 */
export interface ExecutionMetrics {
    duration: number;         // Milliseconds
    tokenCount: number;       // Total tokens used
    toolCallCount: number;    // Number of tool calls made
    modelCalls: number;       // Number of LLM calls
    errors: number;           // Number of errors encountered
    retries?: number;         // Number of retries
    timestamp: number;        // When execution started
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
 * Enhanced tool function with additional metadata
 */
export interface EnhancedToolFunction extends ToolFunction {
    // Tool categorization
    category?: 'control' | 'utility' | 'meta' | 'custom' | string;
    priority?: number;           // Execution order (lower = higher priority)
    sideEffects?: boolean;       // Indicates if tool affects system state
    
    // Agent-specific fields (MAGI)
    agentId?: string;           // Tools specific to certain agents
    requiresContext?: string[]; // Required context fields
    
    // Execution constraints
    maxExecutions?: number;     // Max times this tool can be called
    cooldown?: number;          // Milliseconds between executions
    timeout?: number;           // Max execution time in milliseconds
    
    // Dependencies
    dependsOn?: string[];       // Other tools that must run first
    conflicts?: string[];       // Tools that cannot run concurrently
}

/**
 * Tool handler configuration for lifecycle management
 */
export interface ToolHandler {
    // Custom context passed to all tool calls
    context?: any;
    
    // Lifecycle hooks
    onToolCall?: (toolCall: ToolCall, context: any) => Promise<ToolCallAction | { action: ToolCallAction; replacement?: any }>;
    onToolComplete?: (toolCall: ToolCall, result: any, context: any) => Promise<void>;
    onToolError?: (toolCall: ToolCall, error: Error, context: any) => Promise<any>;
    
    // Custom tool executor (replaces processToolCall)
    executor?: (tool: ToolFunction, args: any, context: any) => Promise<any>;
    
    // Execution control
    executionMode?: 'sequential' | 'parallel' | 'batch';
    errorStrategy?: 'throw' | 'return-error' | 'retry' | 'custom';
    retryConfig?: {
        maxAttempts?: number;
        backoff?: 'linear' | 'exponential';
        initialDelay?: number;
    };
}

/**
 * Loop configuration for multi-round execution
 */
export interface LoopConfig {
    maxIterations?: number;
    maxDuration?: number;           // milliseconds
    continueCondition?: (context: RequestContext) => boolean | Promise<boolean>;
    onIteration?: (iteration: number, context: RequestContext) => Promise<void>;
    breakOnError?: boolean;         // Stop loop on first error
    resetToolCount?: boolean;       // Reset tool count each iteration
}

/**
 * Tool result transformation configuration
 */
export interface ToolResultTransformer {
    // Transform the raw result
    transform?: (toolName: string, result: any, context: any) => any;
    
    // Augment result with additional data (e.g., metrics)
    augment?: (toolName: string, result: any, metrics: ExecutionMetrics) => any;
    
    // Format result for model consumption
    format?: (toolName: string, result: any) => string;
    
    // Validate result before returning
    validate?: (toolName: string, result: any) => boolean | { valid: boolean; error?: string };
}

/**
 * Tool choice strategy function type
 */
export type ToolChoiceStrategy = (
    callCount: number,
    turnCount: number,
    context: any
) => 'none' | 'auto' | 'required' | { type: 'function'; function: { name: string } };

/**
 * Enhanced request options with comprehensive tool handling
 */
export interface EnhancedRequestOptions {
    // === Tool Execution Control ===
    toolHandler?: ToolHandler;
    
    // === Tool Filtering & Organization ===
    toolCategories?: string[];                          // Filter by category
    toolFilter?: (tool: ToolFunction) => boolean;      // Custom filter
    toolPriority?: (tools: ToolFunction[]) => ToolFunction[]; // Sort tools
    
    // === Multi-Round Control ===
    loop?: boolean | LoopConfig;
    
    // === Tool Call Limits ===
    maxToolCalls?: number;              // Total across all iterations
    maxToolCallsPerTurn?: number;       // Per conversation turn
    
    // === Dynamic Strategy ===
    toolChoiceStrategy?: ToolChoiceStrategy;
    
    // === Result Processing ===
    toolResultTransformer?: ToolResultTransformer;
    
    // === Event System ===
    allowedEvents?: string[];           // Event filtering
    eventEmitter?: (event: StreamEvent, context: any) => void | Promise<void>;
    onStreamComplete?: (response: any, context: any) => Promise<boolean>;
    
    // === Performance ===
    cacheToolResults?: boolean;         // Cache identical tool calls
    parallelExecution?: number;         // Max parallel tool executions
    
    // === Debugging ===
    debug?: boolean | {
        logToolCalls?: boolean;
        logToolResults?: boolean;
        logMessages?: boolean;
        logMetrics?: boolean;
    };
}

/**
 * Factory function to create a request context
 */
export function createRequestContext(initialData?: Partial<RequestContext>): RequestContext {
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
        }
    };
    
    return context;
}

/**
 * Helper to check if a value is a loop config
 */
export function isLoopConfig(value: boolean | LoopConfig): value is LoopConfig {
    return typeof value === 'object' && value !== null;
}

/**
 * Helper to normalize tool choice strategy
 */
export function normalizeToolChoice(
    choice: ReturnType<ToolChoiceStrategy>
): 'none' | 'auto' | 'required' | { type: 'function'; function: { name: string } } {
    if (typeof choice === 'string') {
        return choice;
    }
    return choice;
}