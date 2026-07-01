import { describe, expect, it, vi } from 'vitest';
import { findModel } from '../data/model_data.js';
import { getModelFromAgent, getProviderFromModel } from '../model_providers/model_provider.js';
import { GeminiProvider } from '../model_providers/gemini.js';
import { costTracker } from '../utils/cost_tracker.js';

const ONE_PX_PNG_BASE64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7+XxkAAAAASUVORK5CYII=';

function makeGeminiImageStream() {
    return {
        async *[Symbol.asyncIterator]() {
            yield {
                candidates: [
                    {
                        content: {
                            parts: [
                                {
                                    inlineData: {
                                        mimeType: 'image/png',
                                        data: ONE_PX_PNG_BASE64,
                                    },
                                },
                            ],
                        },
                    },
                ],
                usageMetadata: {
                    promptTokenCount: 32,
                    candidatesTokenCount: 64,
                    totalTokenCount: 96,
                },
            };
        },
    };
}

function makeGeminiGroundedThoughtImageStream() {
    return {
        async *[Symbol.asyncIterator]() {
            yield {
                candidates: [
                    {
                        groundingMetadata: {
                            imageSearchQueries: ['timareta butterfly'],
                            groundingChunks: [
                                {
                                    image: {
                                        uri: 'https://example.com/butterfly-source',
                                        imageUri: 'https://images.example.com/butterfly.jpg',
                                    },
                                },
                            ],
                            groundingSupports: [{ groundingChunkIndices: [0] }],
                            searchEntryPoint: {
                                renderedContent: '<div>Google Search</div>',
                            },
                        },
                        content: {
                            parts: [
                                {
                                    text: 'thinking draft',
                                    thought: true,
                                },
                                {
                                    inlineData: {
                                        mimeType: 'image/png',
                                        data: ONE_PX_PNG_BASE64,
                                    },
                                    thought: true,
                                },
                                {
                                    text: 'final explanation text',
                                    thoughtSignature: 'signature-text-1',
                                },
                                {
                                    inlineData: {
                                        mimeType: 'image/png',
                                        data: ONE_PX_PNG_BASE64,
                                    },
                                    thoughtSignature: 'signature-image-1',
                                },
                            ],
                        },
                    },
                ],
                usageMetadata: {
                    promptTokenCount: 100,
                    candidatesTokenCount: 200,
                    totalTokenCount: 300,
                },
            };
        },
    };
}

function makeSingleChunkStream(chunk: Record<string, unknown>) {
    return {
        async *[Symbol.asyncIterator]() {
            yield chunk;
        },
    };
}

describe('Gemini 3.x model support', () => {
    it('registers Gemini 3.5 Flash with Google provider metadata', async () => {
        const model = findModel('gemini-3.5-flash');

        expect(model?.id).toBe('gemini-3.5-flash');
        expect(await getModelFromAgent({ agent_id: 'test-gemini-3-5', model: 'gemini-3.5-flash' } as any)).toBe(
            'gemini-3.5-flash'
        );
        expect(getProviderFromModel('gemini-3.5-flash')).toBe('google');
        expect(model?.cost).toMatchObject({
            input_per_million: 1.5,
            output_per_million: 9.0,
            cached_input_per_million: 0.15,
        });
        expect(model?.features).toMatchObject({
            context_length: 1_000_000,
            max_output_tokens: 65536,
            input_modality: ['text', 'image', 'video', 'audio'],
            output_modality: ['text'],
            tool_use: true,
            streaming: true,
            json_output: true,
        });
    });

    it('registers Gemini 3 Pro Preview and 3.1 compatibility aliases', () => {
        const canonical = findModel('gemini-3-pro-preview');
        const fallbackAlias = findModel('gemini-3.1-pro-preview');
        const customToolsAlias = findModel('gemini-3.1-pro-preview-customtools');

        expect(canonical?.id).toBe('gemini-3.1-pro-preview');
        expect(fallbackAlias?.id).toBe('gemini-3.1-pro-preview');
        expect(customToolsAlias?.id).toBe('gemini-3.1-pro-preview');
    });

    it('keeps backward compatibility for Gemini 3.1 Pro aliases', () => {
        const legacyAlias = findModel('gemini-3.1-pro');
        expect(legacyAlias?.id).toBe('gemini-3.1-pro-preview');
    });

    it('normalizes agent model aliases to the Gemini 3 Pro Preview canonical ID', async () => {
        const resolved = await getModelFromAgent({
            agent_id: 'test-gemini-3-1-alias',
            model: 'gemini-3.1-pro-preview-customtools',
        } as any);

        expect(resolved).toBe('gemini-3.1-pro-preview');
    });

    it('normalizes Gemini 3.1 Flash Lite preview aliases to the stable model while preserving effort suffixes', async () => {
        const model = findModel('gemini-3.1-flash-lite-preview');
        const resolved = await getModelFromAgent({
            agent_id: 'test-gemini-3-1-lite-invalid-high',
            model: 'gemini-3.1-flash-lite-preview-high',
        } as any);

        expect(model?.id).toBe('gemini-3.1-flash-lite');
        expect(resolved).toBe('gemini-3.1-flash-lite-high');
    });

    it('keeps registered suffixed variants intact', async () => {
        const resolved = await getModelFromAgent({
            agent_id: 'test-o4-mini-high',
            model: 'o4-mini-high',
        } as any);

        expect(resolved).toBe('o4-mini-high');
    });

    it('forwards thinkingLevel=LOW for Gemini -low text requests when supported', async () => {
        const provider = new GeminiProvider('test-key');
        const generateContentStream = vi.fn().mockResolvedValue(
            makeSingleChunkStream({
                candidates: [
                    {
                        content: {
                            parts: [{ text: '{"ok":true}' }],
                        },
                    },
                ],
                usageMetadata: {
                    promptTokenCount: 10,
                    candidatesTokenCount: 5,
                    totalTokenCount: 15,
                },
            })
        );

        (provider as any)._client = {
            models: {
                generateContentStream,
            },
        };

        const stream = provider.createResponseStream(
            [
                {
                    type: 'message',
                    role: 'user',
                    content: 'Return JSON.',
                },
            ] as any,
            'gemini-3.1-flash-lite-low',
            { agent_id: 'test-gemini-low-thinking-budget' } as any,
            'req-low-thinking'
        );

        for await (const _event of stream) {
            // Drain stream.
        }

        const requestArg = generateContentStream.mock.calls.at(0)?.[0] as any;
        expect(requestArg?.model).toBe('gemini-3.1-flash-lite');
        expect(requestArg?.config?.thinkingConfig?.includeThoughts).toBe(true);
        expect(requestArg?.config?.thinkingConfig?.thinkingLevel).toBe('LOW');
        expect(requestArg?.config?.thinkingConfig?.thinkingBudget).toBeUndefined();
    });

    it('maps Gemini 3.5 Flash suffixes to native thinking levels', async () => {
        const provider = new GeminiProvider('test-key');
        const generateContentStream = vi.fn().mockImplementation(() =>
            Promise.resolve(
                makeSingleChunkStream({
                    candidates: [
                        {
                            content: {
                                parts: [{ text: '{"ok":true}' }],
                            },
                        },
                    ],
                    usageMetadata: {
                        promptTokenCount: 10,
                        candidatesTokenCount: 5,
                        totalTokenCount: 15,
                    },
                })
            )
        );

        (provider as any)._client = {
            models: {
                generateContentStream,
            },
        };

        const suffixExpectations = [
            ['none', 'MINIMAL'],
            ['disabled', 'MINIMAL'],
            ['minimal', 'MINIMAL'],
            ['low', 'LOW'],
            ['medium', 'MEDIUM'],
            ['high', 'HIGH'],
            ['max', 'HIGH'],
            ['xhigh', 'HIGH'],
        ] as const;

        for (const [suffix, thinkingLevel] of suffixExpectations) {
            const stream = provider.createResponseStream(
                [
                    {
                        type: 'message',
                        role: 'user',
                        content: 'Return JSON.',
                    },
                ] as any,
                `gemini-3.5-flash-${suffix}`,
                { agent_id: `test-gemini-3-5-${suffix}` } as any,
                `req-thinking-level-${suffix}`
            );

            for await (const _event of stream) {
                // Drain stream.
            }

            const requestArg = generateContentStream.mock.calls.at(-1)?.[0] as any;
            expect(requestArg?.model).toBe('gemini-3.5-flash');
            expect(requestArg?.config?.thinkingConfig?.includeThoughts).toBe(true);
            expect(requestArg?.config?.thinkingConfig?.thinkingLevel).toBe(thinkingLevel);
            expect(requestArg?.config?.thinkingConfig?.thinkingBudget).toBeUndefined();
        }
    });

    it('keeps numeric thinkingBudget suffixes for Gemini models without native thinking levels', async () => {
        const provider = new GeminiProvider('test-key');
        const generateContentStream = vi.fn().mockResolvedValue(
            makeSingleChunkStream({
                candidates: [
                    {
                        content: {
                            parts: [{ text: '{"ok":true}' }],
                        },
                    },
                ],
                usageMetadata: {
                    promptTokenCount: 10,
                    candidatesTokenCount: 5,
                    totalTokenCount: 15,
                },
            })
        );

        (provider as any)._client = {
            models: {
                generateContentStream,
            },
        };

        const stream = provider.createResponseStream(
            [
                {
                    type: 'message',
                    role: 'user',
                    content: 'Return JSON.',
                },
            ] as any,
            'gemini-2.5-flash-low',
            { agent_id: 'test-gemini-legacy-low-thinking-budget' } as any,
            'req-legacy-low-thinking'
        );

        for await (const _event of stream) {
            // Drain stream.
        }

        const requestArg = generateContentStream.mock.calls.at(0)?.[0] as any;
        expect(requestArg?.model).toBe('gemini-2.5-flash');
        expect(requestArg?.config?.thinkingConfig?.includeThoughts).toBe(true);
        expect(requestArg?.config?.thinkingConfig?.thinkingBudget).toBe(0);
        expect(requestArg?.config?.thinkingConfig?.thinkingLevel).toBeUndefined();
    });

    it('maps image detail to Gemini mediaResolution only when requested', async () => {
        const provider = new GeminiProvider('test-key');
        const generateContentStream = vi.fn().mockResolvedValue(
            makeSingleChunkStream({
                candidates: [
                    {
                        content: {
                            parts: [{ text: 'ok' }],
                        },
                    },
                ],
                usageMetadata: {
                    promptTokenCount: 10,
                    candidatesTokenCount: 5,
                    totalTokenCount: 15,
                },
            })
        );

        (provider as any)._client = {
            models: {
                generateContentStream,
            },
        };

        const dataUrl = `data:image/png;base64,${ONE_PX_PNG_BASE64}`;
        for await (const _event of provider.createResponseStream(
            [
                {
                    type: 'message',
                    role: 'user',
                    content: [
                        { type: 'input_text', text: 'Describe this image.' },
                        { type: 'image', data: dataUrl, detail: 'medium' },
                    ],
                },
            ] as any,
            'gemini-3-flash-preview',
            { agent_id: 'test-gemini-image-detail' } as any,
            'req-gemini-image-detail'
        )) {
            // Drain stream.
        }

        let requestArg = generateContentStream.mock.calls.at(0)?.[0] as any;
        expect(requestArg?.config?.mediaResolution).toBe('MEDIA_RESOLUTION_MEDIUM');
        expect(requestArg?.contents?.[0]?.parts?.filter((part: any) => part.inlineData)).toEqual([
            {
                inlineData: {
                    mimeType: 'image/png',
                    data: ONE_PX_PNG_BASE64,
                },
            },
        ]);

        generateContentStream.mockClear();
        for await (const _event of provider.createResponseStream(
            [
                {
                    type: 'message',
                    role: 'user',
                    content: [
                        { type: 'input_text', text: 'Describe this image.' },
                        { type: 'image', data: dataUrl },
                    ],
                },
            ] as any,
            'gemini-3-flash-preview',
            { agent_id: 'test-gemini-image-detail-default' } as any,
            'req-gemini-image-detail-default'
        )) {
            // Drain stream.
        }

        requestArg = generateContentStream.mock.calls.at(0)?.[0] as any;
        expect(requestArg?.config?.mediaResolution).toBeUndefined();
    });

    it('maps modelSettings.thinking_budget to native Gemini thinking levels when supported', async () => {
        const provider = new GeminiProvider('test-key');
        const generateContentStream = vi.fn().mockResolvedValue(
            makeSingleChunkStream({
                candidates: [
                    {
                        content: {
                            parts: [{ text: '{"ok":true}' }],
                        },
                    },
                ],
                usageMetadata: {
                    promptTokenCount: 10,
                    candidatesTokenCount: 5,
                    totalTokenCount: 15,
                },
            })
        );

        (provider as any)._client = {
            models: {
                generateContentStream,
            },
        };

        const budgetExpectations = [
            ['gemini-3.5-flash', 0, 'MINIMAL'],
            ['gemini-3.5-flash', 512, 'LOW'],
            ['gemini-3.5-flash', 2048, 'MEDIUM'],
            ['gemini-3.5-flash', 12288, 'HIGH'],
            ['gemini-3-flash-preview', 0, 'MINIMAL'],
            ['gemini-3.1-flash-lite', 0, 'MINIMAL'],
            ['gemini-3.1-pro-preview', 0, 'LOW'],
            ['gemini-3.1-flash-image', 2048, 'HIGH'],
            ['gemini-3.1-flash-lite-image', 2048, 'HIGH'],
        ] as const;

        for (const [model, thinkingBudget, thinkingLevel] of budgetExpectations) {
            const stream = provider.createResponseStream(
                [
                    {
                        type: 'message',
                        role: 'user',
                        content: 'Return JSON.',
                    },
                ] as any,
                model,
                {
                    agent_id: `test-gemini-thinking-budget-${model}-${thinkingBudget}`,
                    modelSettings: {
                        thinking_budget: thinkingBudget,
                    },
                } as any,
                `req-thinking-budget-${model}-${thinkingBudget}`
            );

            for await (const _event of stream) {
                // Drain stream.
            }

            const requestArg = generateContentStream.mock.calls.at(-1)?.[0] as any;
            expect(requestArg?.model).toBe(model);
            expect(requestArg?.config?.thinkingConfig?.thinkingLevel).toBe(thinkingLevel);
            expect(requestArg?.config?.thinkingConfig?.thinkingBudget).toBeUndefined();
        }
    });

    it('keeps modelSettings.thinking_budget numeric for Gemini models without native thinking levels', async () => {
        const provider = new GeminiProvider('test-key');
        const generateContentStream = vi.fn().mockResolvedValue(
            makeSingleChunkStream({
                candidates: [
                    {
                        content: {
                            parts: [{ text: '{"ok":true}' }],
                        },
                    },
                ],
                usageMetadata: {
                    promptTokenCount: 10,
                    candidatesTokenCount: 5,
                    totalTokenCount: 15,
                },
            })
        );

        (provider as any)._client = {
            models: {
                generateContentStream,
            },
        };

        const stream = provider.createResponseStream(
            [
                {
                    type: 'message',
                    role: 'user',
                    content: 'Return JSON.',
                },
            ] as any,
            'gemini-2.5-flash',
            {
                agent_id: 'test-gemini-legacy-thinking-budget-settings',
                modelSettings: {
                    thinking_budget: 0,
                },
            } as any,
            'req-legacy-thinking-budget-settings'
        );

        for await (const _event of stream) {
            // Drain stream.
        }

        const requestArg = generateContentStream.mock.calls.at(0)?.[0] as any;
        expect(requestArg?.model).toBe('gemini-2.5-flash');
        expect(requestArg?.config?.thinkingConfig?.thinkingBudget).toBe(0);
        expect(requestArg?.config?.thinkingConfig?.thinkingLevel).toBeUndefined();
    });

    it('maps modelSettings.thinking_level to Gemini thinking level', async () => {
        const provider = new GeminiProvider('test-key');
        const generateContentStream = vi.fn().mockResolvedValue(
            makeSingleChunkStream({
                candidates: [
                    {
                        content: {
                            parts: [{ text: '{"ok":true}' }],
                        },
                    },
                ],
                usageMetadata: {
                    promptTokenCount: 10,
                    candidatesTokenCount: 5,
                    totalTokenCount: 15,
                },
            })
        );

        (provider as any)._client = {
            models: {
                generateContentStream,
            },
        };

        const stream = provider.createResponseStream(
            [
                {
                    type: 'message',
                    role: 'user',
                    content: 'Return JSON.',
                },
            ] as any,
            'gemini-3-flash-preview',
            {
                agent_id: 'test-gemini-thinking-level-settings',
                modelSettings: {
                    thinking_level: 'high',
                },
            } as any,
            'req-thinking-level-settings'
        );

        for await (const _event of stream) {
            // Drain stream.
        }

        const requestArg = generateContentStream.mock.calls.at(0)?.[0] as any;
        expect(requestArg?.model).toBe('gemini-3-flash-preview');
        expect(requestArg?.config?.thinkingConfig?.thinkingLevel).toBe('HIGH');
        expect(requestArg?.config?.thinkingConfig?.thinkingBudget).toBeUndefined();
    });

    it('maps Gemini -high suffix to native thinking level when supported', async () => {
        const provider = new GeminiProvider('test-key');
        const generateContentStream = vi.fn().mockResolvedValue(
            makeSingleChunkStream({
                candidates: [
                    {
                        content: {
                            parts: [{ text: '{"ok":true}' }],
                        },
                    },
                ],
                usageMetadata: {
                    promptTokenCount: 10,
                    candidatesTokenCount: 5,
                    totalTokenCount: 15,
                },
            })
        );

        (provider as any)._client = {
            models: {
                generateContentStream,
            },
        };

        const stream = provider.createResponseStream(
            [
                {
                    type: 'message',
                    role: 'user',
                    content: 'Return JSON.',
                },
            ] as any,
            'gemini-3-flash-preview-high',
            { agent_id: 'test-gemini-high-thinking-level-suffix' } as any,
            'req-thinking-level-high-suffix'
        );

        for await (const _event of stream) {
            // Drain stream.
        }

        const requestArg = generateContentStream.mock.calls.at(0)?.[0] as any;
        expect(requestArg?.model).toBe('gemini-3-flash-preview');
        expect(requestArg?.config?.thinkingConfig?.thinkingLevel).toBe('HIGH');
        expect(requestArg?.config?.thinkingConfig?.thinkingBudget).toBeUndefined();
    });

    it('rejects Gemini thinking_level combined with thinking_budget', async () => {
        const provider = new GeminiProvider('test-key');
        const generateContentStream = vi.fn();

        (provider as any)._client = {
            models: {
                generateContentStream,
            },
        };

        const events = [];
        for await (const event of provider.createResponseStream(
            [
                {
                    type: 'message',
                    role: 'user',
                    content: 'Return JSON.',
                },
            ] as any,
            'gemini-3-flash-preview',
            {
                agent_id: 'test-gemini-thinking-level-budget-conflict',
                modelSettings: {
                    thinking_level: 'high',
                    thinking_budget: 12288,
                },
            } as any,
            'req-thinking-level-budget-conflict'
        )) {
            events.push(event);
        }

        expect(generateContentStream).not.toHaveBeenCalled();
        expect(events.some(event => event.type === 'error' && event.error.includes('thinking_level'))).toBe(true);
    });

    it('passes abort signals through config for Gemini streaming requests', async () => {
        const provider = new GeminiProvider('test-key');
        const abortSignal = new AbortController().signal;
        const generateContentStream = vi.fn().mockResolvedValue(
            makeSingleChunkStream({
                candidates: [
                    {
                        content: {
                            parts: [{ text: '{"ok":true}' }],
                        },
                    },
                ],
                usageMetadata: {
                    promptTokenCount: 10,
                    candidatesTokenCount: 5,
                    totalTokenCount: 15,
                },
            })
        );

        (provider as any)._client = {
            models: {
                generateContentStream,
            },
        };

        const stream = provider.createResponseStream(
            [
                {
                    type: 'message',
                    role: 'user',
                    content: 'Return JSON.',
                },
            ] as any,
            'gemini-3.1-flash-lite',
            {
                agent_id: 'test-gemini-abort-stream',
                abortSignal,
            } as any,
            'req-gemini-abort-stream'
        );

        for await (const _event of stream) {
            // Drain stream.
        }

        const requestArg = generateContentStream.mock.calls.at(0)?.[0] as any;
        expect(requestArg?.config?.abortSignal).toBe(abortSignal);
        expect(requestArg?.abortSignal).toBeUndefined();
    });

    it('passes abort signals through config for Gemini non-streaming image JSON requests', async () => {
        const provider = new GeminiProvider('test-key');
        const abortSignal = new AbortController().signal;
        const generateContent = vi.fn().mockResolvedValue({
            candidates: [
                {
                    content: {
                        parts: [{ text: '{"dominant_color":"red","confidence":0.9}' }],
                    },
                },
            ],
            usageMetadata: {
                promptTokenCount: 10,
                candidatesTokenCount: 5,
                totalTokenCount: 15,
            },
        });
        const generateContentStream = vi.fn();

        (provider as any)._client = {
            models: {
                generateContent,
                generateContentStream,
            },
        };

        const stream = provider.createResponseStream(
            [
                {
                    type: 'message',
                    role: 'user',
                    content: [
                        {
                            type: 'input_text',
                            text: 'Analyze the image and return JSON.',
                        },
                        {
                            type: 'image',
                            data: ONE_PX_PNG_BASE64,
                            mime_type: 'image/png',
                        },
                    ],
                },
            ] as any,
            'gemini-3.1-flash-lite',
            {
                agent_id: 'test-gemini-abort-nonstream',
                abortSignal,
                modelSettings: {
                    json_schema: {
                        name: 'image_analysis',
                        type: 'json_schema',
                        strict: true,
                        schema: {
                            type: 'object',
                            properties: {
                                dominant_color: { type: 'string' },
                                confidence: { type: 'number' },
                            },
                            required: ['dominant_color', 'confidence'],
                            additionalProperties: false,
                        },
                    },
                },
            } as any,
            'req-gemini-abort-nonstream'
        );

        for await (const _event of stream) {
            // Drain stream.
        }

        expect(generateContentStream).not.toHaveBeenCalled();
        const requestArg = generateContent.mock.calls.at(0)?.[0] as any;
        expect(requestArg?.config?.abortSignal).toBe(abortSignal);
        expect(requestArg?.abortSignal).toBeUndefined();
    });

    it('registers current Gemini image model metadata and legacy preview aliases', async () => {
        const imageModel = findModel('gemini-3.1-flash-image');
        const flashLiteImageModel = findModel('gemini-3.1-flash-lite-image');
        const proImageModel = findModel('gemini-3-pro-image');

        expect(imageModel?.id).toBe('gemini-3.1-flash-image');
        expect(imageModel?.class).toBe('image_generation');
        expect(imageModel?.cost?.per_image).toBe(0.067);
        expect((imageModel?.cost?.input_per_million as any)?.text).toBe(0.5);
        expect((imageModel?.cost?.output_per_million as any)?.image).toBe(60);
        expect(imageModel?.features?.context_length).toBe(131072);

        expect(flashLiteImageModel?.id).toBe('gemini-3.1-flash-lite-image');
        expect(flashLiteImageModel?.class).toBe('image_generation');
        expect(flashLiteImageModel?.cost?.per_image).toBe(0.0336);
        expect((flashLiteImageModel?.cost?.output_per_million as any)?.image).toBe(30);
        expect(flashLiteImageModel?.features?.max_output_tokens).toBe(4096);

        expect(proImageModel?.id).toBe('gemini-3-pro-image');
        expect(proImageModel?.cost?.per_image).toBe(0.134);

        expect(findModel('gemini-3.1-flash-image-preview')?.id).toBe('gemini-3.1-flash-image');
        expect(findModel('gemini-3-pro-image-preview')?.id).toBe('gemini-3-pro-image');
        expect(findModel('gemini-2.5-flash-image-preview')?.id).toBe('gemini-2.5-flash-image');
        expect(
            await getModelFromAgent({ agent_id: 'legacy-flash-image', model: 'gemini-3.1-flash-image-preview' } as any)
        ).toBe('gemini-3.1-flash-image');
    });

    it('uses 0.5K pricing for Gemini 3.1 Flash Image low-quality requests', async () => {
        const provider = new GeminiProvider('test-key');
        const generateContentStream = vi.fn().mockResolvedValue(makeGeminiImageStream());
        (provider as any)._client = {
            models: {
                generateContentStream,
            },
        };

        const usageSpy = vi.spyOn(costTracker, 'addUsage');

        await provider.createImage(
            'A minimalist banana icon',
            'gemini-3.1-flash-image',
            { agent_id: 'test-gemini-3.1-low' } as any,
            { quality: 'low', n: 1 }
        );

        const usageArg = usageSpy.mock.calls.at(-1)?.[0] as any;
        const requestArg = generateContentStream.mock.calls.at(0)?.[0] as any;

        expect(usageArg?.metadata?.cost_per_image).toBe(0.045);
        expect(requestArg?.config?.responseModalities).toEqual(['IMAGE']);
        expect(requestArg?.config?.imageConfig?.imageSize).toBe('512');

        usageSpy.mockRestore();
    });

    it('uses 0.5K pricing when explicit 512x512 size is requested', async () => {
        const provider = new GeminiProvider('test-key');
        const generateContentStream = vi.fn().mockResolvedValue(makeGeminiImageStream());
        (provider as any)._client = {
            models: {
                generateContentStream,
            },
        };

        const usageSpy = vi.spyOn(costTracker, 'addUsage');

        await provider.createImage(
            'A tiny product sticker',
            'gemini-3.1-flash-image',
            { agent_id: 'test-gemini-3.1-512' } as any,
            { size: '512x512', n: 1 }
        );

        const usageArg = usageSpy.mock.calls.at(-1)?.[0] as any;
        const requestArg = generateContentStream.mock.calls.at(0)?.[0] as any;
        expect(usageArg?.metadata?.cost_per_image).toBe(0.045);
        expect(requestArg?.config?.imageConfig?.imageSize).toBe('512');

        usageSpy.mockRestore();
    });

    it('requests 512 landscape outputs for 0.5K Gemini 3.1 Flash Image calls', async () => {
        const provider = new GeminiProvider('test-key');
        const generateContentStream = vi.fn().mockResolvedValue(makeGeminiImageStream());
        (provider as any)._client = {
            models: {
                generateContentStream,
            },
        };

        await provider.createImage(
            'A tiny landscape scene',
            'gemini-3.1-flash-image',
            { agent_id: 'test-gemini-3.1-05k-landscape' } as any,
            { quality: 'low', size: 'landscape', n: 1 }
        );

        const requestArg = generateContentStream.mock.calls.at(0)?.[0] as any;
        expect(requestArg?.config?.imageConfig?.imageSize).toBe('512');
        expect(requestArg?.config?.imageConfig?.aspectRatio).toBe('3:2');
    });

    it('requests 512 narrow portrait outputs for Gemini 3.1 Flash Image', async () => {
        const provider = new GeminiProvider('test-key');
        const generateContentStream = vi.fn().mockResolvedValue(makeGeminiImageStream());
        (provider as any)._client = {
            models: {
                generateContentStream,
            },
        };

        await provider.createImage(
            'A tall fashion poster',
            'gemini-3.1-flash-image',
            { agent_id: 'test-gemini-3.1-05k-1-4' } as any,
            { quality: 'low', size: '1:4', n: 1 }
        );

        const requestArg = generateContentStream.mock.calls.at(0)?.[0] as any;
        expect(requestArg?.config?.imageConfig?.aspectRatio).toBe('1:4');
        expect(requestArg?.config?.imageConfig?.imageSize).toBe('512');
    });

    it('uses the correct 2K pricing for medium quality', async () => {
        const provider = new GeminiProvider('test-key');
        const generateContentStream = vi.fn().mockResolvedValue(makeGeminiImageStream());
        (provider as any)._client = {
            models: {
                generateContentStream,
            },
        };

        const usageSpy = vi.spyOn(costTracker, 'addUsage');

        await provider.createImage(
            'A scenic mountain photo',
            'gemini-3.1-flash-image',
            { agent_id: 'test-gemini-3.1-2k-pricing' } as any,
            { quality: 'medium', n: 1 }
        );

        const usageArg = usageSpy.mock.calls.at(-1)?.[0] as any;
        const requestArg = generateContentStream.mock.calls.at(0)?.[0] as any;
        expect(usageArg?.metadata?.cost_per_image).toBe(0.101);
        expect(requestArg?.config?.imageConfig?.imageSize).toBe('2K');

        usageSpy.mockRestore();
    });

    it('uses the correct 4K pricing for high quality', async () => {
        const provider = new GeminiProvider('test-key');
        const generateContentStream = vi.fn().mockResolvedValue(makeGeminiImageStream());
        (provider as any)._client = {
            models: {
                generateContentStream,
            },
        };

        const usageSpy = vi.spyOn(costTracker, 'addUsage');

        await provider.createImage(
            'A detailed city skyline',
            'gemini-3.1-flash-image',
            { agent_id: 'test-gemini-3.1-4k-pricing' } as any,
            { quality: 'high', n: 1 }
        );

        const usageArg = usageSpy.mock.calls.at(-1)?.[0] as any;
        const requestArg = generateContentStream.mock.calls.at(0)?.[0] as any;
        expect(usageArg?.metadata?.cost_per_image).toBe(0.151);
        expect(requestArg?.config?.imageConfig?.imageSize).toBe('4K');

        usageSpy.mockRestore();
    });

    it('supports Gemini 3 Pro explicit table resolutions with correct tier and AR', async () => {
        const provider = new GeminiProvider('test-key');
        const generateContentStream = vi.fn().mockResolvedValue(makeGeminiImageStream());
        (provider as any)._client = {
            models: {
                generateContentStream,
            },
        };

        const usageSpy = vi.spyOn(costTracker, 'addUsage');

        await provider.createImage(
            'A cinematic panoramic city at dusk',
            'gemini-3-pro-image',
            { agent_id: 'test-gemini-3-pro-21-9-4k' } as any,
            { size: '6336x2688', n: 1 }
        );

        const usageArg = usageSpy.mock.calls.at(-1)?.[0] as any;
        const requestArg = generateContentStream.mock.calls.at(0)?.[0] as any;
        expect(requestArg?.config?.imageConfig?.aspectRatio).toBe('21:9');
        expect(requestArg?.config?.imageConfig?.imageSize).toBe('4K');
        expect(usageArg?.metadata?.cost_per_image).toBe(0.24);

        usageSpy.mockRestore();
    });

    it('enables Google image+web grounding searchTypes for Gemini 3.1 Flash Image', async () => {
        const provider = new GeminiProvider('test-key');
        const generateContentStream = vi.fn().mockResolvedValue(makeGeminiImageStream());
        (provider as any)._client = {
            models: {
                generateContentStream,
            },
        };

        await provider.createImage(
            'A butterfly on a flower',
            'gemini-3.1-flash-image',
            { agent_id: 'test-gemini-3.1-grounding' } as any,
            {
                n: 1,
                grounding: {
                    web_search: true,
                    image_search: true,
                },
            }
        );

        const requestArg = generateContentStream.mock.calls.at(0)?.[0] as any;
        expect(requestArg?.config?.tools?.[0]?.googleSearch?.searchTypes?.webSearch).toEqual({});
        expect(requestArg?.config?.tools?.[0]?.googleSearch?.searchTypes?.imageSearch).toEqual({});
    });

    it('uses 1K pricing and omits grounding for Gemini 3.1 Flash Lite Image', async () => {
        const provider = new GeminiProvider('test-key');
        const generateContentStream = vi.fn().mockResolvedValue(makeGeminiImageStream());
        (provider as any)._client = {
            models: {
                generateContentStream,
            },
        };

        const usageSpy = vi.spyOn(costTracker, 'addUsage');

        await provider.createImage(
            'A fast sticker sheet of banana icons',
            'gemini-3.1-flash-lite-image',
            { agent_id: 'test-gemini-3.1-lite-image' } as any,
            {
                n: 1,
                quality: 'high',
                size: '16:9',
                grounding: {
                    web_search: true,
                    image_search: true,
                },
                thinking: {
                    level: 'high',
                    include_thoughts: true,
                },
            }
        );

        const usageArg = usageSpy.mock.calls.at(-1)?.[0] as any;
        const requestArg = generateContentStream.mock.calls.at(0)?.[0] as any;
        expect(usageArg?.metadata?.cost_per_image).toBe(0.0336);
        expect(usageArg?.metadata?.image_size).toBe('1K');
        expect(requestArg?.config?.imageConfig?.aspectRatio).toBe('16:9');
        expect(requestArg?.config?.imageConfig?.imageSize).toBe('1K');
        expect(requestArg?.config?.tools).toBeUndefined();
        expect(requestArg?.config?.thinkingConfig?.thinkingLevel).toBe('High');
        expect(requestArg?.config?.thinkingConfig?.includeThoughts).toBe(true);

        usageSpy.mockRestore();
    });

    it('rejects unsupported Gemini 3.1 Flash Lite Image aspect ratios', async () => {
        const provider = new GeminiProvider('test-key');
        const generateContentStream = vi.fn().mockResolvedValue(makeGeminiImageStream());
        (provider as any)._client = {
            models: {
                generateContentStream,
            },
        };

        await expect(
            provider.createImage(
                'A very wide banner',
                'gemini-3.1-flash-lite-image',
                { agent_id: 'test-gemini-3.1-lite-image-ratio' } as any,
                { n: 1, size: '1:4' }
            )
        ).rejects.toThrow('gemini-3.1-flash-lite-image does not support aspect ratio 1:4');
        expect(generateContentStream).not.toHaveBeenCalled();
    });

    it('passes thinking controls for Gemini 3.1 Flash Image', async () => {
        const provider = new GeminiProvider('test-key');
        const generateContentStream = vi.fn().mockResolvedValue(makeGeminiImageStream());
        (provider as any)._client = {
            models: {
                generateContentStream,
            },
        };

        await provider.createImage(
            'A futuristic city in a bottle',
            'gemini-3.1-flash-image',
            { agent_id: 'test-gemini-3.1-thinking' } as any,
            {
                n: 1,
                thinking: {
                    level: 'high',
                    include_thoughts: true,
                },
            }
        );

        const requestArg = generateContentStream.mock.calls.at(0)?.[0] as any;
        expect(requestArg?.config?.thinkingConfig?.thinkingLevel).toBe('High');
        expect(requestArg?.config?.thinkingConfig?.includeThoughts).toBe(true);
    });

    it('omits thinkingConfig for unsupported image models', async () => {
        const provider = new GeminiProvider('test-key');
        const generateContentStream = vi.fn().mockResolvedValue(makeGeminiImageStream());
        (provider as any)._client = {
            models: {
                generateContentStream,
            },
        };

        await provider.createImage(
            'A portrait of an astronaut',
            'gemini-2.5-flash-image',
            { agent_id: 'test-gemini-2.5-thinking-ignored' } as any,
            {
                n: 1,
                thinking: {
                    include_thoughts: true,
                    level: 'high',
                },
            }
        );

        const requestArg = generateContentStream.mock.calls.at(0)?.[0] as any;
        expect(requestArg?.config?.thinkingConfig).toBeUndefined();
    });

    it('ignores malformed thinking values for unsupported image models', async () => {
        const provider = new GeminiProvider('test-key');
        const generateContentStream = vi.fn().mockResolvedValue(makeGeminiImageStream());
        (provider as any)._client = {
            models: {
                generateContentStream,
            },
        };

        await expect(
            provider.createImage(
                'A robot holding a lantern',
                'gemini-2.5-flash-image',
                { agent_id: 'test-gemini-2.5-thinking-malformed' } as any,
                {
                    n: 1,

                    thinking: 'not-an-object' as any,
                }
            )
        ).resolves.toBeInstanceOf(Array);

        const requestArg = generateContentStream.mock.calls.at(0)?.[0] as any;
        expect(requestArg?.config?.thinkingConfig).toBeUndefined();
    });

    it('returns grounding/thought metadata via on_metadata and excludes thought images from outputs', async () => {
        const provider = new GeminiProvider('test-key');
        const generateContentStream = vi.fn().mockResolvedValue(makeGeminiGroundedThoughtImageStream());
        (provider as any)._client = {
            models: {
                generateContentStream,
            },
        };

        const onMetadata = vi.fn();
        const images = await provider.createImage(
            'A detailed painting of a Timareta butterfly resting on a flower',
            'gemini-3.1-flash-image',
            { agent_id: 'test-gemini-3.1-metadata' } as any,
            {
                n: 1,
                grounding: {
                    image_search: true,
                },
                thinking: {
                    include_thoughts: true,
                },
                on_metadata: onMetadata,
            }
        );

        expect(images.length).toBe(1);

        const metadata = onMetadata.mock.calls.at(0)?.[0] as any;
        expect(metadata?.grounding?.imageSearchQueries).toContain('timareta butterfly');
        expect(metadata?.citations?.[0]?.uri).toBe('https://example.com/butterfly-source');
        expect(metadata?.citations?.[0]?.image_uri).toBe('https://images.example.com/butterfly.jpg');
        expect(metadata?.thought_signatures).toContain('signature-text-1');
        expect(metadata?.thought_signatures).toContain('signature-image-1');
        expect(Array.isArray(metadata?.thoughts)).toBe(true);
        expect(metadata?.thoughts?.length).toBeGreaterThan(0);
    });
});
