/**
 * External model registration system for ensemble.
 * Allows external code to register custom model providers without modifying ensemble's core.
 */

import { ModelEntry, ModelProvider, ModelProviderID, ModelClass } from '../types/types.js';

// Map of external models that have been registered
const externalModels = new Map<string, ModelEntry>();

// Map of external providers that have been registered
const externalProviders = new Map<ModelProviderID, ModelProvider>();

// Map of model class overrides
const modelClassOverrides = new Map<string, Partial<ModelClass>>();

/**
 * Register an external model with ensemble
 *
 * @param model - The model configuration including id, provider, cost, and features
 * @param provider - The provider instance that handles this model
 *
 * @example
 * ```typescript
 * import { registerExternalModel } from '@just-every/ensemble';
 *
 * const myProvider = new MyCustomProvider();
 *
 * registerExternalModel({
 *   id: 'my-custom-model',
 *   provider: 'custom',
 *   cost: {
 *     input_per_million: 5,
 *     output_per_million: 15
 *   },
 *   features: {
 *     context_length: 8192,
 *     tool_use: true,
 *     streaming: true
 *   }
 * }, myProvider);
 * ```
 */
export function registerExternalModel(model: ModelEntry, provider: ModelProvider): void {
    const modelId = model.id;

    // Store the model entry
    externalModels.set(modelId, model);

    // Store the provider if not already registered
    if (!externalProviders.has(model.provider)) {
        externalProviders.set(model.provider, provider);
    }

    console.log(`[Ensemble] Registered external model: ${modelId} with provider: ${model.provider}`);
}

/**
 * Get an external model by ID
 *
 * @param modelId - The model identifier to look up
 * @returns The model entry if found, undefined otherwise
 */
export function getExternalModel(modelId: string): ModelEntry | undefined {
    return externalModels.get(modelId);
}

/**
 * Get an external provider by ID
 */
export function getExternalProvider(providerId: ModelProviderID): ModelProvider | undefined {
    return externalProviders.get(providerId);
}

/**
 * Check if a model is external
 */
export function isExternalModel(modelId: string): boolean {
    return externalModels.has(modelId);
}

/**
 * Clear all external registrations (useful for testing)
 */
export function clearExternalRegistrations(): void {
    externalModels.clear();
    externalProviders.clear();
    modelClassOverrides.clear();
}

/**
 * Override a model class with custom models
 * @param className The name of the model class to override (e.g., 'code', 'standard')
 * @param modelClass The new model class configuration (can be partial)
 */
export function overrideModelClass(className: string, modelClass: Partial<ModelClass>): void {
    modelClassOverrides.set(className, modelClass);
    console.log(`[Ensemble] Overrode model class: ${className} with models: ${modelClass.models?.join(', ')}`);
}

/**
 * Get model class override if one exists
 * @param className The name of the model class
 * @returns The override configuration or undefined
 */
export function getModelClassOverride(className: string): Partial<ModelClass> | undefined {
    return modelClassOverrides.get(className);
}
