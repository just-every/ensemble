/* eslint-disable @typescript-eslint/no-unused-vars */
/**
 * Example: Retry Handling in Ensemble
 *
 * This example demonstrates how to configure and use the automatic retry
 * functionality for handling network errors and transient failures.
 */

import { ensembleRequest } from '../index.js';
import type { AgentDefinition } from '../types/types.js';

// Example 1: Basic retry configuration
async function basicRetryExample() {
    console.log('Example 1: Basic retry configuration');

    const messages = [
        {
            type: 'message' as const,
            role: 'user' as const,
            content: 'What is 2+2?',
        },
    ];

    const agent: AgentDefinition = {
        model: 'gpt-4.1-mini',
        retryOptions: {
            maxRetries: 5,
            initialDelay: 2000, // Start with 2 second delay
            onRetry: (error, attempt) => {
                console.log(`Retry attempt ${attempt} due to: ${error.message || error.code}`);
            },
        },
    };

    try {
        for await (const event of ensembleRequest(messages, agent)) {
            if (event.type === 'message_delta') {
                process.stdout.write(event.content);
            }
        }
        console.log('\n');
    } catch (error) {
        console.error('Request failed after all retries:', error);
    }
}

// Example 2: Aggressive retry for critical operations
async function aggressiveRetryExample() {
    console.log('\nExample 2: Aggressive retry for critical operations');

    const messages = [
        {
            type: 'message' as const,
            role: 'user' as const,
            content: 'Generate a critical report',
        },
    ];

    const agent: AgentDefinition = {
        model: 'claude-3-5-haiku-latest',
        retryOptions: {
            maxRetries: 10,
            initialDelay: 500,
            maxDelay: 60000, // Max 1 minute between retries
            backoffMultiplier: 1.5, // Less aggressive backoff
            onRetry: (error, attempt) => {
                console.log(`Critical operation retry ${attempt}/10: ${error.code || error.message}`);
            },
        },
    };

    try {
        let fullResponse = '';
        for await (const event of ensembleRequest(messages, agent)) {
            if (event.type === 'message_delta') {
                fullResponse += event.content;
            }
        }
        console.log('Critical report generated successfully');
    } catch (error) {
        console.error('CRITICAL: Failed to generate report after 10 attempts');
        // Send alert to operations team
    }
}

// Example 3: Custom retryable errors
async function customRetryableErrorsExample() {
    console.log('\nExample 3: Custom retryable errors');

    const messages = [
        {
            type: 'message' as const,
            role: 'user' as const,
            content: 'Process data batch',
        },
    ];

    const agent: AgentDefinition = {
        model: 'gemini-2.5-flash-latest',
        retryOptions: {
            maxRetries: 3,
            // Add custom error codes that should trigger retries
            additionalRetryableErrors: ['RATE_LIMIT_EXCEEDED', 'QUOTA_EXCEEDED', 'PROCESSING_ERROR'],
            // Add custom status codes
            additionalRetryableStatusCodes: [
                418, // I'm a teapot (custom error)
                509, // Bandwidth Limit Exceeded
            ],
            onRetry: (error, attempt) => {
                if (error.code === 'RATE_LIMIT_EXCEEDED') {
                    console.log(`Rate limited, waiting before retry ${attempt}...`);
                } else {
                    console.log(`Retrying due to ${error.code || error.status}`);
                }
            },
        },
    };

    try {
        for await (const event of ensembleRequest(messages, agent)) {
            if (event.type === 'message_complete') {
                console.log('Data batch processed successfully');
            }
        }
    } catch (error) {
        console.error('Failed to process batch:', error);
    }
}

// Example 4: Disable retries for fast-fail scenarios
async function disableRetriesExample() {
    console.log('\nExample 4: Disable retries for fast-fail scenarios');

    const messages = [
        {
            type: 'message' as const,
            role: 'user' as const,
            content: 'Quick check',
        },
    ];

    const agent: AgentDefinition = {
        model: 'gpt-4.1-mini',
        retryOptions: {
            maxRetries: 0, // Disable retries completely
        },
    };

    try {
        for await (const event of ensembleRequest(messages, agent)) {
            if (event.type === 'message_delta') {
                process.stdout.write(event.content);
            }
        }
    } catch (error) {
        console.error('Request failed immediately (no retries):', error);
    }
}

// Example 5: Monitoring retry patterns
async function monitoringExample() {
    console.log('\nExample 5: Monitoring retry patterns');

    // Track retry metrics
    const retryMetrics = {
        totalRetries: 0,
        errorCodes: new Map<string, number>(),
        retryDelays: [] as number[],
    };

    const messages = [
        {
            type: 'message' as const,
            role: 'user' as const,
            content: 'Analyze trends',
        },
    ];

    const agent: AgentDefinition = {
        model: 'claude-opus-4-20250514',
        retryOptions: {
            maxRetries: 5,
            onRetry: (error, attempt) => {
                retryMetrics.totalRetries++;

                const errorCode = error.code || error.status || 'UNKNOWN';
                retryMetrics.errorCodes.set(errorCode, (retryMetrics.errorCodes.get(errorCode) || 0) + 1);

                // Calculate actual delay for monitoring
                const delay = Math.pow(2, attempt - 1) * 1000;
                retryMetrics.retryDelays.push(delay);

                console.log(`Retry ${attempt}: ${errorCode} (waiting ${delay}ms)`);
            },
        },
    };

    try {
        for await (const event of ensembleRequest(messages, agent)) {
            if (event.type === 'message_complete') {
                console.log('Analysis complete');
            }
        }
    } finally {
        // Log metrics regardless of success/failure
        console.log('\nRetry Metrics:');
        console.log(`Total retries: ${retryMetrics.totalRetries}`);
        console.log('Error distribution:', Object.fromEntries(retryMetrics.errorCodes));
        console.log(
            `Average retry delay: ${
                retryMetrics.retryDelays.reduce((a, b) => a + b, 0) / retryMetrics.retryDelays.length || 0
            }ms`
        );
    }
}

// Example 6: Different retry strategies per provider
async function perProviderRetryExample() {
    console.log('\nExample 6: Different retry strategies per provider');

    const messages = [{ type: 'message' as const, role: 'user' as const, content: 'Hello' }];

    // More aggressive retries for stable providers
    const openAIAgent: AgentDefinition = {
        model: 'gpt-4',
        retryOptions: {
            maxRetries: 5,
            initialDelay: 1000,
        },
    };

    // Less aggressive for newer/beta providers
    const experimentalAgent: AgentDefinition = {
        model: 'experimental-model',
        retryOptions: {
            maxRetries: 2,
            initialDelay: 3000,
            maxDelay: 10000,
        },
    };

    // Custom handling for specific provider quirks
    const geminiAgent: AgentDefinition = {
        model: 'gemini-2.5-pro-latest',
        retryOptions: {
            maxRetries: 4,
            additionalRetryableErrors: ['Incomplete JSON segment'], // Gemini-specific
            onRetry: (error, attempt) => {
                if (error.message?.includes('Incomplete JSON')) {
                    console.log('Gemini JSON error, retrying with backoff...');
                }
            },
        },
    };

    console.log('Configured provider-specific retry strategies');
}

// Run examples
async function main() {
    console.log('Ensemble Retry Handling Examples\n');

    // Uncomment the examples you want to run:

    // await basicRetryExample();
    // await aggressiveRetryExample();
    // await customRetryableErrorsExample();
    // await disableRetriesExample();
    // await monitoringExample();
    // await perProviderRetryExample();

    console.log('\nNote: These examples demonstrate configuration.');
    console.log('Actual retries will only occur when network errors happen.');
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch(console.error);
}
