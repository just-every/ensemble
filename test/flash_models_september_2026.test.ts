import { describe, expect, it } from 'vitest';
import { findModel } from '../data/model_data.js';
import { costTracker } from '../utils/cost_tracker.js';
import { applyDeepSeekV4Contract } from '../model_providers/deepseek_v4_contract.js';
import { usesCurrentGeminiGenerateContentContract } from '../model_providers/gemini_model_contract.js';

describe('September 2026 economical model contracts', () => {
    it('registers Gemini 3.8 Flash and applies its current API contract', () => {
        expect(findModel('gemini-flash-latest')?.id).toBe('gemini-3.8-flash');
        expect(findModel('gemini-3.8-flash')?.cost?.input_per_million).toBe(0.75);
        expect(usesCurrentGeminiGenerateContentContract('models/gemini-3.8-flash')).toBe(true);
    });
    it.each([
        ['none', undefined],
        ['low', 'low'],
        ['medium', 'high'],
        ['xhigh', 'high'],
        ['max', 'max'],
    ])('maps DeepSeek reasoning %s to %s', (effort, expected) => {
        const params = applyDeepSeekV4Contract({
            model: 'deepseek-v4-flash',
            stream: true,
            messages: [],
            reasoning: { effort },
        } as any) as any;
        expect(params.reasoning_effort).toBe(expected);
        expect(params.thinking.type).toBe(effort === 'none' ? 'disabled' : 'enabled');
    });
    it.each([
        ['2026-09-08T00:59:59Z', 0.22],
        ['2026-09-08T01:00:00Z', 0.44],
        ['2026-09-08T04:00:00Z', 0.22],
        ['2026-09-08T06:00:00Z', 0.44],
        ['2026-09-08T10:00:00Z', 0.22],
        ['2026-09-12T02:00:00Z', 0.22],
    ])('charges the correct DeepSeek rate at %s', (timestamp, expected) => {
        expect(
            costTracker.calculateCost({ model: 'deepseek-v4-flash', input_tokens: 1e6, timestamp: new Date(timestamp) })
                .cost
        ).toBeCloseTo(expected);
    });
    it('discounts cached tokens without counting them twice', () => {
        expect(
            costTracker.calculateCost({
                model: 'deepseek-v4-flash',
                input_tokens: 1e6,
                cached_tokens: 1e6,
                output_tokens: 1e6,
                timestamp: new Date('2026-09-08T05:00:00Z'),
            }).cost
        ).toBeCloseTo(0.667);
    });
});
