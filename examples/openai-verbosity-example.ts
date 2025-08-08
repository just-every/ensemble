/**
 * Example: Using OpenAI's verbosity and service_tier settings
 *
 * These settings allow you to control:
 * - verbosity: How detailed/concise the model's responses are
 * - service_tier: The processing priority for your requests
 */

import { ensembleRequest } from '../dist/core/ensemble_request.js';
import { AgentDefinition } from '../dist/types/types.js';

async function demonstrateVerbositySettings() {
    console.log('🎯 OpenAI Verbosity and Service Tier Settings Example\n');

    // Example 1: Low verbosity for concise responses
    console.log('1. Testing LOW verbosity (concise response):');
    const lowVerbosityAgent: AgentDefinition = {
        agent_id: 'concise-agent',
        modelSettings: {
            temperature: 0.7,
            verbosity: 'low', // Concise responses
            service_tier: 'default', // Standard processing
        },
    };

    const conciseResponse = await ensembleRequest(
        [
            {
                type: 'message',
                role: 'user',
                content: 'Explain what machine learning is.',
            },
        ],
        'gpt-4o',
        lowVerbosityAgent
    );
    console.log('Response:', conciseResponse.content);
    console.log('---\n');

    // Example 2: High verbosity for detailed responses
    console.log('2. Testing HIGH verbosity (detailed response):');
    const highVerbosityAgent: AgentDefinition = {
        agent_id: 'detailed-agent',
        modelSettings: {
            temperature: 0.7,
            verbosity: 'high', // Verbose, detailed responses
            service_tier: 'default',
        },
    };

    const detailedResponse = await ensembleRequest(
        [
            {
                type: 'message',
                role: 'user',
                content: 'Explain what machine learning is.',
            },
        ],
        'gpt-4o',
        highVerbosityAgent
    );
    console.log('Response:', detailedResponse.content);
    console.log('---\n');

    // Example 3: Priority service tier for faster processing
    console.log('3. Testing PRIORITY service tier:');
    const priorityAgent: AgentDefinition = {
        agent_id: 'priority-agent',
        modelSettings: {
            temperature: 0.5,
            verbosity: 'medium', // Default verbosity
            service_tier: 'priority', // Faster processing (requires special access)
        },
    };

    try {
        const priorityResponse = await ensembleRequest(
            [
                {
                    type: 'message',
                    role: 'user',
                    content: 'What is 2 + 2?',
                },
            ],
            'gpt-4o',
            priorityAgent
        );
        console.log('Response:', priorityResponse.content);
    } catch (error) {
        console.log('Note: Priority tier may require special access from OpenAI');
        console.log('Error:', error.message);
    }
    console.log('---\n');

    // Example 4: Combining settings for specific use cases
    console.log('4. Use case: Customer support bot (low verbosity, flex tier):');
    const supportBotAgent: AgentDefinition = {
        agent_id: 'support-bot',
        modelSettings: {
            temperature: 0.3, // Lower temperature for consistency
            verbosity: 'low', // Keep responses concise for customers
            service_tier: 'flex', // Flexible processing for cost optimization
            max_tokens: 150, // Limit response length
        },
    };

    const supportResponse = await ensembleRequest(
        [
            {
                type: 'message',
                role: 'user',
                content: 'How do I reset my password?',
            },
        ],
        'gpt-4o',
        supportBotAgent
    );
    console.log('Response:', supportResponse.content);
}

// Usage notes
console.log(`
📝 Usage Notes:

1. VERBOSITY Settings:
   - 'low': Concise, to-the-point responses
   - 'medium': Balanced detail (default)
   - 'high': Verbose, detailed responses

2. SERVICE_TIER Settings:
   - 'auto': Uses project default setting
   - 'default': Standard pricing and performance
   - 'flex': Flexible processing (may have variable latency)
   - 'priority': Faster processing (requires special access, contact OpenAI sales)

3. These settings are OpenAI-specific and will be ignored by other providers.

4. Combining verbosity with max_tokens gives you fine control over response length.

5. Service tiers affect processing speed and may have different pricing.
`);

// Run the example if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
    demonstrateVerbositySettings().catch(console.error);
}
