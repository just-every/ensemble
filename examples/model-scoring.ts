/**
 * Example demonstrating model scoring and disabling functionality
 *
 * This example shows how to use modelScores for weighted random selection
 * and disabledModels to exclude specific models from selection.
 */

import { ensembleRequest, AgentDefinition } from '../index.js';

// Example 1: Using model scores for weighted selection
const scoredAgent: AgentDefinition = {
    name: 'Scored Agent',
    description: 'Agent with model scoring preferences',
    modelClass: 'standard',
    // Define custom scores for models (0-100)
    // Higher scores mean higher probability of selection
    // Score of 0 means the model will never be selected
    modelScores: {
        'gpt-4.1': 80, // 80 weight - strongly preferred
        'gemini-2.5-flash-preview-05-20-low': 60, // 60 weight
        'claude-3-5-haiku-latest': 40, // 40 weight
        'grok-3-mini-fast': 20, // 20 weight - least preferred
        'deepseek-chat': 0, // 0 weight - will never be selected
    },
    instructions:
        'You are a helpful assistant. When asked about which model you are, please state your model name.',
};

// Example 2: Disabling specific models
const restrictedAgent: AgentDefinition = {
    name: 'Restricted Agent',
    description: 'Agent with disabled models',
    modelClass: 'standard',
    // These models will never be selected
    disabledModels: [
        'deepseek-chat', // Completely disable DeepSeek
        'grok-3-mini-fast', // Completely disable Grok
    ],
    instructions: 'You are a helpful assistant with restricted model access.',
};

// Example 3: Combining scores and disabled models
const combinedAgent: AgentDefinition = {
    name: 'Combined Agent',
    description: 'Agent with both scoring and disabled models',
    modelClass: 'reasoning',
    modelScores: {
        'gemini-2.5-pro-preview-05-06': 90, // Strongly prefer Gemini Pro
        'o4-mini-high': 70, // Good alternative
        'claude-3-7-sonnet-latest': 50, // Medium preference
        'o3-high': 30, // Lower preference
    },
    disabledModels: [
        'claude-opus-4-20250514', // Disable expensive Opus model
        'claude-sonnet-4-20250514', // Disable another Claude model
    ],
    instructions:
        'You are an advanced reasoning assistant with model preferences.',
};

// Example usage
async function demonstrateModelScoring() {
    console.log('=== Model Scoring Example ===\n');

    // Test the scored agent multiple times to see weighted randomization
    console.log('Testing weighted model selection (5 runs):');
    for (let i = 0; i < 5; i++) {
        const response = await ensembleRequest({
            agent: scoredAgent,
            messages: [
                {
                    type: 'message',
                    role: 'user',
                    content:
                        'Which model are you? (Please just state the model name)',
                },
            ],
        });

        let modelUsed = '';
        for await (const event of response) {
            if (event.type === 'message_delta') {
                modelUsed += event.content;
            }
        }
        console.log(`Run ${i + 1}: Selected model based on weighted scores`);
    }

    console.log('\n=== Disabled Models Example ===\n');

    // Test the restricted agent
    const restrictedResponse = await ensembleRequest({
        agent: restrictedAgent,
        messages: [
            {
                type: 'message',
                role: 'user',
                content:
                    'Hello! Can you tell me about your model restrictions?',
            },
        ],
    });

    console.log(
        'Restricted agent response (will not use deepseek-chat or grok-3-mini-fast):'
    );
    for await (const event of restrictedResponse) {
        if (event.type === 'message_delta') {
            process.stdout.write(event.content);
        }
    }
    console.log('\n');
}

// Run the demonstration
if (import.meta.url === `file://${process.argv[1]}`) {
    demonstrateModelScoring().catch(console.error);
}

export { scoredAgent, restrictedAgent, combinedAgent };
