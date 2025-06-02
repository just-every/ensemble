/**
 * Examples using the simplified API and new utilities
 */

import {
    request,
    tool,
    createControlTools,
    MessageHistory,
    EnsembleErrorHandler,
    ErrorCode
} from '../index.js';

// Example 1: Using the fluent tool builder
console.log('--- Example 1: Fluent Tool Builder ---');

const weatherTool = tool('get_weather')
    .description('Get the current weather for a location')
    .string('location', 'The city and state/country')
    .enum('units', ['celsius', 'fahrenheit'], 'Temperature units', false)
    .implement(async ({ location, units = 'celsius' }) => {
        // Simulated weather API call
        const temp = units === 'celsius' ? 22 : 72;
        return `Current weather in ${location}: Sunny, ${temp}°${units[0].toUpperCase()}`;
    })
    .build();

const calculatorTool = tool('calculate')
    .description('Perform mathematical calculations')
    .string('expression', 'Mathematical expression to evaluate')
    .boolean('show_steps', 'Show calculation steps', false)
    .hasSideEffects() // Mark as having side effects
    .implement(async ({ expression, show_steps }) => {
        try {
            // Note: In production, use a proper math parser
            const result = eval(expression);
            if (show_steps) {
                return `${expression} = ${result}\n(Direct evaluation)`;
            }
            return result.toString();
        } catch (error) {
            return `Error: Invalid expression`;
        }
    })
    .build();

// Example 2: Using control tools
console.log('\n--- Example 2: Control Tools ---');

const controlTools = createControlTools({
    onComplete: (result) => {
        console.log('Task completed:', result);
    },
    onError: (error) => {
        console.error('Task error:', error);
    },
    onClarification: (question, options) => {
        console.log('Clarification needed:', question);
        if (options) {
            console.log('Options:', options);
        }
    }
});

// Example 3: Using unified request with message history
console.log('\n--- Example 3: Unified Request with Message History ---');

async function unifiedRequestExample() {
    // Create a message history manager
    const history = new MessageHistory([], {
        maxMessages: 50,
        preserveSystemMessages: true,
        compactToolCalls: true
    });
    
    // Add initial messages
    history.add({
        type: 'message',
        role: 'system',
        content: 'You are a helpful assistant with access to weather and calculation tools.'
    });
    
    history.add({
        type: 'message',
        role: 'user',
        content: 'What\'s the weather in Paris, and what\'s 15 celsius in fahrenheit?'
    });
    
    // Use unified request
    try {
        for await (const event of request('gpt-4o-mini', history.getMessages(), {
            tools: [weatherTool, calculatorTool],
            messageHistory: history,
            useEnhancedMode: true,
            debug: true
        })) {
            if (event.type === 'text_delta') {
                process.stdout.write(event.delta);
            } else if (event.type === 'tool_start') {
                console.log('\n[Tool called]');
            } else if (event.type === 'system_update' && 'data' in event && event.data.type === 'metrics') {
                console.log('\n[Metrics]', event.data.summary);
            }
        }
    } catch (error) {
        console.error('Request failed:', error);
    }
    
    // Show conversation summary
    console.log('\n[History Summary]', history.getSummary());
}

// Example 4: Error handling with retry
console.log('\n--- Example 4: Error Handling with Retry ---');

async function errorHandlingExample() {
    const operation = async () => {
        // Simulate a flaky API call
        if (Math.random() < 0.7) {
            throw EnsembleErrorHandler.createError(
                ErrorCode.PROVIDER_RATE_LIMIT,
                'Rate limit exceeded',
                { retryAfter: 1000 },
                true
            );
        }
        return 'Success!';
    };
    
    try {
        const result = await EnsembleErrorHandler.handleWithRetry(
            operation,
            3, // max retries
            (error) => error.code === ErrorCode.PROVIDER_RATE_LIMIT
        );
        console.log('Operation succeeded:', result);
    } catch (error) {
        console.error('Operation failed after retries:', 
            EnsembleErrorHandler.getUserMessage(error)
        );
    }
}

// Example 5: Using MessageHistory to prevent infinite loops
console.log('\n--- Example 5: Preventing Infinite Loops ---');

async function preventLoopsExample() {
    const history = new MessageHistory();
    
    // Tool that might cause loops
    const echoTool = tool('echo')
        .description('Echo back the input')
        .string('message', 'Message to echo')
        .implement(async ({ message }) => {
            return `Echo: ${message}`;
        })
        .build();
    
    history.add({
        type: 'message',
        role: 'user',
        content: 'Echo "hello" three times'
    });
    
    let loopCount = 0;
    const maxLoops = 5;
    
    try {
        while (loopCount < maxLoops) {
            for await (const event of request('gpt-4o-mini', history.getMessages(), {
                tools: [echoTool],
                maxToolCalls: 1
            })) {
                if (event.type === 'text_delta') {
                    process.stdout.write(event.delta);
                } else if (event.type === 'message_complete' && 'content' in event) {
                    // Check if we're getting repetitive responses
                    const lastAssistant = history.findLast(m => 
                        m.type === 'message' && m.role === 'assistant'
                    );
                    
                    if (lastAssistant && lastAssistant.content === event.content) {
                        console.log('\n[Loop detected - stopping]');
                        loopCount = maxLoops;
                        break;
                    }
                }
            }
            
            loopCount++;
            
            // Check if we should continue
            if (!history.lastAssistantHadToolCalls()) {
                break;
            }
        }
    } catch (error) {
        console.error('Error:', error);
    }
}

// Run examples
async function runExamples() {
    console.log('=== Simplified API Examples ===\n');
    
    // Run async examples
    await unifiedRequestExample();
    await errorHandlingExample();
    await preventLoopsExample();
}

// Only run if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
    runExamples().catch(console.error);
}