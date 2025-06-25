import { describe, it, expect } from 'vitest';
import { MessageHistory } from '../utils/message_history.js';
import {
    ResponseInputMessage,
    ResponseInputFunctionCall,
    ResponseInputFunctionCallOutput,
    ResponseOutputMessage,
} from '../types/types.js';

describe('Message Sequence Fix for Tool Calls', () => {
    it('should ensure tool results immediately follow tool calls', async () => {
        const history = new MessageHistory();

        // Add an assistant message with tool use
        const assistantMessage: ResponseOutputMessage = {
            type: 'message',
            role: 'assistant',
            content: 'Let me help you with that.',
            status: 'completed',
        };
        await history.add(assistantMessage);

        // Add a function call
        const functionCall: ResponseInputFunctionCall = {
            type: 'function_call',
            call_id: 'call_123',
            name: 'get_weather',
            arguments: '{"location": "San Francisco"}',
            status: 'completed',
        };
        await history.add(functionCall);

        // Add another assistant message (this is what causes the issue)
        const assistantMessage2: ResponseOutputMessage = {
            type: 'message',
            role: 'assistant',
            content: 'I found the weather information.',
            status: 'completed',
        };
        await history.add(assistantMessage2);

        // Add the function output
        const functionOutput: ResponseInputFunctionCallOutput = {
            type: 'function_call_output',
            call_id: 'call_123',
            name: 'get_weather',
            output: 'Sunny, 72°F',
            status: 'completed',
        };
        await history.add(functionOutput);

        // Get messages and verify the sequence
        const messages = await history.getMessages();

        // Find the function call
        const functionCallIndex = messages.findIndex(m => m.type === 'function_call' && m.call_id === 'call_123');

        expect(functionCallIndex).toBeGreaterThan(-1);

        // The next message should be the function_call_output
        const nextMessage = messages[functionCallIndex + 1];
        expect(nextMessage.type).toBe('function_call_output');
        expect(nextMessage.call_id).toBe('call_123');
    });

    it('should handle orphaned tool results', async () => {
        const history = new MessageHistory();

        // Add an orphaned function output (no matching function call)
        const functionOutput: ResponseInputFunctionCallOutput = {
            type: 'function_call_output',
            call_id: 'orphaned_call',
            name: 'some_tool',
            output: 'Some result',
            status: 'completed',
        };
        await history.add(functionOutput);

        // Get messages
        const messages = await history.getMessages();

        // The orphaned output should be converted to a regular message
        expect(messages.length).toBe(1);
        expect(messages[0].type).toBe('message');
        expect((messages[0] as ResponseInputMessage).role).toBe('user');
        expect((messages[0] as ResponseInputMessage).content).toContain('Tool result');
        expect((messages[0] as ResponseInputMessage).content).toContain('some_tool');
        expect((messages[0] as ResponseInputMessage).content).toContain('Some result');
    });

    it('should create error output for function calls without results', async () => {
        const history = new MessageHistory();

        // Add a function call without a corresponding output
        const functionCall: ResponseInputFunctionCall = {
            type: 'function_call',
            call_id: 'call_missing_output',
            name: 'missing_tool',
            arguments: '{}',
            status: 'completed',
        };
        await history.add(functionCall);

        // Get messages
        const messages = await history.getMessages();

        // Should have the function call followed by an error output
        expect(messages.length).toBe(2);
        expect(messages[0].type).toBe('function_call');
        expect(messages[1].type).toBe('function_call_output');
        expect(messages[1].call_id).toBe('call_missing_output');
        expect(messages[1].output).toContain('error');
        expect(messages[1].status).toBe('incomplete');
    });

    it('should handle multiple tool calls with interleaved messages correctly', async () => {
        const history = new MessageHistory();

        // Add first function call
        await history.add({
            type: 'function_call',
            call_id: 'call_1',
            name: 'tool_1',
            arguments: '{}',
            status: 'completed',
        } as ResponseInputFunctionCall);

        // Add assistant message
        await history.add({
            type: 'message',
            role: 'assistant',
            content: 'Processing first tool...',
            status: 'completed',
        } as ResponseOutputMessage);

        // Add second function call
        await history.add({
            type: 'function_call',
            call_id: 'call_2',
            name: 'tool_2',
            arguments: '{}',
            status: 'completed',
        } as ResponseInputFunctionCall);

        // Add outputs in reverse order
        await history.add({
            type: 'function_call_output',
            call_id: 'call_2',
            output: 'Result 2',
            status: 'completed',
        } as ResponseInputFunctionCallOutput);

        await history.add({
            type: 'function_call_output',
            call_id: 'call_1',
            output: 'Result 1',
            status: 'completed',
        } as ResponseInputFunctionCallOutput);

        // Get messages and verify sequencing
        const messages = await history.getMessages();

        // Find first function call and verify its output follows immediately
        const call1Index = messages.findIndex(m => m.type === 'function_call' && m.call_id === 'call_1');
        expect(messages[call1Index + 1].type).toBe('function_call_output');
        expect(messages[call1Index + 1].call_id).toBe('call_1');

        // Find second function call and verify its output follows immediately
        const call2Index = messages.findIndex(m => m.type === 'function_call' && m.call_id === 'call_2');
        expect(messages[call2Index + 1].type).toBe('function_call_output');
        expect(messages[call2Index + 1].call_id).toBe('call_2');
    });
});
