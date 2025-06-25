import { describe, it, expect, beforeEach, vi } from 'vitest';
import { costTracker } from '../utils/cost_tracker.js';
import { ensembleVoice } from '../core/ensemble_voice.js';

// Mock the provider
vi.mock('../model_providers/model_provider.js', () => ({
    getModelFromAgent: vi.fn().mockResolvedValue('tts-1'),
    getModelProvider: vi.fn().mockReturnValue({
        createVoice: vi.fn().mockImplementation(async (text, model) => {
            // Simulate the provider adding cost
            const characterCount = text.length;
            const costPerThousandChars = model === 'tts-1-hd' ? 0.03 : 0.015;
            const cost = (characterCount / 1000) * costPerThousandChars;

            // This is what OpenAI provider does
            costTracker.addUsage({
                model,
                cost, // Pass cost directly
                metadata: {
                    character_count: characterCount,
                    voice: 'alloy',
                    format: 'mp3',
                },
            });

            // Return a mock stream
            return new ReadableStream<Uint8Array>({
                start(controller) {
                    controller.enqueue(new Uint8Array([1, 2, 3]));
                    controller.close();
                },
            });
        }),
    }),
}));

describe('Voice Cost Tracking', () => {
    beforeEach(() => {
        // Clear cost tracker before each test
        costTracker.reset();
    });

    it('should track costs for voice generation', async () => {
        const text = 'Hello, this is a test of voice generation cost tracking.';
        const expectedCost = (text.length / 1000) * 0.015; // tts-1 pricing
        const initialCost = costTracker.getTotalCost();

        // Generate voice
        const events = [];
        for await (const event of ensembleVoice(text, { model: 'tts-1' })) {
            events.push(event);
        }

        // Check that cost was tracked
        const totalCost = costTracker.getTotalCost();
        const costIncrease = totalCost - initialCost;
        expect(costIncrease).toBeCloseTo(expectedCost, 6);

        // Check model costs
        const costsByModel = costTracker.getCostsByModel();
        expect(costsByModel['tts-1']).toBeTruthy();
        expect(costsByModel['tts-1'].cost).toBeCloseTo(expectedCost, 6);
        expect(costsByModel['tts-1'].calls).toBe(1);
    });

    it('should track higher costs for HD model', async () => {
        const text = 'Testing HD voice model cost tracking.';
        const expectedCost = (text.length / 1000) * 0.03; // tts-1-hd pricing

        // Mock for HD model
        const { getModelFromAgent } = await import('../model_providers/model_provider.js');
        vi.mocked(getModelFromAgent).mockResolvedValueOnce('tts-1-hd');

        // Generate voice
        const events = [];
        for await (const event of ensembleVoice(text, { model: 'tts-1-hd' })) {
            events.push(event);
        }

        // Check that cost was tracked
        const costsByModel = costTracker.getCostsByModel();
        expect(costsByModel['tts-1-hd']).toBeTruthy();
        expect(costsByModel['tts-1-hd'].cost).toBeCloseTo(expectedCost, 6);
    });

    it('should accumulate total cost correctly', async () => {
        const text1 = 'First voice generation.';
        const text2 = 'Second voice generation with more text.';

        // Generate two voice outputs
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        for await (const _event of ensembleVoice(text1, { model: 'tts-1' })) {
            // consume events
        }

        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        for await (const _event of ensembleVoice(text2, { model: 'tts-1' })) {
            // consume events
        }

        // Check total cost
        const totalCost = costTracker.getTotalCost();
        const expectedTotal = ((text1.length + text2.length) / 1000) * 0.015;
        expect(totalCost).toBeCloseTo(expectedTotal, 6);
    });
});
