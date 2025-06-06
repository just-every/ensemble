/**
 * Parallel Tools Example
 * Demonstrates multiple tools executing in parallel
 */

import { ensembleRequest, ToolFunction } from '../index.js';

// Define tools that simulate different processing times
const tools: ToolFunction[] = [
    {
        definition: {
            type: 'function',
            function: {
                name: 'slow_api_call',
                description: 'Simulates a slow API call',
                parameters: {
                    type: 'object',
                    properties: {
                        endpoint: { type: 'string' },
                    },
                    required: ['endpoint'],
                },
            },
        },
        function: async (endpoint: string) => {
            console.log(`\n⏳ Starting slow API call to ${endpoint}...`);
            const startTime = Date.now();

            // Simulate slow API
            await new Promise(resolve => setTimeout(resolve, 3000));

            const duration = Date.now() - startTime;
            console.log(
                `✅ Slow API call to ${endpoint} completed in ${duration}ms`
            );

            return `Data from ${endpoint} (took ${duration}ms)`;
        },
    },
    {
        definition: {
            type: 'function',
            function: {
                name: 'fast_calculation',
                description: 'Performs a fast calculation',
                parameters: {
                    type: 'object',
                    properties: {
                        numbers: {
                            type: 'array',
                            items: { type: 'number' },
                        },
                    },
                    required: ['numbers'],
                },
            },
        },
        function: async (numbers: number[]) => {
            console.log(`\n⚡ Starting fast calculation with ${numbers}...`);
            const startTime = Date.now();

            // Simulate fast calculation
            await new Promise(resolve => setTimeout(resolve, 500));

            const sum = numbers.reduce((a, b) => a + b, 0);
            const duration = Date.now() - startTime;
            console.log(`✅ Fast calculation completed in ${duration}ms`);

            return `Sum: ${sum} (took ${duration}ms)`;
        },
    },
    {
        definition: {
            type: 'function',
            function: {
                name: 'medium_task',
                description: 'A medium duration task',
                parameters: {
                    type: 'object',
                    properties: {
                        taskName: { type: 'string' },
                    },
                    required: ['taskName'],
                },
            },
        },
        function: async (taskName: string) => {
            console.log(`\n🔄 Starting medium task: ${taskName}...`);
            const startTime = Date.now();

            // Simulate medium task
            await new Promise(resolve => setTimeout(resolve, 1500));

            const duration = Date.now() - startTime;
            console.log(
                `✅ Medium task ${taskName} completed in ${duration}ms`
            );

            return `Task ${taskName} result (took ${duration}ms)`;
        },
    },
];

async function main() {
    const messages = [
        {
            type: 'message' as const,
            role: 'user' as const,
            content: `Please do the following tasks:
1. Call the slow API endpoint "/users"
2. Calculate the sum of [10, 20, 30, 40]
3. Run a medium task called "data_processing"

These should run in parallel.`,
        },
    ];

    const agent = {
        model: 'o4-mini',
        agent_id: 'parallel-executor',
        tools,
    };

    console.log('User:', messages[0].content);
    console.log('\n' + '='.repeat(60) + '\n');

    const overallStart = Date.now();

    try {
        for await (const event of ensembleRequest(messages, agent)) {
            switch (event.type) {
                case 'message_delta':
                    process.stdout.write(event.content);
                    break;

                case 'tool_start':
                    console.log('🚀 Starting parallel tool execution...');
                    console.log(
                        `   Tools to execute: ${event.tool_calls.length}`
                    );
                    event.tool_calls.forEach((call, i) => {
                        console.log(`   ${i + 1}. ${call.function.name}`);
                    });
                    console.log('\n--- Parallel Execution Log ---');
                    break;

                case 'tool_done': {
                    const totalDuration = Date.now() - overallStart;
                    console.log('\n--- Execution Complete ---');
                    console.log(
                        `\n⏱️  Total time for all tools: ${totalDuration}ms`
                    );
                    console.log(
                        '   (Note: Tools ran in parallel, not sequentially)\n'
                    );

                    if (event.result) {
                        console.log('📊 Results:', event.result);
                    }
                    console.log('\n' + '='.repeat(60) + '\n');
                    console.log('Assistant continues:\n');
                    break;
                }
            }
        }
        console.log('\n');
    } catch (error) {
        console.error('Error:', error);
    }
}

main().catch(console.error);
