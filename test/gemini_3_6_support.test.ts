import { describe, expect, it, vi } from 'vitest';
import { MODEL_CLASSES, findModel } from '../data/model_data.js';
import { GeminiProvider } from '../model_providers/gemini.js';
import { getModelFromAgent, getProviderFromModel } from '../model_providers/model_provider.js';

function makeSingleChunkStream() {
    return {
        async *[Symbol.asyncIterator]() {
            yield {
                candidates: [{ content: { parts: [{ text: 'ok' }] } }],
                usageMetadata: {
                    promptTokenCount: 2,
                    candidatesTokenCount: 1,
                    totalTokenCount: 3,
                },
            };
        },
    };
}

describe('Gemini July 2026 model support', () => {
    it.each([
        ['gemini-3.6-flash', 1.5, 7.5, 0.15],
        ['gemini-3.5-flash-lite', 0.3, 2.5, 0.03],
    ] as const)('registers %s with current Google metadata', (modelId, input, output, cachedInput) => {
        const model = findModel(modelId);

        expect(model?.id).toBe(modelId);
        expect(getProviderFromModel(modelId)).toBe('google');
        expect(model?.cost).toMatchObject({
            input_per_million: input,
            output_per_million: output,
            cached_input_per_million: cachedInput,
        });
        expect(model?.features).toMatchObject({
            context_length: 1048576,
            max_output_tokens: 65536,
            input_modality: ['text', 'image', 'video', 'audio'],
            output_modality: ['text'],
            tool_use: true,
            streaming: true,
            json_output: true,
        });
    });

    it('resolves current latest aliases and promotes stable class defaults', async () => {
        expect(findModel('gemini-flash-latest')?.id).toBe('gemini-3.6-flash');
        expect(findModel('models/gemini-3.6-flash')?.id).toBe('gemini-3.6-flash');
        expect(findModel('gemini-flash-lite-latest')?.id).toBe('gemini-3.5-flash-lite');
        expect(findModel('models/gemini-3.5-flash-lite')?.id).toBe('gemini-3.5-flash-lite');
        expect(await getModelFromAgent({ agent_id: 'flash-latest', model: 'gemini-flash-latest' } as any)).toBe(
            'gemini-3.6-flash'
        );
        expect(
            await getModelFromAgent({ agent_id: 'flash-lite-latest', model: 'gemini-flash-lite-latest' } as any)
        ).toBe('gemini-3.5-flash-lite');

        expect(MODEL_CLASSES.standard.models).toContain('gemini-3.6-flash');
        expect(MODEL_CLASSES.mini.models).toContain('gemini-3.5-flash-lite');
        expect(MODEL_CLASSES.reasoning_mini.models).toContain('gemini-3.5-flash-lite');
    });

    it.each(['gemini-3.6-flash', 'gemini-3.5-flash-lite'])(
        'uses native thinking levels and omits deprecated sampling parameters for %s',
        async modelId => {
            const provider = new GeminiProvider('test-key');
            const generateContentStream = vi.fn().mockResolvedValue(makeSingleChunkStream());
            (provider as any)._client = { models: { generateContentStream } };

            const stream = provider.createResponseStream(
                [{ type: 'message', role: 'user', content: 'Respond briefly.' }] as any,
                `${modelId}-high`,
                {
                    agent_id: `test-${modelId}`,
                    modelSettings: {
                        temperature: 0,
                        top_p: 0.8,
                        top_k: 20,
                        max_tokens: 128,
                    },
                } as any,
                `req-${modelId}`
            );

            for await (const _event of stream) {
                // Drain stream.
            }

            const request = generateContentStream.mock.calls.at(0)?.[0] as any;
            expect(request.model).toBe(modelId);
            expect(request.config.thinkingConfig).toMatchObject({ includeThoughts: true, thinkingLevel: 'HIGH' });
            expect(request.config.maxOutputTokens).toBe(128);
            expect(request.config.temperature).toBeUndefined();
            expect(request.config.topP).toBeUndefined();
            expect(request.config.topK).toBeUndefined();
        }
    );

    it('rejects a prefilled model turn before dispatching a Gemini 3.6 request', async () => {
        const provider = new GeminiProvider('test-key');
        const generateContentStream = vi.fn().mockResolvedValue(makeSingleChunkStream());
        (provider as any)._client = { models: { generateContentStream } };

        const events = [];
        for await (const event of provider.createResponseStream(
            [{ type: 'message', role: 'assistant', content: 'Prefilled response:' }] as any,
            'gemini-3.6-flash',
            { agent_id: 'test-prefilled-turn' } as any,
            'req-prefilled-turn'
        )) {
            events.push(event);
        }

        expect(generateContentStream).not.toHaveBeenCalled();
        expect(events).toContainEqual(
            expect.objectContaining({
                type: 'error',
                error: expect.stringContaining('does not support a prefilled model turn'),
            })
        );
    });
});
