/**
 * Example: Improved Message History Compaction
 * 
 * This example demonstrates the new hybrid compaction system that better
 * preserves conversation context while managing token limits.
 */

import { MessageHistory } from '../utils/message_history.js';
import type { ResponseInput } from '../types/types.js';

async function demonstrateImprovedCompaction() {
    console.log('=== Improved Message History Compaction ===\n');
    
    // Create a message history with a small context model to trigger compaction
    const history = new MessageHistory([], {
        modelId: 'gemini-2.0-flash-exp', // Has 1M context, but we'll use a low threshold
        compactionThreshold: 0.1, // Compact at 10% to demonstrate quickly
    });
    
    // Add initial system message
    await history.add({
        type: 'message',
        role: 'system',
        content: 'You are a helpful coding assistant specializing in TypeScript.',
    });
    
    // Simulate a conversation about building a web app
    console.log('Adding conversation messages...\n');
    
    // User asks about project setup
    await history.add({
        type: 'message',
        role: 'user',
        content: 'I want to build a web app with React and TypeScript. What files do I need?',
    });
    
    await history.add({
        type: 'message',
        role: 'assistant',
        content: 'I\'ll help you set up a React TypeScript project. You\'ll need these essential files:\n\n' +
                '1. package.json - for dependencies\n' +
                '2. tsconfig.json - TypeScript configuration\n' +
                '3. src/index.tsx - entry point\n' +
                '4. public/index.html - HTML template\n\n' +
                'TODO: Create a proper project structure with components folder.',
    });
    
    // Important message - let's pin it
    await history.add({
        type: 'message',
        role: 'user',
        content: 'IMPORTANT: The app must work offline and sync when online. Use IndexedDB for storage.',
    });
    history.pinMessage(history.count() - 1); // Pin the last message
    
    // Add tool usage
    await history.add({
        type: 'function_call',
        call_id: 'call_001',
        name: 'create_file',
        arguments: JSON.stringify({ path: '/src/index.tsx', content: '...' }),
    });
    
    await history.add({
        type: 'function_call_output',
        call_id: 'call_001',
        output: 'File created successfully',
    });
    
    // Continue conversation with many messages to trigger compaction
    const topics = [
        'database schema design',
        'authentication implementation',
        'API endpoints',
        'error handling',
        'testing strategy',
        'deployment options',
    ];
    
    for (const topic of topics) {
        await history.add({
            type: 'message',
            role: 'user',
            content: `Can you explain the best practices for ${topic}?`,
        });
        
        await history.add({
            type: 'message',
            role: 'assistant',
            content: `For ${topic}, here are the key considerations:\n\n` +
                    `1. First principle: ${topic} should be modular\n` +
                    `2. Use industry standards\n` +
                    `3. Consider scalability\n\n` +
                    `The approach is to implement ${topic} incrementally.\n` +
                    `TODO: Research specific libraries for ${topic}.`,
        });
        
        // Add some tool calls
        await history.add({
            type: 'function_call',
            call_id: `call_${topic}`,
            name: 'search_documentation',
            arguments: JSON.stringify({ query: topic }),
        });
    }
    
    // Display current state
    console.log('\n=== Message History Status ===');
    console.log(`Total messages: ${history.count()}`);
    console.log(history.getSummary());
    
    // Show micro-log
    console.log('\n=== Micro-Log (Conversation Flow) ===');
    const microLog = history.getMicroLog();
    microLog.slice(-10).forEach(entry => {
        console.log(`- ${entry.role}: ${entry.summary}`);
    });
    
    // Show extracted information
    console.log('\n=== Extracted Information ===');
    const info = history.getExtractedInfo();
    
    console.log('\nKey Entities:');
    Array.from(info.entities).slice(-5).forEach(entity => {
        console.log(`  - ${entity}`);
    });
    
    console.log('\nDecisions Made:');
    info.decisions.slice(-3).forEach(decision => {
        console.log(`  - ${decision}`);
    });
    
    console.log('\nPending TODOs:');
    info.todos.slice(-3).forEach(todo => {
        console.log(`  - ${todo}`);
    });
    
    console.log('\nTools Used:');
    info.tools.forEach(tool => {
        console.log(`  - ${tool.name}: ${tool.purpose}`);
    });
    
    // Check if compaction occurred
    const messages = history.getMessages();
    const hasCompactionSummary = messages.some(m => 
        m.type === 'message' && 
        typeof m.content === 'string' &&
        m.content.includes('[Previous Conversation Summary]')
    );
    
    if (hasCompactionSummary) {
        console.log('\n=== Compaction Occurred ===');
        const summaryMsg = messages.find(m => 
            m.type === 'message' && 
            typeof m.content === 'string' &&
            m.content.includes('[Previous Conversation Summary]')
        );
        
        if (summaryMsg && typeof summaryMsg.content === 'string') {
            console.log('\nGenerated Summary:');
            console.log(summaryMsg.content);
        }
    }
    
    // Verify pinned message is preserved
    const pinnedMsg = messages.find(m => 
        m.type === 'message' && 
        typeof m.content === 'string' &&
        m.content.includes('IMPORTANT: The app must work offline')
    );
    
    console.log('\n=== Pinned Message Status ===');
    console.log(`Pinned message preserved: ${pinnedMsg ? 'Yes' : 'No'}`);
}

// Run the example
if (import.meta.url === `file://${process.argv[1]}`) {
    demonstrateImprovedCompaction().catch(console.error);
}

export { demonstrateImprovedCompaction };