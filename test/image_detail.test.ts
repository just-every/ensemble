import { describe, expect, it } from 'vitest';
import {
    chooseHighestImageDetail,
    mapOpenAIChatImageDetail,
    mapGeminiMediaResolution,
    mapOpenAIImageDetail,
    mapOpenAIImageInputFidelity,
} from '../utils/image_detail.js';

describe('image detail mapping', () => {
    it('leaves provider defaults untouched when detail is omitted or auto', () => {
        expect(mapOpenAIImageDetail()).toBeUndefined();
        expect(mapGeminiMediaResolution()).toBeUndefined();
        expect(mapOpenAIImageInputFidelity('auto')).toBeUndefined();
        expect(chooseHighestImageDetail([undefined, 'auto'])).toBeUndefined();
    });

    it('maps the shared detail knob to OpenAI and Gemini native controls', () => {
        expect(mapOpenAIImageDetail('low')).toBe('low');
        expect(mapOpenAIImageDetail('medium')).toBe('high');
        expect(mapOpenAIImageDetail('original')).toBe('original');
        expect(mapOpenAIChatImageDetail('original')).toBe('high');
        expect(mapOpenAIImageInputFidelity('medium')).toBe('medium');
        expect(mapOpenAIImageInputFidelity('original')).toBe('high');

        expect(mapGeminiMediaResolution('low')).toBe('MEDIA_RESOLUTION_LOW');
        expect(mapGeminiMediaResolution('medium')).toBe('MEDIA_RESOLUTION_MEDIUM');
        expect(mapGeminiMediaResolution('high')).toBe('MEDIA_RESOLUTION_HIGH');
        expect(mapGeminiMediaResolution('original')).toBe('MEDIA_RESOLUTION_HIGH');
    });

    it('chooses the highest concrete detail for global provider controls', () => {
        expect(chooseHighestImageDetail(['low', 'auto', 'medium'])).toBe('medium');
        expect(chooseHighestImageDetail(['high', 'original', 'medium'])).toBe('original');
    });
});
