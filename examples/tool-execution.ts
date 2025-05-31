/**
 * Example demonstrating automatic tool execution with streaming
 */

import { request, requestWithTools } from '../index.js';
import type { EnsembleStreamEvent } from '../types/extended_types.js';

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
    console.log('=== Tool Execution Example with Streaming ===\n');
    
    try {
        // Example 1: Single tool call with streaming
        console.log('Example 1: Weather query (streaming)');
        console.log('User: What\'s the weather like in Paris?');
        console.log('Assistant: ', '');
        
        for await (const event of request(
            'gpt-4o-mini',
            [
                {
                    type: 'message',
                    role: 'user',
                    content: 'What\'s the weather like in Paris?'
                }
            ],
            { tools }
        )) {
            if (event.type === 'text_delta') {
                process.stdout.write(event.delta);
            } else if (event.type === 'tool_start') {
                console.log('\n[Calling tool: ' + event.tool_calls?.[0]?.function.name + ']');
            }
        }
        console.log('\n\n---\n');
        
        // Example 2: Multiple tool calls
        console.log('Example 2: Travel planning query');
        console.log('User: I want to travel from New York to Tokyo. Can you check the weather in both cities and find me a flight?');
        console.log('Assistant: ', '');
        
        const events: EnsembleStreamEvent[] = [];
        for await (const event of request(
            'gpt-4o-mini',
            [
                {
                    type: 'message',
                    role: 'user',
                    content: 'I want to travel from New York to Tokyo. Can you check the weather in both cities and find me a flight?'
                }
            ],
            { tools }
        )) {
            events.push(event);
            if (event.type === 'text_delta') {
                process.stdout.write(event.delta);
            } else if (event.type === 'tool_start') {
                const toolNames = event.tool_calls?.map(tc => tc.function.name).join(', ');
                console.log(`\n[Calling tools: ${toolNames}]`);
            }
        }
        console.log('\n\n---\n');
        
        // Example 3: Using requestWithTools directly with custom handler
        console.log('Example 3: Custom tool handler');
        console.log('User: What\'s the weather in London?');
        console.log('Assistant: ', '');
        
        for await (const event of requestWithTools(
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
                    console.log('\n[Custom handler processing tools]');
                    
                    // Custom processing logic
                    return toolCalls.map(tc => {
                        if (tc.function.name === 'get_weather') {
                            return 'Weather data temporarily unavailable due to maintenance';
                        }
                        return 'Tool not handled by custom processor';
                    });
                }
            }
        )) {
            if (event.type === 'text_delta') {
                process.stdout.write(event.delta);
            }
        }
        console.log('\n\n---\n');
        
        // Example 4: Disabling tool execution
        console.log('Example 4: Tools provided but execution disabled');
        console.log('User: What\'s the weather in Paris?');
        console.log('Assistant: ', '');
        
        for await (const event of request(
            'gpt-4o-mini',
            [
                {
                    type: 'message',
                    role: 'user',
                    content: 'What\'s the weather in Paris?'
                }
            ],
            { 
                tools,
                executeTools: false // Tools are sent to model but not executed
            } as any
        )) {
            if (event.type === 'text_delta') {
                process.stdout.write(event.delta);
            } else if (event.type === 'tool_start') {
                console.log('\n[Tool requested but not executed: ' + event.tool_calls?.[0]?.function.name + ']');
            }
        }
        console.log('\n');
        
    } catch (error) {
        console.error('Error:', error);
    }
}

// Run the example
main().catch(console.error);