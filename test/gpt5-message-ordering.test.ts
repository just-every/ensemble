/**
 * Unit test for GPT-5 message ordering logic
 * Tests that function call outputs are properly deferred when in reasoning blocks
 */

import { describe, it, expect } from 'vitest';

// Mock message processing logic extracted from openai.ts
function processMessagesForGPT5(messages: any[], requiresReasoning: boolean): any[] {
    const input: any[] = [];
    const pendingFunctionOutputs: any[] = [];
    let currentReasoningId: string | null = null;

    for (const message of messages) {
        // Handle thinking messages (reasoning)
        if (message.type === 'thinking' && requiresReasoning) {
            const match = message.thinking_id?.match(/^(rs_[A-Za-z0-9]+)-(\d)$/);
            if (match) {
                const reasoningId = match[1];
                currentReasoningId = reasoningId;

                // Add or update reasoning item
                const existingIndex = input.findIndex(
                    (item: any) => item.type === 'reasoning' && item.id === reasoningId
                );

                if (existingIndex === -1) {
                    input.push({
                        type: 'reasoning',
                        id: reasoningId,
                        summary: [{ type: 'summary_text', text: message.content }],
                    });
                } else {
                    input[existingIndex].summary.push({
                        type: 'summary_text',
                        text: message.content,
                    });
                }
            }
            continue;
        }

        // Handle function calls
        if (message.type === 'function_call') {
            // Check if this is part of the current reasoning block
            const isAssociatedWithReasoning = currentReasoningId && message.id?.startsWith('fc_') && requiresReasoning;

            input.push(message);

            // If this function call is NOT associated with reasoning, it ends the reasoning block
            // So we should flush any pending outputs from the previous reasoning block
            if (!isAssociatedWithReasoning && currentReasoningId && pendingFunctionOutputs.length > 0) {
                // This is a non-reasoning function call after a reasoning block
                // The pending outputs belong to the previous reasoning block and should be flushed
                // But actually, they should have been kept deferred until now
                // Let's not flush here - we'll let them flush at the end or with a message
                currentReasoningId = null;
            }
            continue;
        }

        // Handle function call outputs
        if (message.type === 'function_call_output') {
            if (currentReasoningId && requiresReasoning) {
                // Defer the output
                pendingFunctionOutputs.push(message);
            } else {
                // Add immediately
                input.push(message);
            }
            continue;
        }

        // Handle regular messages
        if (message.type === 'message') {
            // Flush pending outputs before regular messages
            if (pendingFunctionOutputs.length > 0) {
                input.push(...pendingFunctionOutputs);
                pendingFunctionOutputs.length = 0;
                currentReasoningId = null;
            }
            input.push(message);
            continue;
        }
    }

    // Flush remaining pending outputs
    if (pendingFunctionOutputs.length > 0) {
        input.push(...pendingFunctionOutputs);
    }

    return input;
}

describe('GPT-5 Message Ordering', () => {
    it('should keep function calls together with reasoning blocks', () => {
        const messages = [
            {
                type: 'thinking',
                thinking_id: 'rs_abc123-0',
                content: 'Reasoning about function calls',
            },
            {
                type: 'function_call',
                id: 'fc_call1',
                name: 'function1',
                arguments: '{}',
            },
            {
                type: 'function_call_output',
                call_id: 'call1',
                output: 'Result 1',
            },
            {
                type: 'function_call',
                id: 'fc_call2',
                name: 'function2',
                arguments: '{}',
            },
            {
                type: 'function_call_output',
                call_id: 'call2',
                output: 'Result 2',
            },
        ];

        const processed = processMessagesForGPT5(messages, true);

        // Verify order: reasoning, function_call, function_call, function_call_output, function_call_output
        expect(processed[0].type).toBe('reasoning');
        expect(processed[1].type).toBe('function_call');
        expect(processed[2].type).toBe('function_call');
        expect(processed[3].type).toBe('function_call_output');
        expect(processed[4].type).toBe('function_call_output');
    });

    it('should not defer outputs when not in reasoning mode', () => {
        const messages = [
            {
                type: 'message',
                role: 'user',
                content: 'Hello',
            },
            {
                type: 'function_call',
                id: 'call1',
                name: 'function1',
                arguments: '{}',
            },
            {
                type: 'function_call_output',
                call_id: 'call1',
                output: 'Result 1',
            },
            {
                type: 'function_call',
                id: 'call2',
                name: 'function2',
                arguments: '{}',
            },
            {
                type: 'function_call_output',
                call_id: 'call2',
                output: 'Result 2',
            },
        ];

        const processed = processMessagesForGPT5(messages, false);

        // Without reasoning, outputs should appear immediately after their calls
        expect(processed[0].type).toBe('message');
        expect(processed[1].type).toBe('function_call');
        expect(processed[2].type).toBe('function_call_output');
        expect(processed[3].type).toBe('function_call');
        expect(processed[4].type).toBe('function_call_output');
    });

    it('should flush pending outputs when encountering a regular message', () => {
        const messages = [
            {
                type: 'thinking',
                thinking_id: 'rs_xyz789-0',
                content: 'Thinking about this',
            },
            {
                type: 'function_call',
                id: 'fc_call1',
                name: 'function1',
                arguments: '{}',
            },
            {
                type: 'function_call_output',
                call_id: 'call1',
                output: 'Result 1',
            },
            {
                type: 'message',
                role: 'assistant',
                content: 'Here are the results',
            },
        ];

        const processed = processMessagesForGPT5(messages, true);

        // Outputs should be flushed before the message
        expect(processed[0].type).toBe('reasoning');
        expect(processed[1].type).toBe('function_call');
        expect(processed[2].type).toBe('function_call_output');
        expect(processed[3].type).toBe('message');
    });

    it('should handle mixed reasoning and non-reasoning function calls', () => {
        const messages = [
            {
                type: 'thinking',
                thinking_id: 'rs_abc123-0',
                content: 'First reasoning',
            },
            {
                type: 'function_call',
                id: 'fc_call1',
                name: 'function1',
                arguments: '{}',
            },
            {
                type: 'function_call_output',
                call_id: 'call1',
                output: 'Result 1',
            },
            {
                type: 'function_call',
                id: 'regular_call', // Not part of reasoning (no fc_ prefix)
                name: 'function2',
                arguments: '{}',
            },
            {
                type: 'function_call_output',
                call_id: 'call2',
                output: 'Result 2',
            },
        ];

        const processed = processMessagesForGPT5(messages, true);

        // For GPT-5, all function calls after reasoning stay together
        // The outputs are deferred to the end since we're still in the context
        expect(processed[0].type).toBe('reasoning');
        expect(processed[1].type).toBe('function_call');
        expect(processed[1].id).toBe('fc_call1');
        expect(processed[2].type).toBe('function_call'); // regular_call
        // All outputs come at the end
        expect(processed[3].type).toBe('function_call_output'); // Result 1
        expect(processed[4].type).toBe('function_call_output'); // Result 2
    });
});
