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
    type ResponseThinkingMessage,
    type ResponseInputFunctionCall,
    type ResponseInputFunctionCallOutput,
    type ToolEvent,
} from '../types/types.js';
import { getModelFromAgent, getModelProvider } from '../model_providers/model_provider.js';
import { MessageHistory } from '../utils/message_history.js';
import { handleToolCall } from '../utils/tool_execution_manager.js';
import { processToolResult } from '../utils/tool_result_processor.js';
import { verifyOutput } from '../utils/verification.js';
import { waitWhilePaused } from '../utils/pause_controller.js';
import { emitEvent } from '../utils/event_controller.js';

const MAX_ERROR_ATTEMPTS = 5;

/**
 * Unified request function that handles both standard and enhanced modes
 */
export async function* ensembleRequest(
    messages: ResponseInput,
    agent: AgentDefinition = {}
): AsyncGenerator<ProviderStreamEvent> {
    // Use agent's historyThread if available, otherwise use provided messages
    const conversationHistory = agent?.historyThread || messages;

    // Ensure we have at least one message to prevent provider errors
    if (conversationHistory.length === 0) {
        conversationHistory.push({
            type: 'message',
            role: 'user',
            content: 'Begin.',
        });
    }

    if (agent.instructions) {
        const firstMsg = conversationHistory[0];
        const alreadyHasInstructions =
            firstMsg &&
            'content' in firstMsg &&
            typeof firstMsg.content === 'string' &&
            firstMsg.content.trim() === agent.instructions.trim();

        if (!alreadyHasInstructions) {
            conversationHistory.unshift({
                type: 'message',
                role: 'system',
                content: agent.instructions,
            });
        }
    }

    // Use message history manager with automatic compaction
    const history = new MessageHistory(conversationHistory, {
        compactToolCalls: true,
        preserveSystemMessages: true,
        compactionThreshold: 0.7, // Compact when reaching 70% of context
    });

    try {
        // Track tool calls and rounds
        let totalToolCalls = 0;
        let toolCallRounds = 0;
        let errorRounds = 0;
        const maxToolCalls = agent?.maxToolCalls ?? 200;
        const maxRounds = agent?.maxToolCallRoundsPerTurn ?? Infinity;

        // Execute rounds while we have tool calls and haven't hit limits
        let hasToolCalls = false;
        let hasError = false;
        let lastMessageContent = '';
        const modelHistory: string[] = [];

        // Always execute at least one round to get initial response
        do {
            hasToolCalls = false;
            hasError = false;

            const model = await getModelFromAgent(
                agent,
                'reasoning_mini',
                modelHistory // Change models if using classes
            );
            modelHistory.push(model);

            // Execute one round
            const stream = executeRound(model, agent, history, totalToolCalls, maxToolCalls);

            // Yield all events from this round
            for await (const event of stream) {
                yield event;

                switch (event.type) {
                    case 'message_complete': {
                        const messageEvent = event as MessageEventBase;
                        if (messageEvent.content) {
                            lastMessageContent = messageEvent.content;
                        }
                        break;
                    }

                    case 'tool_start': {
                        hasToolCalls = true;
                        ++totalToolCalls;
                        break;
                    }

                    case 'error': {
                        hasError = true;
                        break;
                    }
                }
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
        } while (
            (hasError && errorRounds < MAX_ERROR_ATTEMPTS) ||
            (hasToolCalls && toolCallRounds < maxRounds && totalToolCalls < maxToolCalls)
        );

        // If we hit limits, add a notification
        if (hasToolCalls && toolCallRounds >= maxRounds) {
            console.log('[ensembleRequest] Tool call rounds limit reached');
        } else if (hasToolCalls && totalToolCalls >= maxToolCalls) {
            console.log('[ensembleRequest] Total tool calls limit reached');
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
        yield {
            type: 'error',
            error: error.message || 'Unknown error',
            code: error.code,
            details: error.details,
            recoverable: error.recoverable,
            timestamp: new Date().toISOString(),
        } as ProviderStreamEvent;
    } finally {
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
    maxToolCalls: number
): AsyncGenerator<ProviderStreamEvent> {
    // Generate request ID and track timing
    const requestId = randomUUID();
    const startTime = Date.now();
    let totalCost = 0;

    // Get current messages
    let messages = await history.getMessages(model);

    // Emit agent_start event through global event controller
    await emitEvent(
        {
            type: 'agent_start',
            request_id: requestId,
            input:
                'content' in messages[0] && typeof messages[0].content === 'string' ? messages[0].content : undefined,
            timestamp: new Date().toISOString(),
        },
        agent,
        model
    );

    // Allow agent onRequest hook
    if (agent.onRequest) {
        [agent, messages] = await agent.onRequest(agent, messages);
    }

    // Wait while paused before creating the stream
    await waitWhilePaused(100, agent.abortSignal);

    // Create provider and agent with fresh settings
    const provider = getModelProvider(model);

    // Stream the response with retry support if available
    const stream =
        'createResponseStreamWithRetry' in provider
            ? (provider as any).createResponseStreamWithRetry(messages, model, agent)
            : provider.createResponseStream(messages, model, agent);

    const toolPromises: Promise<ToolCallResult>[] = [];

    // Map to store formatted arguments for each tool call
    const toolCallFormattedArgs = new Map<string, string>();

    // Buffer for events emitted during tool execution
    const toolEventBuffer: ProviderStreamEvent[] = [];

    // Add tool event buffers
    agent.onToolEvent = async (event: ProviderStreamEvent) => {
        // Buffer for the main stream
        toolEventBuffer.push(event);
    };

    for await (let event of stream) {
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

                    if (tool && 'definition' in tool) {
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
                if (
                    messageEvent.thinking_content ||
                    (!messageEvent.content && messageEvent.message_id) // Note that some providers require empty thinking nodes to be included in the conversation history
                ) {
                    const thinkingMessage: ResponseThinkingMessage = {
                        type: 'thinking',
                        role: 'assistant',
                        content: messageEvent.thinking_content || '',
                        signature: messageEvent.thinking_signature || '',
                        thinking_id: messageEvent.message_id || '',
                        status: 'completed',
                        model,
                    };

                    if (agent.onThinking) {
                        await agent.onThinking(thinkingMessage);
                    }

                    history.add(thinkingMessage);
                    yield {
                        type: 'response_output',
                        message: thinkingMessage,
                    };
                }
                if (messageEvent.content) {
                    const contentMessage: ResponseOutputMessage = {
                        id: messageEvent.message_id,
                        type: 'message',
                        role: 'assistant',
                        content: messageEvent.content,
                        status: 'completed',
                        model,
                    };

                    if (agent.onResponse) {
                        await agent.onResponse(contentMessage);
                    }

                    history.add(contentMessage);
                    yield {
                        type: 'response_output',
                        message: contentMessage,
                    };
                }
                break;
            }

            case 'tool_start': {
                const toolEvent = event as ToolEvent;
                if (!toolEvent.tool_call) {
                    break;
                }

                // Check if we'll exceed the limit
                const remainingCalls = maxToolCalls - currentToolCalls;
                if (remainingCalls <= 0) {
                    console.warn(`Tool call limit reached (${maxToolCalls}). Skipping tool calls.`);
                    // Don't count this as having tool calls if we're at the limit
                    break;
                }

                const toolCall = toolEvent.tool_call;

                // Add function call
                const functionCall: ResponseInputFunctionCall = {
                    type: 'function_call',
                    id: toolCall.id,
                    call_id: toolCall.call_id || toolCall.id,
                    name: toolCall.function.name,
                    arguments: toolCall.function.arguments,
                    model,
                    status: 'completed',
                };

                // Run tools in parallel
                toolPromises.push(processToolCall(toolCall, agent));

                history.add(functionCall);
                yield {
                    type: 'response_output',
                    message: functionCall,
                };
                break;
            }

            case 'error': {
                // Log errors but don't add them to messages
                console.error('[executeRound] Error event:', (event as any).error);
                break;
            }
        }
    }

    // Calculate request duration
    const request_duration = Date.now() - startTime;

    // Complete then process any tool calls
    const toolResults: ToolCallResult[] = await Promise.all(toolPromises);

    for (const toolResult of toolResults) {
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

        const functionOutput: ResponseInputFunctionCallOutput = {
            type: 'function_call_output',
            id: toolResult.id,
            call_id: toolResult.call_id || toolResult.id,
            name: toolResult.toolCall.function.name,
            output: toolResult.output + (toolResult.error || ''),
            model,
            status: 'completed',
        };

        history.add(functionOutput);
        yield {
            type: 'response_output',
            message: functionOutput,
        };
    }

    // Calculate full duration
    const duration_with_tools = Date.now() - startTime;

    // Emit agent_done event through global event controller
    await emitEvent(
        {
            type: 'agent_done',
            request_id: requestId,
            request_cost: totalCost > 0 ? totalCost : undefined,
            request_duration,
            duration_with_tools,
            timestamp: new Date().toISOString(),
        },
        agent,
        model
    );

    // Yield any events that were buffered during tool execution
    for (const bufferedEvent of toolEventBuffer) {
        yield bufferedEvent;
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
        const processedResult = await processToolResult(toolCall, rawResult, agent);

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
