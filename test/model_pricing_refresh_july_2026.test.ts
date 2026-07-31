import { describe, expect, it } from 'vitest';
import { findModel } from '../data/model_data.js';

describe('July 2026 model pricing refresh', () => {
    it('uses current Anthropic standard pricing for Claude Opus 4.5', () => {
        expect(findModel('claude-opus-4.5')?.cost).toMatchObject({
            input_per_million: 5,
            cached_input_per_million: 0.5,
            output_per_million: 25,
        });
    });

    it('uses current Google standard token pricing for Gemini 2.5 models', () => {
        expect(findModel('gemini-2.5-pro')?.cost).toMatchObject({
            input_per_million: {
                threshold_tokens: 200000,
                price_below_threshold_per_million: 1.25,
                price_above_threshold_per_million: 2.5,
                tier_basis: 'input_tokens',
            },
            cached_input_per_million: {
                threshold_tokens: 200000,
                price_below_threshold_per_million: 0.125,
                price_above_threshold_per_million: 0.25,
                tier_basis: 'input_tokens',
            },
            output_per_million: {
                threshold_tokens: 200000,
                price_below_threshold_per_million: 10,
                price_above_threshold_per_million: 15,
                tier_basis: 'input_tokens',
            },
        });
        expect(findModel('gemini-2.5-flash')?.cost).toMatchObject({
            input_per_million: { text: 0.3, image: 0.3, video: 0.3, audio: 1 },
            cached_input_per_million: { text: 0.03, image: 0.03, video: 0.03, audio: 0.1 },
            output_per_million: 2.5,
        });
        expect(findModel('gemini-2.5-flash-lite')?.cost).toMatchObject({
            input_per_million: { text: 0.1, image: 0.1, video: 0.1, audio: 0.3 },
            cached_input_per_million: { text: 0.01, image: 0.01, video: 0.01, audio: 0.03 },
            output_per_million: 0.4,
        });
    });

    it('uses modality-specific cached-input pricing for Gemini 3.x models', () => {
        expect(findModel('gemini-3-flash')?.cost?.cached_input_per_million).toEqual({
            text: 0.05,
            image: 0.05,
            video: 0.05,
            audio: 0.1,
        });
        expect(findModel('gemini-3.1-flash-lite')?.cost?.cached_input_per_million).toEqual({
            text: 0.025,
            image: 0.025,
            video: 0.025,
            audio: 0.05,
        });
    });

    it('uses modality-specific pricing for current Google speech and live models', () => {
        expect(findModel('gemini-2.5-flash-preview-tts')?.cost).toMatchObject({
            input_per_million: { text: 0.5 },
            output_per_million: { audio: 10 },
        });
        expect(findModel('gemini-2.5-pro-preview-tts')?.cost).toMatchObject({
            input_per_million: { text: 1 },
            output_per_million: { audio: 20 },
        });
        expect(findModel('gemini-3.1-flash-tts-preview')?.cost).toMatchObject({
            input_per_million: { text: 1 },
            output_per_million: { audio: 20 },
        });
        expect(findModel('gemini-2.5-flash-native-audio-preview')?.cost).toMatchObject({
            input_per_million: { text: 0.5, audio: 3, video: 3 },
            output_per_million: { text: 2, audio: 12 },
        });
        expect(findModel('gemini-3.1-flash-live-preview')?.cost).toMatchObject({
            input_per_million: { text: 0.75, audio: 3, image: 1, video: 1 },
            output_per_million: { text: 4.5, audio: 12 },
        });
    });

    it('tracks all published cached-input modalities for OpenAI realtime models', () => {
        expect(findModel('gpt-realtime-2.1')?.cost?.cached_input_per_million).toEqual({
            text: 0.4,
            audio: 0.4,
            image: 0.5,
        });
        expect(findModel('gpt-realtime-2.1-mini')?.cost?.cached_input_per_million).toEqual({
            text: 0.06,
            audio: 0.3,
            image: 0.08,
        });
    });

    it('uses current OpenRouter pricing for DeepSeek V4 Flash', () => {
        expect(findModel('deepseek/deepseek-v4-flash')?.cost).toMatchObject({
            input_per_million: 0.14,
            cached_input_per_million: 0.028,
            output_per_million: 0.28,
        });
    });
});
