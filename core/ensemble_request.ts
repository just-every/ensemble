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
import { createOperationStatusEvent, streamWithAbortAndTimeout, toTerminalErrorEvent } from '../utils/failure_detection.js';
import { validateJsonResponseContent } from '../utils/json_schema.js';
import { runningToolTracker } from '../utils/running_tool_tracker.js';

const MAX_ERROR_ATTEMPTS = 5;
const DEFAULT_TERMINAL_TOOL_NAMES = new Set(['task_complete', 'task_fatal_error']);
const TOOL_FAILURE_FINALIZATION_TIMEOUT_MS = 50;

const isTerminalRoundError = (error: unknown): boolean => {
    const candidate = error as {
        recoverable?: boolean;
        code?: string;
        name?: string;
        message?: string;
    };

    if (candidate?.recoverable === false) {
        return true;
    }

    if (candidate?.code === 'ETIMEDOUT' || candidate?.code === 'ABORT_ERR') {
        return true;
    }

    if (candidate?.name === 'AbortError') {
        return true;
    }

    return false;
};

const getTerminalToolNames = (agent: AgentDefinition): Set<string> => {
    const toolNames = new Set(DEFAULT_TERMINAL_TOOL_NAMES);
    for (const name of agent.terminalToolNames ?? []) {
        if (typeof name === 'string' && name.trim().length > 0) {
            toolNames.add(name);
        }
    }
    return toolNames;
};

const hasTerminalTextContent = (content: unknown, expectsStructuredOutput: boolean): content is string => {
    if (typeof content !== 'string') {
        return false;
    }

    return expectsStructuredOutput ? content.trim().length > 0 : content.length > 0;
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
    let terminalErrorThisRound = false;
    let lastMessageContent = '';
    const expectsStructuredOutput = Boolean(agent.modelSettings?.json_schema?.schema);
    const modelHistory: string[] = [];
    let lifecycleRequestId: string | undefined;
    let lastRoundRequestId: string | undefined;
    let requestStartedStatusEmitted = false;

    await trace.emitTurnStart({
        input_messages: conversationHistory,
    });

    try {
        // Always execute at least one round to get initial response
        do {
            hasToolCalls = false;
            hasError = false;
            terminalErrorThisRound = false;
            let terminalToolSucceededThisRound = false;
            let currentRoundRequestId: string | undefined;
            const currentRoundMessages: string[] = [];
            const currentRoundErrors: string[] = [];
            let currentRoundToolCalls = 0;
            let currentRoundRequestDuration: number | undefined;
            let currentRoundDurationWithTools: number | undefined;
            let currentRoundRequestCost: number | undefined;
            let currentRoundLimitError: string | undefined;
            const deferredTerminalErrors: ProviderStreamEvent[] = [];
            const terminalToolNames = getTerminalToolNames(agent);

            const model = await getModelFromAgent(
                agent,
                'reasoning_mini',
                modelHistory // Change models if using classes
            );
            modelHistory.push(model);

            // Execute one round
            const stream = executeRound(
                model,
                agent,
                history,
                totalToolCalls,
                maxToolCalls,
                trace,
                !requestStartedStatusEmitted
            );

            // Yield all events from this round
            try {
                for await (const event of stream) {
                    let normalizedEvent = event;
                    if (normalizedEvent.type === 'error' && currentRoundToolCalls > 0) {
                        const errorEvent = normalizedEvent as any;
                        if (errorEvent.recoverable !== false) {
                            normalizedEvent = {
                                ...errorEvent,
                                recoverable: false,
                            } as ProviderStreamEvent;
                        }
                    }

                    const isDeferredTerminalError =
                        normalizedEvent.type === 'error' && (normalizedEvent as any).recoverable === false;

                    if (isDeferredTerminalError) {
                        deferredTerminalErrors.push(normalizedEvent);
                    } else {
                        yield normalizedEvent;
                    }

                    switch (normalizedEvent.type) {
                        case 'agent_start': {
                            currentRoundRequestId = normalizedEvent.request_id;
                            lastRoundRequestId = normalizedEvent.request_id;
                            lifecycleRequestId ??= normalizedEvent.request_id;
                            break;
                        }

                        case 'operation_status': {
                            const statusEvent = normalizedEvent as any;
                            if (statusEvent.operation === 'request' && statusEvent.status === 'started') {
                                requestStartedStatusEmitted = true;
                            }
                            break;
                        }

                        case 'message_complete': {
                            const messageEvent = normalizedEvent as MessageEventBase;
                            if (hasTerminalTextContent(messageEvent.content, expectsStructuredOutput)) {
                                lastMessageContent = messageEvent.content;
                                currentRoundMessages.push(messageEvent.content);
                            }
                            break;
                        }

                        case 'tool_start': {
                            const toolEvent = normalizedEvent as ToolEvent;
                            if (toolEvent.tool_call) {
                                const toolName = toolEvent.tool_call.function.name;
                                currentRoundToolCalls += 1;

                                await trace.emitToolStart(normalizedEvent.request_id, toolEvent.tool_call.id, {
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
                            const toolEvent = normalizedEvent as ToolEvent;
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
                            const agentDoneEvent = normalizedEvent as any;
                            currentRoundRequestDuration = agentDoneEvent.request_duration;
                            currentRoundDurationWithTools = agentDoneEvent.duration_with_tools;
                            currentRoundRequestCost = agentDoneEvent.request_cost;
                            break;
                        }

                        case 'error': {
                            hasError = true;
                            const errorEvent = normalizedEvent as any;
                            if (errorEvent.recoverable === false) {
                                terminalErrorThisRound = true;
                            }
                            if (errorEvent.error) {
                                currentRoundErrors.push(String(errorEvent.error));
                            }
                            break;
                        }
                    }
                }
            } catch (roundError) {
                hasError = true;
                terminalErrorThisRound = isTerminalRoundError(roundError);
                const errorMessage = roundError instanceof Error ? roundError.message : String(roundError);
                currentRoundErrors.push(errorMessage);
                const roundErrorEvent = {
                    type: 'error',
                    request_id: currentRoundRequestId,
                    error: errorMessage,
                    recoverable: !terminalErrorThisRound,
                    timestamp: new Date().toISOString(),
                } as ProviderStreamEvent;
                if (terminalErrorThisRound) {
                    deferredTerminalErrors.push(roundErrorEvent);
                } else {
                    yield roundErrorEvent;
                }
            }

            // A successful terminal tool call ends this turn immediately, but it must not
            // erase any malformed-tool or stream errors that also occurred in the round.
            if (terminalToolSucceededThisRound) {
                hasToolCalls = false;
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

            const willRetryForError = hasError && !terminalErrorThisRound && errorRounds < MAX_ERROR_ATTEMPTS;
            const willContinueForTools =
                !hasError && hasToolCalls && toolCallRounds < maxRounds && totalToolCalls < maxToolCalls;
            const willContinue = willRetryForError || willContinueForTools;

            if (hasToolCalls && !willContinueForTools) {
                if (toolCallRounds >= maxRounds) {
                    currentRoundLimitError = `Tool call rounds limit reached (${maxRounds}).`;
                } else if (totalToolCalls >= maxToolCalls) {
                    currentRoundLimitError = `Tool call limit reached (${maxToolCalls}).`;
                }
            }

            let requestStatus = 'completed';
            if (hasError) {
                requestStatus = willContinue ? 'error_retrying' : 'error';
            } else if (hasToolCalls) {
                requestStatus = willContinue ? 'waiting_for_followup_request' : 'tool_limit_reached';
            }

            const requestStatusRequestId = lifecycleRequestId ?? currentRoundRequestId;

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

            if (hasError && requestStatusRequestId) {
                yield createOperationStatusEvent({
                    operation: 'request',
                    status: willContinue ? 'retrying' : 'failed',
                    request_id: requestStatusRequestId,
                    error: currentRoundErrors.at(-1),
                    reason: requestStatus,
                    recoverable: willContinue,
                    terminal: !willContinue,
                    will_continue: willContinue,
                    attempt: errorRounds,
                    max_attempts: MAX_ERROR_ATTEMPTS,
                }) as ProviderStreamEvent;
            }

            if (!hasError && requestStatusRequestId && currentRoundLimitError) {
                yield createOperationStatusEvent({
                    operation: 'request',
                    status: 'failed',
                    request_id: requestStatusRequestId,
                    error: currentRoundLimitError,
                    reason: requestStatus,
                    recoverable: false,
                    terminal: true,
                    will_continue: false,
                }) as ProviderStreamEvent;
            }

            for (const deferredTerminalError of deferredTerminalErrors) {
                yield deferredTerminalError;
            }

            if (hasError && !willContinue) {
                turnStatus = 'error';
                turnEndReason = terminalErrorThisRound ? 'terminal_error' : 'max_error_attempts_reached';
                turnError = currentRoundErrors.at(-1);
            } else if (currentRoundLimitError) {
                turnStatus = 'error';
                turnEndReason = toolCallRounds >= maxRounds ? 'max_tool_call_rounds_reached' : 'max_tool_calls_reached';
                turnError = currentRoundLimitError;
            }
        } while (
            (hasError && !terminalErrorThisRound && errorRounds < MAX_ERROR_ATTEMPTS) ||
            (!hasError && hasToolCalls && toolCallRounds < maxRounds && totalToolCalls < maxToolCalls)
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

        // Perform verification only for otherwise successful turns.
        if (turnStatus === 'completed' && agent?.verifier && lastMessageContent) {
            const verificationResult = yield* performVerification(
                agent,
                lastMessageContent,
                await history.getMessages()
            );

            if (!verificationResult.passed) {
                turnStatus = 'error';
                turnEndReason = 'verification_failed';
                turnError = verificationResult.error;

                yield createOperationStatusEvent({
                    operation: 'request',
                    status: 'failed',
                    request_id: lifecycleRequestId ?? lastRoundRequestId,
                    error: turnError,
                    reason: 'verification_failed',
                    recoverable: false,
                    terminal: true,
                    will_continue: false,
                }) as ProviderStreamEvent;
            }
        }
    } catch (err) {
        // Use unified error handler
        const error = err as any;
        turnStatus = 'error';
        turnEndReason = 'exception';
        turnError = error.message || 'Unknown error';
        yield createOperationStatusEvent({
            operation: 'request',
            status: 'failed',
            request_id: lifecycleRequestId ?? lastRoundRequestId,
            error: turnError,
            reason: 'exception',
            recoverable: false,
            terminal: true,
            will_continue: false,
            max_attempts: MAX_ERROR_ATTEMPTS,
        }) as ProviderStreamEvent;
        yield toTerminalErrorEvent({
            error: turnError,
            code: error.code,
            details: error.details,
            recoverable: error.recoverable,
        }) as ProviderStreamEvent;
    } finally {
        if (turnStatus === 'completed') {
            yield createOperationStatusEvent({
                operation: 'request',
                status: 'completed',
                request_id: lifecycleRequestId ?? lastRoundRequestId,
                recoverable: false,
                terminal: true,
                will_continue: false,
            }) as ProviderStreamEvent;
        }

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
    trace: TraceContext,
    emitStartedStatus: boolean
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

    if (emitStartedStatus) {
        yield createOperationStatusEvent({
            operation: 'request',
            status: 'started',
            request_id: requestId,
            will_continue: true,
            terminal: false,
        }) as ProviderStreamEvent;
    }

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
    const rawStream: AsyncGenerator<ProviderStreamEvent> =
        'createResponseStreamWithRetry' in provider
            ? (provider as any).createResponseStreamWithRetry(messages, model, agent, requestId)
            : provider.createResponseStream(messages, model, agent, requestId);
    const stream = streamWithAbortAndTimeout<ProviderStreamEvent>(rawStream, {
        operationName: `Request generation for ${model}`,
        abortSignal: agent.abortSignal,
        timeoutMs: agent.modelSettings?.timeout_ms,
    });

    type TrackedToolExecution = {
        toolCall: ToolCall;
        promise: Promise<ToolCallResult>;
        settled: boolean;
        result?: ToolCallResult;
    };

    const toolExecutions: TrackedToolExecution[] = [];

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

    const structuredOutputSchema = agent.modelSettings?.json_schema?.strict === true
        ? agent.modelSettings.json_schema.schema
        : undefined;
    let sawTerminalProviderEvent = false;
    let sawTerminalProviderFailure = false;
    const finalizeToolResults = async function* (mode: 'wait_all' | 'bounded_failure') {
        if (mode === 'bounded_failure') {
            const waitForPendingExecutions = async (executions: TrackedToolExecution[]) => {
                if (executions.length === 0) {
                    return;
                }

                await Promise.race([
                    Promise.all(executions.map(execution => execution.promise.then(() => undefined))),
                    new Promise(resolve => setTimeout(resolve, TOOL_FAILURE_FINALIZATION_TIMEOUT_MS)),
                ]);
            };

            await waitForPendingExecutions(toolExecutions.filter(execution => !execution.settled));

            for (const execution of toolExecutions) {
                if (execution.settled) {
                    continue;
                }

                const runningToolId = execution.toolCall.id || execution.toolCall.call_id;
                if (runningToolId) {
                    runningToolTracker.abortRunningTool(runningToolId);
                }
            }

            await waitForPendingExecutions(toolExecutions.filter(execution => !execution.settled));

            for (const execution of toolExecutions) {
                if (execution.settled) {
                    continue;
                }

                execution.settled = true;
                execution.result = createToolFinalizationFailureResult(execution.toolCall);
            }
        }

        const toolResults: ToolCallResult[] = mode === 'wait_all'
            ? await Promise.all(toolExecutions.map(execution => execution.promise))
            : toolExecutions.flatMap(execution => (execution.settled && execution.result ? [execution.result] : []));
        const terminalToolNames = getTerminalToolNames(agent);

        for (const toolResult of toolResults) {
            const toolName = toolResult.toolCall.function.name;
            const isTerminalTool = terminalToolNames.has(toolName);

            const formattedArgs = toolCallFormattedArgs.get(toolResult.toolCall.id);
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
            await emitEvent(toolDoneEvent, agent, model);

            if (!isTerminalTool) {
                const functionOutput = convertToFunctionCallOutput(toolResult, model, 'completed');

                history.add(functionOutput);
                const functionOutputEvent: ProviderStreamEvent = {
                    type: 'response_output',
                    message: functionOutput,
                    request_id: requestId,
                };
                yield functionOutputEvent;
            }
        }

        for (const bufferedEvent of toolEventBuffer) {
            yield { ...bufferedEvent, request_id: requestId };
        }
    };

    let streamFailure: unknown;

    try {
        for await (let event of stream) {
            event = { ...event, request_id: requestId };

            if (event.type === 'message_complete' && structuredOutputSchema) {
                const messageEvent = event as MessageEventBase;
                if (hasTerminalTextContent(messageEvent.content, true)) {
                    const validationResult = validateJsonResponseContent(messageEvent.content, structuredOutputSchema);
                    if (validationResult.ok === false) {
                        event = toTerminalErrorEvent({
                            request_id: requestId,
                            error: validationResult.error,
                        }) as ProviderStreamEvent;
                    }
                }
            }

            if (event.type === 'tool_start') {
                const toolEvent = event as ToolEvent;
                if (toolEvent.tool_call) {
                    const toolCall = toolEvent.tool_call;

                    let argumentsFormatted: string | undefined;
                    try {
                        const tool = agent.tools?.find(t => t.definition.function.name === toolCall.function.name);

                        if (tool && 'definition' in tool && tool.definition.function.parameters.properties) {
                            const parsedArgs = JSON.parse(toolCall.function.arguments || '{}');
                            if (typeof parsedArgs === 'object' && parsedArgs !== null && !Array.isArray(parsedArgs)) {
                                const paramNames = Object.keys(tool.definition.function.parameters.properties);

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
                        console.debug('Failed to format tool arguments:', error);
                    }

                    if (argumentsFormatted) {
                        toolCallFormattedArgs.set(toolCall.id, argumentsFormatted);
                    }

                    event = {
                        ...event,
                        tool_call: {
                            ...toolCall,
                            function: {
                                ...toolCall.function,
                                arguments_formatted: argumentsFormatted,
                            },
                        },
                    };
                }
            }

            if (event.type === 'message_complete') {
                const messageEvent = event as MessageEventBase;
                if (hasTerminalTextContent(messageEvent.content, Boolean(structuredOutputSchema))) {
                    sawTerminalProviderEvent = true;
                }
            } else if (event.type === 'tool_start' || event.type === 'file_complete' || event.type === 'error') {
                sawTerminalProviderEvent = true;
            }

            if (
                event.type === 'error' &&
                ((event as any).recoverable === false || sawToolCallThisRound)
            ) {
                sawTerminalProviderFailure = true;
            }

            yield event;
            await emitEvent(event, agent, model);

            switch (event.type) {
                case 'cost_update': {
                    const costEvent = event as any;
                    if (costEvent.usage?.cost) {
                        totalCost += costEvent.usage.cost;
                    }
                    break;
                }

                case 'message_complete': {
                    const messageEvent = event as MessageEventBase;
                    if (sawToolCallThisRound) {
                        break;
                    }

                    if (
                        messageEvent.thinking_content ||
                        (!messageEvent.content && messageEvent.message_id)
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
                    if (hasTerminalTextContent(messageEvent.content, Boolean(structuredOutputSchema))) {
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

                    const remainingCalls = maxToolCalls - currentToolCalls;
                    if (remainingCalls <= 0) {
                        console.warn(`Tool call limit reached (${maxToolCalls}). Skipping tool calls.`);
                        break;
                    }

                    const toolCall = toolEvent.tool_call;
                    const functionCall = convertToFunctionCall(toolCall, model, 'completed');

                    const trackedExecution: TrackedToolExecution = {
                        toolCall,
                        promise: processToolCall(toolCall, agent),
                        settled: false,
                    };
                    trackedExecution.promise = trackedExecution.promise.then(
                        result => {
                    if (!trackedExecution.settled) {
                        trackedExecution.settled = true;
                        trackedExecution.result = result;
                    }
                    return trackedExecution.result ?? result;
                },
                error => {
                    const result = createToolFailureResult(toolCall, error);
                    if (!trackedExecution.settled) {
                        trackedExecution.settled = true;
                        trackedExecution.result = result;
                    }
                    return trackedExecution.result ?? result;
                }
            );
            toolExecutions.push(trackedExecution);

                    history.add(functionCall);
                    yield {
                        type: 'response_output',
                        message: functionCall,
                        request_id: requestId,
                    };
                    break;
                }

                case 'error': {
                    console.error('[executeRound] Error event:', truncateLargeValues((event as any).error));
                    break;
                }
            }
        }
    } catch (error) {
        streamFailure = error;
    }

    if (!sawTerminalProviderEvent && streamFailure === undefined) {
        const emptyResponseError = toTerminalErrorEvent({
            request_id: requestId,
            error: `Provider ${provider.provider_id} ended the stream without any terminal content, tool calls, files, or errors.`,
        }) as ProviderStreamEvent;
        yield emptyResponseError;
        await emitEvent(emptyResponseError, agent, model);
    }

    // Calculate request duration
    const request_duration = Date.now() - startTime;

    const shouldUseBoundedFailureFinalization =
        sawTerminalProviderFailure || (streamFailure !== undefined && isTerminalRoundError(streamFailure));

    yield* finalizeToolResults(shouldUseBoundedFailureFinalization ? 'bounded_failure' : 'wait_all');

    if (streamFailure !== undefined) {
        throw streamFailure;
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
}

/**
 * Perform verification with retry logic
 */
async function* performVerification(
    agent: AgentDefinition,
    output: string,
    messages: ResponseInput,
    attempt: number = 0
): AsyncGenerator<ProviderStreamEvent, { passed: boolean; error?: string }, void> {
    if (!agent.verifier) {
        return { passed: true };
    }

    const maxAttempts = agent.maxVerificationAttempts || 2;

    // Perform verification
    const verification = await verifyOutput(agent.verifier, output, messages);

    if (verification.status === 'pass') {
        // Verification passed
        yield {
            type: 'message_delta',
            content: '\n\n✓ Output verified',
        } as ProviderStreamEvent;
        return { passed: true };
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
            return yield* performVerification(agent, retryOutput, messages, attempt + 1);
        }

        return {
            passed: false,
            error: 'Verification retry did not produce a final response.',
        };
    } else {
        // Max attempts reached
        const failureMessage = `Verification failed after ${maxAttempts} attempts: ${verification.reason}`;
        yield {
            type: 'message_delta',
            content: `\n\n❌ ${failureMessage}`,
        } as ProviderStreamEvent;

        return {
            passed: false,
            error: failureMessage,
        };
    }
}

/**
 * Process tool calls with enhanced features
 */
async function processToolCall(toolCall: ToolCall, agent: AgentDefinition): Promise<ToolCallResult> {
    // Process all tool calls in parallel

    // Execute tool
    try {
        // Apply tool handler lifecycle if available
        if (agent.onToolCall) {
            await agent.onToolCall(toolCall);
        }

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
        const toolCallResult = createToolFailureResult(toolCall, error);

        if (agent.onToolError) {
            try {
                await agent.onToolError(toolCallResult);
            } catch (hookError) {
                console.error('[processToolCall] onToolError hook failed:', hookError);
            }
        }

        return toolCallResult;
    }
}

function createToolFailureResult(toolCall: ToolCall, error: unknown): ToolCallResult {
    const errorOutput =
        error instanceof Error
            ? `Tool execution failed: ${error.message}`
            : `Tool execution failed: ${String(error)}`;

    return {
        toolCall,
        id: toolCall.id,
        call_id: toolCall.call_id || toolCall.id,
        error: errorOutput,
    };
}

function createToolFinalizationFailureResult(toolCall: ToolCall): ToolCallResult {
    return createToolFailureResult(
        toolCall,
        'Tool did not finish before request finalization after a provider failure.'
    );
}

/**
 * Merge history thread back to main history
 */
export function mergeHistoryThread(mainHistory: ResponseInput, thread: ResponseInput, startIndex: number): void {
    const newMessages = thread.slice(startIndex);
    mainHistory.push(...newMessages);
}
