// Simple test of request functionality
// Run with: node test-request-with-tools.js

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
    console.log('Testing request...\n');
    
    try {
        const response = await request(
            'gpt-3.5-turbo', 
            [
                {
                    type: 'message',
                    role: 'user',
                    content: 'What is 25 plus 17?'
                }
            ],
            { 
                tools,
                modelSettings: {
                    temperature: 0
                }
            }
        );
        
        console.log('\nFinal response:', response);
    } catch (error) {
        console.error('Error:', error);
    }
}

test();