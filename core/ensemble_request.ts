/**
 * Unified request implementation that combines standard and enhanced features
 */

import {
    ProviderStreamEvent,
    ResponseInput,
    ToolCall,
    ToolCallResult,
    AgentDefinition,
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

/**
 * Unified request function that handles both standard and enhanced modes
 */
export async function* ensembleRequest(
    messages: ResponseInput,
    agent: AgentDefinition
): AsyncGenerator<ProviderStreamEvent> {
    // Use message history manager
    const history = new MessageHistory(messages, {
        compactToolCalls: true,
        preserveSystemMessages: true,
    });

    // Create context if using enhanced mode
    const context = createRequestContext({
        messages: history.getMessages(),
    });

    try {
        // Main execution
        const stream = await executeRound(agent, context, history);

        // Yield all events from this round
        for await (const event of stream) {
            yield event;
        }
    } catch (error) {
        // Use unified error handler
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
    agent: AgentDefinition,
    context: RequestContext | undefined,
    history: MessageHistory
): AsyncGenerator<ProviderStreamEvent> {
    let messageContent = '';

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

        yield event;

        // Handle different event types
        switch (event.type) {
            case 'message_complete':
                if ('content' in event) {
                    messageContent = event.content;
                }
                break;

            case 'tool_start':
                if ('tool_calls' in event && event.tool_calls) {
                    // Process tool calls with enhanced features if available
                    toolPromises.push(
                        processToolCalls(event.tool_calls, agent, context)
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
        history.addAssistantResponse(messageContent, toolResults);
    }

    // Update context if available
    if (context) {
        context.messages = history.getMessages();
        context.toolCallCount += toolResults.length;
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
