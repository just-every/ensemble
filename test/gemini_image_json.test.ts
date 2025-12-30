import { describe, it, expect } from 'vitest';
import { ensembleRequest } from '../core/ensemble_request.js';
import { setEnsembleLogger } from '../utils/llm_logger.js';

const liveKey = process.env.LIVE_GOOGLE_API_KEY;
const hasRealGoogleKey = !!liveKey;

const liveIt = hasRealGoogleKey ? it : it.skip;

describe('Gemini image JSON output (live)', () => {
    liveIt(
        'returns JSON for image input with gemini-3-flash-preview',
        async () => {
            if (!liveKey) {
                throw new Error('LIVE_GOOGLE_API_KEY is required to run this test');
            }

            process.env.GOOGLE_API_KEY = liveKey;

            const imageBase64 =
                'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAAKElEQVR4nO3NMQEAAAjDMMC/ZzDBvlRA01vZJvwHAAAAAAAAAAAAbx2jxAE/i2AjOgAAAABJRU5ErkJggg==';

            const agent = {
                model: 'gemini-3-flash-preview',
                modelSettings: {
                    max_tokens: 256,
                    temperature: 0.2,
                    json_schema: {
                        name: 'image_analysis',
                        type: 'json_schema',
                        schema: {
                            type: 'object',
                            properties: {
                                dominant_color: { type: 'string' },
                                confidence: { type: 'number' },
                            },
                            required: ['dominant_color', 'confidence'],
                        },
                    },
                },
            };

            const messages = [
                {
                    type: 'message',
                    role: 'user',
                    content: [
                        {
                            type: 'input_text',
                            text: 'Analyze this image and return JSON with dominant_color and confidence.',
                        },
                        {
                            type: 'image',
                            data: imageBase64,
                            mime_type: 'image/png',
                        },
                    ],
                },
            ];

            let capturedRequest: any | null = null;
            setEnsembleLogger({
                log_llm_request: (_agentId, providerName, model, requestData) => {
                    if (providerName === 'google' && model === 'gemini-3-flash-preview') {
                        capturedRequest = requestData as any;
                    }
                    return 'gemini-image-json-test';
                },
                log_llm_response: () => {},
                log_llm_error: () => {},
            });

            let output = '';
            for await (const event of ensembleRequest(messages, agent)) {
                if (event.type === 'message_complete' && 'content' in event) {
                    output += event.content;
                }
            }

            setEnsembleLogger(null);

            expect(capturedRequest).toBeTruthy();
            const contents = capturedRequest?.contents || [];
            const parts = contents.flatMap((content: any) => content?.parts || []);
            const inlinePart = parts.find((part: any) => part?.inlineData);
            expect(inlinePart?.inlineData?.mimeType).toBe('image/png');
            expect(typeof inlinePart?.inlineData?.data).toBe('string');
            expect(inlinePart?.inlineData?.data?.length).toBeGreaterThan(0);
            expect(inlinePart?.inlineData?.data).not.toContain('data:image');
            const textPart = parts.find(
                (part: any) =>
                    typeof part?.text === 'string' &&
                    part.text.includes('Analyze this image and return JSON')
            );
            expect(textPart).toBeTruthy();

            const parsed = JSON.parse(output);
            expect(typeof parsed.dominant_color).toBe('string');
            expect(parsed.dominant_color.length).toBeGreaterThan(0);
            expect(typeof parsed.confidence).toBe('number');
        },
        30000
    );
});
