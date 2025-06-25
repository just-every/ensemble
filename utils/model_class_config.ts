/**
 * Model class configuration utilities for ensemble.
 * Provides APIs to customize model class definitions at runtime.
 */

import { MODEL_CLASSES, findModel } from '../data/model_data.js';
import { ModelClass } from '../types/types.js';
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import type { ModelClassID } from '../types/types.js';
import { overrideModelClass as _overrideModelClass, getModelClassOverride } from './external_models.js';

/**
 * Get the effective model class configuration (with overrides applied)
 * @param className The model class name
 * @returns The effective model class configuration or undefined if class doesn't exist
 */
export function getModelClass(className: string): ModelClass | undefined {
    // Check if this is a valid class name
    if (!(className in MODEL_CLASSES)) {
        return undefined;
    }

    // Get the base configuration
    const baseConfig = MODEL_CLASSES[className as keyof typeof MODEL_CLASSES];

    // Get any override
    const override = getModelClassOverride(className);

    // If no override, return base config
    if (!override) {
        return { ...baseConfig };
    }

    // Merge override with base config
    return {
        ...baseConfig,
        ...override,
        // Ensure models array is properly merged (override completely replaces if provided)
        models: override.models || baseConfig.models,
    };
}

/**
 * Get all model class names
 * @returns Array of available model class names
 */
export function getModelClassNames(): string[] {
    return Object.keys(MODEL_CLASSES);
}

/**
 * Override an entire model class configuration
 * @param className The model class name
 * @param config The new configuration (can be partial)
 */
export function overrideModelClass(className: string, config: Partial<ModelClass>): void {
    // Validate that the class exists
    if (!(className in MODEL_CLASSES)) {
        throw new Error(`Model class '${className}' does not exist`);
    }

    // Validate models if provided
    if (config.models) {
        for (const modelId of config.models) {
            if (!findModel(modelId)) {
                console.warn(`Model '${modelId}' not found in registry, but adding to class '${className}' anyway`);
            }
        }
    }

    _overrideModelClass(className, config);
}

/**
 * Set the models for a specific class
 * @param className The model class name
 * @param models Array of model IDs
 * @param random Optional - whether to use random selection (preserves existing value if not specified)
 */
export function setModelClassModels(className: string, models: string[], random?: boolean): void {
    const currentConfig = getModelClass(className);
    if (!currentConfig) {
        throw new Error(`Model class '${className}' does not exist`);
    }

    overrideModelClass(className, {
        models,
        random: random !== undefined ? random : currentConfig.random,
    });
}

/**
 * Add a model to a class
 * @param className The model class name
 * @param modelId The model ID to add
 */
export function addModelToClass(className: string, modelId: string): void {
    const currentConfig = getModelClass(className);
    if (!currentConfig) {
        throw new Error(`Model class '${className}' does not exist`);
    }

    // Check if model already exists in the class
    if (currentConfig.models.includes(modelId)) {
        return; // Already in the class
    }

    // Add the model
    const newModels = [...currentConfig.models, modelId];
    setModelClassModels(className, newModels);
}

/**
 * Remove a model from a class
 * @param className The model class name
 * @param modelId The model ID to remove
 */
export function removeModelFromClass(className: string, modelId: string): void {
    const currentConfig = getModelClass(className);
    if (!currentConfig) {
        throw new Error(`Model class '${className}' does not exist`);
    }

    // Filter out the model
    const newModels = currentConfig.models.filter(id => id !== modelId);

    // Only update if the model was actually removed
    if (newModels.length < currentConfig.models.length) {
        setModelClassModels(className, newModels);
    }
}

/**
 * Set whether a class uses random selection
 * @param className The model class name
 * @param random Whether to use random selection
 */
export function setModelClassRandom(className: string, random: boolean): void {
    const currentConfig = getModelClass(className);
    if (!currentConfig) {
        throw new Error(`Model class '${className}' does not exist`);
    }

    overrideModelClass(className, {
        models: currentConfig.models,
        random,
    });
}

/**
 * Reset a model class to its default configuration
 * @param className The model class name
 */
export function resetModelClass(className: string): void {
    // This works by setting an empty override, which causes getModelClass
    // to return the base configuration
    overrideModelClass(className, {});
}

/**
 * Get the current configuration for all model classes
 * @returns Object mapping class names to their effective configurations
 */
export function getAllModelClasses(): Record<string, ModelClass> {
    const result: Record<string, ModelClass> = {};

    for (const className of getModelClassNames()) {
        const config = getModelClass(className);
        if (config) {
            result[className] = config;
        }
    }

    return result;
}

/**
 * Bulk update multiple model classes at once
 * @param updates Object mapping class names to their new configurations
 */
export function updateModelClasses(updates: Record<string, Partial<ModelClass>>): void {
    for (const [className, config] of Object.entries(updates)) {
        overrideModelClass(className, config);
    }
}
