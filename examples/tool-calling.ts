/**
 * Tool Calling Example
 * 
 * This example shows how to use tools (function calling) with LLMs.
 * It demonstrates both manual tool definition and using createToolFunction.
 */

import { request, createToolFunction } from '../index.js';
import type { ResponseInput, ToolFunction } from '../types.js';

// Method 1: Manual tool definition (traditional way)
const calculatorToolManual: ToolFunction = {
    function: async (args: any) => {
        const { operation, a, b } = args;
        switch (operation) {
            case 'add': return String(a + b);
            case 'subtract': return String(a - b);
            case 'multiply': return String(a * b);
            case 'divide': return b !== 0 ? String(a / b) : 'Error: Division by zero';
            default: return 'Error: Unknown operation';
        }
    },
    definition: {
        type: 'function',
        function: {
            name: 'calculator',
            description: 'Perform basic arithmetic operations',
            parameters: {
                type: 'object',
                properties: {
                    operation: {
                        type: 'string',
                        enum: ['add', 'subtract', 'multiply', 'divide'],
                        description: 'The arithmetic operation to perform'
                    },
                    a: {
                        type: 'number',
                        description: 'First number'
                    },
                    b: {
                        type: 'number',
                        description: 'Second number'
                    }
                },
                required: ['operation', 'a', 'b']
            }
        }
    }
};

// Method 2: Using createToolFunction (simpler and type-safe)
const weatherTool = createToolFunction(
    async (city: string, unit = 'celsius') => {
        // Simulate weather API call
        const temps = { celsius: 22, fahrenheit: 72 };
        const temp = unit === 'celsius' ? temps.celsius : temps.fahrenheit;
        return `The weather in ${city} is ${temp}°${unit === 'celsius' ? 'C' : 'F'} and sunny`;
    },
    'Get the current weather for a city',
    {
        city: 'The city to get weather for',
        unit: {
            type: 'string',
            description: 'Temperature unit',
            enum: ['celsius', 'fahrenheit'],
            optional: true
        }
    }
);

// Method 3: Even simpler - let createToolFunction infer everything
const getTimeTool = createToolFunction(
    async () => {
        const now = new Date();
        return `Current time: ${now.toLocaleTimeString()} on ${now.toDateString()}`;
    },
    'Get the current date and time'
);

// Method 4: Complex example with multiple parameter types
const searchTool = createToolFunction(
    async (query: string, limit = 10, includeMetadata = false, categories = []) => {
        // Simulate search
        const results = [];
        for (let i = 1; i <= limit; i++) {
            const result = {
                title: `Result ${i} for "${query}"`,
                url: `https://example.com/result${i}`,
                ...(includeMetadata && { 
                    metadata: { 
                        relevance: Math.random(), 
                        category: categories[0] || 'general' 
                    } 
                })
            };
            results.push(result);
        }
        return JSON.stringify(results, null, 2);
    },
    'Search for information on the web',
    {
        query: 'The search query',
        limit: {
            type: 'number',
            description: 'Maximum number of results to return',
            optional: true
        },
        includeMetadata: {
            type: 'boolean',
            description: 'Whether to include metadata in results',
            optional: true
        },
        categories: {
            type: 'array',
            description: 'Categories to filter by',
            items: { type: 'string' },
            optional: true
        }
    },
    'JSON array of search results'
);

async function main() {
    console.log('=== Tool Calling Examples ===\n');
    
    // Example 1: Using the manual calculator tool
    console.log('1. Calculator Example (Manual Tool Definition)');
    const calcMessages: ResponseInput = [
        {
            type: 'message',
            role: 'user',
            content: 'What is 15 multiplied by 7?'
        }
    ];

    const calcStream = request('gpt-4o-mini', calcMessages, {
        tools: [calculatorToolManual],
        maxToolCalls: 1
    });

    for await (const event of calcStream) {
        if (event.type === 'text_delta') {
            process.stdout.write(event.delta);
        } else if (event.type === 'tool_result') {
            console.log('\n📊 Tool result:', event.result);
        }
    }
    
    console.log('\n\n' + '='.repeat(50) + '\n');
    
    // Example 2: Using multiple tools created with createToolFunction
    console.log('2. Multi-Tool Example (Using createToolFunction)');
    const multiToolMessages: ResponseInput = [
        {
            type: 'message',
            role: 'user',
            content: 'What\'s the weather in Paris and what time is it there? Also search for "Paris attractions" and limit to 3 results.'
        }
    ];

    const multiToolStream = request('gpt-4o', multiToolMessages, {
        tools: [weatherTool, getTimeTool, searchTool],
        maxToolCalls: 10  // Allow multiple tool calls
    });

    console.log('Assistant response:\n');
    for await (const event of multiToolStream) {
        if (event.type === 'text_delta') {
            process.stdout.write(event.delta);
        } else if (event.type === 'tool_start') {
            console.log(`\n🔧 Calling tool: ${event.tool_calls[0].function.name}`);
        } else if (event.type === 'tool_result') {
            console.log(`📊 Result: ${event.result}\n`);
        }
    }
    
    console.log('\n\n' + '='.repeat(50) + '\n');
    
    // Example 3: Demonstrating tool parameter inference
    console.log('3. Parameter Inference Example');
    
    // Create a tool on the fly with automatic parameter inference
    const dateTool = createToolFunction(
        async (days = 0, format = 'short') => {
            const date = new Date();
            date.setDate(date.getDate() + days);
            
            if (format === 'short') {
                return date.toLocaleDateString();
            } else {
                return date.toLocaleString('en-US', { 
                    weekday: 'long', 
                    year: 'numeric', 
                    month: 'long', 
                    day: 'numeric' 
                });
            }
        },
        'Get a date relative to today',
        {
            days: {
                type: 'number',
                description: 'Number of days from today (negative for past)',
                optional: true
            },
            format: {
                type: 'string',
                description: 'Date format',
                enum: ['short', 'long'],
                optional: true
            }
        }
    );
    
    const dateMessages: ResponseInput = [
        {
            type: 'message',
            role: 'user',
            content: 'What date was it 7 days ago? Use the long format.'
        }
    ];

    const dateStream = request('claude-3.5-haiku', dateMessages, {
        tools: [dateTool]
    });

    for await (const event of dateStream) {
        if (event.type === 'text_delta') {
            process.stdout.write(event.delta);
        }
    }
    
    console.log('\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch(console.error);
}