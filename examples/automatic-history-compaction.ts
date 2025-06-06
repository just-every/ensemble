/**
 * Example: Automatic History Compaction
 *
 * This example demonstrates how ensemble automatically manages long conversation
 * histories by compacting older messages into summaries when approaching the
 * model's context limit.
 */

import {
    Agent,
    ensembleRequest,
    ResponseInput,
} from '../index.js';

async function runLongConversation() {
    console.log('🔄 Automatic History Compaction Example\n');

    // Create an agent with a specific model
    const agent = new Agent({
        name: 'ConversationAgent',
        model: 'gpt-4.1-mini', // Has 1M context, will compact at 700k tokens
        instructions: 'You are a helpful assistant engaged in a long conversation.',
    });

    // Initialize conversation history
    const conversationHistory: ResponseInput = [
        {
            type: 'message',
            role: 'system',
            content: 'You are a helpful assistant. Keep your responses concise.',
        },
    ];

    // Simulate a long conversation
    console.log('Starting long conversation that will trigger automatic compaction...\n');

    for (let i = 0; i < 100; i++) {
        // Add user message
        conversationHistory.push({
            type: 'message',
            role: 'user',
            content: `Question ${i + 1}: Tell me an interesting fact about the number ${i + 1}. Please provide a detailed explanation.`,
        });

        // Get assistant response
        const messages = [...conversationHistory];
        const stream = ensembleRequest(messages, agent);
        const result = await convertStreamToMessages(stream, messages, agent);

        // Add assistant response to history
        conversationHistory.push({
            type: 'message',
            role: 'assistant',
            content: result.fullResponse,
            status: 'completed',
        });

        // Show progress
        if ((i + 1) % 10 === 0) {
            console.log(`✓ Completed ${i + 1} Q&A exchanges`);
            console.log(`  Current history size: ${conversationHistory.length} messages`);

            // Estimate tokens (rough approximation)
            const totalChars = conversationHistory.reduce((sum, msg) => {
                if ('content' in msg && typeof msg.content === 'string') {
                    return sum + msg.content.length;
                }
                return sum;
            }, 0);
            const estimatedTokens = Math.ceil(totalChars / 4);
            console.log(`  Estimated tokens: ${estimatedTokens.toLocaleString()}\n`);
        }

        // For demo purposes, break after some iterations
        if (i >= 19) {
            console.log('Demo completed. In a real scenario, compaction would happen automatically when approaching context limits.\n');
            break;
        }
    }

    // Show a sample of the conversation
    console.log('Sample from conversation history:');
    console.log('First user message:', conversationHistory[1].content);
    console.log('Last user message:', conversationHistory[conversationHistory.length - 2].content);
    console.log('Last assistant response:', conversationHistory[conversationHistory.length - 1].content?.substring(0, 200) + '...\n');
}

async function demonstrateCompactionBehavior() {
    console.log('\n📊 Compaction Behavior Demonstration\n');

    // Create an agent with explicit history thread management
    const agent = new Agent({
        name: 'CompactionDemoAgent',
        model: 'gemini-2.5-flash-preview-05-20', // 1M context
        instructions: 'You are demonstrating automatic history compaction.',
        historyThread: [], // Start with empty history thread
    });

    console.log('Key features of automatic compaction:');
    console.log('1. Triggers at 70% of model\'s context limit');
    console.log('2. Preserves system messages');
    console.log('3. Keeps recent messages (last 30% of context)');
    console.log('4. Summarizes older messages using fast summary model');
    console.log('5. Maintains conversation continuity\n');

    // Show what happens during compaction
    console.log('When compaction occurs:');
    console.log('- Older messages are grouped and summarized');
    console.log('- Summary is added as a system message');
    console.log('- Recent messages are preserved in full');
    console.log('- Tool calls and outputs are included in summaries\n');

    // Example of a compacted history structure
    console.log('Example compacted history structure:');
    console.log('1. [System] Original instructions');
    console.log('2. [System] [Previous conversation summary]: ...');
    console.log('3. [User] Recent question');
    console.log('4. [Assistant] Recent response');
    console.log('5. [Tool Call] Recent tool usage');
    console.log('6. [Tool Output] Recent tool result');
    console.log('7. [User] Current question');
}

// Run the examples
async function main() {
    try {
        await runLongConversation();
        await demonstrateCompactionBehavior();

        console.log('\n✅ Automatic history compaction ensures:');
        console.log('- Conversations can continue indefinitely');
        console.log('- Context limits are respected');
        console.log('- Important information is preserved');
        console.log('- Performance remains optimal');

    } catch (error) {
        console.error('Error:', error);
    }
}

// Run the example
main().catch(console.error);