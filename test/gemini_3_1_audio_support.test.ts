import { describe, expect, it, vi } from 'vitest';
import { MODEL_CLASSES, findModel } from '../data/model_data.js';
import { GeminiProvider } from '../model_providers/gemini.js';
import { getModelFromAgent, getProviderFromModel } from '../model_providers/model_provider.js';
import type { AgentDefinition, LiveConfig } from '../types/types.js';

function makeAgent(): AgentDefinition {
    return {
        agent_id: 'test-gemini-3-1-audio',
        name: 'Gemini audio test',
        model: 'gemini-3.1-flash-tts-preview',
    };
}

describe('Gemini 3.1 audio model support', () => {
    it('registers Gemini 3.1 Flash TTS, Live, and Omni Flash models', async () => {
        const tts = findModel('gemini-3.1-flash-tts-preview');
        const live = findModel('gemini-3.1-flash-live-preview');
        const omni = findModel('gemini-omni-flash');

        expect(tts?.id).toBe('gemini-3.1-flash-tts-preview');
        expect(live?.id).toBe('gemini-3.1-flash-live-preview');
        expect(omni?.id).toBe('gemini-omni-flash-preview');
        expect(MODEL_CLASSES.voice.models).toContain('gemini-3.1-flash-tts-preview');
        expect(MODEL_CLASSES.transcription.models).toContain('gemini-3.1-flash-live-preview');
        expect(await getModelFromAgent({ agent_id: 'gemini-tts', model: 'gemini-3.1-flash-tts-preview' } as any)).toBe(
            'gemini-3.1-flash-tts-preview'
        );
        expect(getProviderFromModel('gemini-3.1-flash-live-preview')).toBe('google');
        expect(getProviderFromModel('gemini-omni-flash')).toBe('google');
    });

    it('passes Gemini 3.1 Flash TTS to the Gemini voice generation API', async () => {
        const provider = new GeminiProvider('test-api-key');
        const generateContentStream = vi.fn().mockResolvedValue(
            (async function* () {
                yield {
                    candidates: [
                        {
                            content: {
                                parts: [
                                    {
                                        inlineData: {
                                            mimeType: 'audio/wav',
                                            data: 'bW9jayBhdWRpbyBkYXRh',
                                        },
                                    },
                                ],
                            },
                        },
                    ],
                };
            })()
        );
        (provider as any)._client = {
            models: {
                generateContentStream,
            },
        };

        const result = await provider.createVoice('Read this aloud', 'gemini-3.1-flash-tts-preview', makeAgent());

        expect(result).toBeInstanceOf(ArrayBuffer);
        expect(generateContentStream.mock.calls.at(0)?.[0]?.model).toBe('gemini-3.1-flash-tts-preview');
    });

    it('allows Gemini 3.1 Flash Live sessions through provider validation', async () => {
        const provider = new GeminiProvider('test-api-key');
        const connect = vi.fn().mockImplementation(({ callbacks }) => {
            callbacks.onopen();
            return Promise.resolve({
                close: vi.fn(),
                sendClientContent: vi.fn(),
                sendRealtimeInput: vi.fn(),
                sendToolResponse: vi.fn(),
            });
        });
        (provider as any)._client = {
            live: {
                connect,
            },
        };

        const config: LiveConfig = {
            responseModalities: ['AUDIO'],
            speechConfig: {
                voiceConfig: {
                    prebuiltVoiceConfig: {
                        voiceName: 'Puck',
                    },
                },
            },
        };

        const session = await provider.createLiveSession(config, makeAgent(), 'gemini-3.1-flash-live-preview');

        expect(session.sessionId).toBeTruthy();
        expect(connect.mock.calls.at(0)?.[0]?.model).toBe('gemini-3.1-flash-live-preview');
    });
});
