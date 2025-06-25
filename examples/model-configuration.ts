/**
 * Example: Configuring Model Classes in Ensemble
 *
 * This example demonstrates how to customize model class configurations
 * to control which models are used for different purposes.
 */

import {
    getModelClass,
    setModelClassModels,
    addModelToClass,
    removeModelFromClass,
    setModelClassRandom,
    overrideModelClass,
    getAllModelClasses,
    updateModelClasses,
    ensembleRequest,
    Agent,
} from '@just-every/ensemble';

// Example 1: View current model class configuration
console.log('Current "standard" class models:');
const standardClass = getModelClass('standard');
console.log(standardClass);

// Example 2: Override an entire model class
// Use only specific models for coding tasks
overrideModelClass('code', {
    models: ['claude-opus-4-20250514-medium', 'codex-mini-latest', 'o3-medium'],
    random: true, // Randomly select between these models
});

// Example 3: Add a new model to an existing class
// Add GPT-4.5 to the standard class if you have access
addModelToClass('standard', 'gpt-4.5-preview');

// Example 4: Remove a model from a class
// Remove a model that's experiencing issues
removeModelFromClass('standard', 'deepseek-chat');

// Example 5: Control random selection
// Always use the first model in the list for reasoning
setModelClassRandom('reasoning', false);

// Example 6: Set specific models for a class
// Use only fast models for the mini class
setModelClassModels('mini', ['gpt-4.1-nano', 'claude-3-5-haiku-latest', 'gemini-2.0-flash-lite'], true); // Keep random selection

// Example 7: Bulk update multiple classes
updateModelClasses({
    // Use only the best models for reasoning
    reasoning: {
        models: ['o3-high', 'claude-opus-4-20250514-max', 'gemini-2.5-pro-preview-06-05'],
        random: true,
    },
    // Use fastest models for summaries
    summary: {
        models: ['gpt-4.1-mini', 'gemini-2.5-flash-preview-05-20-low'],
        random: true,
    },
});

// Example 8: View all current configurations
console.log('\nAll model class configurations:');
const allClasses = getAllModelClasses();
for (const [className, config] of Object.entries(allClasses)) {
    console.log(`${className}: ${config.models.length} models, random: ${config.random}`);
}

// Example 9: Use with an agent
// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function _example() {
    const codeAgent = new Agent({
        name: 'Code Assistant',
        modelClass: 'code', // Will use our customized code class
        instructions: 'You are an expert programmer.',
    });

    // The agent will use one of the models from our customized 'code' class
    const response = await ensembleRequest(
        [{ role: 'user', content: 'Write a hello world function in Python' }],
        codeAgent
    );

    for await (const event of response) {
        if (event.type === 'message_delta') {
            process.stdout.write(event.content);
        }
    }
}

// Example 10: Environment-specific configuration
// Different models for development vs production
if (process.env.NODE_ENV === 'production') {
    // Use stable, proven models in production
    updateModelClasses({
        standard: {
            models: ['gpt-4.1', 'claude-3-5-haiku-latest'],
            random: false, // Use first available model for consistency
        },
    });
} else {
    // Experiment with newer models in development
    updateModelClasses({
        standard: {
            models: ['gpt-4.5-preview', 'claude-sonnet-4-20250514', 'gemini-2.5-pro-preview-06-05'],
            random: true, // Test different models
        },
    });
}
