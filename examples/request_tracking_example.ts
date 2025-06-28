/**
 * Example demonstrating request tracking with request_id, duration, and cost
 */
import { ensembleAgentHandler } from '../ensemble.js';
import { ProviderStreamEvent } from '../types/types.js';

async function main() {
    console.log('=== Request Tracking Example ===\n');

    // Agent configuration with a tool to demonstrate cost tracking
    const agent = {
        name: 'example-agent',
        model: 'gpt-3.5-turbo',
        modelSettings: {
            temperature: 0.7,
            max_tokens: 100,
        },
        tools: [
            {
                function: async (query: string) => {
                    console.log(`[Tool] Searching for: ${query}`);
                    return `Found information about ${query}`;
                },
                definition: {
                    type: 'function' as const,
                    function: {
                        name: 'search',
                        description: 'Search for information',
                        parameters: {
                            type: 'object' as const,
                            properties: {
                                query: {
                                    type: 'string',
                                    description: 'Search query',
                                },
                            },
                            required: ['query'],
                        },
                    },
                },
            },
        ],
    };

    // Track events
    const events: ProviderStreamEvent[] = [];
    let requestId: string | undefined;

    // Execute request with event tracking
    const stream = ensembleAgentHandler(
        { request: 'Search for information about request tracking in ensemble' },
        agent
    );

    for await (const event of stream) {
        events.push(event);

        // Display key events
        switch (event.type) {
            case 'agent_start':
                requestId = event.request_id;
                console.log(`[Agent Start] Request ID: ${requestId}`);
                console.log(`[Agent Start] Input: ${event.input}\n`);
                break;

            case 'cost_update':
                console.log(
                    `[Cost Update] Tokens: ${event.usage?.totalTokens}, Cost: $${event.usage?.totalCost?.toFixed(4) || '0.0000'}`
                );
                break;

            case 'agent_done':
                console.log(`\n[Agent Done] Request ID: ${event.request_id}`);
                console.log(`[Agent Done] Duration: ${event.duration}ms`);
                console.log(`[Agent Done] Total Cost: $${event.cost?.toFixed(4) || '0.0000'}`);
                break;

            case 'message_delta':
                process.stdout.write(event.content || '');
                break;

            case 'message_complete':
                console.log('\n');
                break;
        }
    }

    // Verify request ID consistency
    const agentStartEvent = events.find(e => e.type === 'agent_start');
    const agentDoneEvent = events.find(e => e.type === 'agent_done');

    if (agentStartEvent && agentDoneEvent) {
        console.log('\n=== Request Tracking Summary ===');
        console.log(`Request ID matches: ${agentStartEvent.request_id === agentDoneEvent.request_id}`);
        console.log(`Duration tracked: ${agentDoneEvent.duration !== undefined}`);
        console.log(`Cost tracked: ${agentDoneEvent.cost !== undefined}`);
    }
}

// Run the example
main().catch(console.error);
