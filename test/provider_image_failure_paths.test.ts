import { describe, expect, it, vi } from 'vitest';
import { OpenAIProvider } from '../model_providers/openai.js';
import { GeminiProvider } from '../model_providers/gemini.js';
import { GrokProvider } from '../model_providers/grok.js';

describe('provider image failure paths', () => {
    it('OpenAI rejects non-positive image counts instead of defaulting them to one', async () => {
        const provider = new OpenAIProvider('sk-test');
        (provider as any)._client = {
            images: {
                generate: vi.fn(),
            },
        };

        await expect(
            provider.createImage('A failed render', 'gpt-image-1.5', { agent_id: 'test-openai' } as any, { n: 0 })
        ).rejects.toThrow('ImageGenerationOpts.n must be a positive integer');

        expect((provider as any)._client.images.generate).not.toHaveBeenCalled();
    });

    it('OpenAI throws when the image response is missing image data', async () => {
        const provider = new OpenAIProvider('sk-test');
        (provider as any)._client = {
            images: {
                generate: vi.fn().mockResolvedValue({ data: [{}] }),
            },
        };

        await expect(
            provider.createImage('A failed render', 'gpt-image-1.5', { agent_id: 'test-openai' } as any, {})
        ).rejects.toThrow('No image data returned from OpenAI');
    });

    it('Gemini throws when the image stream completes without image parts', async () => {
        const provider = new GeminiProvider('test-key');
        (provider as any)._client = {
            models: {
                generateContentStream: vi.fn().mockImplementation(async function* () {
                    yield {
                        candidates: [
                            {
                                content: {
                                    parts: [{ text: 'No image here' }],
                                },
                            },
                        ],
                    };
                }),
            },
        };

        await expect(
            provider.createImage(
                'A failed Gemini render',
                'gemini-2.5-flash-image-preview',
                { agent_id: 'test-gemini' } as any,
                {}
            )
        ).rejects.toThrow('No images returned from gemini-2.5-flash-image-preview model');
    });

    it('Grok throws when the API returns no image outputs', async () => {
        const provider = new GrokProvider();
        (provider as any)._client = {
            post: vi.fn().mockResolvedValue({ data: [] }),
        };

        await expect(
            provider.createImage(
                'A failed xAI render',
                'grok-imagine-image',
                { agent_id: 'test-grok' } as any,
                {}
            )
        ).rejects.toThrow('xAI image generation returned no images.');
    });
});
