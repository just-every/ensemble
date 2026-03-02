import {
    LiveConfig,
    LiveOptions,
    LiveEvent,
    LiveSession,
    AgentDefinition,
    ToolCallResult,
    LiveStartEvent,
    LiveEndEvent,
    LiveErrorEvent,
    LiveToolStartEvent,
    LiveToolCallEvent,
    LiveToolResultEvent,
    LiveToolDoneEvent,
    LiveCostUpdateEvent,
    LiveTurnCompleteEvent,
} from '../types/types.js';
import { getModelFromAgent } from '../model_providers/model_provider.js';
import { getModelProvider } from '../model_providers/model_provider.js';
import { MessageHistory } from '../utils/message_history.js';
import { handleToolCall } from '../utils/tool_execution_manager.js';
import { processToolResult } from '../utils/tool_result_processor.js';
import { emitEvent } from '../utils/event_controller.js';
import { createTraceContext } from '../utils/trace_context.js';
import { randomUUID } from 'crypto';

/**
 * Creates a live interactive session with real-time audio/text capabilities
 *
 * @param config - Configuration for the live session
 * @param agent - Agent definition with model, tools, and settings
 * @param options - Optional parameters for the session
 * @returns AsyncGenerator that yields live events
 *
 * @example
 * ```typescript
 * const config: LiveConfig = {
 *     responseModalities: ['AUDIO'],
 *     speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } }
 * };
 *
 * for await (const event of ensembleLive(config, agent)) {
 *     if (event.type === 'audio_output') {
 *         // Handle audio output
 *     }
 * }
 * ```
 */
export async function* ensembleLive(
    config: LiveConfig,
    agent: AgentDefinition,
    options?: LiveOptions
): AsyncGenerator<LiveEvent> {
    const startTime = Date.now();
    const trace = createTraceContext(agent, 'live_session');
    const requestId = randomUUID();
    let session: LiveSession | null = null;
    let messageHistory: MessageHistory | null = null;
    let totalToolCalls = 0;
    let currentTurnToolCalls = 0;
    let isSessionActive = true;
    let totalCost = 0;
    let totalTokens = 0;
    let requestStarted = false;
    let turnStatus: 'completed' | 'error' = 'completed';
    let turnEndReason = 'completed';
    let requestStatus = 'completed';
    let requestError: string | undefined;
    let resolvedModel: string | undefined;
    let resolvedProviderId: string | undefined;

    await trace.emitTurnStart({
        config,
        options,
    });

    try {
        // Determine the model to use
        const model = await getModelFromAgent(agent);
        if (!model) {
            throw new Error('No model specified in agent configuration');
        }
        resolvedModel = model;

        // Get the provider for this model
        const provider = getModelProvider(model);
        if (!provider) {
            throw new Error(`No provider found for model: ${model}`);
        }
        resolvedProviderId = provider.provider_id;

        // Check if provider supports Live API
        if (!provider.createLiveSession) {
            throw new Error(`Provider ${provider.provider_id} does not support Live API`);
        }

        await trace.emitRequestStart(requestId, {
            agent_id: agent.agent_id,
            provider: provider.provider_id,
            model,
            payload: {
                config,
                options,
                history_count: options?.messageHistory?.length ?? 0,
            },
        });
        requestStarted = true;

        // Initialize message history if provided
        if (options?.messageHistory) {
            messageHistory = new MessageHistory();
            for (const message of options.messageHistory) {
                if ('content' in message && message.content) {
                    await messageHistory.add(message);
                }
            }
        }

        // Create live session
        session = await provider.createLiveSession(config, agent, model, options);

        // Emit start event
        const startEvent: LiveStartEvent = {
            type: 'live_start',
            timestamp: new Date().toISOString(),
            sessionId: session.sessionId,
            config,
        };
        yield startEvent;
        emitEvent(
            {
                type: 'agent_start',
                agent: {
                    agent_id: agent.agent_id,
                    name: agent.name,
                    model: agent.model,
                    modelClass: agent.modelClass,
                },
                timestamp: new Date().toISOString(),
            },
            agent
        );

        // Initialize session with message history if available
        if (messageHistory) {
            const historyMessages = await messageHistory.getMessages();
            if (historyMessages.length > 0) {
                for (const message of historyMessages) {
                    if ('role' in message && message.role && 'content' in message) {
                        const role = message.role === 'assistant' ? 'assistant' : 'user';
                        const content = typeof message.content === 'string' ? message.content : '';
                        if (content) {
                            await session.sendText(content, role);
                        }
                    }
                }
            }
        }

        // Process events from the session
        for await (const event of session.getEventStream()) {
            // Handle session lifecycle
            if (!isSessionActive) {
                break;
            }

            // Track costs if available
            if (event.type === 'cost_update') {
                const costEvent = event as LiveCostUpdateEvent;
                if (costEvent.usage.totalCost) {
                    totalCost += costEvent.usage.totalCost;
                }
                if (costEvent.usage.totalTokens) {
                    totalTokens += costEvent.usage.totalTokens;
                }
            }

            // Handle tool calls
            if (event.type === 'tool_call') {
                const toolCallEvent = event as LiveToolCallEvent;
                const toolResults: ToolCallResult[] = [];

                // Check tool call limits
                const maxToolCalls = options?.maxToolCalls ?? agent.maxToolCalls ?? 200;
                const maxToolCallRoundsPerTurn =
                    options?.maxToolCallRoundsPerTurn ?? agent.maxToolCallRoundsPerTurn ?? Infinity;

                if (totalToolCalls >= maxToolCalls) {
                    turnStatus = 'error';
                    turnEndReason = 'max_tool_calls_exceeded';
                    requestStatus = 'error';
                    requestError = `Maximum tool calls (${maxToolCalls}) exceeded`;
                    const errorEvent: LiveErrorEvent = {
                        type: 'error',
                        timestamp: new Date().toISOString(),
                        error: requestError,
                        code: 'MAX_TOOL_CALLS_EXCEEDED',
                        recoverable: false,
                    };
                    yield errorEvent;
                    break;
                }

                if (currentTurnToolCalls >= maxToolCallRoundsPerTurn) {
                    const errorEvent: LiveErrorEvent = {
                        type: 'error',
                        timestamp: new Date().toISOString(),
                        error: `Maximum tool call rounds per turn (${maxToolCallRoundsPerTurn}) exceeded`,
                        code: 'MAX_TURN_TOOL_CALLS_EXCEEDED',
                        recoverable: true,
                    };
                    yield errorEvent;
                    continue;
                }

                // Execute tool calls
                for (const toolCall of toolCallEvent.toolCalls) {
                    await trace.emitToolStart(requestId, toolCall.id, {
                        tool_name: toolCall.function.name,
                        call_id: toolCall.call_id || toolCall.id,
                        arguments: toolCall.function.arguments,
                    });

                    // Emit tool start event
                    const toolStartEvent: LiveToolStartEvent = {
                        type: 'tool_start',
                        timestamp: new Date().toISOString(),
                        toolCall,
                    };
                    yield toolStartEvent;

                    try {
                        // Find the matching tool
                        const tools = agent.tools || [];
                        const tool = tools.find(t => t.definition.function.name === toolCall.function.name);

                        if (!tool) {
                            throw new Error(`Tool not found: ${toolCall.function.name}`);
                        }

                        // Handle the tool call
                        const result = await handleToolCall(toolCall, tool, agent);

                        // Process the result
                        const processedResult = await processToolResult(toolCall, result, agent, tool.allowSummary);

                        const toolCallResult: ToolCallResult = {
                            toolCall,
                            id: toolCall.id,
                            call_id: toolCall.call_id || toolCall.id,
                            output: processedResult,
                        };

                        toolResults.push(toolCallResult);
                        totalToolCalls++;
                        currentTurnToolCalls++;

                        await trace.emitToolDone(requestId, toolCall.id, {
                            tool_name: toolCall.function.name,
                            call_id: toolCallResult.call_id,
                            output: toolCallResult.output,
                        });

                        // Emit tool result event
                        const toolResultEvent: LiveToolResultEvent = {
                            type: 'tool_result',
                            timestamp: new Date().toISOString(),
                            toolCallResult,
                        };
                        yield toolResultEvent;

                        // Call agent callbacks
                        if (agent.onToolResult) {
                            await agent.onToolResult(toolCallResult);
                        }
                    } catch (error) {
                        const errorMessage = error instanceof Error ? error.message : String(error);
                        const toolCallResult: ToolCallResult = {
                            toolCall,
                            id: toolCall.id,
                            call_id: toolCall.call_id || toolCall.id,
                            error: errorMessage,
                        };

                        toolResults.push(toolCallResult);

                        await trace.emitToolDone(requestId, toolCall.id, {
                            tool_name: toolCall.function.name,
                            call_id: toolCallResult.call_id,
                            error: errorMessage,
                        });

                        // Emit error event
                        const errorEvent: LiveErrorEvent = {
                            type: 'error',
                            timestamp: new Date().toISOString(),
                            error: `Tool call failed: ${errorMessage}`,
                            code: 'TOOL_CALL_ERROR',
                            recoverable: true,
                        };
                        yield errorEvent;

                        // Call agent error callback
                        if (agent.onToolError) {
                            await agent.onToolError(toolCallResult);
                        }
                    }
                }

                // Send tool results back to the session
                if (toolResults.length > 0 && session.isActive()) {
                    await session.sendToolResponse(toolResults);
                }

                // Emit tool done event
                const toolDoneEvent: LiveToolDoneEvent = {
                    type: 'tool_done',
                    timestamp: new Date().toISOString(),
                    totalCalls: totalToolCalls,
                };
                yield toolDoneEvent;
            }

            // Handle turn completion
            if (event.type === 'turn_complete') {
                currentTurnToolCalls = 0; // Reset per-turn counter
                const turnEvent = event as LiveTurnCompleteEvent;

                // Update message history if available
                if (messageHistory && turnEvent.message) {
                    await messageHistory.add(turnEvent.message);
                }
            }

            // Handle interruption
            if (event.type === 'interrupted') {
                currentTurnToolCalls = 0; // Reset per-turn counter
            }

            // Forward compatible events
            if (event.type === 'live_ready') {
                emitEvent(
                    {
                        type: 'agent_status',
                        agent: {
                            agent_id: agent.agent_id,
                            name: agent.name,
                            model: agent.model,
                            modelClass: agent.modelClass,
                        },
                        status: 'ready',
                        timestamp: new Date().toISOString(),
                    },
                    agent
                );
            }

            // Always yield the event
            yield event;
        }
    } catch (error) {
        // Emit error event
        const errorMessage = error instanceof Error ? error.message : String(error);
        turnStatus = 'error';
        turnEndReason = 'exception';
        requestStatus = 'error';
        requestError = errorMessage;
        const errorEvent: LiveErrorEvent = {
            type: 'error',
            timestamp: new Date().toISOString(),
            error: errorMessage,
            code: error instanceof Error && 'code' in error ? String(error.code) : 'UNKNOWN_ERROR',
            recoverable: false,
        };
        yield errorEvent;

        // Re-throw for caller to handle
        throw error;
    } finally {
        // Clean up session
        if (session && session.isActive()) {
            await session.close();
        }
        isSessionActive = false;

        // Emit end event
        const duration = Date.now() - startTime;
        if (requestStarted) {
            await trace.emitRequestEnd(requestId, {
                status: requestStatus,
                error: requestError,
                duration_ms: duration,
                total_tokens: totalTokens,
                total_cost: totalCost > 0 ? totalCost : undefined,
                total_tool_calls: totalToolCalls,
                session_id: session?.sessionId,
                model: resolvedModel,
                provider: resolvedProviderId,
            });
        }
        await trace.emitTurnEnd(turnStatus, turnEndReason, {
            error: requestError,
            duration_ms: duration,
            total_tokens: totalTokens,
            total_cost: totalCost > 0 ? totalCost : undefined,
            total_tool_calls: totalToolCalls,
            session_id: session?.sessionId,
            model: resolvedModel,
            provider: resolvedProviderId,
        });

        const endEvent: LiveEndEvent = {
            type: 'live_end',
            timestamp: new Date().toISOString(),
            reason: turnStatus === 'completed' ? 'completed' : 'error',
            duration,
            totalTokens,
            totalCost: totalCost > 0 ? totalCost : undefined,
        };
        yield endEvent;

        emitEvent(
            {
                type: 'agent_done',
                agent: {
                    agent_id: agent.agent_id,
                    name: agent.name,
                    model: agent.model,
                    modelClass: agent.modelClass,
                },
                duration_with_tools: duration,
                request_cost: totalCost > 0 ? totalCost : undefined,
                timestamp: new Date().toISOString(),
            },
            agent
        );
    }
}

/**
 * Helper function to create a live session with audio input/output
 *
 * @param audioSource - Async iterable of audio chunks
 * @param agent - Agent definition
 * @param options - Live options
 * @returns AsyncGenerator of live events
 */
export async function* ensembleLiveAudio(
    audioSource: AsyncIterable<Uint8Array>,
    agent: AgentDefinition,
    options?: LiveOptions & {
        voice?: string;
        language?: string;
        enableAffectiveDialog?: boolean;
        enableProactivity?: boolean;
    }
): AsyncGenerator<LiveEvent> {
    const trace = createTraceContext(agent, 'live_audio_session');
    const requestId = randomUUID();
    let requestStarted = false;
    let turnStatus: 'completed' | 'error' = 'completed';
    let turnEndReason = 'completed';
    let requestStatus = 'completed';
    let requestError: string | undefined;
    let totalCost = 0;
    let totalTokens = 0;
    const startTime = Date.now();
    const config: LiveConfig = {
        responseModalities: ['AUDIO'],
        speechConfig: options?.voice
            ? {
                  voiceConfig: {
                      prebuiltVoiceConfig: { voiceName: options.voice },
                  },
                  languageCode: options.language,
              }
            : undefined,
        inputAudioTranscription: {},
        outputAudioTranscription: {},
    };

    // Add optional features
    if (options?.enableAffectiveDialog) {
        config.enableAffectiveDialog = true;
    }
    if (options?.enableProactivity) {
        config.proactivity = {
            proactiveAudio: true,
        };
    }

    await trace.emitTurnStart({
        config,
        options,
        audio_source_type: 'async_iterable',
    });

    let session: LiveSession | null = null;
    let model: string | undefined;
    let providerId: string | undefined;
    let audioChunkCount = 0;
    let totalAudioBytes = 0;
    let audioProcessingTask: Promise<void> | null = null;

    try {
        // We need direct access to the session, so we'll handle the live session creation manually
        model = await getModelFromAgent(agent);
        console.log('[ensembleLiveAudio] Using model:', model);
        if (!model) {
            throw new Error('No model specified in agent configuration');
        }

        const provider = getModelProvider(model);
        providerId = provider?.provider_id;
        console.log('[ensembleLiveAudio] Provider:', provider?.provider_id);
        if (!provider || !provider.createLiveSession) {
            throw new Error(`Provider does not support Live API for model: ${model}`);
        }

        await trace.emitRequestStart(requestId, {
            agent_id: agent.agent_id,
            provider: provider.provider_id,
            model,
            payload: {
                config,
                options,
                audio_source_type: 'async_iterable',
            },
        });
        requestStarted = true;

        // Create the live session directly
        console.log('[ensembleLiveAudio] Creating live session...');
        session = await provider.createLiveSession(config, agent, model, options);
        console.log('[ensembleLiveAudio] Session created:', session.sessionId);

        // Start audio processing task
        audioProcessingTask = (async () => {
            try {
                console.log('[ensembleLiveAudio] Starting audio processing task...');
                for await (const chunk of audioSource) {
                    if (!session || !session.isActive()) {
                        console.log('[ensembleLiveAudio] Session inactive, stopping audio processing');
                        break;
                    }

                    audioChunkCount++;
                    totalAudioBytes += chunk.length;

                    // Convert to base64
                    const base64Data = Buffer.from(chunk).toString('base64');
                    console.log(
                        `[ensembleLiveAudio] Sending audio chunk ${audioChunkCount}, size: ${chunk.length} bytes, total: ${totalAudioBytes} bytes`
                    );
                    await session.sendAudio({
                        data: base64Data,
                        mimeType: 'audio/pcm;rate=16000',
                    });
                }
                console.log(
                    `[ensembleLiveAudio] Audio processing completed. Total chunks: ${audioChunkCount}, Total bytes: ${totalAudioBytes}`
                );
            } catch (error) {
                console.error('[ensembleLiveAudio] Error processing audio:', error);
            }
        })();

        // Emit start event
        yield {
            type: 'live_start',
            timestamp: new Date().toISOString(),
            sessionId: session.sessionId,
            config,
        } as LiveStartEvent;

        // Process events
        console.log('[ensembleLiveAudio] Starting event processing...');
        let eventCount = 0;
        for await (const event of session.getEventStream()) {
            eventCount++;
            console.log(`[ensembleLiveAudio] Event ${eventCount}:`, event.type);

            if (event.type === 'cost_update') {
                const costEvent = event as LiveCostUpdateEvent;
                if (costEvent.usage.totalCost) {
                    totalCost += costEvent.usage.totalCost;
                }
                if (costEvent.usage.totalTokens) {
                    totalTokens += costEvent.usage.totalTokens;
                }
            }

            yield event;
        }
        console.log(`[ensembleLiveAudio] Event processing completed. Total events: ${eventCount}`);
    } catch (error) {
        turnStatus = 'error';
        turnEndReason = 'exception';
        requestStatus = 'error';
        requestError = error instanceof Error ? error.message : String(error);
        throw error;
    } finally {
        if (audioProcessingTask) {
            await audioProcessingTask;
        }

        // Close session if still active
        if (session && session.isActive()) {
            await session.close();
        }

        const duration = Date.now() - startTime;
        if (requestStarted) {
            await trace.emitRequestEnd(requestId, {
                status: requestStatus,
                error: requestError,
                duration_ms: duration,
                total_tokens: totalTokens,
                total_cost: totalCost > 0 ? totalCost : undefined,
                audio_chunks_sent: audioChunkCount,
                audio_bytes_sent: totalAudioBytes,
                session_id: session?.sessionId,
                model,
                provider: providerId,
            });
        }
        await trace.emitTurnEnd(turnStatus, turnEndReason, {
            error: requestError,
            duration_ms: duration,
            total_tokens: totalTokens,
            total_cost: totalCost > 0 ? totalCost : undefined,
            audio_chunks_sent: audioChunkCount,
            audio_bytes_sent: totalAudioBytes,
            session_id: session?.sessionId,
            model,
            provider: providerId,
        });

        // Emit end event
        yield {
            type: 'live_end',
            timestamp: new Date().toISOString(),
            reason: turnStatus === 'completed' ? 'completed' : 'error',
        } as LiveEndEvent;
    }
}

/**
 * Helper function to create a text-based live session
 *
 * @param agent - Agent definition
 * @param options - Live options
 * @returns Object with session control methods
 */
export async function ensembleLiveText(
    agent: AgentDefinition,
    options?: LiveOptions
): Promise<{
    sendMessage: (text: string) => Promise<void>;
    getEvents: () => AsyncIterable<LiveEvent>;
    close: () => Promise<void>;
}> {
    const config: LiveConfig = {
        responseModalities: ['TEXT'],
    };

    // eslint-disable-next-line prefer-const
    let session: LiveSession | null = null;
    const sessionGenerator = ensembleLive(config, agent, options);

    // Find session from events
    const eventQueue: LiveEvent[] = [];
    let eventPromiseResolve: ((value: IteratorResult<LiveEvent>) => void) | null = null;

    // Prime the live generator so provider session setup starts before returning controls.
    const firstEvent = await sessionGenerator.next();
    if (!firstEvent.done && firstEvent.value) {
        eventQueue.push(firstEvent.value);
    }

    // Process events in background
    (async () => {
        for await (const event of sessionGenerator) {
            if (event.type === 'live_start') {
                // Extract session (would need to be passed differently in real implementation)
            }

            if (eventPromiseResolve) {
                eventPromiseResolve({ value: event, done: false });
                eventPromiseResolve = null;
            } else {
                eventQueue.push(event);
            }
        }

        // Signal completion
        if (eventPromiseResolve) {
            eventPromiseResolve({ value: undefined, done: true });
        }
    })();

    return {
        sendMessage: async (text: string) => {
            if (!session) {
                throw new Error('Session not initialized');
            }
            await session.sendText(text, 'user');
        },
        getEvents: async function* () {
            while (true) {
                if (eventQueue.length > 0) {
                    yield eventQueue.shift()!;
                } else {
                    const result = await new Promise<IteratorResult<LiveEvent>>(resolve => {
                        eventPromiseResolve = resolve;
                    });
                    if (result.done) break;
                    if (result.value) yield result.value;
                }
            }
        },
        close: async () => {
            if (session && session.isActive()) {
                await session.close();
            }
        },
    };
}
