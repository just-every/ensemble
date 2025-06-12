import { describe, it, expect, beforeEach } from 'vitest';
import {
    getModelClass,
    getModelClassNames,
    overrideModelClass,
    setModelClassModels,
    addModelToClass,
    removeModelFromClass,
    setModelClassRandom,
    resetModelClass,
    getAllModelClasses,
    updateModelClasses,
} from '../utils/model_class_config.js';
import { clearExternalRegistrations } from '../utils/external_models.js';
import { MODEL_CLASSES } from '../data/model_data.js';

describe('Model Class Configuration', () => {
    beforeEach(() => {
        // Clear any overrides between tests
        clearExternalRegistrations();
    });

    describe('getModelClass', () => {
        it('should return base configuration when no override exists', () => {
            const config = getModelClass('standard');
            expect(config).toBeDefined();
            expect(config?.models).toEqual(MODEL_CLASSES.standard.models);
            expect(config?.random).toBe(MODEL_CLASSES.standard.random);
        });

        it('should return undefined for non-existent class', () => {
            const config = getModelClass('non-existent');
            expect(config).toBeUndefined();
        });

        it('should return merged configuration when override exists', () => {
            overrideModelClass('standard', {
                models: ['gpt-4.1', 'claude-3-5-haiku-latest'],
            });

            const config = getModelClass('standard');
            expect(config?.models).toEqual([
                'gpt-4.1',
                'claude-3-5-haiku-latest',
            ]);
            expect(config?.random).toBe(MODEL_CLASSES.standard.random); // Preserved
        });
    });

    describe('getModelClassNames', () => {
        it('should return all model class names', () => {
            const names = getModelClassNames();
            expect(names).toContain('standard');
            expect(names).toContain('mini');
            expect(names).toContain('reasoning');
            expect(names).toContain('code');
        });
    });

    describe('overrideModelClass', () => {
        it('should override model class configuration', () => {
            overrideModelClass('code', {
                models: ['codex-mini-latest'],
                random: false,
            });

            const config = getModelClass('code');
            expect(config?.models).toEqual(['codex-mini-latest']);
            expect(config?.random).toBe(false);
        });

        it('should throw error for non-existent class', () => {
            expect(() => {
                overrideModelClass('invalid-class', { models: [] });
            }).toThrow("Model class 'invalid-class' does not exist");
        });

        it('should warn for non-existent models but still add them', () => {
            const consoleSpy = vi
                .spyOn(console, 'warn')
                .mockImplementation(() => {});

            overrideModelClass('standard', {
                models: ['non-existent-model'],
            });

            expect(consoleSpy).toHaveBeenCalledWith(
                expect.stringContaining("Model 'non-existent-model' not found")
            );

            const config = getModelClass('standard');
            expect(config?.models).toEqual(['non-existent-model']);

            consoleSpy.mockRestore();
        });
    });

    describe('setModelClassModels', () => {
        it('should set models for a class', () => {
            setModelClassModels('mini', [
                'gpt-4.1-nano',
                'claude-3-5-haiku-latest',
            ]);

            const config = getModelClass('mini');
            expect(config?.models).toEqual([
                'gpt-4.1-nano',
                'claude-3-5-haiku-latest',
            ]);
        });

        it('should preserve random setting when not specified', () => {
            const originalRandom = MODEL_CLASSES.mini.random;

            setModelClassModels('mini', ['gpt-4.1-nano']);

            const config = getModelClass('mini');
            expect(config?.random).toBe(originalRandom);
        });

        it('should update random setting when specified', () => {
            setModelClassModels('mini', ['gpt-4.1-nano'], false);

            const config = getModelClass('mini');
            expect(config?.random).toBe(false);
        });
    });

    describe('addModelToClass', () => {
        it('should add a model to a class', () => {
            const originalModels = MODEL_CLASSES.standard.models;

            addModelToClass('standard', 'new-model');

            const config = getModelClass('standard');
            expect(config?.models).toContain('new-model');
            expect(config?.models.length).toBe(originalModels.length + 1);
        });

        it('should not add duplicate models', () => {
            const originalModels = MODEL_CLASSES.standard.models;
            const existingModel = originalModels[0];

            addModelToClass('standard', existingModel);

            const config = getModelClass('standard');
            expect(config?.models.length).toBe(originalModels.length);
        });
    });

    describe('removeModelFromClass', () => {
        it('should remove a model from a class', () => {
            const modelToRemove = MODEL_CLASSES.standard.models[0];

            removeModelFromClass('standard', modelToRemove);

            const config = getModelClass('standard');
            expect(config?.models).not.toContain(modelToRemove);
        });

        it('should do nothing if model not in class', () => {
            const originalLength = MODEL_CLASSES.standard.models.length;

            removeModelFromClass('standard', 'non-existent-model');

            const config = getModelClass('standard');
            expect(config?.models.length).toBe(originalLength);
        });
    });

    describe('setModelClassRandom', () => {
        it('should set random flag for a class', () => {
            setModelClassRandom('standard', false);

            const config = getModelClass('standard');
            expect(config?.random).toBe(false);
        });
    });

    describe('resetModelClass', () => {
        it('should reset class to default configuration', () => {
            // First override
            overrideModelClass('standard', {
                models: ['test-model'],
                random: false,
            });

            // Then reset
            resetModelClass('standard');

            const config = getModelClass('standard');
            expect(config?.models).toEqual(MODEL_CLASSES.standard.models);
            expect(config?.random).toBe(MODEL_CLASSES.standard.random);
        });
    });

    describe('getAllModelClasses', () => {
        it('should return all model classes with their configurations', () => {
            const allClasses = getAllModelClasses();

            expect(allClasses).toHaveProperty('standard');
            expect(allClasses).toHaveProperty('mini');
            expect(allClasses).toHaveProperty('reasoning');
            expect(allClasses.standard.models).toEqual(
                MODEL_CLASSES.standard.models
            );
        });

        it('should include overrides in the result', () => {
            overrideModelClass('standard', {
                models: ['test-model'],
            });

            const allClasses = getAllModelClasses();
            expect(allClasses.standard.models).toEqual(['test-model']);
        });
    });

    describe('updateModelClasses', () => {
        it('should update multiple classes at once', () => {
            updateModelClasses({
                standard: { models: ['gpt-4.1'] },
                mini: { random: false },
                code: { models: ['codex-mini-latest'], random: true },
            });

            const standardConfig = getModelClass('standard');
            const miniConfig = getModelClass('mini');
            const codeConfig = getModelClass('code');

            expect(standardConfig?.models).toEqual(['gpt-4.1']);
            expect(miniConfig?.random).toBe(false);
            expect(codeConfig?.models).toEqual(['codex-mini-latest']);
            expect(codeConfig?.random).toBe(true);
        });
    });
});
