/**
 * Example: Using Perplexity models through OpenRouter
 *
 * Prerequisites:
 * 1. Set OPENROUTER_API_KEY in your .env file
 * 2. Your OpenRouter API key should start with 'sk-or-'
 */

import * as dotenv from 'dotenv';
import { ensembleRequest } from '@just-every/ensemble';

// Load environment variables
dotenv.config();

async function perplexityExample() {
    // Check if API key is available
    if (!process.env.OPENROUTER_API_KEY) {
        console.error(
            'Error: OPENROUTER_API_KEY not found in environment variables'
        );
        console.error(
            'Please add OPENROUTER_API_KEY=sk-or-your-key to your .env file'
        );
        return;
    }

    console.log('Using Perplexity Sonar model through OpenRouter...\n');

    const messages = [
        {
            type: 'message' as const,
            role: 'user' as const,
            content:
                'What are the latest developments in quantum computing? Please provide a brief summary.',
        },
    ];

    // Use any Perplexity model available through OpenRouter
    const agent = {
        model: 'perplexity/sonar', // or 'perplexity/sonar-pro', 'perplexity/sonar-reasoning'
    };

    try {
        for await (const event of ensembleRequest(messages, agent)) {
            switch (event.type) {
                case 'message_delta':
                    process.stdout.write(event.content);
                    break;
                case 'error':
                    console.error('\nError:', event.error);
                    break;
                case 'cost_update':
                    // Perplexity models report usage
                    console.log('\n\nToken usage:', event.usage);
                    break;
            }
        }

        console.log('\n\nRequest completed successfully!');
    } catch (error) {
        console.error('Failed to complete request:', error);
    }
}

// Run the example
perplexityExample().catch(console.error);
