/**
 * Example demonstrating Agent features:
 * - historyThread for separate conversation contexts
 * - maxToolCalls to limit total tool executions
 * - maxToolCallRoundsPerTurn to limit sequential rounds
 * - verifier for output validation
 */

import { Agent, ensembleRequest } from '../index.js';
import type { ResponseInput } from '../types/types.js';

// Mock file system tool
function createFileSystemTools() {
    const files = new Map<string, string>([
        ['readme.txt', 'This is a readme file'],
        ['data.json', '{"count": 42, "items": ["a", "b", "c"]}'],
    ]);

    return [
        {
            definition: {
                type: 'function' as const,
                function: {
                    name: 'list_files',
                    description: 'List all files',
                    parameters: {},
                },
            },
            function: async () => {
                console.log('🔧 Tool: list_files()');
                return Array.from(files.keys()).join('\n');
            },
        },
        {
            definition: {
                type: 'function' as const,
                function: {
                    name: 'read_file',
                    description: 'Read a file',
                    parameters: {
                        type: 'object',
                        properties: {
                            filename: { type: 'string' },
                        },
                        required: ['filename'],
                    },
                },
            },
            function: async ({ filename }: { filename: string }) => {
                console.log(`🔧 Tool: read_file("${filename}")`);
                return files.get(filename) || 'File not found';
            },
        },
        {
            definition: {
                type: 'function' as const,
                function: {
                    name: 'count_words',
                    description: 'Count words in text',
                    parameters: {
                        type: 'object',
                        properties: {
                            text: { type: 'string' },
                        },
                        required: ['text'],
                    },
                },
            },
            function: async ({ text }: { text: string }) => {
                console.log(`🔧 Tool: count_words("${text.substring(0, 20)}...")`);
                return `Word count: ${text.split(/\s+/).length}`;
            },
        },
    ];
}

async function main() {
    console.log('=== Agent Features Example ===\n');

    // Example 1: Tool Call Limits
    console.log('1. Testing maxToolCalls (limit: 3):');
    console.log('   Request: "List files, read each one, and count words in each"\n');

    const agent1 = new Agent({
        name: 'file_analyzer',
        maxToolCalls: 3, // Limit total tool calls
        tools: createFileSystemTools(),
        onToolCall: async toolCall => {
            console.log(`   → Executing: ${toolCall.function.name}`);
        },
    });

    const messages1: ResponseInput = [
        {
            type: 'message',
            role: 'user',
            content: 'List all files, then read each file and count words in each.',
        },
    ];

    const stream1 = ensembleRequest(messages1, agent1);
    const result1 = await convertStreamToMessages(stream1);
    console.log('\n   Result:', result1.fullResponse);
    console.log('\n' + '-'.repeat(60) + '\n');

    // Example 2: Round Limits
    console.log('2. Testing maxToolCallRoundsPerTurn (limit: 1):');
    console.log('   Request: Same as above but limited to 1 round\n');

    const agent2 = new Agent({
        name: 'limited_analyzer',
        maxToolCallRoundsPerTurn: 1, // Only 1 round of tool calls
        tools: createFileSystemTools(),
        onToolCall: async toolCall => {
            console.log(`   → Round 1: ${toolCall.function.name}`);
        },
    });

    const stream2 = ensembleRequest(messages1, agent2);
    const result2 = await convertStreamToMessages(stream2);
    console.log('\n   Result:', result2.fullResponse);
    console.log('\n' + '-'.repeat(60) + '\n');

    // Example 3: History Thread
    console.log('3. Testing historyThread (separate conversation context):');
    console.log('   Using a pre-existing conversation about files\n');

    const historyThread: ResponseInput = [
        {
            type: 'message',
            role: 'user',
            content: 'I need help analyzing some files.',
        },
        {
            type: 'message',
            role: 'assistant',
            content: 'I can help you analyze files. What would you like to know?',
        },
        {
            type: 'message',
            role: 'user',
            content: 'What files are available?',
        },
    ];

    const agent3 = new Agent({
        name: 'thread_analyzer',
        historyThread, // Use separate conversation context
        tools: createFileSystemTools(),
    });

    // This message won't be used - historyThread takes precedence
    const ignoredMessages: ResponseInput = [
        {
            type: 'message',
            role: 'user',
            content: 'This message will be ignored',
        },
    ];

    const stream3 = ensembleRequest(ignoredMessages, agent3);
    const result3 = await convertStreamToMessages(stream3);
    console.log('   Result:', result3.fullResponse);
    console.log('\n' + '-'.repeat(60) + '\n');

    // Example 4: Verifier
    console.log('4. Testing verifier (output validation):');
    console.log('   Request: "Count total words across all files"\n');

    const verifierAgent = {
        name: 'output_verifier',
        modelClass: 'mini' as const,
    };

    const agent4 = new Agent({
        name: 'verified_analyzer',
        tools: createFileSystemTools(),
        verifier: verifierAgent,
        maxVerificationAttempts: 2,
        onToolCall: async toolCall => {
            console.log(`   → Tool: ${toolCall.function.name}`);
        },
    });

    const messages4: ResponseInput = [
        {
            type: 'message',
            role: 'user',
            content: 'Count the total number of words across all files. Be specific about the count.',
        },
    ];

    console.log('   (Verifier will check if the response includes specific word counts)\n');

    const stream4 = ensembleRequest(messages4, agent4);
    const result4 = await convertStreamToMessages(stream4);
    console.log('\n   Final Result:', result4.fullResponse);
}

// Run the example
main().catch(console.error);
