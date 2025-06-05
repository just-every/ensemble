import type {
    ProviderStreamEvent,
    ResponseInput,
    ResponseThinkingMessage,
    ResponseOutputMessage,
    ResponseInputFunctionCall,
    ResponseInputFunctionCallOutput,
    ToolCall,
    AgentDefinition,
} from '../types/types.js';

export interface ConversionResult {
    messages: ResponseInput;
    fullResponse: string;
    toolCalls: ToolCall[];
}

/**
 * Converts a stream of ProviderStreamEvent into ResponseInput messages.
 * This allows chaining LLM calls by converting the output of one call
 * into the input format for the next call.
 */
export async function convertStreamToMessages(
    stream: AsyncGenerator<ProviderStreamEvent>,
    initialMessages: ResponseInput = [],
    agent: AgentDefinition = {}
): Promise<ConversionResult> {
    const messages: ResponseInput = [...initialMessages];
    let fullResponse = '';
    const collectedToolCalls: ToolCall[] = [];
    const toolResults: Array<{ id: string; call_id: string; output: string }> =
        [];

    for await (const event of stream) {
        switch (event.type) {
            case 'message_complete': {
                const messageEvent = event as any;

                // Handle thinking content
                if (messageEvent.thinking_content) {
                    const thinkingMessage: ResponseThinkingMessage = {
                        type: 'thinking',
                        role: 'assistant',
                        content:
                            messageEvent.thinking_content &&
                            messageEvent.thinking_content !== '{empty}'
                                ? messageEvent.thinking_content
                                : '',
                        signature: messageEvent.thinking_signature || '',
                        thinking_id: messageEvent.message_id || '',
                        status: 'completed',
                        model: agent.model || messageEvent.model || 'unknown',
                    };
                    messages.push(thinkingMessage);

                    if (agent.onThinking) {
                        await agent.onThinking(thinkingMessage);
                    }
                }

                // Handle regular content
                if (messageEvent.content) {
                    fullResponse = messageEvent.content;
                    const contentMessage: ResponseOutputMessage = {
                        id: messageEvent.message_id,
                        type: 'message',
                        role: 'assistant',
                        content: messageEvent.content,
                        status: 'completed',
                        model: agent.model || messageEvent.model || 'unknown',
                    };
                    messages.push(contentMessage);

                    if (agent.onResponse) {
                        await agent.onResponse(contentMessage);
                    }
                }
                break;
            }

            case 'tool_start': {
                const toolEvent = event as any;
                if (
                    !toolEvent.tool_calls ||
                    toolEvent.tool_calls.length === 0
                ) {
                    continue;
                }

                // Collect tool calls
                collectedToolCalls.push(...toolEvent.tool_calls);

                // Process tool calls if handler provided
                if (agent.processToolCall) {
                    try {
                        const results = await agent.processToolCall(
                            toolEvent.tool_calls
                        );

                        // Convert results to array format
                        const resultsArray = Array.isArray(results)
                            ? results
                            : [results];

                        // Store results
                        for (let i = 0; i < toolEvent.tool_calls.length; i++) {
                            const toolCall = toolEvent.tool_calls[i];
                            const result = resultsArray[i] || resultsArray[0];

                            toolResults.push({
                                id: toolCall.id,
                                call_id: toolCall.call_id || toolCall.id,
                                output:
                                    typeof result === 'string'
                                        ? result
                                        : JSON.stringify(result),
                            });
                        }
                    } catch (error) {
                        // Handle tool execution errors
                        const errorResult = {
                            error: `Tool execution failed: ${error instanceof Error ? error.message : String(error)}`,
                        };

                        for (const toolCall of toolEvent.tool_calls) {
                            toolResults.push({
                                id: toolCall.id,
                                call_id: toolCall.call_id || toolCall.id,
                                output: JSON.stringify(errorResult),
                            });
                        }
                    }
                }
                break;
            }

            case 'tool_done': {
                // Handle tool completion - add function calls and results to messages
                for (const toolCall of collectedToolCalls) {
                    // Add function call
                    const functionCall: ResponseInputFunctionCall = {
                        type: 'function_call',
                        id: toolCall.id,
                        call_id: toolCall.call_id || toolCall.id,
                        name: toolCall.function.name,
                        arguments: toolCall.function.arguments,
                        model: agent.model || 'unknown',
                    };
                    messages.push(functionCall);

                    // Add function result if available
                    const result = toolResults.find(
                        r => r.call_id === (toolCall.call_id || toolCall.id)
                    );

                    if (result) {
                        const functionOutput: ResponseInputFunctionCallOutput =
                            {
                                type: 'function_call_output',
                                id: toolCall.id,
                                call_id: toolCall.call_id || toolCall.id,
                                name: toolCall.function.name,
                                output: result.output,
                                model: agent.model || 'unknown',
                            };
                        messages.push(functionOutput);
                    }
                }

                // Clear collected tool calls for next batch
                collectedToolCalls.length = 0;
                toolResults.length = 0;
                break;
            }

            case 'error': {
                // Log errors but don't add them to messages
                console.error(
                    '[Stream Converter] Error event:',
                    (event as any).error
                );
                break;
            }
        }
    }

    // Handle any remaining tool calls that didn't get a tool_complete event
    if (collectedToolCalls.length > 0) {
        for (const toolCall of collectedToolCalls) {
            // Add function call
            const functionCall: ResponseInputFunctionCall = {
                type: 'function_call',
                id: toolCall.id,
                call_id: toolCall.call_id || toolCall.id,
                name: toolCall.function.name,
                arguments: toolCall.function.arguments,
                model: agent.model || 'unknown',
            };
            messages.push(functionCall);

            // Add function result if available
            const result = toolResults.find(
                r => r.call_id === (toolCall.call_id || toolCall.id)
            );

            if (result) {
                const functionOutput: ResponseInputFunctionCallOutput = {
                    type: 'function_call_output',
                    id: toolCall.id,
                    call_id: toolCall.call_id || toolCall.id,
                    name: toolCall.function.name,
                    output: result.output,
                    model: agent.model || 'unknown',
                };
                messages.push(functionOutput);
            }
        }
    }

    return {
        messages,
        fullResponse,
        toolCalls: collectedToolCalls,
    };
}
