/**
 * Test script to verify tool_choice doesn't cause infinite loops
 */

import { request, tool } from '../index.js';

async function testToolChoiceFix() {
    console.log('Testing tool_choice fix...\n');
    
    // Create a simple tool
    const getCurrentTime = tool('get_current_time')
        .description('Get the current time')
        .implement(async () => {
            const now = new Date();
            return `Current time: ${now.toLocaleTimeString()}`;
        })
        .build();
    
    const messages = [
        {
            type: 'message' as const,
            role: 'user' as const,
            content: 'What time is it?'
        }
    ];
    
    console.log('Test 1: With tool_choice forcing function use');
    let eventCount = 0;
    let toolCallCount = 0;
    
    for await (const event of request('gpt-4o-mini', messages, {
        tools: [getCurrentTime],
        modelSettings: {
            tool_choice: { 
                type: 'function', 
                function: { name: 'get_current_time' } 
            }
        },
        maxToolCalls: 3  // Safety limit
    })) {
        eventCount++;
        
        if (event.type === 'tool_start') {
            toolCallCount++;
            console.log(`Tool called (${toolCallCount})`);
        }
        
        if (event.type === 'text_delta') {
            process.stdout.write(event.delta);
        }
        
        if (event.type === 'message_complete') {
            console.log('\n[Message complete]');
        }
        
        if (event.type === 'error') {
            console.error('Error:', event.error);
        }
    }
    
    console.log(`\nTotal events: ${eventCount}`);
    console.log(`Tool calls: ${toolCallCount}`);
    console.log('Expected: Tool should be called exactly once\n');
    
    // Test 2: Without tool_choice
    console.log('\nTest 2: Without tool_choice (normal behavior)');
    eventCount = 0;
    toolCallCount = 0;
    
    for await (const event of request('gpt-4o-mini', messages, {
        tools: [getCurrentTime],
        maxToolCalls: 3
    })) {
        eventCount++;
        
        if (event.type === 'tool_start') {
            toolCallCount++;
            console.log(`Tool called (${toolCallCount})`);
        }
        
        if (event.type === 'text_delta') {
            process.stdout.write(event.delta);
        }
        
        if (event.type === 'message_complete') {
            console.log('\n[Message complete]');
        }
    }
    
    console.log(`\nTotal events: ${eventCount}`);
    console.log(`Tool calls: ${toolCallCount}`);
}

// Run the test
testToolChoiceFix().catch(console.error);