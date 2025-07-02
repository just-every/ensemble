/**
 * Model provider interface for the ensemble system.
 *
 * This module defines the ModelProvider interface and factory function
 * to get the appropriate provider implementation.
 */

import { ModelProvider as BaseModelProvider, EmbedOpts, AgentDefinition } from '../types/types.js';

// Re-export for backward compatibility
export type { EmbedOpts };

// Use the base ModelProvider interface for embedding and image generation support
export type ModelProvider = BaseModelProvider;

// Import external model functions
import {
    isExternalModel,
    getExternalModel,
    getExternalProvider,
    getModelClassOverride,
} from '../utils/external_models.js';

import { openaiProvider } from './openai.js';
import { claudeProvider } from './claude.js';
import { geminiProvider } from './gemini.js';
import { grokProvider } from './grok.js';
import { deepSeekProvider } from './deepseek.js';
import { testProvider } from './test_provider.js';
import { openRouterProvider } from './openrouter.js';
import { elevenLabsProvider } from './elevenlabs.js';
import { MODEL_CLASSES, ModelClassID, ModelProviderID } from '../data/model_data.js';

// Provider mapping by model prefix
const MODEL_PROVIDER_MAP: Record<string, ModelProvider> = {
    // OpenAI models
    'gpt-': openaiProvider,
    o1: openaiProvider,
    o3: openaiProvider,
    o4: openaiProvider,
    'text-': openaiProvider,
    'computer-use-preview': openaiProvider,
    'dall-e': openaiProvider, // Image generation models
    'gpt-image': openaiProvider, // GPT-Image-1 model
    'tts-': openaiProvider, // TTS models
    'codex-': openaiProvider, // Coding models

    // Claude/Anthropic models
    'claude-': claudeProvider,

    // Gemini/Google models
    'gemini-': geminiProvider,
    'imagen-': geminiProvider, // Image generation models

    // Grok/X.AI models
    'grok-': grokProvider,

    // DeepSeek models
    'deepseek-': deepSeekProvider,

    // ElevenLabs models
    eleven_: elevenLabsProvider,
    'elevenlabs-': elevenLabsProvider,

    // Test provider for testing
    'test-': testProvider,
};

/**
 * Check if an API key for a model provider exists and is valid
 */
export function isProviderKeyValid(provider: ModelProviderID): boolean {
    // Basic check to see if an API key exists with the expected format
    switch (provider) {
        case 'openai':
            return !!process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY.startsWith('sk-');
        case 'anthropic':
            return !!process.env.ANTHROPIC_API_KEY && process.env.ANTHROPIC_API_KEY.startsWith('sk-ant-');
        case 'google':
            return !!process.env.GOOGLE_API_KEY;
        case 'xai':
            return !!process.env.XAI_API_KEY && process.env.XAI_API_KEY.startsWith('xai-');
        case 'deepseek':
            return !!process.env.DEEPSEEK_API_KEY && process.env.DEEPSEEK_API_KEY.startsWith('sk-');
        case 'openrouter':
            return !!process.env.OPENROUTER_API_KEY;
        case 'elevenlabs':
            return !!process.env.ELEVENLABS_API_KEY;
        case 'test':
            return true; // Test provider is always valid
        default: {
            // Check if it's an external provider
            const externalProvider = getExternalProvider(provider);
            if (externalProvider) {
                return true; // External providers are assumed to be valid
            }
            return false;
        }
    }
}

/**
 * Get the provider name from a model name
 */
export function getProviderFromModel(model: string): ModelProviderID {
    // First check if it's an external model
    if (isExternalModel(model)) {
        const externalModel = getExternalModel(model);
        if (externalModel) {
            return externalModel.provider;
        }
    }

    if (
        model.startsWith('gpt-') ||
        model.startsWith('o1') ||
        model.startsWith('o3') ||
        model.startsWith('o4') ||
        model.startsWith('text-') ||
        model.startsWith('computer-use-preview') ||
        model.startsWith('dall-e') ||
        model.startsWith('gpt-image') ||
        model.startsWith('tts-')
    ) {
        return 'openai';
    } else if (model.startsWith('claude-')) {
        return 'anthropic';
    } else if (model.startsWith('gemini-') || model.startsWith('imagen-')) {
        return 'google';
    } else if (model.startsWith('grok-')) {
        return 'xai';
    } else if (model.startsWith('deepseek-')) {
        return 'deepseek';
    } else if (model.startsWith('eleven_') || model.startsWith('elevenlabs-')) {
        return 'elevenlabs';
    } else if (model.startsWith('test-')) {
        return 'test';
    }
    return 'openrouter'; // Default to OpenRouter if no specific provider found
}

/**
 * Filter models excluding specified models, with fallback to first excluded model if all are filtered out
 */
function filterModelsWithFallback(models: string[], excludeModels?: string[], disabledModels?: string[]): string[] {
    // Combine exclude and disabled models
    const allExcluded = [...(excludeModels || []), ...(disabledModels || [])];

    if (allExcluded.length === 0) {
        return models;
    }

    const originalModels = [...models];
    const filteredModels = models.filter(model => !allExcluded.includes(model));

    // If we ended up with no models after filtering, determine the next model in the cycle
    if (filteredModels.length === 0) {
        // Find the last used model from excludeModels that exists in originalModels
        const lastUsedModel = [...(excludeModels || [])]
            .reverse()
            .find(excludedModel => originalModels.includes(excludedModel));

        if (lastUsedModel) {
            // Find the next model in the cycle, skipping disabled models if possible
            let nextIndex = (originalModels.indexOf(lastUsedModel) + 1) % originalModels.length;
            let attempts = 0;
            while (attempts < originalModels.length) {
                const nextModel = originalModels[nextIndex];
                if (!disabledModels?.includes(nextModel)) {
                    return [nextModel];
                }
                nextIndex = (nextIndex + 1) % originalModels.length;
                attempts++;
            }
        }

        // If no valid last used model found, fall back to the first non-disabled model
        const firstNonDisabled = originalModels.find(m => !disabledModels?.includes(m));
        if (firstNonDisabled) {
            return [firstNonDisabled];
        }

        // Last resort: return first model even if disabled
        if (originalModels.length > 0) {
            return [originalModels[0]];
        }
    }

    return filteredModels;
}

/**
 * Select a model using weighted randomization based on scores
 */
function selectWeightedModel(models: string[], scores?: Record<string, number>): string {
    if (!scores || models.length === 0) {
        // No scores provided, fall back to random selection
        return models[Math.floor(Math.random() * models.length)];
    }

    // Calculate weights for each model, filtering out 0-weight models
    const modelWeights = models
        .map(model => ({
            model,
            weight: scores[model] !== undefined ? scores[model] : 50, // Default score of 50 if not specified
        }))
        .filter(m => m.weight > 0); // Filter out models with 0 or negative weights

    if (modelWeights.length === 0) {
        // All models have 0 weight, fall back to random selection from original list
        return models[Math.floor(Math.random() * models.length)];
    }

    // Calculate total weight
    const totalWeight = modelWeights.reduce((sum, m) => sum + m.weight, 0);

    if (totalWeight === 0) {
        // Shouldn't happen after filtering, but just in case
        return modelWeights[0].model;
    }

    // Select based on weighted random
    let random = Math.random() * totalWeight;
    for (const { model, weight } of modelWeights) {
        random -= weight;
        if (random <= 0) {
            return model;
        }
    }

    // Fallback (shouldn't happen)
    return modelWeights[0].model;
}

export async function getModelFromAgent(
    agent: AgentDefinition,
    defaultClass?: ModelClassID,
    excludeModels?: string[]
): Promise<string> {
    return (
        agent.model ||
        (await getModelFromClass(
            agent.modelClass || defaultClass,
            excludeModels,
            agent.disabledModels,
            agent.modelScores
        ))
    );
}

/**
 * Get a suitable model from a model class, with fallback
 */
export async function getModelFromClass(
    modelClass?: ModelClassID,
    excludeModels?: string[],
    disabledModels?: string[],
    modelScores?: Record<string, number>
): Promise<string> {
    // Simple quota tracker stub
    const { quotaTracker } = await import('../utils/quota_tracker.js');

    // Convert modelClass to a string to avoid TypeScript errors
    const modelClassStr = modelClass as string;

    // Default to standard class if none specified or if the class doesn't exist in MODEL_CLASSES
    const modelGroup = modelClassStr && modelClassStr in MODEL_CLASSES ? modelClassStr : 'standard';

    // Try each model in the group until we find one with a valid API key and quota
    if (modelGroup in MODEL_CLASSES) {
        // Check for class override first
        const override = getModelClassOverride(modelGroup);
        let modelClassConfig = MODEL_CLASSES[modelGroup as keyof typeof MODEL_CLASSES];

        // Apply override if it exists
        if (override) {
            modelClassConfig = {
                ...modelClassConfig,
                ...override,
            } as typeof modelClassConfig;
        }

        let models = [...(override?.models || modelClassConfig.models)];

        // Filter out excluded and disabled models
        models = filterModelsWithFallback(models, excludeModels, disabledModels);

        // Only access the random property if it exists
        const shouldRandomize = override?.random ?? ('random' in modelClassConfig && modelClassConfig.random);

        // Store the original order for weighted selection
        const validModels = [...models];

        // First pass: Try all models checking both API key and quota
        const modelsWithKeyAndQuota = validModels.filter(model => {
            const provider = getProviderFromModel(model);
            return isProviderKeyValid(provider) && quotaTracker.hasQuota(provider, model);
        });

        if (modelsWithKeyAndQuota.length > 0) {
            const selectedModel =
                shouldRandomize && !modelScores
                    ? modelsWithKeyAndQuota[Math.floor(Math.random() * modelsWithKeyAndQuota.length)]
                    : selectWeightedModel(modelsWithKeyAndQuota, modelScores);
            console.log(`Using '${selectedModel}' model for '${modelGroup}' class.`);
            return selectedModel;
        }

        // Second pass: If we couldn't find a model with quota, just check for API key
        // (This allows exceeding quota when necessary)
        const modelsWithKey = validModels.filter(model => {
            const provider = getProviderFromModel(model);
            return isProviderKeyValid(provider);
        });

        if (modelsWithKey.length > 0) {
            const selectedModel =
                shouldRandomize && !modelScores
                    ? modelsWithKey[Math.floor(Math.random() * modelsWithKey.length)]
                    : selectWeightedModel(modelsWithKey, modelScores);
            console.log(`Using '${selectedModel}' model for '${modelGroup}' class (may exceed quota).`);
            return selectedModel;
        }
    }

    // If we couldn't find a valid model in the specified class, try the standard class
    if (modelGroup !== 'standard' && 'standard' in MODEL_CLASSES) {
        // Use type assertion to tell TypeScript that 'standard' is a valid key
        let standardModels = MODEL_CLASSES['standard' as keyof typeof MODEL_CLASSES].models;

        // Filter out excluded and disabled models
        standardModels = filterModelsWithFallback(standardModels, excludeModels, disabledModels);

        // First check for models with both API key and quota
        const standardModelsWithKeyAndQuota = standardModels.filter(model => {
            const provider = getProviderFromModel(model);
            return isProviderKeyValid(provider) && quotaTracker.hasQuota(provider, model);
        });

        if (standardModelsWithKeyAndQuota.length > 0) {
            // Use weighted selection for fallback too
            const selectedModel = selectWeightedModel(standardModelsWithKeyAndQuota, modelScores);
            console.warn(`Falling back to 'standard' class with model '${selectedModel}'.`);
            return selectedModel;
        }

        // Then just check for API key
        const standardModelsWithKey = standardModels.filter(model => {
            const provider = getProviderFromModel(model);
            return isProviderKeyValid(provider);
        });

        if (standardModelsWithKey.length > 0) {
            const selectedModel = selectWeightedModel(standardModelsWithKey, modelScores);
            console.log(`Falling back to 'standard' class with model '${selectedModel}' (may exceed quota).`);
            return selectedModel;
        }
    }

    // Last resort: return first model in the class, even if we don't have a valid key
    // The provider will handle the error appropriately
    let defaultModel = 'gpt-4.1'; // Fallback if we can't get a model from the class

    // Check if the model group exists in MODEL_CLASSES before trying to access it
    if (modelGroup in MODEL_CLASSES) {
        const models = MODEL_CLASSES[modelGroup as keyof typeof MODEL_CLASSES].models;
        if (models.length > 0) {
            defaultModel = models[0];
        }
    }

    console.log(`No valid API key found for any model in class ${modelGroup}, using default: ${defaultModel}`);
    return defaultModel;
}

/**
 * Get the appropriate model provider based on the model name and class
 * with fallback to OpenRouter if direct provider access isn't available
 */
export function getModelProvider(model?: string): ModelProvider {
    // If no class override, use the model name to determine the provider
    if (model) {
        // First check if it's an external model
        if (isExternalModel(model)) {
            const externalModel = getExternalModel(model);
            if (externalModel) {
                const externalProvider = getExternalProvider(externalModel.provider);
                if (externalProvider) {
                    return externalProvider;
                }
            }
        }

        for (const [prefix, provider] of Object.entries(MODEL_PROVIDER_MAP)) {
            if (model.startsWith(prefix)) {
                const providerName = getProviderFromModel(model);
                if (!isProviderKeyValid(providerName)) {
                    throw new Error(
                        `API key for ${providerName} provider is missing or invalid. Please set ${providerName.toUpperCase()}_API_KEY environment variable.`
                    );
                }
                return provider;
            }
        }
    }

    // Default to openRouter if no specific provider found
    if (!isProviderKeyValid(getProviderFromModel('openrouter'))) {
        throw new Error(`No valid provider found for the model ${model}. Please check your API keys.`);
    }
    return openRouterProvider;
}

/**
 * Check if API keys are available for a given agent specification
 *
 * @param agent - Agent definition with model or modelClass
 * @returns Object with availability status and details
 *
 * @example
 * ```typescript
 * // Check specific model
 * const result = await canRunAgent({ model: 'gpt-4' });
 * if (result.canRun) {
 *   console.log(`Can run with model: ${result.model}`);
 * } else {
 *   console.log(`Missing API key for provider: ${result.missingProvider}`);
 * }
 *
 * // Check model class
 * const classResult = await canRunAgent({ modelClass: 'standard' });
 * if (classResult.canRun) {
 *   console.log(`Available models: ${classResult.availableModels.join(', ')}`);
 * }
 * ```
 */
export async function canRunAgent(agent: Partial<AgentDefinition>): Promise<{
    canRun: boolean;
    model?: string;
    provider?: ModelProviderID;
    missingProvider?: ModelProviderID;
    availableModels?: string[];
    unavailableModels?: string[];
    reason?: string;
}> {
    // If a specific model is provided
    if (agent.model) {
        const provider = getProviderFromModel(agent.model);
        const hasKey = isProviderKeyValid(provider);

        return {
            canRun: hasKey,
            model: agent.model,
            provider,
            missingProvider: hasKey ? undefined : provider,
            reason: hasKey ? undefined : `Missing API key for provider: ${provider}`,
        };
    }

    // If a model class is provided
    if (agent.modelClass) {
        const modelClassStr = agent.modelClass as string;
        const modelGroup = modelClassStr && modelClassStr in MODEL_CLASSES ? modelClassStr : 'standard';

        // Get the model class configuration
        const override = getModelClassOverride(modelGroup);
        let modelClassConfig = MODEL_CLASSES[modelGroup as keyof typeof MODEL_CLASSES];

        if (override) {
            modelClassConfig = {
                ...modelClassConfig,
                ...override,
            } as typeof modelClassConfig;
        }

        const models = [...(override?.models || modelClassConfig.models)];

        // Check each model's availability
        const availableModels: string[] = [];
        const unavailableModels: string[] = [];
        const missingProviders = new Set<ModelProviderID>();

        for (const model of models) {
            const provider = getProviderFromModel(model);
            if (isProviderKeyValid(provider)) {
                availableModels.push(model);
            } else {
                unavailableModels.push(model);
                missingProviders.add(provider);
            }
        }

        return {
            canRun: availableModels.length > 0,
            availableModels,
            unavailableModels,
            missingProvider:
                availableModels.length === 0 && missingProviders.size === 1
                    ? Array.from(missingProviders)[0]
                    : undefined,
            reason:
                availableModels.length === 0
                    ? `No API keys found for any models in class: ${agent.modelClass}. Missing providers: ${Array.from(missingProviders).join(', ')}`
                    : undefined,
        };
    }

    // If neither model nor modelClass is provided, check the default (standard class)
    return canRunAgent({ modelClass: 'standard' });
}
