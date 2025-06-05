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
} from '../types/types.js';
import {
    RequestContext,
    createRequestContext,
    ToolCallAction,
} from '../types/tool_types.js';
import {
    getModelFromAgent,
    getModelProvider,
} from '../model_providers/model_provider.js';
import { MessageHistory } from '../utils/message_history.js';
import { handleToolCall } from '../utils/tool_execution_manager.js';
import { processToolResult } from '../utils/tool_result_processor.js';
import { verifyOutput, VerificationResult } from '../utils/verification.js';

/**
 * Unified request function that handles both standard and enhanced modes
 */
export async function* ensembleRequest(
    messages: ResponseInput,
    agent: AgentDefinition
): AsyncGenerator<ProviderStreamEvent> {
    // Use agent's historyThread if available, otherwise use provided messages
    const conversationHistory = agent?.historyThread || messages;
    
    // Get the model ID for context-aware compaction
    const modelId = agent?.model || (await getModelFromAgent(agent));
    
    // Use message history manager with automatic compaction
    const history = new MessageHistory(conversationHistory, {
        compactToolCalls: true,
        preserveSystemMessages: true,
        modelId: modelId,
        compactionThreshold: 0.7, // Compact when reaching 70% of context
    });

    // Create context if using enhanced mode
    const context = createRequestContext({
        messages: history.getMessages(),
    });

    try {
        // Track tool calls and rounds
        let totalToolCalls = 0;
        let toolCallRounds = 0;
        const maxToolCalls = agent?.maxToolCalls || 200;
        const maxRounds = agent?.maxToolCallRoundsPerTurn || Infinity;
        
        // Execute rounds while we have tool calls and haven't hit limits
        let hasToolCalls = true;
        let lastMessageContent = '';
        
        while (hasToolCalls && toolCallRounds < maxRounds && totalToolCalls < maxToolCalls) {
            hasToolCalls = false;
            
            // Execute one round
            const roundResult = await executeRound(
                agent, 
                context, 
                history,
                totalToolCalls,
                maxToolCalls
            );
            
            // Yield all events from this round
            for await (const event of roundResult.stream) {
                yield event;
            }
            
            // Update counters
            if (roundResult.toolCount > 0) {
                hasToolCalls = true;
                totalToolCalls += roundResult.toolCount;
                toolCallRounds++;
            }
            
            // Store the last message content for verification
            if (roundResult.messageContent) {
                lastMessageContent = roundResult.messageContent;
            }
        }
        
        // If we hit limits, add a notification
        if (hasToolCalls && toolCallRounds >= maxRounds) {
            yield {
                type: 'message_delta',
                content: '\n\n[Tool call rounds limit reached]',
            } as ProviderStreamEvent;
        } else if (hasToolCalls && totalToolCalls >= maxToolCalls) {
            yield {
                type: 'message_delta',
                content: '\n\n[Total tool calls limit reached]',
            } as ProviderStreamEvent;
        }
        
        // Perform verification if configured
        if (agent?.verifier && lastMessageContent) {
            const verificationResult = await performVerification(
                agent,
                lastMessageContent,
                history.getMessages()
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

interface RoundResult {
    stream: AsyncGenerator<ProviderStreamEvent>;
    toolCount: number;
    messageContent: string;
}

/**
 * Execute one round of request/response
 */
async function executeRound(
    agent: AgentDefinition,
    context: RequestContext | undefined,
    history: MessageHistory,
    currentToolCalls: number,
    maxToolCalls: number
): Promise<RoundResult> {
    const events: ProviderStreamEvent[] = [];
    let messageContent = '';
    let toolCount = 0;

    // Get current messages
    const messages = history.getMessages();

    // Create provider and agent with fresh settings
    const model = await getModelFromAgent(agent);
    const provider = await getModelProvider(model);

    // Stream the response
    const stream = provider.createResponseStream(messages, model, agent);

    const toolPromises: Promise<ToolCallResult[]>[] = [];

    for await (const event of stream) {
        // Apply event filtering
        if (agent.allowedEvents && !agent.allowedEvents.includes(event.type)) {
            continue;
        }

        events.push(event);

        // Handle different event types
        switch (event.type) {
            case 'message_complete':
                if ('content' in event) {
                    messageContent = event.content;
                }
                break;

            case 'tool_start':
                if ('tool_calls' in event && event.tool_calls) {
                    // Check if we'll exceed the limit
                    const remainingCalls = maxToolCalls - currentToolCalls;
                    if (remainingCalls <= 0) {
                        console.warn(`Tool call limit reached (${maxToolCalls}). Skipping tool calls.`);
                        break;
                    }
                    
                    // Limit the number of tool calls to process
                    const toolCallsToProcess = event.tool_calls.slice(0, remainingCalls);
                    toolCount += toolCallsToProcess.length;
                    
                    // Process tool calls with enhanced features if available
                    toolPromises.push(
                        processToolCalls(toolCallsToProcess, agent, context)
                    );
                }
                break;

            case 'error':
                if (context) {
                    context.halt();
                }
                break;
        }
    }

    const toolResults: ToolCallResult[] = (
        await Promise.all(toolPromises)
    ).flat();

    // Update message history
    if (messageContent.length > 0 || toolResults.length > 0) {
        await history.addAssistantResponse(messageContent, toolResults);
    }

    // Update context if available
    if (context) {
        context.messages = history.getMessages();
        context.toolCallCount += toolResults.length;
    }

    // Create a generator that yields the collected events
    async function* eventGenerator(): AsyncGenerator<ProviderStreamEvent> {
        for (const event of events) {
            yield event;
        }
    }

    return {
        stream: eventGenerator(),
        toolCount,
        messageContent,
    };
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
    const verification = await verifyOutput(
        agent.verifier,
        output,
        messages
    );
    
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
async function processToolCalls(
    toolCalls: ToolCall[],
    agent: AgentDefinition,
    context?: RequestContext
): Promise<ToolCallResult[]> {
    // Process all tool calls in parallel
    const toolCallPromises = toolCalls.map(async toolCall => {
        // Apply tool handler lifecycle if available
        if (agent.onToolCall) {
            const action = await agent.onToolCall(toolCall);

            if (action && action === ToolCallAction.SKIP) {
                return null; // Skip this tool call
            }

            if (action === ToolCallAction.HALT && context) {
                context.halt();
                return null; // Halt processing
            }
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
    });

    // Wait for all tool calls to complete
    const results = await Promise.all(toolCallPromises);

    // Filter out null results (skipped tools)
    return results.filter(
        (result): result is ToolCallResult => result !== null
    );
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