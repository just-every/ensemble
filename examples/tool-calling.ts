/**
 * Tool Calling Example
 * Demonstrates basic tool definition and execution
 */

import { ensembleRequest, ToolFunction } from '../index.js';

// Define some example tools
const tools: ToolFunction[] = [
    {
        definition: {
            type: 'function',
            function: {
                name: 'get_weather',
                description: 'Get the current weather for a location',
                parameters: {
                    type: 'object',
                    properties: {
                        location: {
                            type: 'string',
                            description:
                                'City and state, e.g. San Francisco, CA',
                        },
                        unit: {
                            type: 'string',
                            enum: ['celsius', 'fahrenheit'],
                            description: 'Temperature unit',
                        },
                    },
                    required: ['location'],
                },
            },
        },
        function: async (location: string, unit: string = 'fahrenheit') => {
            // Simulate weather API call
            const temp = Math.floor(Math.random() * 30) + 50;
            const conditions = ['sunny', 'cloudy', 'rainy', 'partly cloudy'];
            const condition =
                conditions[Math.floor(Math.random() * conditions.length)];

            return JSON.stringify({
                location,
                temperature: temp,
                unit,
                condition,
                humidity: Math.floor(Math.random() * 40) + 40,
            });
        },
    },
    {
        definition: {
            type: 'function',
            function: {
                name: 'calculate',
                description: 'Perform basic mathematical calculations',
                parameters: {
                    type: 'object',
                    properties: {
                        expression: {
                            type: 'string',
                            description: 'Mathematical expression to evaluate',
                        },
                    },
                    required: ['expression'],
                },
            },
        },
        function: async (expression: string) => {
            try {
                // Simple evaluation (in production, use a proper math parser)
                const result = eval(expression);
                return `${expression} = ${result}`;
            } catch (error) {
                return `Error evaluating expression: ${error}`;
            }
        },
    },
];

async function main() {
    const messages = [
        {
            type: 'message' as const,
            role: 'user' as const,
            content:
                "What's the weather like in New York? Also, what's 25 * 4?",
        },
    ];

    const agent = {
        model: 'o4-mini',
        agent_id: 'assistant',
        tools,
    };

    console.log('User:', messages[0].content);
    console.log('\nAssistant:');

    try {
        for await (const event of ensembleRequest(messages, agent)) {
            switch (event.type) {
                case 'message_delta':
                    process.stdout.write(event.content);
                    break;

                case 'tool_start':
                    console.log('\n\n🔧 Tool calls:');
                    event.tool_calls.forEach(call => {
                        console.log(
                            `  - ${call.function.name}(${call.function.arguments})`
                        );
                    });
                    break;

                case 'tool_done':
                    if (event.results) {
                        console.log('\n📊 Tool results:');
                        event.results.forEach(result => {
                            console.log(`  - ${result.output}`);
                        });
                        console.log('\nContinuing...\n');
                    }
                    break;
            }
        }
        console.log('\n');
    } catch (error) {
        console.error('Error:', error);
    }
}

main().catch(console.error);
