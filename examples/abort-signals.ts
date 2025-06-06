/**
 * Abort Signals Example
 * Demonstrates graceful cancellation with abort signals
 */

import { ensembleRequest, ToolFunction, runningToolTracker } from '../index.js';

// Define tools that support abort signals
const tools: ToolFunction[] = [
    {
        definition: {
            type: 'function',
            function: {
                name: 'interruptible_download',
                description: 'Simulates a download that can be cancelled',
                parameters: {
                    type: 'object',
                    properties: {
                        url: { type: 'string' },
                        chunks: { type: 'number' },
                    },
                    required: ['url', 'chunks'],
                },
            },
        },
        function: async (url: string, chunks: number, signal?: AbortSignal) => {
            console.log(
                `\n📥 Starting download from ${url} (${chunks} chunks)`
            );

            for (let i = 1; i <= chunks; i++) {
                // Check if we should abort
                if (signal?.aborted) {
                    console.log(
                        `\n🛑 Download cancelled at chunk ${i}/${chunks}`
                    );
                    return `Download cancelled after ${i - 1} chunks`;
                }

                // Simulate chunk download
                await new Promise(resolve => setTimeout(resolve, 1000));
                console.log(`   Downloaded chunk ${i}/${chunks}`);
            }

            return `Successfully downloaded all ${chunks} chunks from ${url}`;
        },
        injectAbortSignal: true,
    },
    {
        definition: {
            type: 'function',
            function: {
                name: 'interruptible_analysis',
                description: 'Performs analysis that can be interrupted',
                parameters: {
                    type: 'object',
                    properties: {
                        data: { type: 'string' },
                        iterations: { type: 'number' },
                    },
                    required: ['data', 'iterations'],
                },
            },
        },
        function: async (
            data: string,
            iterations: number,
            signal?: AbortSignal
        ) => {
            console.log(
                `\n🔬 Starting analysis of "${data}" (${iterations} iterations)`
            );

            const results = [];
            for (let i = 1; i <= iterations; i++) {
                // Check abort signal
                if (signal?.aborted) {
                    console.log(
                        `\n🛑 Analysis interrupted at iteration ${i}/${iterations}`
                    );
                    return `Analysis interrupted. Partial results: ${results.join(', ')}`;
                }

                // Simulate analysis work
                await new Promise(resolve => setTimeout(resolve, 800));
                const result = `${data}-result-${i}`;
                results.push(result);
                console.log(`   Completed iteration ${i}: ${result}`);
            }

            return `Analysis complete. Results: ${results.join(', ')}`;
        },
        injectAbortSignal: true,
    },
    {
        definition: {
            type: 'function',
            function: {
                name: 'abort_running_tool',
                description: 'Aborts a running tool by ID',
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
            const tool = runningToolTracker.getRunningTool(toolId);
            if (!tool) {
                return `No running tool found with ID: ${toolId}`;
            }

            console.log(`\n🚫 Aborting tool: ${tool.toolName} (${toolId})`);
            runningToolTracker.abortRunningTool(toolId);

            return `Sent abort signal to ${tool.toolName}`;
        },
    },
    {
        definition: {
            type: 'function',
            function: {
                name: 'list_running_tools',
                description: 'Lists all currently running tools',
                parameters: {
                    type: 'object',
                    properties: {},
                    required: [],
                },
            },
        },
        function: async () => {
            const tools = runningToolTracker.getAllRunningTools();
            if (tools.length === 0) {
                return 'No tools currently running';
            }

            return tools
                .map(
                    t =>
                        `${t.id}: ${t.toolName} (running for ${Date.now() - t.startTime}ms)`
                )
                .join('\n');
        },
    },
];

async function main() {
    console.log('=== ABORT SIGNALS DEMONSTRATION ===\n');
    console.log('This demo shows how tools can be gracefully cancelled.\n');

    // Monitor tool completions
    runningToolTracker.onCompletion(event => {
        console.log(`\n🔔 Tool completed in background:`);
        console.log(`   ${event.toolName}: ${event.result || event.error}`);
    });

    const messages = [
        {
            type: 'message' as const,
            role: 'user' as const,
            content: `Please demonstrate abort signals:
1. Start a download with 10 chunks
2. Start an analysis with 8 iterations
3. After 3 seconds, list running tools
4. Abort the download (use the tool ID from the list)
5. Let the analysis complete
6. Show the final results`,
        },
    ];

    const agent = {
        model: 'o4-mini',
        agent_id: 'abort-demo',
        tools,
        modelSettings: {
            // Use sequential to make the demo clearer
            sequential_tools: false,
        },
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
                    console.log('🚀 Starting tools...\n');
                    break;

                case 'tool_done':
                    if (event.result) {
                        console.log('\n\n📊 Tool Results:', event.result);
                        console.log('\nAssistant continues:\n');
                    }
                    break;
            }
        }

        console.log('\n\n' + '='.repeat(60));
        console.log('Demo complete!');
        console.log('\nKey takeaways:');
        console.log('- Tools can check abort signals during execution');
        console.log('- Aborted tools can return partial results');
        console.log('- Clean cancellation without errors');
    } catch (error) {
        console.error('Error:', error);
    } finally {
        // Wait a bit for any final completions
        await new Promise(resolve => setTimeout(resolve, 2000));
        runningToolTracker.clear();
    }
}

main().catch(console.error);
