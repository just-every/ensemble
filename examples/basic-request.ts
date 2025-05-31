/**
 * Basic LLM Request Example
 * 
 * This example demonstrates the fundamentals of making streaming requests
 * to LLMs using the ensemble module.
 * 
 * Key concepts covered:
 * - Creating properly typed message arrays
 * - Using AsyncGenerator pattern for streaming
 * - Handling different event types
 * - Basic error handling
 */

import { request } from '../index.js';
import type { ResponseInput, EnsembleStreamEvent } from '../types.js';

/**
 * Example 1: Simple question-answer request
 */
async function simpleRequest() {
    console.log('=== Example 1: Simple Q&A ===\n');
    
    // ResponseInput is an array of message objects
    // Each message has a type, role, and content
    const messages: ResponseInput = [
        {
            type: 'message',
            role: 'user',
            content: 'What is the capital of France?'
        }
    ];

    try {
        // request() returns an AsyncGenerator that yields events
        const stream = request('claude-3-5-sonnet-latest', messages);
        
        console.log('Assistant: ', '');
        
        // Use for-await-of to consume the stream
        for await (const event of stream) {
            switch (event.type) {
                case 'text_delta':
                    // Streaming text chunks - write immediately for real-time display
                    process.stdout.write(event.delta);
                    break;
                    
                case 'message_complete':
                    // Full message is available (useful for logging/storage)
                    console.log('\n\n[Complete message received]');
                    break;
                    
                case 'error':
                    // Error events are yielded, not thrown
                    console.error('\nStream error:', event.error);
                    break;
                    
                case 'cost_update':
                    // Track token usage and costs
                    console.log(`\n[Tokens: ${event.usage.input_tokens} in, ${event.usage.output_tokens} out]`);
                    break;
            }
        }
    } catch (error) {
        // This catches errors in stream creation, not stream events
        console.error('Failed to create request:', error);
    }
}

/**
 * Example 2: Multi-turn conversation
 */
async function conversationExample() {
    console.log('\n\n=== Example 2: Multi-turn Conversation ===\n');
    
    // Build a conversation with context
    const messages: ResponseInput = [
        {
            type: 'message',
            role: 'developer',  // System/developer message for context
            content: 'You are a helpful geography teacher. Be concise but informative.'
        },
        {
            type: 'message',
            role: 'user',
            content: 'What is the capital of France?'
        },
        {
            type: 'message',
            role: 'assistant',  // Previous assistant response
            content: 'The capital of France is Paris.'
        },
        {
            type: 'message',
            role: 'user',
            content: 'Tell me more about it.'
        }
    ];
    
    // Use a different model for variety
    const stream = request('gpt-4o-mini', messages);
    
    console.log('Assistant: ', '');
    for await (const event of stream) {
        if (event.type === 'text_delta') {
            process.stdout.write(event.delta);
        }
    }
}

/**
 * Example 3: Early stream termination
 */
async function earlyTerminationExample() {
    console.log('\n\n=== Example 3: Early Termination ===\n');
    
    const messages: ResponseInput = [
        {
            type: 'message',
            role: 'user',
            content: 'Count from 1 to 100, with each number on a new line.'
        }
    ];
    
    const stream = request('gpt-3.5-turbo', messages);
    
    console.log('Assistant (stopping at 10):\n');
    let lineCount = 0;
    
    for await (const event of stream) {
        if (event.type === 'text_delta') {
            process.stdout.write(event.delta);
            
            // Count newlines to stop early
            const newlines = (event.delta.match(/\n/g) || []).length;
            lineCount += newlines;
            
            if (lineCount >= 10) {
                console.log('\n\n[Stopped early]');
                break; // This properly cleans up the stream
            }
        }
    }
}

/**
 * Example 4: Collecting events for processing
 */
async function collectEventsExample() {
    console.log('\n\n=== Example 4: Event Collection ===\n');
    
    const messages: ResponseInput = [
        {
            type: 'message',
            role: 'user',
            content: 'Write a haiku about programming.'
        }
    ];
    
    // Sometimes you want to collect all events for post-processing
    const events: EnsembleStreamEvent[] = [];
    let fullText = '';
    
    const stream = request('claude-3-5-haiku-latest', messages);
    
    console.log('Collecting events...');
    for await (const event of stream) {
        events.push(event);
        
        if (event.type === 'text_delta') {
            fullText += event.delta;
        }
    }
    
    // Post-process collected events
    console.log(`\nCollected ${events.length} events`);
    console.log(`Event types: ${[...new Set(events.map(e => e.type))].join(', ')}`);
    console.log(`\nFull haiku:\n${fullText}`);
}

// Main function to run all examples
async function main() {
    console.log('Ensemble Basic Request Examples\n');
    console.log('===============================\n');
    
    try {
        await simpleRequest();
        await conversationExample();
        await earlyTerminationExample();
        await collectEventsExample();
        
        console.log('\n\nAll examples completed!');
    } catch (error) {
        console.error('\nFatal error:', error);
        process.exit(1);
    }
}

// Run the examples if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch(console.error);
}