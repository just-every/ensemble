import { describe, expect, it, vi } from 'vitest';
import { findModel } from '../data/model_data.js';
import { getModelFromAgent } from '../model_providers/model_provider.js';
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

function getPngDimensions(dataUrl: string): { width: number; height: number } {
    const match = /^data:image\/png;base64,(.+)$/i.exec(dataUrl);
    if (!match) {
        throw new Error('Expected PNG data URL');
    }

    const buf = Buffer.from(match[1], 'base64');
    if (buf.length < 24) {
        throw new Error('PNG data too short');
    }

    // PNG IHDR stores width/height at bytes 16..23 (big-endian)
    return {
        width: buf.readUInt32BE(16),
        height: buf.readUInt32BE(20),
    };
}

describe('Gemini 3.1 model support', () => {
    it('registers Gemini 3.1 Pro Preview and customtools alias', () => {
        const canonical = findModel('gemini-3.1-pro-preview');
        const customToolsAlias = findModel('gemini-3.1-pro-preview-customtools');

        expect(canonical?.id).toBe('gemini-3.1-pro-preview');
        expect(customToolsAlias?.id).toBe('gemini-3.1-pro-preview');
    });

    it('keeps backward compatibility for Gemini 3 Pro Preview aliases', () => {
        const legacyAlias = findModel('gemini-3-pro-preview');
        expect(legacyAlias?.id).toBe('gemini-3.1-pro-preview');
    });

    it('normalizes agent model aliases to the Gemini 3.1 Pro Preview canonical ID', async () => {
        const resolved = await getModelFromAgent({
            agent_id: 'test-gemini-3-1-alias',
            model: 'gemini-3.1-pro-preview-customtools',
        } as any);

        expect(resolved).toBe('gemini-3.1-pro-preview');
    });

    it('registers Gemini 3.1 Flash Image Preview pricing metadata', () => {
        const imageModel = findModel('gemini-3.1-flash-image-preview');

        expect(imageModel?.id).toBe('gemini-3.1-flash-image-preview');
        expect(imageModel?.class).toBe('image_generation');
        expect(imageModel?.cost?.per_image).toBe(0.067);
        expect((imageModel?.cost?.output_per_million as any)?.image).toBe(60);
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
            'gemini-3.1-flash-image-preview',
            { agent_id: 'test-gemini-3.1-low' } as any,
            { quality: 'low', n: 1 }
        );

        const usageArg = usageSpy.mock.calls.at(-1)?.[0] as any;
        const requestArg = generateContentStream.mock.calls.at(0)?.[0] as any;

        expect(usageArg?.metadata?.cost_per_image).toBe(0.045);
        // Keep 0.5K internal; only send documented imageSize values to Gemini.
        expect(requestArg?.config?.imageConfig?.imageSize).toBeUndefined();

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
            'gemini-3.1-flash-image-preview',
            { agent_id: 'test-gemini-3.1-512' } as any,
            { size: '512x512', n: 1 }
        );

        const usageArg = usageSpy.mock.calls.at(-1)?.[0] as any;
        expect(usageArg?.metadata?.cost_per_image).toBe(0.045);

        usageSpy.mockRestore();
    });

    it('uses table resolution for 0.5K landscape outputs', async () => {
        const provider = new GeminiProvider('test-key');
        const generateContentStream = vi.fn().mockResolvedValue(makeGeminiImageStream());
        (provider as any)._client = {
            models: {
                generateContentStream,
            },
        };

        const images = await provider.createImage(
            'A tiny landscape scene',
            'gemini-3.1-flash-image-preview',
            { agent_id: 'test-gemini-3.1-05k-landscape' } as any,
            { quality: 'low', size: 'landscape', n: 1 }
        );

        const dims = getPngDimensions(images[0]);
        expect(dims.width).toBe(688);
        expect(dims.height).toBe(384);
    });

    it('supports narrow portrait ratios from the Gemini 3.1 Flash Image table', async () => {
        const provider = new GeminiProvider('test-key');
        const generateContentStream = vi.fn().mockResolvedValue(makeGeminiImageStream());
        (provider as any)._client = {
            models: {
                generateContentStream,
            },
        };

        const images = await provider.createImage(
            'A tall fashion poster',
            'gemini-3.1-flash-image-preview',
            { agent_id: 'test-gemini-3.1-05k-1-4' } as any,
            { quality: 'low', size: '1:4', n: 1 }
        );

        const requestArg = generateContentStream.mock.calls.at(0)?.[0] as any;
        expect(requestArg?.config?.imageConfig?.aspectRatio).toBe('1:4');

        const dims = getPngDimensions(images[0]);
        expect(dims.width).toBe(256);
        expect(dims.height).toBe(1024);
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
            'gemini-3.1-flash-image-preview',
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
            'gemini-3.1-flash-image-preview',
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
            'gemini-3-pro-image-preview',
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
            'gemini-3.1-flash-image-preview',
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
            'gemini-3.1-flash-image-preview',
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
            'gemini-2.5-flash-image-preview',
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
                'gemini-2.5-flash-image-preview',
                { agent_id: 'test-gemini-2.5-thinking-malformed' } as any,
                {
                    n: 1,
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
            'gemini-3.1-flash-image-preview',
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
