// Test OpenAI function calls to verify infinite loop is fixed
// This test will fail if OPENAI_API_KEY is not set

import { request } from './dist/index.js';

// Define a simple tool
const tools = [{
    function: async ({ x, y }) => {
        const result = x + y;
        console.log(`Tool called: ${x} + ${y} = ${result}`);
        return `The sum of ${x} and ${y} is ${result}`;
    },
    definition: {
        type: 'function',
        function: {
            name: 'add_numbers',
            description: 'Add two numbers together',
            parameters: {
                type: 'object',
                properties: {
                    x: { type: 'number', description: 'First number' },
                    y: { type: 'number', description: 'Second number' }
                },
                required: ['x', 'y']
            }
        }
    }
}];

async function test() {
    console.log('Testing OpenAI function calls...\n');
    
    try {
        let fullResponse = '';
        let eventCount = 0;
        const startTime = Date.now();
        
        for await (const event of request(
            'gpt-3.5-turbo', 
            [
                {
                    type: 'message',
                    role: 'user',
                    content: 'What is 25 plus 17? Please use the add_numbers function.'
                }
            ],
            { 
                tools,
                modelSettings: {
                    temperature: 0
                },
                maxToolCalls: 3  // Limit to prevent runaway in case of bug
            }
        )) {
            eventCount++;
            
            if (event.type === 'message_delta' && event.content) {
                fullResponse += event.content;
                process.stdout.write(event.content);
            } else if (event.type === 'tool_start') {
                console.log('\nTool call detected:', event.tool_calls);
            } else if (event.type === 'error') {
                console.error('\nError:', event.error);
            }
            
            // Safety check: if we get too many events, something is wrong
            if (eventCount > 1000) {
                console.error('\nERROR: Too many events, possible infinite loop!');
                break;
            }
        }
        
        const duration = Date.now() - startTime;
        console.log(`\n\nCompleted in ${duration}ms with ${eventCount} events`);
        console.log('Full response:', fullResponse);
        
        if (eventCount > 100) {
            console.warn('WARNING: High event count may indicate a problem');
        }
    } catch (error) {
        console.error('Error:', error);
    }
}

test();