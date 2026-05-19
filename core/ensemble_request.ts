/**
 * Unified request implementation that combines standard and enhanced features.
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
import {
    createOperationGuard,
    FailureClassification,
    normalizeFailure,
    RequestLifecycleController,
    selectMoreSevereFailure,
    streamWithAbortAndTimeout,
    toErrorEvent,
} from '../utils/failure_detection.js';
import { validateJsonResponseContent } from '../utils/json_schema.js';
import { runningToolTracker } from '../utils/running_tool_tracker.js';
import { calculateDelay } from '../utils/retry_handler.js';

const DEFAULT_MAX_ERROR_RETRIES = 4;
const DEFAULT_TERMINAL_TOOL_NAMES = new Set(['task_complete', 'task_fatal_error']);
const TOOL_FAILURE_FINALIZATION_TIMEOUT_MS = 50;

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

const getMaxErrorRetries = (agent: AgentDefinition): number => {
    const configuredMaxRetries = agent.retryOptions?.maxRetries;
    if (typeof configuredMaxRetries !== 'number' || Number.isNaN(configuredMaxRetries)) {
        return DEFAULT_MAX_ERROR_RETRIES;
    }

    return Math.max(0, Math.floor(configuredMaxRetries));
};

const waitForRetryDelay = async (delayMs: number, abortSignal?: AbortSignal): Promise<void> => {
    if (delayMs <= 0) {
        return;
    }

    await new Promise<void>((resolve, reject) => {
        if (abortSignal?.aborted) {
            reject(abortSignal.reason ?? new Error('Retry wait aborted'));
            return;
        }

        const timeoutId = setTimeout(() => {
            if (abortSignal && abortListener) {
                abortSignal.removeEventListener('abort', abortListener);
            }
            resolve();
        }, delayMs);

        const abortListener = abortSignal
            ? () => {
                  clearTimeout(timeoutId);
                  abortSignal.removeEventListener('abort', abortListener);
                  reject(abortSignal.reason ?? new Error('Retry wait aborted'));
              }
            : undefined;

        if (abortSignal && abortListener) {
            abortSignal.addEventListener('abort', abortListener, { once: true });
        }
    });
};

const getOuterRequestTimeoutMs = (agent: AgentDefinition): number | undefined => {
    const timeoutMs = agent.modelSettings?.timeout_ms;
    if (typeof timeoutMs !== 'number' || Number.isNaN(timeoutMs) || timeoutMs <= 0) {
        return undefined;
    }

    return Math.floor(timeoutMs);
};

const getRemainingRequestTimeoutMs = (requestTimeoutMs?: number, requestStartedAt?: number): number | undefined => {
    if (requestTimeoutMs === undefined || requestStartedAt === undefined) {
        return undefined;
    }

    return Math.max(0, requestTimeoutMs - (Date.now() - requestStartedAt));
};

const createRequestTimeoutError = (model: string, timeoutMs: number) => {
    const error = new Error(`Request generation for ${model} timed out after ${timeoutMs}ms`) as Error & {
        code?: string;
        recoverable?: boolean;
    };
    error.code = 'ETIMEDOUT';
    error.recoverable = false;
    return error;
};

interface TrackedToolExecution {
    toolCall: ToolCall;
    promise: Promise<ToolCallResult>;
    settled: boolean;
    result?: ToolCallResult;
}

interface RoundExecutionResult {
    requestId: string;
    messages: string[];
    errors: string[];
    toolCallsStarted: number;
    hasFollowupToolCalls: boolean;
    emittedTerminalOutput: boolean;
    terminalToolSucceeded: boolean;
    failure?: FailureClassification;
    requestDuration?: number;
    durationWithTools?: number;
    requestCost?: number;
    agentDoneEvent?: ProviderStreamEvent;
    agentDoneAgent?: AgentDefinition;
}

const getFailureRetryOverrides = (agent: AgentDefinition) => ({
    retryableErrors: agent.retryOptions?.additionalRetryableErrors,
    retryableStatusCodes: agent.retryOptions?.additionalRetryableStatusCodes,
});

// Set the ensemble request function in verification and image-to-text modules to avoid circular dependency
setEnsembleRequestFunction(ensembleRequest);
setImageToTextFunction(ensembleRequest);

export async function* ensembleRequest(
    messages: ResponseInput,
    agent: AgentDefinition = {}
): AsyncGenerator<ProviderStreamEvent> {
    if (agent.jsonSchema && !agent.modelSettings?.json_schema) {
        agent = {
            ...agent,
            modelSettings: {
                ...agent.modelSettings,
                json_schema: agent.jsonSchema,
            },
        };
    }

    const conversationHistory = agent?.historyThread || messages;

    if (agent.instructions) {
        const alreadyHasInstructions = conversationHistory.some(msg => {
            return (
                msg.type === 'message' &&
                msg.role === 'system' &&
                'content' in msg &&
                typeof msg.content === 'string' &&
                msg.content.trim() === agent.instructions!.trim()
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
            agent.instructions = undefined;
        }
    }

    const history = new MessageHistory(conversationHistory, {
        compactToolCalls: true,
        preserveSystemMessages: true,
        compactionThreshold: 0.7,
    });

    const trace = createTraceContext(agent, 'chat');
    const lifecycle = new RequestLifecycleController();
    const maxToolCalls = agent?.maxToolCalls ?? 200;
    const maxRounds = agent?.maxToolCallRoundsPerTurn ?? Infinity;
    const maxErrorRetries = getMaxErrorRetries(agent);
    const maxErrorAttempts = maxErrorRetries + 1;
    const outerRequestTimeoutMs = getOuterRequestTimeoutMs(agent);
    const outerRequestStartedAt = outerRequestTimeoutMs !== undefined ? Date.now() : undefined;
    const modelHistory: string[] = [];
    let lastModelUsed: string | undefined;
    let totalToolCalls = 0;
    let toolCallRounds = 0;
    let errorRounds = 0;
    let lastMessageContent = '';
    let turnStatus: 'completed' | 'error' = 'completed';
    let turnEndReason = 'completed';
    let turnError: string | undefined;
    let terminalFailure: FailureClassification | undefined;
    let terminalFailureEventEmitted = false;
    let finalRound: { round: RoundExecutionResult; model: string } | undefined;

    await trace.emitTurnStart({
        input_messages: conversationHistory,
    });

    try {
        const emitRoundAgentDone = async function* (
            round: RoundExecutionResult,
            model: string
        ): AsyncGenerator<ProviderStreamEvent> {
            if (!round.agentDoneEvent) {
                return;
            }

            yield round.agentDoneEvent;
            await emitEvent(round.agentDoneEvent, round.agentDoneAgent ?? agent, model);
        };

        while (!terminalFailure) {
            const model = await getModelFromAgent(agent, 'reasoning_mini', modelHistory);
            const roundRequestId = randomUUID();
            const startedStatusEvent = lifecycle.begin(roundRequestId);

            modelHistory.push(model);
            lastModelUsed = model;

            const round = yield* executeRound({
                roundRequestId,
                model,
                agent,
                history,
                currentToolCalls: totalToolCalls,
                maxToolCalls,
                trace,
                startedStatusEvent,
                requestTimeoutMs: outerRequestTimeoutMs,
                requestStartedAt: outerRequestStartedAt,
            });

            totalToolCalls += round.toolCallsStarted;

            if (round.messages.length > 0) {
                lastMessageContent = round.messages.at(-1) || lastMessageContent;
            }

            if (round.hasFollowupToolCalls) {
                ++toolCallRounds;
            }

            const willRetryForError = (() => {
                if (!round.failure) {
                    return false;
                }
                ++errorRounds;
                return !round.emittedTerminalOutput && round.failure.recoverable && errorRounds <= maxErrorRetries;
            })();

            const willContinueForTools =
                !round.failure &&
                !round.terminalToolSucceeded &&
                round.hasFollowupToolCalls &&
                toolCallRounds < maxRounds &&
                totalToolCalls < maxToolCalls;

            let requestStatus = 'completed';
            if (round.failure) {
                requestStatus = willRetryForError ? 'error_retrying' : 'error';
            } else if (round.hasFollowupToolCalls && !round.terminalToolSucceeded) {
                requestStatus = willContinueForTools ? 'waiting_for_followup_request' : 'tool_limit_reached';
            }

            await trace.emitRequestEnd(round.requestId, {
                status: requestStatus,
                will_continue: willRetryForError || willContinueForTools,
                tool_calls: round.toolCallsStarted,
                final_response: round.messages.length > 0 ? round.messages.join('\n') : undefined,
                errors: round.errors.length > 0 ? round.errors : undefined,
                request_duration_ms: round.requestDuration,
                duration_with_tools_ms: round.durationWithTools,
                request_cost: round.requestCost,
            });

            if (round.failure) {
                const terminalRoundFailure = willRetryForError
                    ? round.failure
                    : {
                          ...round.failure,
                          recoverable: false,
                          terminal: true,
                      };
                const errorEvent = toErrorEvent(terminalRoundFailure, {
                    request_id: round.requestId,
                });
                yield errorEvent;
                await emitEvent(errorEvent, agent, model);

                if (willRetryForError) {
                    agent.retryOptions?.onRetry?.(
                        {
                            message: round.failure.error,
                            code: round.failure.code,
                            details: round.failure.details,
                            recoverable: round.failure.recoverable,
                        },
                        errorRounds
                    );

                    const retryingEvent = lifecycle.retrying(round.failure, errorRounds, maxErrorAttempts);
                    if (retryingEvent) {
                        yield retryingEvent;
                        await emitEvent(retryingEvent, agent, model);
                    }

                    const retryDelayMs = calculateDelay(errorRounds, agent.retryOptions);
                    const remainingTimeoutMs = getRemainingRequestTimeoutMs(
                        outerRequestTimeoutMs,
                        outerRequestStartedAt
                    );
                    const boundedRetryDelayMs =
                        remainingTimeoutMs === undefined
                            ? retryDelayMs
                            : remainingTimeoutMs < retryDelayMs
                              ? 0
                              : retryDelayMs;
                    yield* emitRoundAgentDone(round, model);
                    await waitForRetryDelay(boundedRetryDelayMs, agent.abortSignal);
                    continue;
                }

                terminalFailure = terminalRoundFailure;
                terminalFailureEventEmitted = true;
                finalRound = { round, model };
                break;
            }

            if (round.terminalToolSucceeded) {
                finalRound = { round, model };
                break;
            }

            if (willContinueForTools) {
                if (agent.modelSettings?.tool_choice) {
                    agent = {
                        ...agent,
                        modelSettings: {
                            ...agent.modelSettings,
                        },
                    };
                    delete agent.modelSettings.tool_choice;
                }
                yield* emitRoundAgentDone(round, model);
                continue;
            }

            if (round.hasFollowupToolCalls && !round.terminalToolSucceeded) {
                terminalFailure = normalizeFailure(
                    new Error(
                        toolCallRounds >= maxRounds
                            ? `Tool call rounds limit reached (${maxRounds}).`
                            : `Tool call limit reached (${maxToolCalls}).`
                    ),
                    {
                        recoverable: false,
                        reason: toolCallRounds >= maxRounds ? 'max_tool_call_rounds_reached' : 'max_tool_calls_reached',
                        ...getFailureRetryOverrides(agent),
                    }
                );
                finalRound = { round, model };
                break;
            }

            finalRound = { round, model };
            break;
        }

        if (!terminalFailure && agent.verifier && lastMessageContent) {
            const verification = yield* performVerification(agent, lastMessageContent, await history.getMessages());
            if (!verification.passed) {
                terminalFailure = normalizeFailure(new Error(verification.error || 'Verification failed'), {
                    recoverable: false,
                    reason: 'verification_failed',
                    ...getFailureRetryOverrides(agent),
                });
            }
        }

        if (terminalFailure) {
            turnStatus = 'error';
            turnEndReason = terminalFailure.reason || 'terminal_failure';
            turnError = terminalFailure.error;

            if (!terminalFailureEventEmitted) {
                const errorEvent = toErrorEvent(terminalFailure, {
                    request_id: lifecycle.getRequestId(),
                });
                yield errorEvent;
                await emitEvent(errorEvent, agent, lastModelUsed);
            }

            const failedEvent = lifecycle.fail(terminalFailure, errorRounds || 1, maxErrorAttempts);
            if (failedEvent) {
                yield failedEvent;
                await emitEvent(failedEvent, agent, lastModelUsed);
            }
        } else {
            const completedEvent = lifecycle.complete();
            if (completedEvent) {
                yield completedEvent;
                await emitEvent(completedEvent, agent, lastModelUsed);
            }
        }

        if (finalRound) {
            yield* emitRoundAgentDone(finalRound.round, finalRound.model);
        }
    } catch (err) {
        if (!lifecycle.getRequestId()) {
            const startedEvent = lifecycle.begin(randomUUID());
            if (startedEvent) {
                yield startedEvent;
                await emitEvent(startedEvent, agent, lastModelUsed);
            }
        }

        const failure = normalizeFailure(err, {
            recoverable: false,
            reason: 'exception',
            ...getFailureRetryOverrides(agent),
        });

        turnStatus = 'error';
        turnEndReason = 'exception';
        turnError = failure.error;

        const errorEvent = toErrorEvent(failure, {
            request_id: lifecycle.getRequestId(),
        });
        yield errorEvent;
        await emitEvent(errorEvent, agent, lastModelUsed);

        const failedEvent = lifecycle.fail(failure, errorRounds || 1, maxErrorAttempts);
        if (failedEvent) {
            yield failedEvent;
            await emitEvent(failedEvent, agent, lastModelUsed);
        }
    } finally {
        await trace.emitTurnEnd(turnStatus, turnEndReason, {
            error: turnError,
            tool_call_rounds: toolCallRounds,
            total_tool_calls: totalToolCalls,
            error_rounds: errorRounds,
        });

        yield {
            type: 'stream_end',
            timestamp: new Date().toISOString(),
        } as ProviderStreamEvent;
    }
}

async function* executeRound(options: {
    roundRequestId: string;
    model: string;
    agent: AgentDefinition;
    history: MessageHistory;
    currentToolCalls: number;
    maxToolCalls: number;
    trace: TraceContext;
    startedStatusEvent: ProviderStreamEvent | null;
    requestTimeoutMs?: number;
    requestStartedAt?: number;
}): AsyncGenerator<ProviderStreamEvent, RoundExecutionResult, void> {
    const { roundRequestId, model, agent, history, currentToolCalls, maxToolCalls, trace, startedStatusEvent } =
        options;
    const startTime = Date.now();
    let totalCost = 0;
    let messages = await history.getMessages(model);
    let roundAgentDefinition = agent;
    let requestGuard: ReturnType<typeof createOperationGuard> | undefined;
    let toolExecutionGuard: ReturnType<typeof createOperationGuard> | undefined;
    let roundAgent: AgentDefinition = agent;
    let provider!: ReturnType<typeof getModelProvider>;
    let stream!: AsyncGenerator<ProviderStreamEvent>;

    const roundSummary: RoundExecutionResult = {
        requestId: roundRequestId,
        messages: [],
        errors: [],
        toolCallsStarted: 0,
        hasFollowupToolCalls: false,
        emittedTerminalOutput: false,
        terminalToolSucceeded: false,
    };

    const agentStartEvent = {
        type: 'agent_start' as const,
        request_id: roundRequestId,
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
    await emitEvent(agentStartEvent, agent, model);

    try {
        if (roundAgentDefinition.onRequest) {
            const [nextAgent, nextMessages] = await roundAgentDefinition.onRequest(roundAgentDefinition, messages);
            roundAgentDefinition = nextAgent;
            messages = nextMessages;
        }

        const remainingTimeoutMs = getRemainingRequestTimeoutMs(options.requestTimeoutMs, options.requestStartedAt);
        const needsRequestGuard = Boolean(roundAgentDefinition.abortSignal || remainingTimeoutMs !== undefined);
        if (needsRequestGuard) {
            if (options.requestTimeoutMs !== undefined && remainingTimeoutMs !== undefined && remainingTimeoutMs <= 0) {
                throw createRequestTimeoutError(model, options.requestTimeoutMs);
            }

            requestGuard = createOperationGuard({
                operationName: `Request generation for ${model}`,
                abortSignal: roundAgentDefinition.abortSignal,
                timeoutMs: remainingTimeoutMs,
            });
            roundAgent = {
                ...roundAgentDefinition,
                abortSignal: requestGuard.signal,
            };
        } else {
            roundAgent = roundAgentDefinition;
        }

        await waitWhilePaused(100, roundAgent.abortSignal);
        toolExecutionGuard = createOperationGuard({
            operationName: `Tool execution for ${model}`,
            abortSignal: roundAgent.abortSignal,
        });

        if (startedStatusEvent) {
            yield startedStatusEvent;
            await emitEvent(startedStatusEvent, roundAgent, model);
        }

        provider = getModelProvider(model);
        await trace.emitRequestStart(roundRequestId, {
            agent_id: roundAgent.agent_id,
            provider: provider.provider_id,
            model,
            payload: {
                messages,
                model_settings: roundAgent.modelSettings,
                tool_names: roundAgent.tools?.map(tool => tool.definition.function.name) || [],
            },
        });

        const rawStream = provider.createResponseStream(messages, model, roundAgent, roundRequestId);

        stream = streamWithAbortAndTimeout(rawStream, {
            abortSignal: requestGuard?.signal,
        });
    } catch (error) {
        requestGuard?.cleanup();
        toolExecutionGuard?.cleanup();

        const failure = normalizeFailure(error, {
            reason: 'request_setup_failed',
            ...getFailureRetryOverrides(agent),
        });
        roundSummary.failure = failure;
        roundSummary.errors.push(failure.error);
        roundSummary.requestDuration = Date.now() - startTime;
        roundSummary.durationWithTools = roundSummary.requestDuration;

        roundSummary.agentDoneEvent = {
            type: 'agent_done' as const,
            request_id: roundRequestId,
            request_duration: roundSummary.requestDuration,
            duration_with_tools: roundSummary.durationWithTools,
            timestamp: new Date().toISOString(),
        };
        roundSummary.agentDoneAgent = roundAgentDefinition;
        return roundSummary;
    }

    const terminalToolNames = getTerminalToolNames(roundAgent);
    const expectsStructuredOutput = Boolean(roundAgent.modelSettings?.json_schema?.schema);
    const structuredOutputSchema =
        roundAgent.modelSettings?.json_schema?.strict === true
            ? roundAgent.modelSettings.json_schema.schema
            : undefined;

    const toolExecutions: TrackedToolExecution[] = [];
    const toolCallFormattedArgs = new Map<string, string>();
    const toolEventBuffer: ProviderStreamEvent[] = [];
    let sawToolCallThisRound = false;
    let sawTerminalProviderOutcome = false;
    roundAgent.onToolEvent = async event => {
        toolEventBuffer.push(event);
    };

    const finalizeToolResults = async function* (mode: 'wait_all' | 'bounded_failure') {
        const waitForPendingExecutions = async (executions: TrackedToolExecution[], timeoutMs?: number) => {
            if (executions.length === 0) {
                return;
            }

            const completionPromise = Promise.all(executions.map(execution => execution.promise.then(() => undefined)));
            if (timeoutMs === undefined) {
                await completionPromise;
                return;
            }

            await Promise.race([completionPromise, new Promise(resolve => setTimeout(resolve, timeoutMs))]);
        };

        const waitForAllExecutions = async (
            executions: TrackedToolExecution[],
            abortSignal?: AbortSignal
        ): Promise<boolean> => {
            if (executions.length === 0) {
                return true;
            }

            const completionPromise = Promise.all(
                executions.map(execution => execution.promise.then(() => undefined))
            ).then(() => true);

            if (!abortSignal) {
                return completionPromise;
            }

            if (abortSignal.aborted) {
                return false;
            }

            return new Promise<boolean>(resolve => {
                const abortListener = () => {
                    abortSignal.removeEventListener('abort', abortListener);
                    resolve(false);
                };

                completionPromise.then(completed => {
                    abortSignal.removeEventListener('abort', abortListener);
                    resolve(completed);
                });

                abortSignal.addEventListener('abort', abortListener, { once: true });
            });
        };

        let finalizationMode = mode;
        if (finalizationMode === 'wait_all') {
            const completedAllExecutions = await waitForAllExecutions(
                toolExecutions.filter(execution => !execution.settled),
                requestGuard?.signal
            );

            if (!completedAllExecutions) {
                finalizationMode = 'bounded_failure';
            }
        }

        if (finalizationMode === 'bounded_failure') {
            toolExecutionGuard?.abort(
                roundSummary.failure?.error
                    ? new Error(roundSummary.failure.error)
                    : new Error('Request finalized after terminal provider failure.')
            );

            await waitForPendingExecutions(
                toolExecutions.filter(execution => !execution.settled),
                TOOL_FAILURE_FINALIZATION_TIMEOUT_MS
            );

            for (const execution of toolExecutions) {
                if (!execution.settled) {
                    runningToolTracker.abortRunningTool(execution.toolCall.id || execution.toolCall.call_id || '');
                }
            }

            await waitForPendingExecutions(
                toolExecutions.filter(execution => !execution.settled),
                TOOL_FAILURE_FINALIZATION_TIMEOUT_MS
            );

            for (const execution of toolExecutions) {
                const runningToolId = execution.toolCall.id || execution.toolCall.call_id || '';
                if (execution.settled) {
                    const leakedRunningTool = runningToolId
                        ? runningToolTracker.getRunningTool(runningToolId)
                        : undefined;

                    if (leakedRunningTool) {
                        const failureResult =
                            execution.result ?? createToolFinalizationFailureResult(execution.toolCall);
                        await runningToolTracker.failRunningTool(
                            runningToolId,
                            failureResult.error || 'Tool execution failed during bounded finalization.'
                        );
                    }
                }
            }
        }

        const toolResults =
            finalizationMode === 'wait_all'
                ? await Promise.all(toolExecutions.map(execution => execution.promise))
                : toolExecutions.flatMap(execution =>
                      execution.settled && execution.result ? [execution.result] : []
                  );

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
                request_id: roundRequestId,
                tool_call: toolCallWithFormattedArgs,
                result: {
                    call_id: toolResult.call_id || toolResult.id,
                    output: toolResult.output,
                    error: toolResult.error,
                },
            };

            if (isTerminalTool && !toolResult.error) {
                roundSummary.terminalToolSucceeded = true;
            }

            yield toolDoneEvent;
            await emitEvent(toolDoneEvent, roundAgent, model);
            await trace.emitToolDone(roundRequestId, toolResult.toolCall.id, {
                tool_name: toolName,
                call_id: toolResult.call_id,
                output: toolResult.output,
                error: toolResult.error,
            });

            if (!isTerminalTool) {
                const functionOutput = convertToFunctionCallOutput(toolResult, model, 'completed');
                history.add(functionOutput);
                yield {
                    type: 'response_output' as const,
                    message: functionOutput,
                    request_id: roundRequestId,
                };
            }
        }

        for (const bufferedEvent of toolEventBuffer) {
            yield { ...bufferedEvent, request_id: roundRequestId };
        }
    };

    try {
        for await (let event of stream) {
            event = { ...event, request_id: roundRequestId };

            if (event.type === 'error') {
                const failure = normalizeFailure(event, {
                    error: (event as any).error,
                    recoverable: (event as any).recoverable,
                    code: (event as any).code,
                    details: (event as any).details,
                    ...getFailureRetryOverrides(agent),
                });
                roundSummary.failure = selectMoreSevereFailure(roundSummary.failure, failure);
                roundSummary.errors.push(failure.error);
                continue;
            }

            if (event.type === 'message_complete' && structuredOutputSchema) {
                const messageEvent = event as MessageEventBase;
                if (hasTerminalTextContent(messageEvent.content, true)) {
                    const validationResult = validateJsonResponseContent(messageEvent.content, structuredOutputSchema);
                    if (!validationResult.ok && 'error' in validationResult) {
                        const failure = normalizeFailure(new Error(validationResult.error), {
                            recoverable: false,
                            reason: 'structured_output_validation_failed',
                        });
                        roundSummary.failure = selectMoreSevereFailure(roundSummary.failure, failure);
                        roundSummary.errors.push(failure.error);
                        continue;
                    }
                }
            }

            if (event.type === 'tool_start') {
                const toolEvent = event as ToolEvent;
                if (toolEvent.tool_call) {
                    const toolCall = toolEvent.tool_call;

                    let argumentsFormatted: string | undefined;
                    try {
                        const tool = roundAgent.tools?.find(t => t.definition.function.name === toolCall.function.name);
                        if (tool?.definition.function.parameters.properties) {
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
                if (hasTerminalTextContent(messageEvent.content, expectsStructuredOutput)) {
                    sawTerminalProviderOutcome = true;
                }
            } else if (event.type === 'tool_start' || event.type === 'file_complete') {
                sawTerminalProviderOutcome = true;
            }

            yield event;
            await emitEvent(event, roundAgent, model);

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

                    if (messageEvent.thinking_content || (!messageEvent.content && messageEvent.message_id)) {
                        const thinkingMessage = convertToThinkingMessage(messageEvent, model);
                        if (roundAgent.onThinking) {
                            await roundAgent.onThinking(thinkingMessage);
                        }
                        history.add(thinkingMessage);
                        yield {
                            type: 'response_output',
                            message: thinkingMessage,
                            request_id: roundRequestId,
                        };
                    }

                    if (hasTerminalTextContent(messageEvent.content, expectsStructuredOutput)) {
                        roundSummary.emittedTerminalOutput = true;
                        roundSummary.messages.push(messageEvent.content);
                        const contentMessage = convertToOutputMessage(messageEvent, model, 'completed');
                        if (roundAgent.onResponse) {
                            await roundAgent.onResponse(contentMessage);
                        }
                        history.add(contentMessage);
                        yield {
                            type: 'response_output',
                            message: contentMessage,
                            request_id: roundRequestId,
                        };
                    }
                    break;
                }

                case 'file_complete': {
                    roundSummary.emittedTerminalOutput = true;
                    break;
                }

                case 'tool_start': {
                    const toolEvent = event as ToolEvent;
                    if (!toolEvent.tool_call) {
                        break;
                    }

                    if (!sawToolCallThisRound) {
                        roundSummary.emittedTerminalOutput = false;
                        roundSummary.messages = [];
                    }
                    sawToolCallThisRound = true;

                    const remainingCalls = maxToolCalls - currentToolCalls - roundSummary.toolCallsStarted;
                    if (remainingCalls <= 0) {
                        console.warn(`Tool call limit reached (${maxToolCalls}). Skipping tool calls.`);
                        const failure = normalizeFailure(
                            new Error(
                                `Tool call limit reached (${maxToolCalls}). Cannot execute tool ${toolEvent.tool_call.function.name}.`
                            ),
                            {
                                recoverable: false,
                                reason: 'max_tool_calls_reached',
                                ...getFailureRetryOverrides(agent),
                            }
                        );
                        roundSummary.failure = selectMoreSevereFailure(roundSummary.failure, failure);
                        if (!roundSummary.errors.includes(failure.error)) {
                            roundSummary.errors.push(failure.error);
                        }
                        break;
                    }

                    const toolCall = toolEvent.tool_call;
                    const functionCall = convertToFunctionCall(toolCall, model, 'completed');
                    history.add(functionCall);
                    yield {
                        type: 'response_output',
                        message: functionCall,
                        request_id: roundRequestId,
                    };

                    ++roundSummary.toolCallsStarted;
                    if (!terminalToolNames.has(toolCall.function.name)) {
                        roundSummary.hasFollowupToolCalls = true;
                    }

                    await trace.emitToolStart(roundRequestId, toolCall.id, {
                        tool_name: toolCall.function.name,
                        arguments: toolCall.function.arguments,
                        arguments_formatted: toolCall.function.arguments_formatted,
                    });

                    const trackedExecution: TrackedToolExecution = {
                        toolCall,
                        promise: processToolCall(toolCall, {
                            ...roundAgent,
                            abortSignal: toolExecutionGuard?.signal ?? roundAgent.abortSignal,
                        }),
                        settled: false,
                    };
                    trackedExecution.promise = trackedExecution.promise.then(result => {
                        if (!trackedExecution.settled) {
                            trackedExecution.settled = true;
                            trackedExecution.result = result;
                        }
                        return trackedExecution.result ?? result;
                    });
                    toolExecutions.push(trackedExecution);
                    break;
                }
            }
        }
    } catch (error) {
        const streamFailure = normalizeFailure(error, {
            reason: 'request_stream_failed',
            ...getFailureRetryOverrides(agent),
        });
        roundSummary.failure = selectMoreSevereFailure(roundSummary.failure, streamFailure);
        roundSummary.errors.push(streamFailure.error);
    }

    if (!sawTerminalProviderOutcome && !roundSummary.failure) {
        const emptyResponseFailure = normalizeFailure(
            new Error(
                `Provider ${provider.provider_id} ended the stream without any terminal content, tool calls, files, or errors.`
            ),
            {
                recoverable: false,
                reason: 'empty_provider_response',
                ...getFailureRetryOverrides(agent),
            }
        );
        roundSummary.failure = emptyResponseFailure;
        roundSummary.errors.push(emptyResponseFailure.error);
    }

    roundSummary.requestDuration = Date.now() - startTime;

    const shouldUseBoundedFailureFinalization = Boolean(roundSummary.failure?.terminal);
    yield* finalizeToolResults(shouldUseBoundedFailureFinalization ? 'bounded_failure' : 'wait_all');

    if (requestGuard?.signal.aborted) {
        const abortFailure = normalizeFailure(requestGuard.signal.reason, {
            reason: 'request_stream_failed',
            ...getFailureRetryOverrides(agent),
        });
        roundSummary.failure = selectMoreSevereFailure(roundSummary.failure, abortFailure);
        if (!roundSummary.errors.includes(abortFailure.error)) {
            roundSummary.errors.push(abortFailure.error);
        }
    }

    roundSummary.durationWithTools = Date.now() - startTime;
    roundSummary.requestCost = totalCost > 0 ? totalCost : undefined;

    roundSummary.agentDoneEvent = {
        type: 'agent_done' as const,
        request_id: roundRequestId,
        request_cost: roundSummary.requestCost,
        request_duration: roundSummary.requestDuration,
        duration_with_tools: roundSummary.durationWithTools,
        timestamp: new Date().toISOString(),
    };
    roundSummary.agentDoneAgent = roundAgent;
    requestGuard?.cleanup();
    toolExecutionGuard?.cleanup();

    return roundSummary;
}

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
    const verification = await verifyOutput(agent.verifier, output, messages);

    if (verification.status === 'pass') {
        yield {
            type: 'message_delta',
            content: '\n\n✓ Output verified',
        } as ProviderStreamEvent;
        return { passed: true };
    }

    if (attempt < maxAttempts - 1) {
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

        const retryAgent: AgentDefinition = {
            ...agent,
            verifier: undefined,
            historyThread: retryMessages,
        };

        const retryStream = ensembleRequest(retryMessages, retryAgent);
        let retryOutput = '';

        for await (const event of retryStream) {
            if (event.type === 'operation_status' || event.type === 'error') {
                continue;
            }

            yield event;

            if (event.type === 'message_complete' && 'content' in event) {
                retryOutput = event.content;
            }
        }

        if (retryOutput) {
            return yield* performVerification(agent, retryOutput, messages, attempt + 1);
        }

        return {
            passed: false,
            error: 'Verification retry did not produce a final response.',
        };
    }

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

async function processToolCall(toolCall: ToolCall, agent: AgentDefinition): Promise<ToolCallResult> {
    try {
        if (agent.onToolCall) {
            await agent.onToolCall(toolCall);
        }

        if (!agent.tools) {
            throw new Error('No tools available for agent');
        }

        const tool = agent.tools.find(t => t.definition.function.name === toolCall.function.name);
        if (!tool || !('function' in tool)) {
            throw new Error(`Tool ${toolCall.function.name} not found`);
        }

        const rawResult = await handleToolCall(toolCall, tool, agent, agent.abortSignal);
        const processedResult = await processToolResult(toolCall, rawResult, agent, tool.allowSummary);

        const toolCallResult: ToolCallResult = {
            toolCall,
            id: toolCall.id,
            call_id: toolCall.call_id || toolCall.id,
            output: processedResult,
        };

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
        error instanceof Error ? `Tool execution failed: ${error.message}` : `Tool execution failed: ${String(error)}`;

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
        'Tool did not finish before request finalization after a terminal provider failure.'
    );
}

export function mergeHistoryThread(mainHistory: ResponseInput, thread: ResponseInput, startIndex: number): void {
    const newMessages = thread.slice(startIndex);
    mainHistory.push(...newMessages);
}
