import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { findModel } from '../data/model_data.js';
import { DeepSeekProvider } from '../model_providers/deepseek.js';
import { createOpenAIRealtimeSession } from '../model_providers/openai_realtime.js';
import { OpenAIProvider } from '../model_providers/openai.js';
import { getModelFromAgent, getModelProvider, getProviderFromModel } from '../model_providers/model_provider.js';
import { costTracker } from '../utils/cost_tracker.js';

describe('July 2026 provider model refresh', () => {
    beforeEach(() => costTracker.reset());
    it('routes DeepSeek V4 aliases to the direct provider and maps reasoning controls', async () => {
        expect(findModel('DeepSeek-V4')?.id).toBe('deepseek-v4-pro');
        expect(findModel('DeepSeek-V4-Flash')?.id).toBe('deepseek-v4-flash');
        expect(getProviderFromModel('deepseek-v4-pro')).toBe('deepseek');
        expect(await getModelFromAgent({ agent_id: 'v4', model: 'deepseek-v4-flash' } as any)).toBe(
            'deepseek-v4-flash'
        );

        const provider = new DeepSeekProvider();
        const max = provider.prepareParameters({
            model: 'deepseek-v4-pro',
            messages: [],
            stream: true,
            reasoning: { effort: 'xhigh' },
        } as any) as any;
        expect(max.reasoning).toBeUndefined();
        expect(max.thinking).toEqual({ type: 'enabled' });
        expect(max.reasoning_effort).toBe('max');

        const disabled = provider.prepareParameters({
            model: 'deepseek-v4-flash',
            messages: [],
            stream: true,
            reasoning: { effort: 'disabled' },
        } as any) as any;
        expect(disabled.thinking).toEqual({ type: 'disabled' });
        expect(disabled.reasoning_effort).toBeUndefined();
        expect(() => getModelProvider('deepseek-chat')).toThrow('Migrate to deepseek-v4-flash');
    });

    it('registers current ElevenLabs, OpenAI, xAI video, and Laguna models', () => {
        expect(findModel('eleven_v3')?.features?.max_input_characters).toBe(5000);
        expect(findModel('eleven_turbo_v2_5')?.id).toBe('eleven_flash_v2_5');
        expect(findModel('gpt-realtime-2.1')?.features?.context_length).toBe(128000);
        expect(findModel('gpt-realtime-2.1-mini')?.cost?.input_per_million).toMatchObject({ audio: 10 });
        expect(findModel('gpt-audio-1.5')?.features?.output_modality).toContain('audio');
        expect(findModel('grok-imagine-video-1.5')?.cost?.per_second_by_resolution?.['1080p']).toBe(0.25);
        expect(findModel('Laguna S 2.1')).toMatchObject({
            id: 'poolside/laguna-s-2.1',
            provider: 'openrouter',
            cost: { input_per_million: 0.1, cached_input_per_million: 0.01, output_per_million: 0.2 },
        });
    });

    it('sends the GA OpenAI Realtime session contract over WebSocket', async () => {
        class FakeSocket extends EventEmitter {
            readyState = 1;
            sent: string[] = [];
            send(payload: string) {
                this.sent.push(payload);
            }
            close() {
                this.readyState = 3;
                this.emit('close');
            }
        }
        const socket = new FakeSocket();
        const sessionPromise = createOpenAIRealtimeSession(
            { responseModalities: ['AUDIO'] },
            { agent_id: 'realtime', instructions: 'Be concise.' },
            'gpt-realtime-2.1',
            {},
            'test-key',
            (() => socket as any) as any
        );
        queueMicrotask(() => {
            socket.emit('message', Buffer.from(JSON.stringify({ type: 'session.created', session: { id: 'sess-1' } })));
            socket.emit('message', Buffer.from(JSON.stringify({ type: 'session.updated' })));
        });
        const session = await sessionPromise;

        expect(JSON.parse(socket.sent[0])).toMatchObject({
            type: 'session.update',
            session: {
                type: 'realtime',
                model: 'gpt-realtime-2.1',
                output_modalities: ['audio'],
                audio: { input: { format: { type: 'audio/pcm', rate: 24000 } } },
            },
        });
        await session.sendText('hello');
        expect(socket.sent.map(item => JSON.parse(item).type)).toEqual([
            'session.update',
            'conversation.item.create',
            'response.create',
        ]);
        await session.close();
    });

    it('uses Chat Completions audio output for gpt-audio-1.5', async () => {
        const provider = new OpenAIProvider('test-key');
        const create = vi.fn().mockResolvedValue({
            choices: [{ message: { audio: { data: Buffer.from('audio').toString('base64') } } }],
            usage: { prompt_tokens: 10, completion_tokens: 20 },
        });
        (provider as any)._client = { chat: { completions: { create } } };

        const audio = await provider.createVoice('Hello', 'gpt-audio-1.5', { agent_id: 'audio' } as any, {
            voice: 'alloy',
            response_format: 'mp3',
        });

        expect(audio).toBeInstanceOf(ArrayBuffer);
        expect(create).toHaveBeenCalledWith(
            expect.objectContaining({
                model: 'gpt-audio-1.5',
                modalities: ['text', 'audio'],
                audio: { voice: 'alloy', format: 'mp3' },
            })
        );
        expect(costTracker.getCostsByModel()['gpt-audio-1.5']?.calls).toBe(1);
    });
});
