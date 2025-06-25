import {
    ProviderStreamEvent,
    MessageEvent,
    FileEvent,
    ToolEvent,
    ErrorEvent,
    CostUpdateEvent,
    ResponseOutputEvent,
    AgentEvent,
    ResponseInputItem,
    ToolCallResult,
    AgentExportDefinition,
} from '../types/types.js';

/**
 * Result object containing all aggregated data from an ensemble stream
 */
export interface EnsembleResult {
    /** Complete message content (joined deltas or final complete message) */
    message: string;

    /** Thinking content if present (for models that support reasoning output) */
    thinking?: {
        content: string;
        signature?: string;
    };

    /** Final cost data */
    cost?: {
        input_tokens: number;
        output_tokens: number;
        total_tokens?: number;
        cached_tokens?: number;
        thought_delay?: number;
    };

    /** Tool calls and their results */
    tools?: {
        calls: ToolCallResult[];
        totalCalls: number;
    };

    /** Files received during the stream */
    files?: Array<{
        mime_type?: string;
        data: string;
        data_format: 'base64';
    }>;

    /** Any errors that occurred */
    error?: string;

    /** All response output messages */
    responseOutputs?: ResponseInputItem[];

    /** Agent information if present */
    agent?: AgentExportDefinition;

    /** Whether the stream completed successfully */
    completed: boolean;

    /** Timestamp of stream start */
    startTime: Date;

    /** Timestamp of stream end */
    endTime?: Date;

    /** All message IDs encountered */
    messageIds: Set<string>;
}

/**
 * Converts an ensemble stream into a single result object
 * @param stream - The async generator stream from ensembleRequest or similar
 * @returns Promise resolving to the aggregated result
 */
export async function ensembleResult(stream: AsyncGenerator<ProviderStreamEvent>): Promise<EnsembleResult> {
    const result: EnsembleResult = {
        message: '',
        completed: false,
        startTime: new Date(),
        messageIds: new Set<string>(),
    };

    // Track message deltas by message_id
    const messageDeltas = new Map<string, string[]>();
    const thinkingDeltas = new Map<string, { content: string[]; signature?: string[] }>();
    const toolCalls = new Map<string, ToolCallResult>();
    const files: EnsembleResult['files'] = [];
    const responseOutputs: ResponseInputItem[] = [];

    try {
        for await (const event of stream) {
            switch (event.type) {
                case 'message_start': {
                    const msgEvent = event as MessageEvent;
                    if (msgEvent.message_id) {
                        result.messageIds.add(msgEvent.message_id);
                        messageDeltas.set(msgEvent.message_id, []);
                        if (msgEvent.thinking_content || msgEvent.thinking_signature) {
                            thinkingDeltas.set(msgEvent.message_id, {
                                content: [],
                                signature: [],
                            });
                        }
                    }
                    break;
                }

                case 'message_delta': {
                    const msgEvent = event as MessageEvent;
                    if (msgEvent.message_id && messageDeltas.has(msgEvent.message_id)) {
                        messageDeltas.get(msgEvent.message_id)!.push(msgEvent.content);
                    }
                    if (msgEvent.thinking_content && msgEvent.message_id && thinkingDeltas.has(msgEvent.message_id)) {
                        thinkingDeltas.get(msgEvent.message_id)!.content.push(msgEvent.thinking_content);
                    }
                    if (msgEvent.thinking_signature && msgEvent.message_id && thinkingDeltas.has(msgEvent.message_id)) {
                        thinkingDeltas.get(msgEvent.message_id)!.signature?.push(msgEvent.thinking_signature);
                    }
                    break;
                }

                case 'message_complete': {
                    const msgEvent = event as MessageEvent;
                    if (msgEvent.message_id) {
                        // Use complete message if available, otherwise join deltas
                        if (msgEvent.content) {
                            result.message = msgEvent.content;
                        } else if (messageDeltas.has(msgEvent.message_id)) {
                            const deltas = messageDeltas.get(msgEvent.message_id)!;
                            result.message = deltas.join('');
                        }

                        // Handle thinking content
                        if (thinkingDeltas.has(msgEvent.message_id)) {
                            const thinking = thinkingDeltas.get(msgEvent.message_id)!;
                            result.thinking = {
                                content: msgEvent.thinking_content || thinking.content.join(''),
                                signature:
                                    msgEvent.thinking_signature ||
                                    (thinking.signature?.length ? thinking.signature.join('') : undefined),
                            };
                        }
                    }
                    break;
                }

                case 'file_start':
                case 'file_delta':
                case 'file_complete': {
                    const fileEvent = event as FileEvent;
                    if (event.type === 'file_complete') {
                        files.push({
                            mime_type: fileEvent.mime_type,
                            data: fileEvent.data,
                            data_format: fileEvent.data_format,
                        });
                    }
                    break;
                }

                case 'tool_start': {
                    const toolEvent = event as ToolEvent;
                    const callId = toolEvent.tool_call.call_id || toolEvent.tool_call.id;
                    toolCalls.set(callId, {
                        toolCall: toolEvent.tool_call,
                        id: toolEvent.tool_call.id,
                        call_id: callId,
                    });
                    break;
                }

                case 'tool_done': {
                    const toolEvent = event as ToolEvent;
                    if (toolEvent.result) {
                        const existing = toolCalls.get(toolEvent.result.call_id);
                        if (existing) {
                            existing.output = toolEvent.result.output;
                            existing.error = toolEvent.result.error;
                        }
                    }
                    break;
                }

                case 'cost_update': {
                    const costEvent = event as CostUpdateEvent;
                    result.cost = {
                        input_tokens: costEvent.usage.input_tokens,
                        output_tokens: costEvent.usage.output_tokens,
                        total_tokens: costEvent.usage.total_tokens,
                        cached_tokens: costEvent.usage.cached_tokens,
                        thought_delay: costEvent.thought_delay,
                    };
                    break;
                }

                case 'error': {
                    const errorEvent = event as ErrorEvent;
                    result.error = errorEvent.error;
                    break;
                }

                case 'response_output': {
                    const outputEvent = event as ResponseOutputEvent;
                    responseOutputs.push(outputEvent.message);
                    break;
                }

                case 'agent_start':
                case 'agent_status':
                case 'agent_done': {
                    const agentEvent = event as AgentEvent;
                    result.agent = agentEvent.agent;
                    break;
                }

                case 'stream_end': {
                    result.completed = true;
                    break;
                }
            }
        }

        // If no message_complete was received, join all deltas
        if (!result.message && messageDeltas.size > 0) {
            const allDeltas: string[] = [];
            for (const deltas of messageDeltas.values()) {
                allDeltas.push(...deltas);
            }
            result.message = allDeltas.join('');
        }

        // Add tools if any were called
        if (toolCalls.size > 0) {
            result.tools = {
                calls: Array.from(toolCalls.values()),
                totalCalls: toolCalls.size,
            };
        }

        // Add files if any were received
        if (files.length > 0) {
            result.files = files;
        }

        // Add response outputs if any
        if (responseOutputs.length > 0) {
            result.responseOutputs = responseOutputs;
        }

        // Mark as completed if we finished the loop without errors
        if (!result.error && !result.completed) {
            result.completed = true;
        }
    } catch (error) {
        result.error = error instanceof Error ? error.message : String(error);
        result.completed = false;
    } finally {
        result.endTime = new Date();
    }

    return result;
}
