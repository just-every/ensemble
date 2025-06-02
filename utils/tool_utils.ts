/**
 * Utilities for working with tool calls
 */

import { ToolCall } from '../types.js';

/**
 * Simplified tool call structure
 */
export interface SimpleToolCall {
    name: string;
    arguments: Record<string, any> | string;
    id?: string;
}

/**
 * Type guard to check if a tool call is already in full format
 */
export function isFullToolCall(call: any): call is ToolCall {
    return call && typeof call === 'object' && 'function' in call;
}

/**
 * Normalize a tool call to the full structure
 * Accepts both simplified and full formats
 */
export function normalizeToolCall(call: SimpleToolCall | ToolCall): ToolCall {
    // Already full structure
    if (isFullToolCall(call)) {
        return call;
    }
    
    // Convert simplified structure
    const id = call.id || `call_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    return {
        id,
        type: 'function' as const,
        function: {
            name: call.name,
            arguments: typeof call.arguments === 'string' 
                ? call.arguments 
                : JSON.stringify(call.arguments)
        }
    };
}

/**
 * Normalize multiple tool calls
 */
export function normalizeToolCalls(calls: Array<SimpleToolCall | ToolCall>): ToolCall[] {
    return calls.map(normalizeToolCall);
}

/**
 * Create a simplified tool call
 */
export function createToolCall(name: string, args: Record<string, any> = {}): SimpleToolCall {
    return {
        name,
        arguments: args
    };
}

/**
 * Extract tool name from a tool call (works with both formats)
 */
export function getToolName(call: SimpleToolCall | ToolCall): string {
    if (isFullToolCall(call)) {
        return call.function.name;
    }
    return call.name;
}

/**
 * Extract tool arguments from a tool call (works with both formats)
 */
export function getToolArguments(call: SimpleToolCall | ToolCall): Record<string, any> {
    let argsString: string;
    
    if (isFullToolCall(call)) {
        argsString = call.function.arguments || '{}';
    } else {
        argsString = typeof call.arguments === 'string' 
            ? call.arguments 
            : JSON.stringify(call.arguments);
    }
    
    try {
        return JSON.parse(argsString);
    } catch {
        return {};
    }
}