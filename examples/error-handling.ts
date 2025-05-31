/**
 * Error Handling Example
 * 
 * Demonstrates robust error handling patterns for production use
 */

import { request, isRateLimitError, isAuthenticationError, ProviderError } from '../index.js';
import type { ResponseInput, RequestOptions } from '../types.js';

/**
 * Example 1: Basic error handling with retry logic
 */
async function basicErrorHandling() {
    console.log('=== Basic Error Handling ===\n');
    
    const messages: ResponseInput = [
        { type: 'message', role: 'user', content: 'Tell me about error handling' }
    ];
    
    try {
        for await (const event of request('gpt-4o', messages)) {
            if (event.type === 'error') {
                console.error('Stream error:', event.error.message);
                // You might want to break or handle differently based on error type
                break;
            } else if (event.type === 'text_delta') {
                process.stdout.write(event.delta);
            }
        }
    } catch (error) {
        console.error('\nRequest failed:', error);
        
        // Check error type and handle accordingly
        if (error instanceof ProviderError) {
            console.log(`Provider: ${error.provider}`);
            console.log(`Status: ${error.status}`);
        }
    }
}

/**
 * Example 2: Intelligent retry with exponential backoff
 */
async function retryWithBackoff(
    model: string, 
    messages: ResponseInput, 
    options?: RequestOptions,
    maxRetries = 3
) {
    console.log('\n=== Retry with Backoff ===\n');
    
    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            const events = [];
            for await (const event of request(model, messages, options)) {
                if (event.type === 'error') {
                    throw event.error;
                }
                events.push(event);
                
                if (event.type === 'text_delta') {
                    process.stdout.write(event.delta);
                }
            }
            
            // Success - return events
            return events;
            
        } catch (error) {
            console.error(`\nAttempt ${attempt + 1} failed:`, error.message);
            
            // Don't retry authentication errors
            if (isAuthenticationError(error)) {
                console.error('Authentication failed - check your API keys');
                throw error;
            }
            
            // Handle rate limits with proper wait time
            if (isRateLimitError(error)) {
                const waitTime = error.retryAfter || Math.pow(2, attempt) * 1000;
                console.log(`Rate limited. Waiting ${waitTime}ms before retry...`);
                await new Promise(resolve => setTimeout(resolve, waitTime));
                continue;
            }
            
            // For other errors, use exponential backoff
            if (attempt < maxRetries - 1) {
                const backoffTime = Math.pow(2, attempt) * 1000;
                console.log(`Waiting ${backoffTime}ms before retry...`);
                await new Promise(resolve => setTimeout(resolve, backoffTime));
            } else {
                throw error; // Final attempt failed
            }
        }
    }
}

/**
 * Example 3: Fallback chain with multiple models
 */
async function fallbackChain() {
    console.log('\n=== Fallback Chain ===\n');
    
    const messages: ResponseInput = [
        { type: 'message', role: 'user', content: 'Explain the concept of recursion' }
    ];
    
    // Models to try in order of preference
    const modelChain = [
        'gpt-4o',           // Primary choice
        'claude-3.5-sonnet', // First fallback
        'gemini-2.0-flash',  // Second fallback
        'gpt-3.5-turbo'     // Final fallback
    ];
    
    for (const model of modelChain) {
        try {
            console.log(`Trying ${model}...`);
            
            let success = false;
            for await (const event of request(model, messages)) {
                if (event.type === 'text_delta') {
                    if (!success) {
                        console.log(' ✓ Success!\n');
                        success = true;
                    }
                    process.stdout.write(event.delta);
                } else if (event.type === 'error') {
                    throw event.error;
                }
            }
            
            // If we got here, request succeeded
            console.log('\n');
            return;
            
        } catch (error) {
            console.log(` ✗ Failed: ${error.message}`);
            
            // If this was the last model, re-throw
            if (model === modelChain[modelChain.length - 1]) {
                throw new Error(`All models failed. Last error: ${error.message}`);
            }
        }
    }
}

/**
 * Example 4: Timeout handling
 */
async function timeoutHandling() {
    console.log('\n=== Timeout Handling ===\n');
    
    const messages: ResponseInput = [
        { type: 'message', role: 'user', content: 'Count to 1000 slowly' }
    ];
    
    const timeout = 5000; // 5 second timeout
    const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Request timeout')), timeout)
    );
    
    try {
        // Race between the request and timeout
        await Promise.race([
            (async () => {
                for await (const event of request('gpt-4o-mini', messages)) {
                    if (event.type === 'text_delta') {
                        process.stdout.write(event.delta);
                    }
                }
            })(),
            timeoutPromise
        ]);
    } catch (error) {
        if (error.message === 'Request timeout') {
            console.log('\n\n⏱️ Request timed out after 5 seconds');
        } else {
            throw error;
        }
    }
}

/**
 * Example 5: Graceful degradation
 */
async function gracefulDegradation() {
    console.log('\n=== Graceful Degradation ===\n');
    
    const messages: ResponseInput = [
        { type: 'message', role: 'user', content: 'Analyze this image: [image would go here]' }
    ];
    
    try {
        // Try with vision-capable model first
        console.log('Attempting with vision model...');
        for await (const event of request('gpt-4o', messages)) {
            if (event.type === 'text_delta') {
                process.stdout.write(event.delta);
            }
        }
    } catch (error) {
        console.log('\nVision model failed, degrading to text-only...\n');
        
        // Degrade to text-only version
        const textOnlyMessages: ResponseInput = [
            { 
                type: 'message', 
                role: 'user', 
                content: 'Please help me analyze an image (description not available)' 
            }
        ];
        
        for await (const event of request('gpt-3.5-turbo', textOnlyMessages)) {
            if (event.type === 'text_delta') {
                process.stdout.write(event.delta);
            }
        }
    }
}

// Main execution
async function main() {
    console.log('Ensemble Error Handling Examples\n');
    console.log('================================\n');
    
    try {
        await basicErrorHandling();
        await retryWithBackoff('gpt-4o-mini', [
            { type: 'message', role: 'user', content: 'Test retry logic' }
        ]);
        await fallbackChain();
        await timeoutHandling();
        await gracefulDegradation();
    } catch (error) {
        console.error('\nFatal error:', error);
        process.exit(1);
    }
}

if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch(console.error);
}