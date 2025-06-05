/**
 * Basic Request Example
 * Demonstrates a simple LLM request with streaming
 */

import { ensembleRequest } from '../index.js';

async function main() {
    const messages = [
        {
            type: 'message' as const,
            role: 'user' as const,
            content: 'Write a haiku about TypeScript'
        }
    ];

    const agent = {
        model: 'gpt-4o-mini',
        agent_id: 'haiku-writer'
    };

    console.log('Requesting haiku...\n');

    try {
        for await (const event of ensembleRequest(messages, agent)) {
            switch (event.type) {
                case 'message_start':
                    console.log('--- Message Start ---');
                    break;
                    
                case 'message_delta':
                    process.stdout.write(event.content);
                    break;
                    
                case 'message_complete':
                    console.log('\n--- Message Complete ---');
                    break;
                    
                case 'cost_update':
                    console.log(`\nTokens used: ${event.usage.total_tokens}`);
                    break;
            }
        }
    } catch (error) {
        console.error('Error:', error);
    }
}

main().catch(console.error);