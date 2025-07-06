import { randomUUID } from 'crypto';
import {
    MessageEventBase,
    ResponseBaseMessage,
    ResponseThinkingMessage,
    ResponseOutputMessage,
    ResponseInputFunctionCall,
    ResponseInputFunctionCallOutput,
    ToolCall,
    ToolCallResult,
} from '../types/types.js';

/**
 * Converts a MessageEventBase to a ResponseThinkingMessage
 */
export function convertToThinkingMessage(event: MessageEventBase, model?: string): ResponseThinkingMessage {
    return {
        id: event.message_id || randomUUID(),
        type: 'thinking',
        role: 'assistant',
        content: event.thinking_content || '',
        signature: event.thinking_signature || '',
        thinking_id: event.message_id || '',
        status: 'completed',
        model,
        timestamp: event.timestamp ? new Date(event.timestamp).getTime() : undefined,
    };
}

/**
 * Converts a MessageEventBase to a ResponseOutputMessage
 */
export function convertToOutputMessage(
    event: MessageEventBase,
    model?: string,
    status: 'in_progress' | 'completed' | 'incomplete' = 'completed'
): ResponseOutputMessage {
    return {
        id: event.message_id || randomUUID(),
        type: 'message',
        role: 'assistant',
        content: event.content,
        status,
        model,
        timestamp: event.timestamp ? new Date(event.timestamp).getTime() : undefined,
    };
}

/**
 * Converts a ToolCall to a ResponseInputFunctionCall
 */
export function convertToFunctionCall(
    toolCall: ToolCall,
    model?: string,
    status: 'in_progress' | 'completed' | 'incomplete' = 'completed'
): ResponseInputFunctionCall {
    return {
        id: toolCall.id || randomUUID(),
        type: 'function_call',
        call_id: toolCall.call_id || toolCall.id,
        name: toolCall.function.name,
        arguments: toolCall.function.arguments,
        model,
        status,
        timestamp: Date.now(),
    };
}

/**
 * Converts a ToolCallResult to a ResponseInputFunctionCallOutput
 */
export function convertToFunctionCallOutput(
    toolResult: ToolCallResult,
    model?: string,
    status: 'in_progress' | 'completed' | 'incomplete' = 'completed'
): ResponseInputFunctionCallOutput {
    // Append '_output' to avoid ID collision with the function call
    const id = toolResult.id ? `${toolResult.id}_output` : randomUUID();

    return {
        id,
        type: 'function_call_output',
        call_id: toolResult.call_id || toolResult.toolCall.id,
        name: toolResult.toolCall.function.name,
        output: toolResult.output + (toolResult.error || ''),
        model,
        status,
        timestamp: Date.now(),
    };
}

/**
 * Generic converter that ensures all ResponseBaseMessage fields are populated
 */
export function ensureMessageId<T extends ResponseBaseMessage>(message: T): T {
    if (!message.id) {
        // Generate a unique ID if not present
        message.id = randomUUID();
    }
    return message;
}
