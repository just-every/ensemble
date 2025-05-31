/**
 * Example demonstrating automatic tool execution with requestWithTools
 */

import { requestWithTools } from '../index.js';

// Define some example tools
const tools = [
    {
        function: async ({ city }: { city: string }) => {
            // Simulate weather API call
            const weatherData = {
                'Paris': { temp: 72, condition: 'Sunny' },
                'London': { temp: 65, condition: 'Cloudy' },
                'Tokyo': { temp: 78, condition: 'Clear' },
                'New York': { temp: 68, condition: 'Partly Cloudy' },
            };
            
            const weather = weatherData[city as keyof typeof weatherData] || {
                temp: 70,
                condition: 'Unknown'
            };
            
            return `Weather in ${city}: ${weather.condition}, ${weather.temp}°F`;
        },
        definition: {
            type: 'function' as const,
            function: {
                name: 'get_weather',
                description: 'Get the current weather for a city',
                parameters: {
                    type: 'object' as const,
                    properties: {
                        city: {
                            type: 'string' as const,
                            description: 'The name of the city'
                        }
                    },
                    required: ['city']
                }
            }
        }
    },
    {
        function: async ({ from, to }: { from: string; to: string }) => {
            // Simulate flight search
            const price = Math.floor(Math.random() * 500) + 200;
            const duration = Math.floor(Math.random() * 8) + 2;
            
            return `Flight from ${from} to ${to}: $${price}, ${duration}h duration, next available tomorrow at 2:00 PM`;
        },
        definition: {
            type: 'function' as const,
            function: {
                name: 'search_flights',
                description: 'Search for flights between two cities',
                parameters: {
                    type: 'object' as const,
                    properties: {
                        from: {
                            type: 'string' as const,
                            description: 'Departure city'
                        },
                        to: {
                            type: 'string' as const,
                            description: 'Destination city'
                        }
                    },
                    required: ['from', 'to']
                }
            }
        }
    }
];

async function main() {
    console.log('=== Tool Execution Example ===\n');
    
    try {
        // Example 1: Single tool call
        console.log('Example 1: Weather query');
        const response1 = await requestWithTools(
            'gpt-4o-mini',
            [
                {
                    type: 'message',
                    role: 'user',
                    content: 'What\'s the weather like in Paris?'
                }
            ],
            { tools }
        );
        console.log('Response:', response1);
        console.log('\n---\n');
        
        // Example 2: Multiple tool calls
        console.log('Example 2: Travel planning query');
        const response2 = await requestWithTools(
            'gpt-4o-mini',
            [
                {
                    type: 'message',
                    role: 'user',
                    content: 'I want to travel from New York to Tokyo. Can you check the weather in both cities and find me a flight?'
                }
            ],
            { tools }
        );
        console.log('Response:', response2);
        console.log('\n---\n');
        
        // Example 3: Custom tool handler
        console.log('Example 3: Custom tool handler');
        const response3 = await requestWithTools(
            'gpt-4o-mini',
            [
                {
                    type: 'message',
                    role: 'user',
                    content: 'What\'s the weather in London?'
                }
            ],
            {
                tools,
                processToolCall: async (toolCalls) => {
                    console.log('Custom handler called with:', toolCalls.map(tc => ({
                        name: tc.function.name,
                        args: tc.function.arguments
                    })));
                    
                    // Custom processing logic
                    return toolCalls.map(tc => {
                        if (tc.function.name === 'get_weather') {
                            return 'Weather data temporarily unavailable';
                        }
                        return 'Tool not handled by custom processor';
                    });
                }
            }
        );
        console.log('Response:', response3);
        
    } catch (error) {
        console.error('Error:', error);
    }
}

// Run the example
main().catch(console.error);