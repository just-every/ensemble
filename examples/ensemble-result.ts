import { ensembleRequest, ensembleResult, type AgentDefinition } from '../index.js';

async function example() {
    const messages = [
        {
            type: 'message' as const,
            role: 'user' as const,
            content: 'Tell me a joke',
        },
    ];

    const agent: AgentDefinition = {
        model: 'claude-3-haiku-20240307',
        modelSettings: {
            temperature: 0.7,
            max_tokens: 150,
        },
    };

    console.log('--- Using traditional streaming approach ---');
    for await (const event of ensembleRequest(messages, agent)) {
        switch (event.type) {
            case 'message_start':
                console.log('Message started');
                break;
            case 'message_delta':
                process.stdout.write(event.content);
                break;
            case 'message_complete':
                console.log('\nMessage complete');
                break;
            case 'cost_update':
                console.log(`Cost: ${event.usage.total_tokens} tokens`);
                break;
        }
    }

    console.log('\n\n--- Using ensembleResult approach ---');
    const stream = ensembleRequest(messages, agent);
    const result = await ensembleResult(stream);

    console.log('Result:', {
        message: result.message,
        cost: result.cost,
        completed: result.completed,
        duration: result.endTime ? result.endTime.getTime() - result.startTime.getTime() : 0,
        messageIds: Array.from(result.messageIds),
    });
}

// Example with tools
async function exampleWithTools() {
    const toolFunction = {
        function: async (a: number, b: number) => `${a} + ${b} = ${a + b}`,
        definition: {
            type: 'function' as const,
            function: {
                name: 'add',
                description: 'Add two numbers',
                parameters: {
                    type: 'object' as const,
                    properties: {
                        a: {
                            type: 'number' as const,
                            description: 'First number',
                        },
                        b: {
                            type: 'number' as const,
                            description: 'Second number',
                        },
                    },
                    required: ['a', 'b'],
                },
            },
        },
    };

    const messages = [
        {
            type: 'message' as const,
            role: 'user' as const,
            content: 'What is 5 + 3?',
        },
    ];

    const agent: AgentDefinition = {
        model: 'claude-3-haiku-20240307',
        tools: [toolFunction],
    };

    const stream = ensembleRequest(messages, agent);
    const result = await ensembleResult(stream);

    console.log('\n--- Tool Example Result ---');
    console.log('Message:', result.message);
    console.log('Tools called:', result.tools?.totalCalls || 0);
    if (result.tools) {
        result.tools.calls.forEach(call => {
            console.log(`  - ${call.toolCall.function.name}: ${call.output}`);
        });
    }
}

// Run examples
if (import.meta.url === `file://${process.argv[1]}`) {
    example()
        .then(() => exampleWithTools())
        .catch(console.error);
}
