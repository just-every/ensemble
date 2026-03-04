import { describe, expect, it, vi } from 'vitest';

import { GeminiProvider } from '../model_providers/gemini.js';

function makeSingleChunkStream(chunk: Record<string, unknown>) {
    return {
        async *[Symbol.asyncIterator]() {
            yield chunk;
        },
    };
}

describe('Gemini thought signatures for function calls', () => {
    it('replays tool-call thought signatures across grouped parallel function calls in history', async () => {
        const provider = new GeminiProvider('test-key');
        const generateContentStream = vi.fn().mockResolvedValue(
            makeSingleChunkStream({
                candidates: [
                    {
                        content: {
                            parts: [{ text: 'done' }],
                        },
                    },
                ],
                usageMetadata: {
                    promptTokenCount: 5,
                    candidatesTokenCount: 5,
                    totalTokenCount: 10,
                },
            })
        );

        (provider as any)._client = {
            models: {
                generateContentStream,
            },
        };

        const stream = provider.createResponseStream(
            [
                {
                    type: 'message',
                    role: 'user',
                    content: 'Do two tool calls.',
                },
                {
                    type: 'function_call',
                    call_id: 'call_1',
                    name: 'tool_a',
                    arguments: '{"city":"Paris"}',
                    thought_signature: 'sig-tool-step-1',
                },
                {
                    type: 'function_call',
                    call_id: 'call_2',
                    name: 'tool_b',
                    arguments: '{"city":"London"}',
                },
                {
                    type: 'function_call_output',
                    call_id: 'call_1',
                    name: 'tool_a',
                    output: '{"temp":"15C"}',
                },
                {
                    type: 'function_call_output',
                    call_id: 'call_2',
                    name: 'tool_b',
                    output: '{"temp":"12C"}',
                },
            ] as any,
            'gemini-3-flash-preview',
            { agent_id: 'test-gemini-signature-history' } as any,
            'req-history'
        );

        for await (const _event of stream) {
            // Drain stream.
        }

        const requestArg = generateContentStream.mock.calls.at(0)?.[0] as any;
        const modelMessages = (requestArg?.contents || []).filter(
            (message: any) => message.role === 'model' && Array.isArray(message.parts)
        );
        const functionCallMessages = modelMessages.filter((message: any) =>
            message.parts.some((part: any) => part.functionCall)
        );

        expect(functionCallMessages).toHaveLength(1);

        const toolParts = functionCallMessages[0].parts.filter((part: any) => part.functionCall);
        expect(toolParts).toHaveLength(2);
        expect(toolParts[0].thoughtSignature).toBe('sig-tool-step-1');
        expect(toolParts[1].thoughtSignature).toBe('sig-tool-step-1');
    });

    it('propagates chunk thought signatures across parallel tool_start events', async () => {
        const provider = new GeminiProvider('test-key');
        const generateContentStream = vi.fn().mockResolvedValue(
            makeSingleChunkStream({
                functionCalls: [
                    {
                        id: 'fc_1',
                        name: 'finalize_draft_output',
                        args: { artifact_id: 'art_1' },
                    },
                    {
                        id: 'fc_2',
                        name: 'search_inspiration_library',
                        args: { query: 'minimal logos' },
                    },
                ],
                candidates: [
                    {
                        content: {
                            parts: [
                                {
                                    functionCall: {
                                        name: 'finalize_draft_output',
                                        args: { artifact_id: 'art_1' },
                                    },
                                    thoughtSignature: 'sig-tool-step',
                                },
                                {
                                    functionCall: {
                                        name: 'search_inspiration_library',
                                        args: { query: 'minimal logos' },
                                    },
                                },
                                {
                                    text: 'thinking...',
                                    thought: true,
                                    thoughtSignature: 'sig-thinking-final',
                                },
                                {
                                    text: 'final response',
                                },
                            ],
                        },
                    },
                ],
                usageMetadata: {
                    promptTokenCount: 10,
                    candidatesTokenCount: 10,
                    totalTokenCount: 20,
                },
            })
        );

        (provider as any)._client = {
            models: {
                generateContentStream,
            },
        };

        const events: any[] = [];
        const stream = provider.createResponseStream(
            [
                {
                    type: 'message',
                    role: 'user',
                    content: 'Generate and finalize.',
                },
            ] as any,
            'gemini-3-flash-preview',
            { agent_id: 'test-gemini-signature-stream' } as any,
            'req-stream'
        );

        for await (const event of stream) {
            events.push(event);
        }

        const toolStartEvents = events.filter(event => event.type === 'tool_start');
        expect(toolStartEvents).toHaveLength(2);
        expect(toolStartEvents[0].tool_call.thought_signature).toBe('sig-tool-step');
        expect(toolStartEvents[1].tool_call.thought_signature).toBe('sig-tool-step');

        const messageComplete = events.find(event => event.type === 'message_complete');
        expect(messageComplete).toBeTruthy();
        expect(messageComplete.thinking_signature).toBe('sig-thinking-final');
    });
});
