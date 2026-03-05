/**
 * Unified request implementation that combines standard and enhanced features
 */

import { randomUUID } from 'crypto';
import {
    ProviderStreamEvent,
    ResponseInput,
    ToolCall,
    ToolCallResult,
    AgentDefinition,
    ResponseOutputMessage,
    ResponseInputMessage,
    MessageEventBase,
    type ToolEvent,
} from '../types/types.js';
import { getModelFromAgent, getModelProvider } from '../model_providers/model_provider.js';
import { MessageHistory } from '../utils/message_history.js';
import { handleToolCall } from '../utils/tool_execution_manager.js';
import { processToolResult } from '../utils/tool_result_processor.js';
import { verifyOutput, setEnsembleRequestFunction } from '../utils/verification.js';
import { setEnsembleRequestFunction as setImageToTextFunction } from '../utils/image_to_text.js';
import { waitWhilePaused } from '../utils/pause_controller.js';
import { emitEvent } from '../utils/event_controller.js';
import { createTraceContext, TraceContext } from '../utils/trace_context.js';
import {
    convertToThinkingMessage,
    convertToOutputMessage,
    convertToFunctionCall,
    convertToFunctionCallOutput,
} from '../utils/message_converter.js';
import { truncateLargeValues } from '../utils/truncate_utils.js';

const MAX_ERROR_ATTEMPTS = 5;
const DEFAULT_TERMINAL_TOOL_NAMES = new Set(['task_complete', 'task_fatal_error']);

const getTerminalToolNames = (agent: AgentDefinition): Set<string> => {
    const toolNames = new Set(DEFAULT_TERMINAL_TOOL_NAMES);
    for (const name of agent.terminalToolNames ?? []) {
        if (typeof name === 'string' && name.trim().length > 0) {
            toolNames.add(name);
        }
    }
    return toolNames;
};

// Set the ensemble request function in verification and image-to-text modules to avoid circular dependency
setEnsembleRequestFunction(ensembleRequest);
setImageToTextFunction(ensembleRequest);

/**
 * Unified request function that handles both standard and enhanced modes
 */
export async function* ensembleRequest(
    messages: ResponseInput,
    agent: AgentDefinition = {}
): AsyncGenerator<ProviderStreamEvent> {
    // Use agent's historyThread if available, otherwise use provided messages
    const conversationHistory = agent?.historyThread || messages;

    if (agent.instructions) {
        // Check if ANY system message in the conversation history contains these exact instructions
        const alreadyHasInstructions = conversationHistory.some(msg => {
            return (
                msg.type === 'message' &&
                msg.role === 'system' &&
                'content' in msg &&
                typeof msg.content === 'string' &&
                msg.content.trim() === agent.instructions.trim()
            );
        });

        if (!alreadyHasInstructions) {
            const instructionsMessage: ResponseInputMessage = {
                type: 'message',
                role: 'system',
                content: agent.instructions,
                id: randomUUID(),
            };
            conversationHistory.unshift(instructionsMessage);
            yield {
                type: 'response_output',
                message: instructionsMessage,
                request_id: randomUUID(),
            };
            agent.instructions = undefined; // Clear instructions after adding to history
        }
    }

    // Use message history manager with automatic compaction
    const history = new MessageHistory(conversationHistory, {
        compactToolCalls: true,
        preserveSystemMessages: true,
        compactionThreshold: 0.7, // Compact when reaching 70% of context
    });

    const trace = createTraceContext(agent, 'chat');
    let totalToolCalls = 0;
    let toolCallRounds = 0;
    let errorRounds = 0;
    let turnStatus: 'completed' | 'error' = 'completed';
    let turnEndReason = 'completed';
    let turnError: string | undefined;
    const maxToolCalls = agent?.maxToolCalls ?? 200;
    const maxRounds = agent?.maxToolCallRoundsPerTurn ?? Infinity;
    let hasToolCalls = false;
    let hasError = false;
    let lastMessageContent = '';
    const modelHistory: string[] = [];

    await trace.emitTurnStart({
        input_messages: conversationHistory,
    });

    try {
        // Always execute at least one round to get initial response
        do {
            hasToolCalls = false;
            hasError = false;
            let terminalToolSucceededThisRound = false;
            let currentRoundRequestId: string | undefined;
            const currentRoundMessages: string[] = [];
            const currentRoundErrors: string[] = [];
            let currentRoundToolCalls = 0;
            let currentRoundRequestDuration: number | undefined;
            let currentRoundDurationWithTools: number | undefined;
            let currentRoundRequestCost: number | undefined;
            const terminalToolNames = getTerminalToolNames(agent);

            const model = await getModelFromAgent(
                agent,
                'reasoning_mini',
                modelHistory // Change models if using classes
            );
            modelHistory.push(model);

            // Execute one round
            const stream = executeRound(model, agent, history, totalToolCalls, maxToolCalls, trace);

            // Yield all events from this round
            try {
                for await (const event of stream) {
                    yield event;

                    switch (event.type) {
                        case 'agent_start': {
                            currentRoundRequestId = event.request_id;
                            break;
                        }

                        case 'message_complete': {
                            const messageEvent = event as MessageEventBase;
                            if (messageEvent.content) {
                                lastMessageContent = messageEvent.content;
                                currentRoundMessages.push(messageEvent.content);
                            }
                            break;
                        }

                        case 'tool_start': {
                            const toolEvent = event as ToolEvent;
                            if (toolEvent.tool_call) {
                                const toolName = toolEvent.tool_call.function.name;
                                currentRoundToolCalls += 1;

                                await trace.emitToolStart(event.request_id, toolEvent.tool_call.id, {
                                    tool_name: toolName,
                                    arguments: toolEvent.tool_call.function.arguments,
                                    arguments_formatted: toolEvent.tool_call.function.arguments_formatted,
                                });

                                // Don't count terminal tools as regular tool calls that need another round
                                if (!terminalToolNames.has(toolName)) {
                                    hasToolCalls = true;
                                }
                            }
                            ++totalToolCalls;
                            break;
                        }

                        case 'tool_done': {
                            const toolEvent = event as ToolEvent;
                            if (toolEvent.tool_call) {
                                const toolName = toolEvent.tool_call.function.name;
                                if (terminalToolNames.has(toolName) && !toolEvent.result?.error) {
                                    terminalToolSucceededThisRound = true;
                                }

                                await trace.emitToolDone(event.request_id, toolEvent.tool_call.id, {
                                    tool_name: toolName,
                                    call_id: toolEvent.result?.call_id,
                                    output: toolEvent.result?.output,
                                    error: toolEvent.result?.error,
                                });
                            }
                            break;
                        }

                        case 'agent_done': {
                            const agentDoneEvent = event as any;
                            currentRoundRequestDuration = agentDoneEvent.request_duration;
                            currentRoundDurationWithTools = agentDoneEvent.duration_with_tools;
                            currentRoundRequestCost = agentDoneEvent.request_cost;
                            break;
                        }

                        case 'error': {
                            hasError = true;
                            const errorEvent = event as any;
                            if (errorEvent.error) {
                                currentRoundErrors.push(String(errorEvent.error));
                            }
                            break;
                        }
                    }
                }
            } catch (roundError) {
                hasError = true;
                const errorMessage = roundError instanceof Error ? roundError.message : String(roundError);
                currentRoundErrors.push(errorMessage);
                yield {
                    type: 'error',
                    request_id: currentRoundRequestId,
                    error: errorMessage,
                    recoverable: true,
                    timestamp: new Date().toISOString(),
                } as ProviderStreamEvent;
            }

            // A successful terminal tool call ends this turn immediately.
            if (terminalToolSucceededThisRound) {
                hasToolCalls = false;
                hasError = false;
            }

            if (hasToolCalls) {
                ++toolCallRounds;

                if (agent.modelSettings?.tool_choice) {
                    // Ensure that we don't loop the same tool calls
                    delete agent.modelSettings.tool_choice;
                }
            }
            if (hasError) {
                ++errorRounds;
            }

            const willRetryForError = hasError && errorRounds < MAX_ERROR_ATTEMPTS;
            const willContinueForTools = hasToolCalls && toolCallRounds < maxRounds && totalToolCalls < maxToolCalls;
            const willContinue = willRetryForError || willContinueForTools;

            let requestStatus = 'completed';
            if (hasError) {
                requestStatus = willContinue ? 'error_retrying' : 'error';
            } else if (hasToolCalls) {
                requestStatus = willContinue ? 'waiting_for_followup_request' : 'tool_limit_reached';
            }

            if (currentRoundRequestId) {
                await trace.emitRequestEnd(currentRoundRequestId, {
                    status: requestStatus,
                    will_continue: willContinue,
                    tool_calls: currentRoundToolCalls,
                    final_response: currentRoundMessages.length > 0 ? currentRoundMessages.join('\n') : undefined,
                    errors: currentRoundErrors.length > 0 ? currentRoundErrors : undefined,
                    request_duration_ms: currentRoundRequestDuration,
                    duration_with_tools_ms: currentRoundDurationWithTools,
                    request_cost: currentRoundRequestCost,
                });
            }
        } while (
            (hasError && errorRounds < MAX_ERROR_ATTEMPTS) ||
            (hasToolCalls && toolCallRounds < maxRounds && totalToolCalls < maxToolCalls)
        );

        // If we hit limits, add a notification
        if (hasToolCalls && toolCallRounds >= maxRounds) {
            console.log('[ensembleRequest] Tool call rounds limit reached');
            turnEndReason = 'max_tool_call_rounds_reached';
        } else if (hasToolCalls && totalToolCalls >= maxToolCalls) {
            console.log('[ensembleRequest] Total tool calls limit reached');
            turnEndReason = 'max_tool_calls_reached';
        } else if (hasError && errorRounds >= MAX_ERROR_ATTEMPTS) {
            turnStatus = 'error';
            turnEndReason = 'max_error_attempts_reached';
        }

        // Perform verification if configured
        if (agent?.verifier && lastMessageContent) {
            const verificationResult = await performVerification(
                agent,
                lastMessageContent,
                await history.getMessages()
            );

            if (verificationResult) {
                // Yield the verification result
                for await (const event of verificationResult) {
                    yield event;
                }
            }
        }
    } catch (err) {
        // Use unified error handler
        const error = err as any;
        turnStatus = 'error';
        turnEndReason = 'exception';
        turnError = error.message || 'Unknown error';
        yield {
            type: 'error',
            error: error.message || 'Unknown error',
            code: error.code,
            details: error.details,
            recoverable: error.recoverable,
            timestamp: new Date().toISOString(),
        } as ProviderStreamEvent;
    } finally {
        await trace.emitTurnEnd(turnStatus, turnEndReason, {
            error: turnError,
            tool_call_rounds: toolCallRounds,
            total_tool_calls: totalToolCalls,
            error_rounds: errorRounds,
        });

        // Emit stream end
        yield {
            type: 'stream_end',
            timestamp: new Date().toISOString(),
        } as ProviderStreamEvent;
    }
}

/**
 * Execute one round of request/response
 */
async function* executeRound(
    model: string,
    agent: AgentDefinition,
    history: MessageHistory,
    currentToolCalls: number,
    maxToolCalls: number,
    trace: TraceContext
): AsyncGenerator<ProviderStreamEvent> {
    // Generate request ID and track timing
    const requestId = randomUUID();
    const startTime = Date.now();
    let totalCost = 0;

    // Get current messages
    let messages = await history.getMessages(model);

    // Create and yield agent_start event
    const agentStartEvent = {
        type: 'agent_start' as const,
        request_id: requestId,
        input: 'content' in messages[0] && typeof messages[0].content === 'string' ? messages[0].content : undefined,
        timestamp: new Date().toISOString(),
        agent: {
            agent_id: agent.agent_id,
            name: agent.name,
            parent_id: agent.parent_id,
            model: agent.model || model,
            modelClass: agent.modelClass,
            cwd: agent.cwd,
            modelScores: agent.modelScores,
            disabledModels: agent.disabledModels,
            tags: agent.tags,
        },
    };

    yield agentStartEvent;

    // Also emit through global event controller
    await emitEvent(agentStartEvent, agent, model);

    // Allow agent onRequest hook
    if (agent.onRequest) {
        [agent, messages] = await agent.onRequest(agent, messages);
    }

    // Wait while paused before creating the stream
    await waitWhilePaused(100, agent.abortSignal);

    // Create provider and agent with fresh settings
    const provider = getModelProvider(model);

    await trace.emitRequestStart(requestId, {
        agent_id: agent.agent_id,
        provider: provider.provider_id,
        model,
        payload: {
            messages,
            model_settings: agent.modelSettings,
            tool_names: agent.tools?.map(tool => tool.definition.function.name) || [],
        },
    });

    // Stream the response with retry support if available
    const stream =
        'createResponseStreamWithRetry' in provider
            ? (provider as any).createResponseStreamWithRetry(messages, model, agent, requestId)
            : provider.createResponseStream(messages, model, agent, requestId);

    const toolPromises: Promise<ToolCallResult>[] = [];

    // Map to store formatted arguments for each tool call
    const toolCallFormattedArgs = new Map<string, string>();

    // Buffer for events emitted during tool execution
    const toolEventBuffer: ProviderStreamEvent[] = [];
    let sawToolCallThisRound = false;

    // Add tool event buffers
    agent.onToolEvent = async (event: ProviderStreamEvent) => {
        // Buffer for the main stream
        toolEventBuffer.push(event);
    };

    for await (let event of stream) {
        // Add request_id to all events from provider
        event = { ...event, request_id: requestId };

        // Handle tool_start events specially to add formatted arguments
        if (event.type === 'tool_start') {
            const toolEvent = event as ToolEvent;
            if (toolEvent.tool_call) {
                const toolCall = toolEvent.tool_call;

                // Format arguments to match parameter order if possible
                let argumentsFormatted: string | undefined;
                try {
                    // Find the tool definition to get parameter order
                    const tool = agent.tools?.find(t => t.definition.function.name === toolCall.function.name);

                    if (tool && 'definition' in tool && tool.definition.function.parameters.properties) {
                        const parsedArgs = JSON.parse(toolCall.function.arguments || '{}');
                        if (typeof parsedArgs === 'object' && parsedArgs !== null && !Array.isArray(parsedArgs)) {
                            // Get parameter names in the correct order
                            const paramNames = Object.keys(tool.definition.function.parameters.properties);

                            // Create ordered object
                            const orderedArgs: Record<string, any> = {};
                            for (const param of paramNames) {
                                if (param in parsedArgs) {
                                    orderedArgs[param] = parsedArgs[param];
                                }
                            }

                            argumentsFormatted = JSON.stringify(orderedArgs, null, 2);
                        }
                    }
                } catch (error) {
                    // If formatting fails, we'll just use the original
                    console.debug('Failed to format tool arguments:', error);
                }

                // Store formatted arguments if we have them
                if (argumentsFormatted) {
                    toolCallFormattedArgs.set(toolCall.id, argumentsFormatted);
                }

                // Create a modified tool call with formatted arguments for the event
                const modifiedEvent = {
                    ...event,
                    tool_call: {
                        ...toolCall,
                        function: {
                            ...toolCall.function,
                            arguments_formatted: argumentsFormatted,
                        },
                    },
                };

                // Update event to the modified one for further processing
                event = modifiedEvent;
            }
        }

        yield event;

        // Emit event through global event controller
        await emitEvent(event, agent, model);

        // Handle different event types
        switch (event.type) {
            case 'cost_update': {
                // Accumulate cost from cost_update events
                const costEvent = event as any;
                if (costEvent.usage?.cost) {
                    totalCost += costEvent.usage.cost;
                }
                break;
            }

            case 'message_complete': {
                const messageEvent = event as MessageEventBase;

                // Some providers emit assistant prefill/summary text in the same turn as tool_use.
                // Persisting that assistant message after tool results can violate provider ordering
                // constraints on follow-up requests (e.g. Claude requires next request to end on user
                // tool_result after tool_use). Once a tool call has started in this round, ignore
                // subsequent assistant message_complete payloads for history construction.
                if (sawToolCallThisRound) {
                    break;
                }

                if (
                    messageEvent.thinking_content ||
                    (!messageEvent.content && messageEvent.message_id) // Note that some providers require empty thinking nodes to be included in the conversation history
                ) {
                    const thinkingMessage = convertToThinkingMessage(messageEvent, model);

                    if (agent.onThinking) {
                        await agent.onThinking(thinkingMessage);
                    }

                    history.add(thinkingMessage);
                    yield {
                        type: 'response_output',
                        message: thinkingMessage,
                        request_id: requestId,
                    };
                }
                if (messageEvent.content) {
                    const contentMessage = convertToOutputMessage(messageEvent, model, 'completed');

                    if (agent.onResponse) {
                        await agent.onResponse(contentMessage);
                    }

                    history.add(contentMessage);
                    yield {
                        type: 'response_output',
                        message: contentMessage,
                        request_id: requestId,
                    };
                }
                break;
            }

            case 'tool_start': {
                const toolEvent = event as ToolEvent;
                if (!toolEvent.tool_call) {
                    break;
                }
                sawToolCallThisRound = true;

                // Check if we'll exceed the limit
                const remainingCalls = maxToolCalls - currentToolCalls;
                if (remainingCalls <= 0) {
                    console.warn(`Tool call limit reached (${maxToolCalls}). Skipping tool calls.`);
                    // Don't count this as having tool calls if we're at the limit
                    break;
                }

                const toolCall = toolEvent.tool_call;

                // Add function call
                const functionCall = convertToFunctionCall(toolCall, model, 'completed');

                // Run tools in parallel
                toolPromises.push(processToolCall(toolCall, agent));

                history.add(functionCall);
                yield {
                    type: 'response_output',
                    message: functionCall,
                    request_id: requestId,
                };
                break;
            }

            case 'error': {
                // Log errors but don't add them to messages
                console.error('[executeRound] Error event:', truncateLargeValues((event as any).error));
                break;
            }
        }
    }

    // Calculate request duration
    const request_duration = Date.now() - startTime;

    // Complete then process any tool calls
    const toolResults: ToolCallResult[] = await Promise.all(toolPromises);
    const terminalToolNames = getTerminalToolNames(agent);

    for (const toolResult of toolResults) {
        const toolName = toolResult.toolCall.function.name;
        const isTerminalTool = terminalToolNames.has(toolName);

        // Get the formatted arguments if we stored them
        const formattedArgs = toolCallFormattedArgs.get(toolResult.toolCall.id);

        // Create tool call with formatted arguments
        const toolCallWithFormattedArgs = formattedArgs
            ? {
                  ...toolResult.toolCall,
                  function: {
                      ...toolResult.toolCall.function,
                      arguments_formatted: formattedArgs,
                  },
              }
            : toolResult.toolCall;

        const toolDoneEvent: ProviderStreamEvent = {
            type: 'tool_done',
            request_id: requestId,
            tool_call: toolCallWithFormattedArgs,
            result: {
                call_id: toolResult.call_id || toolResult.id,
                output: toolResult.output,
                error: toolResult.error,
            },
        };
        yield toolDoneEvent;
        // Emit tool done event through global event controller
        await emitEvent(toolDoneEvent, agent, model);

        // For terminal tools, don't add output to history or send it back to the model.
        if (!isTerminalTool) {
            const functionOutput = convertToFunctionCallOutput(toolResult, model, 'completed');

            history.add(functionOutput);
            yield {
                type: 'response_output',
                message: functionOutput,
                request_id: requestId,
            };
        }
    }

    // Calculate full duration
    const duration_with_tools = Date.now() - startTime;

    // Create agent_done event
    const agentDoneEvent = {
        type: 'agent_done' as const,
        request_id: requestId,
        request_cost: totalCost > 0 ? totalCost : undefined,
        request_duration,
        duration_with_tools,
        timestamp: new Date().toISOString(),
    };

    // Yield to stream
    yield agentDoneEvent;

    // Also emit through global event controller
    await emitEvent(agentDoneEvent, agent, model);

    // Yield any events that were buffered during tool execution
    for (const bufferedEvent of toolEventBuffer) {
        yield { ...bufferedEvent, request_id: requestId };
    }
}

/**
 * Perform verification with retry logic
 */
async function* performVerification(
    agent: AgentDefinition,
    output: string,
    messages: ResponseInput,
    attempt: number = 0
): AsyncGenerator<ProviderStreamEvent> {
    if (!agent.verifier) return;

    const maxAttempts = agent.maxVerificationAttempts || 2;

    // Perform verification
    const verification = await verifyOutput(agent.verifier, output, messages);

    if (verification.status === 'pass') {
        // Verification passed
        yield {
            type: 'message_delta',
            content: '\n\n✓ Output verified',
        } as ProviderStreamEvent;
        return;
    }

    // Verification failed
    if (attempt < maxAttempts - 1) {
        // Retry with feedback
        yield {
            type: 'message_delta',
            content: `\n\n⚠️ Verification failed: ${verification.reason}\n\nRetrying...`,
        } as ProviderStreamEvent;

        const retryMessages: ResponseInput = [
            ...messages,
            {
                type: 'message',
                role: 'assistant',
                content: output,
                status: 'completed',
            } as ResponseOutputMessage,
            {
                type: 'message',
                role: 'developer',
                content: `Verification failed: ${verification.reason}\n\nPlease correct your response.`,
            } as ResponseInputMessage,
        ];

        // Create a new agent for retry without verifier to avoid infinite recursion
        const retryAgent: AgentDefinition = {
            ...agent,
            verifier: undefined,
            historyThread: retryMessages,
        };

        const retryStream = ensembleRequest(retryMessages, retryAgent);
        let retryOutput = '';

        for await (const event of retryStream) {
            yield event;

            if (event.type === 'message_complete' && 'content' in event) {
                retryOutput = event.content;
            }
        }

        // Verify the retry
        if (retryOutput) {
            yield* performVerification(agent, retryOutput, messages, attempt + 1);
        }
    } else {
        // Max attempts reached
        yield {
            type: 'message_delta',
            content: `\n\n❌ Verification failed after ${maxAttempts} attempts: ${verification.reason}`,
        } as ProviderStreamEvent;
    }
}

/**
 * Process tool calls with enhanced features
 */
async function processToolCall(toolCall: ToolCall, agent: AgentDefinition): Promise<ToolCallResult> {
    // Process all tool calls in parallel

    // Apply tool handler lifecycle if available
    if (agent.onToolCall) {
        await agent.onToolCall(toolCall);
    }

    // Execute tool
    try {
        if (!agent.tools) {
            throw new Error('No tools available for agent');
        }

        // Find the tool
        const tool = agent.tools.find(t => t.definition.function.name === toolCall.function.name);

        if (!tool || !('function' in tool)) {
            throw new Error(`Tool ${toolCall.function.name} not found`);
        }

        // Execute with enhanced lifecycle management
        const rawResult = await handleToolCall(toolCall, tool, agent);

        // Process the result (summarization, truncation, etc.)
        const processedResult = await processToolResult(toolCall, rawResult, agent, tool.allowSummary);

        const toolCallResult: ToolCallResult = {
            toolCall,
            id: toolCall.id,
            call_id: toolCall.call_id || toolCall.id,
            output: processedResult,
        };

        // Call onToolResult callback
        if (agent.onToolResult) {
            await agent.onToolResult(toolCallResult);
        }

        return toolCallResult;
    } catch (error) {
        // Handle tool error
        const errorOutput =
            error instanceof Error
                ? `Tool execution failed: ${error.message}`
                : `Tool execution failed: ${String(error)}`;

        const toolCallResult: ToolCallResult = {
            toolCall,
            id: toolCall.id,
            call_id: toolCall.call_id || toolCall.id,
            error: errorOutput,
        };

        if (agent.onToolError) {
            await agent.onToolError(toolCallResult);
        }

        return toolCallResult;
    }
}

/**
 * Merge history thread back to main history
 */
export function mergeHistoryThread(mainHistory: ResponseInput, thread: ResponseInput, startIndex: number): void {
    const newMessages = thread.slice(startIndex);
    mainHistory.push(...newMessages);
}
