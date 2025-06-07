/**
 * Unified request implementation that combines standard and enhanced features
 */

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
import {
    getModelFromAgent,
    getModelProvider,
} from '../model_providers/model_provider.js';
import { MessageHistory } from '../utils/message_history.js';
import { handleToolCall } from '../utils/tool_execution_manager.js';
import { processToolResult } from '../utils/tool_result_processor.js';
import { verifyOutput } from '../utils/verification.js';

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
            const stream = executeRound(
                model,
                agent,
                history,
                totalToolCalls,
                maxToolCalls
            );

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
            (hasToolCalls &&
                toolCallRounds < maxRounds &&
                totalToolCalls < maxToolCalls)
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
    // Get current messages
    let messages = await history.getMessages(model);

    // Allow agent onRequest hook
    if (agent.onRequest) {
        [agent, messages] = await agent.onRequest(agent, messages);
    }

    // Create provider and agent with fresh settings
    const provider = getModelProvider(model);

    // Stream the response
    const stream = provider.createResponseStream(messages, model, agent);

    const toolPromises: Promise<ToolCallResult>[] = [];

    for await (const event of stream) {
        // Apply event filtering
        if (agent.allowedEvents && !agent.allowedEvents.includes(event.type)) {
            continue;
        }

        yield event;

        // Handle different event types
        switch (event.type) {
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
                    console.warn(
                        `Tool call limit reached (${maxToolCalls}). Skipping tool calls.`
                    );
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
                console.error(
                    '[executeRound] Error event:',
                    (event as any).error
                );
                break;
            }
        }
    }

    // Complete then process any tool calls
    const toolResults: ToolCallResult[] = await Promise.all(toolPromises);
    for (const toolResult of toolResults) {
        yield {
            type: 'tool_done',
            tool_call: toolResult.toolCall,
            result: {
                call_id: toolResult.call_id || toolResult.id,
                output: toolResult.output,
                error: toolResult.error,
            },
        };

        const functionOutput: ResponseInputFunctionCallOutput = {
            type: 'function_call_output',
            id: toolResult.id,
            call_id: toolResult.call_id || toolResult.id,
            name: toolResult.toolCall.function.name,
            output: toolResult.output + (toolResult.error || ''),
            model,
        };

        history.add(functionOutput);
        yield {
            type: 'response_output',
            message: functionOutput,
        };
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
            { type: 'message', role: 'assistant', content: output, status: 'completed' } as ResponseOutputMessage,
            {
                type: 'message',
                role: 'developer',
                content: `Verification failed: ${verification.reason}\n\nPlease correct your response.`
            } as ResponseInputMessage
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
async function processToolCall(
    toolCall: ToolCall,
    agent: AgentDefinition
): Promise<ToolCallResult> {
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
        const tool = agent.tools.find(
            t => t.definition.function.name === toolCall.function.name
        );

        if (!tool || !('function' in tool)) {
            throw new Error(`Tool ${toolCall.function.name} not found`);
        }

        // Execute with enhanced lifecycle management
        const rawResult = await handleToolCall(toolCall, tool, agent);

        // Process the result (summarization, truncation, etc.)
        const processedResult = await processToolResult(
            toolCall,
            rawResult
        );

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
            output: errorOutput,
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
export function mergeHistoryThread(
    mainHistory: ResponseInput,
    thread: ResponseInput,
    startIndex: number
): void {
    const newMessages = thread.slice(startIndex);
    mainHistory.push(...newMessages);
}