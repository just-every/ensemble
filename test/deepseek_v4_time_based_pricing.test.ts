import { describe, expect, it } from 'vitest';
import { findModel, TimeBasedPrice } from '../data/model_data.js';
import { CostTracker } from '../utils/cost_tracker.js';

const tracker = new CostTracker();

function priceAt(model: string, timestamp: string): number {
    return tracker.calculateCost({
        model,
        input_tokens: 1_000_000,
        output_tokens: 0,
        timestamp: new Date(timestamp),
    }).cost as number;
}

describe('DeepSeek V4 time-based pricing', () => {
    it('records the published weekday peak windows and rates for direct DeepSeek V4 models', () => {
        const pro = findModel('deepseek-v4-pro');
        const flash = findModel('deepseek-v4-flash');
        const vision = findModel('deepseek-v4-flash-vision-exp');

        expect(pro?.cost?.input_per_million).toEqual({
            off_peak_price_per_million: 0.66,
            peak_price_per_million: 1.32,
            peak_windows_utc: [
                [60, 240],
                [360, 600],
            ],
            peak_days: [1, 2, 3, 4, 5],
        });
        expect(pro?.cost?.cached_input_per_million).toMatchObject({
            off_peak_price_per_million: 0.022,
            peak_price_per_million: 0.044,
        });
        expect(pro?.cost?.output_per_million).toMatchObject({
            off_peak_price_per_million: 1.98,
            peak_price_per_million: 3.96,
        });

        for (const model of [flash, vision]) {
            expect(model?.cost?.input_per_million).toMatchObject({
                off_peak_price_per_million: 0.22,
                peak_price_per_million: 0.44,
            });
            expect(model?.cost?.cached_input_per_million).toMatchObject({
                off_peak_price_per_million: 0.007,
                peak_price_per_million: 0.014,
            });
            expect(model?.cost?.output_per_million).toMatchObject({
                off_peak_price_per_million: 0.66,
                peak_price_per_million: 1.32,
            });
        }
        expect(vision?.features.input_modality).toContain('image');
    });

    it('charges peak prices in both weekday DeepSeek windows', () => {
        expect(priceAt('deepseek-v4-flash', '2026-08-31T02:00:00.000Z')).toBeCloseTo(0.44);
        expect(priceAt('deepseek-v4-flash', '2026-08-31T07:00:00.000Z')).toBeCloseTo(0.44);
    });

    it('keeps weekday-filtered windows off-peak on weekends', () => {
        expect(priceAt('deepseek-v4-flash', '2026-08-29T02:00:00.000Z')).toBeCloseTo(0.22);
        expect(priceAt('deepseek-v4-flash', '2026-08-30T07:00:00.000Z')).toBeCloseTo(0.22);
    });

    it('charges off-peak prices outside and at the end boundary of DeepSeek peak windows', () => {
        expect(priceAt('deepseek-v4-flash', '2026-08-31T00:59:00.000Z')).toBeCloseTo(0.22);
        expect(priceAt('deepseek-v4-flash', '2026-08-31T04:00:00.000Z')).toBeCloseTo(0.22);
        expect(priceAt('deepseek-v4-flash', '2026-08-31T05:59:00.000Z')).toBeCloseTo(0.22);
        expect(priceAt('deepseek-v4-flash', '2026-08-31T10:00:00.000Z')).toBeCloseTo(0.22);
    });

    it('applies time-based cached input and output prices with the same schedule', () => {
        const peakUsage = tracker.calculateCost({
            model: 'deepseek-v4-pro',
            input_tokens: 1_000_000,
            cached_tokens: 100_000,
            output_tokens: 1_000_000,
            timestamp: new Date('2026-08-31T06:00:00.000Z'),
        });
        const offPeakUsage = tracker.calculateCost({
            model: 'deepseek-v4-pro',
            input_tokens: 1_000_000,
            cached_tokens: 100_000,
            output_tokens: 1_000_000,
            timestamp: new Date('2026-08-31T05:59:00.000Z'),
        });

        expect(peakUsage.cost).toBeCloseTo(5.1524);
        expect(offPeakUsage.cost).toBeCloseTo(2.5762);
    });

    it('still supports windows that cross UTC midnight when represented as one window', () => {
        const crossMidnightPrice: TimeBasedPrice = {
            off_peak_price_per_million: 1,
            peak_price_per_million: 2,
            peak_windows_utc: [[1380, 60]],
        };
        const model = findModel('deepseek-v4-flash');
        const originalInputPrice = model?.cost?.input_per_million;
        if (model?.cost) model.cost.input_per_million = crossMidnightPrice;

        try {
            expect(priceAt('deepseek-v4-flash', '2026-08-31T23:30:00.000Z')).toBeCloseTo(2);
            expect(priceAt('deepseek-v4-flash', '2026-09-01T00:30:00.000Z')).toBeCloseTo(2);
            expect(priceAt('deepseek-v4-flash', '2026-09-01T12:00:00.000Z')).toBeCloseTo(1);
        } finally {
            if (model?.cost) model.cost.input_per_million = originalInputPrice;
        }
    });
});
