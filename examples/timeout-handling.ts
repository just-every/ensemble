/**
 * Timeout Handling Example
 * Demonstrates tool timeout and background execution tracking
 */

import {
    ensembleRequest,
    ToolFunction,
    runningToolTracker,
    FUNCTION_TIMEOUT_MS,
} from '../index.js';

// Define tools including status tracking
const tools: ToolFunction[] = [
    {
        definition: {
            type: 'function',
            function: {
                name: 'get_running_tools',
                description: 'Get list of currently running tools',
                parameters: {
                    type: 'object',
                    properties: {},
                    required: [],
                },
            },
        },
        function: async () => {
            const tools = runningToolTracker.getAllRunningTools();
            return JSON.stringify(
                tools.map(t => ({
                    id: t.id,
                    toolName: t.toolName,
                    duration: Date.now() - t.startTime,
                    timedOut: t.timedOut,
                })),
                null,
                2
            );
        },
    },
    {
        definition: {
            type: 'function',
            function: {
                name: 'wait_for_running_tool',
                description: 'Wait for a specific tool to complete',
                parameters: {
                    type: 'object',
                    properties: {
                        toolId: { type: 'string' },
                    },
                    required: ['toolId'],
                },
            },
        },
        function: async (toolId: string) => {
            console.log(`\n⏳ Waiting for tool ${toolId} to complete...`);
            const result = await runningToolTracker.waitForTool(toolId, 60000);
            if (result) {
                return `Tool completed: ${JSON.stringify(result)}`;
            }
            return 'Tool not found or already completed';
        },
    },
    {
        definition: {
            type: 'function',
            function: {
                name: 'long_running_task',
                description: 'A task that takes longer than the timeout',
                parameters: {
                    type: 'object',
                    properties: {
                        duration: {
                            type: 'number',
                            description: 'Duration in seconds',
                        },
                    },
                    required: ['duration'],
                },
            },
        },
        function: async (duration: number) => {
            console.log(`\n🐌 Starting long task (${duration}s)...`);
            const steps = duration;

            for (let i = 1; i <= steps; i++) {
                await new Promise(resolve => setTimeout(resolve, 1000));
                console.log(`   Step ${i}/${steps} completed`);
            }

            return `Long task completed after ${duration} seconds!`;
        },
    },
    {
        definition: {
            type: 'function',
            function: {
                name: 'quick_task',
                description: 'A quick task that completes before timeout',
                parameters: {
                    type: 'object',
                    properties: {
                        message: { type: 'string' },
                    },
                    required: ['message'],
                },
            },
        },
        function: async (message: string) => {
            console.log(`\n⚡ Running quick task...`);
            await new Promise(resolve => setTimeout(resolve, 1000));
            return `Quick task completed: ${message}`;
        },
    },
];

async function main() {
    console.log('=== TIMEOUT HANDLING DEMONSTRATION ===\n');
    console.log(
        `Default timeout: ${FUNCTION_TIMEOUT_MS}ms (${FUNCTION_TIMEOUT_MS / 1000}s)\n`
    );

    // Monitor background completions
    runningToolTracker.onCompletion(event => {
        console.log(`\n🔔 BACKGROUND COMPLETION EVENT:`);
        console.log(`   Tool: ${event.toolName}`);
        console.log(`   Duration: ${event.duration}ms`);
        console.log(`   Timed out: ${event.timedOut}`);
        console.log(`   Result: ${event.result || event.error}\n`);
    });

    const messages = [
        {
            type: 'message' as const,
            role: 'user' as const,
            content: `Please demonstrate timeout handling:
1. Run a quick task with message "I'm fast!"
2. Run a long task for 35 seconds (this will timeout)
3. Check what tools are running
4. Wait for the long task to complete in the background`,
        },
    ];

    const agent = {
        model: 'o4-mini',
        agent_id: 'timeout-demo',
        tools,
    };

    console.log('User:', messages[0].content);
    console.log('\n' + '='.repeat(60) + '\n');

    try {
        for await (const event of ensembleRequest(messages, agent)) {
            switch (event.type) {
                case 'message_delta':
                    process.stdout.write(event.content);
                    break;

                case 'tool_start':
                    console.log('🚀 Tool execution starting...\n');
                    break;

                case 'tool_done':
                    if (event.results) {
                        console.log('\n\n📊 Tool Results:');
                        event.results.forEach((result, i) => {
                            const lines = result.output.split('\n');
                            if (lines.length > 1) {
                                console.log(`\n${i + 1}. Multi-line result:`);
                                lines.forEach(line =>
                                    console.log(`   ${line}`)
                                );
                            } else {
                                console.log(`${i + 1}. ${result.output}`);
                            }
                        });
                        console.log('\nAssistant continues:\n');
                    }
                    break;
            }
        }

        console.log('\n\n' + '='.repeat(60));
        console.log(
            'Demo complete! Check the background completion events above.'
        );

        // Give some time for background tasks to complete
        console.log(
            '\nWaiting 10 seconds for any remaining background tasks...'
        );
        await new Promise(resolve => setTimeout(resolve, 10000));
    } catch (error) {
        console.error('Error:', error);
    } finally {
        // Clean up
        runningToolTracker.clear();
    }
}

main().catch(console.error);
