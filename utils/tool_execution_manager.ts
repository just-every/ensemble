/**
 * Tool Execution Manager - Handles tool execution with timeout, tracking, and lifecycle
 */

import { v4 as uuidv4 } from 'uuid';
import { ToolCall, ToolFunction, AgentDefinition } from '../types/types.js';
import { runningToolTracker } from './running_tool_tracker.js';
import { runSequential } from './sequential_queue.js';
import { coerceValue } from './tool_parameter_utils.js';
import {
    FUNCTION_TIMEOUT_MS,
    EXCLUDED_FROM_TIMEOUT_FUNCTIONS,
    STATUS_TRACKING_TOOLS,
} from '../config/tool_execution.js';

/**
 * Convert a tool result to string intelligently
 * Handles objects, arrays, and primitive values appropriately
 */
function convertResultToString(result: any): string {
    // Handle null/undefined
    if (result === null || result === undefined) {
        return '';
    }

    // If already a string, return as-is
    if (typeof result === 'string') {
        return result;
    }

    // For numbers and booleans, use toString()
    if (typeof result === 'number' || typeof result === 'boolean') {
        return result.toString();
    }

    // For objects and arrays, try JSON.stringify
    if (typeof result === 'object') {
        try {
            // Pretty print with 2-space indentation for readability
            return JSON.stringify(result, null, 2);
        } catch (error) {
            // If JSON.stringify fails (circular references, etc.), fall back to String()
            console.warn('Failed to JSON.stringify tool result, falling back to String():', error);
            return String(result);
        }
    }

    // For functions and other types, use String()
    return String(result);
}

/**
 * Create a timeout promise
 */
export function timeoutPromise(ms: number): Promise<'TIMEOUT'> {
    return new Promise(resolve => {
        setTimeout(() => resolve('TIMEOUT'), ms);
    });
}

/**
 * Check if an agent has status tracking tools
 */
export function agentHasStatusTracking(agent: AgentDefinition): boolean {
    if (!agent.tools) return false;

    return agent.tools.some(tool => STATUS_TRACKING_TOOLS.has(tool.definition.function.name));
}

/**
 * Execute a tool with full lifecycle management
 */
export async function executeToolWithLifecycle(
    toolCall: ToolCall,
    tool: ToolFunction,
    agent: AgentDefinition,
    signal?: AbortSignal
): Promise<string> {
    const fnId = toolCall.id || uuidv4();
    const toolName = toolCall.function.name;
    const argsString = toolCall.function.arguments || '{}';

    // Parse and prepare arguments using shared utility
    let args: any[];
    try {
        args = prepareToolArguments(argsString, tool);
    } catch (error) {
        throw new Error(`Invalid JSON in tool arguments: ${error}`);
    }

    // Register with tracker
    const runningTool = runningToolTracker.addRunningTool(fnId, toolName, agent.agent_id || 'unknown', argsString);

    // Use the signal from the tracker if not provided
    const abortSignal = signal || runningTool.abortController?.signal;

    try {
        // Inject agent specific parameters
        if (tool.injectAgentId) {
            args.unshift(agent.agent_id || 'ensemble');
        }
        if (tool.injectAbortSignal && abortSignal) {
            args.push(abortSignal);
        }

        // Execute the tool
        const result = await tool.function(...args);

        // Convert result to string intelligently
        const resultString = convertResultToString(result);

        // Mark as completed
        await runningToolTracker.completeRunningTool(fnId, resultString, agent);

        return resultString;
    } catch (error) {
        // Mark as failed - use intelligent conversion for error too
        const errorString = convertResultToString(error);
        await runningToolTracker.failRunningTool(fnId, errorString, agent);
        throw error;
    }
}

/**
 * Handle tool call with timeout and sequential execution support
 */
export async function handleToolCall(toolCall: ToolCall, tool: ToolFunction, agent: AgentDefinition): Promise<string> {
    const fnId = toolCall.id || uuidv4();
    const toolName = toolCall.function.name;

    // Create the execution function
    const executeFunction = async (): Promise<string> => {
        // Special handling for wait_for_running_tool
        if (toolName === 'wait_for_running_tool') {
            return executeToolWithLifecycle(toolCall, tool, agent);
        }

        return Promise.race([
            executeToolWithLifecycle(toolCall, tool, agent),
            new Promise<string>((_, reject) => {
                const runningTool = runningToolTracker.getRunningTool(fnId);
                if (runningTool?.abortController?.signal) {
                    runningTool.abortController.signal.addEventListener(
                        'abort',
                        () => reject(new Error('Operation was aborted')),
                        { once: true }
                    );
                }
            }),
        ]);
    };

    // Check if sequential execution is required
    const sequential = !!agent.modelSettings?.sequential_tools;

    // Determine if we should apply timeout
    const hasStatusTools = agentHasStatusTracking(agent);
    const excludedFromTimeout = EXCLUDED_FROM_TIMEOUT_FUNCTIONS.has(toolName);
    const shouldTimeout = !excludedFromTimeout && hasStatusTools && !sequential;

    // Create the execute function
    const execute = sequential ? () => runSequential(agent.agent_id || 'unknown', executeFunction) : executeFunction;

    if (!shouldTimeout) {
        return execute();
    }

    // Race against timeout
    const result = await Promise.race([
        execute().catch(error => {
            throw error;
        }),
        timeoutPromise(FUNCTION_TIMEOUT_MS),
    ]);

    if (result === 'TIMEOUT') {
        runningToolTracker.markTimedOut(fnId);
        return `Tool ${toolName} is running in the background (RunningTool: ${fnId}).`;
    }

    return result;
}

/**
 * Validate and prepare tool arguments
 */
export function prepareToolArguments(argsString: string, tool: ToolFunction): any[] {
    // Parse arguments
    let args: any;
    try {
        if (!argsString || argsString.trim() === '') {
            args = {};
        } else {
            args = JSON.parse(argsString);
        }
    } catch (error) {
        throw new Error(`Invalid JSON in tool arguments: ${error}`);
    }

    if (typeof args === 'object' && args !== null && !Array.isArray(args)) {
        // Extract parameter names from tool definition
        const paramNames = Object.keys(tool.definition.function.parameters.properties);

        // Filter out unknown parameters
        Object.keys(args).forEach(key => {
            if (!paramNames.includes(key)) {
                console.warn(`Removing unknown parameter "${key}" for tool "${tool.definition.function.name}"`);
                delete args[key];
            }
        });

        // Map to positional arguments with type coercion
        if (paramNames.length > 0) {
            return paramNames.map(param => {
                const value = args[param];
                const paramSpec = tool.definition.function.parameters.properties[param];

                // Skip empty optional parameters
                if (
                    (value === undefined || value === '') &&
                    !tool.definition.function.parameters.required?.includes(param)
                ) {
                    return undefined;
                }

                // Apply type coercion
                const [coercedValue, error] = coerceValue(value, paramSpec, param);

                if (error && tool.definition.function.parameters.required?.includes(param)) {
                    throw new Error(
                        JSON.stringify({
                            error: {
                                param,
                                expected: paramSpec.type + (paramSpec.items?.type ? `<${paramSpec.items.type}>` : ''),
                                received: String(value),
                                message: error,
                            },
                        })
                    );
                } else if (error) {
                    console.warn(`Parameter coercion warning for ${param}: ${error}`);
                }

                return coercedValue;
            });
        }

        // Fallback to values
        return Object.values(args);
    }

    // Already positional or single argument
    return [args];
}
