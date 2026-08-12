import { describe, expect, it } from 'vitest';
import { findModel } from '../data/model_data.js';
import { canRunAgent, getModelProvider } from '../model_providers/model_provider.js';

describe('August 2026 model retirements', () => {
    it.each([
        ['gemini-2.0-flash', 'gemini-3.6-flash'],
        ['gemini-2.0-flash-001', 'gemini-3.6-flash'],
        ['gemini-2.0-flash-lite', 'gemini-3.1-flash-lite'],
        ['gemini-live-2.5-flash-preview', 'gemini-3.1-flash-live-preview'],
        ['gemini-2.0-flash-live-001', 'gemini-3.1-flash-live-preview'],
    ])('rejects shut-down Google model %s', async (model, replacement) => {
        expect(findModel(model)).toBeUndefined();
        expect(() => getModelProvider(model)).toThrow(`Migrate to ${replacement}`);
        expect(await canRunAgent({ model })).toMatchObject({
            canRun: false,
            model,
            reason: expect.stringContaining(`Migrate to ${replacement}`),
        });
    });

    it.each([
        ['grok-4-1-fast-reasoning', 'grok-4.3-low'],
        ['grok-4-fast-reasoning-high', 'grok-4.3-low'],
        ['grok-4-fast-non-reasoning', 'grok-4.3-none'],
        ['grok-4-0709', 'grok-4.3-low'],
        ['grok-3', 'grok-4.3-none'],
        ['grok-code-fast-1', 'grok-build-0.1'],
    ])('rejects retired xAI model %s', (model, replacement) => {
        expect(findModel(model)).toBeUndefined();
        expect(() => getModelProvider(model)).toThrow(`Migrate to ${replacement}`);
    });
});
