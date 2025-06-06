/**
 * Tool Lifecycle Example
 * Demonstrates tool lifecycle callbacks (onToolCall, onToolResult, onToolError)
 */

import {
    ensembleRequest,
    ToolFunction,
    ToolCall,
    ToolCallResult,
    AgentDefinition,
} from '../index.js';

// Define tools with various behaviors
const tools: ToolFunction[] = [
    {
        definition: {
            type: 'function',
            function: {
                name: 'safe_operation',
                description: 'A safe operation that always succeeds',
                parameters: {
                    type: 'object',
                    properties: {
                        input: { type: 'string' },
                    },
                    required: ['input'],
                },
            },
        },
        function: async (input: string) => {
            await new Promise(resolve => setTimeout(resolve, 1000));
            return `Processed: ${input.toUpperCase()}`;
        },
    },
    {
        definition: {
            type: 'function',
            function: {
                name: 'risky_operation',
                description: 'An operation that might fail',
                parameters: {
                    type: 'object',
                    properties: {
                        shouldFail: { type: 'boolean' },
                    },
                    required: ['shouldFail'],
                },
            },
        },
        function: async (shouldFail: boolean) => {
            await new Promise(resolve => setTimeout(resolve, 500));
            if (shouldFail) {
                throw new Error('Risky operation failed as requested');
            }
            return 'Risky operation succeeded';
        },
    },
    {
        definition: {
            type: 'function',
            function: {
                name: 'restricted_operation',
                description: 'An operation that might be skipped',
                parameters: {
                    type: 'object',
                    properties: {
                        data: { type: 'string' },
                    },
                    required: ['data'],
                },
            },
        },
        function: async (data: string) => {
            return `Restricted operation processed: ${data}`;
        },
    },
    {
        definition: {
            type: 'function',
            function: {
                name: 'halt_everything',
                description: 'Halts all further tool execution',
                parameters: {
                    type: 'object',
                    properties: {},
                    required: [],
                },
            },
        },
        function: async () => {
            return 'This should halt everything';
        },
    },
];

// Track lifecycle events
const lifecycleLog: string[] = [];

function log(message: string) {
    const timestamp = new Date().toISOString().split('T')[1].slice(0, -1);
    const logMessage = `[${timestamp}] ${message}`;
    lifecycleLog.push(logMessage);
    console.log(logMessage);
}

async function main() {
    console.log('=== TOOL LIFECYCLE DEMONSTRATION ===\n');

    const agent: AgentDefinition = {
        model: 'o4-mini',
        agent_id: 'lifecycle-demo',
        tools,

        // Called before each tool execution
        onToolCall: async (toolCall: ToolCall) => {
            log(
                `📞 onToolCall: ${toolCall.function.name}(${toolCall.function.arguments})`
            );
        },

        // Called after successful tool execution
        onToolResult: async (result: ToolCallResult) => {
            log(
                `✅ onToolResult: ${result.toolCall.function.name} => ${result.output}`
            );

            // You could log to a database, send metrics, etc.
            if (result.output.length > 50) {
                log('  📊 Note: Large output detected');
            }
        },

        // Called when a tool fails
        onToolError: async (result: ToolCallResult) => {
            log(
                `❌ onToolError: ${result.toolCall.function.name} => ${result.output}`
            );

            // You could implement retry logic, alerting, etc.
            log('  🔄 Could implement retry logic here');
        },
    };

    const messages = [
        {
            type: 'message' as const,
            role: 'user' as const,
            content: `Please demonstrate tool lifecycle by:
1. Run safe_operation with input "hello world"
2. Run risky_operation with shouldFail=false
3. Run risky_operation with shouldFail=true
4. Run restricted_operation with data "public info"
5. Run restricted_operation with data "secret data"
6. Run halt_everything
7. Run safe_operation with input "this won't run"`,
        },
    ];

    console.log('User:', messages[0].content);
    console.log('\n' + '='.repeat(60) + '\n');
    console.log('LIFECYCLE EVENT LOG:\n');

    try {
        for await (const event of ensembleRequest(messages, agent)) {
            switch (event.type) {
                case 'message_delta':
                    // Don't output during lifecycle demo to keep it clean
                    break;

                case 'tool_done':
                    // Add spacing between tool rounds
                    console.log('');
                    break;
            }
        }

        console.log('\n' + '='.repeat(60) + '\n');
        console.log('SUMMARY OF LIFECYCLE EVENTS:\n');

        // Analyze the lifecycle log
        const skipped = lifecycleLog.filter(l => l.includes('SKIPPING')).length;
        const halted = lifecycleLog.filter(l => l.includes('HALTING')).length;
        const errors = lifecycleLog.filter(l =>
            l.includes('onToolError')
        ).length;
        const successes = lifecycleLog.filter(l =>
            l.includes('onToolResult')
        ).length;

        console.log(`📊 Lifecycle Statistics:`);
        console.log(
            `   - Tool calls initiated: ${lifecycleLog.filter(l => l.includes('onToolCall')).length}`
        );
        console.log(`   - Successful executions: ${successes}`);
        console.log(`   - Failed executions: ${errors}`);
        console.log(`   - Skipped tools: ${skipped}`);
        console.log(`   - Execution halted: ${halted > 0 ? 'Yes' : 'No'}`);

        console.log('\n📝 Key Observations:');
        console.log('   - Lifecycle callbacks provide fine-grained control');
        console.log('   - Tools can be skipped based on content');
        console.log('   - Execution can be halted mid-stream');
        console.log('   - Errors are handled gracefully');
    } catch (error) {
        console.error('Error:', error);
    }
}

main().catch(console.error);
