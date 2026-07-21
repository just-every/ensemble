import type {
    AgentDefinition,
    LiveAudioBlob,
    LiveConfig,
    LiveEvent,
    LiveOptions,
    LiveSession,
    ToolCallResult,
} from '../types/types.js';
import { costTracker } from '../utils/cost_tracker.js';

type RealtimeMessage = Record<string, any>;
type RealtimeSocket = {
    readyState: number;
    on(event: string, listener: (...args: any[]) => void): unknown;
    once(event: string, listener: (...args: any[]) => void): unknown;
    send(payload: string): void;
    close(): void;
};

export type OpenAIRealtimeSocketFactory = (url: string, headers: Record<string, string>) => RealtimeSocket;

export class OpenAIRealtimeSession implements LiveSession {
    sessionId = '';
    private socket: RealtimeSocket;
    private active = true;
    private queue: LiveEvent[] = [];
    private waiters: Array<() => void> = [];
    private text = '';
    private readyResolve!: () => void;
    private readyReject!: (error: Error) => void;
    private ready = new Promise<void>((resolve, reject) => {
        this.readyResolve = resolve;
        this.readyReject = reject;
    });

    constructor(
        private readonly model: string,
        private readonly config: LiveConfig,
        private readonly agent: AgentDefinition,
        private readonly options: LiveOptions,
        apiKey: string,
        socketFactory: OpenAIRealtimeSocketFactory
    ) {
        this.socket = socketFactory(`wss://api.openai.com/v1/realtime?model=${encodeURIComponent(model)}`, {
            Authorization: `Bearer ${apiKey}`,
        });
        this.socket.on('message', data => this.handleMessage(JSON.parse(data.toString())));
        this.socket.on('close', () => {
            this.active = false;
            this.notify();
        });
        this.socket.on('error', error => {
            this.readyReject(error);
            this.push({ type: 'error', timestamp: new Date().toISOString(), error: error.message, recoverable: false });
        });
        options.abortSignal?.addEventListener('abort', () => void this.close(), { once: true });
    }

    async initialize(): Promise<void> {
        if (this.socket.readyState !== 1) {
            await new Promise<void>((resolve, reject) => {
                this.socket.once('open', resolve);
                this.socket.once('error', reject);
            });
        }
        const voice = this.config.speechConfig?.voiceConfig?.prebuiltVoiceConfig?.voiceName || 'marin';
        const tools = (this.agent.tools || []).map(tool => ({
            type: 'function',
            name: tool.definition.function.name,
            description: tool.definition.function.description,
            parameters: tool.definition.function.parameters,
        }));
        const session: Record<string, unknown> = {
            type: 'realtime',
            model: this.model,
            instructions: this.agent.instructions,
            output_modalities: [this.config.responseModalities[0] === 'AUDIO' ? 'audio' : 'text'],
            tools,
        };
        if (this.config.responseModalities[0] === 'AUDIO') {
            session.audio = {
                input: {
                    format: { type: 'audio/pcm', rate: this.options.inputAudioSampleRate ?? 24000 },
                    turn_detection: { type: 'semantic_vad' },
                },
                output: { format: { type: 'audio/pcm' }, voice },
            };
        }
        this.send({ type: 'session.update', session });
        await this.ready;
    }

    async sendAudio(audio: LiveAudioBlob): Promise<void> {
        this.send({ type: 'input_audio_buffer.append', audio: audio.data });
    }

    async commitAudio(): Promise<void> {
        this.send({ type: 'input_audio_buffer.commit' });
        this.send({ type: 'response.create' });
    }

    async sendText(text: string, role: 'user' | 'assistant' = 'user'): Promise<void> {
        this.send({
            type: 'conversation.item.create',
            item: { type: 'message', role, content: [{ type: 'input_text', text }] },
        });
        if (role === 'user') this.send({ type: 'response.create' });
    }

    async sendToolResponse(toolResults: ToolCallResult[]): Promise<void> {
        for (const result of toolResults) {
            this.send({
                type: 'conversation.item.create',
                item: {
                    type: 'function_call_output',
                    call_id: result.call_id || result.toolCall.call_id || result.toolCall.id,
                    output: result.error ?? result.output ?? '',
                },
            });
        }
        this.send({ type: 'response.create' });
    }

    async *getEventStream(): AsyncIterable<LiveEvent> {
        while (this.active || this.queue.length) {
            if (!this.queue.length) await new Promise<void>(resolve => this.waiters.push(resolve));
            while (this.queue.length) yield this.queue.shift()!;
        }
    }

    async close(): Promise<void> {
        this.active = false;
        if (this.socket.readyState === 1 || this.socket.readyState === 0) {
            this.socket.close();
        }
        this.notify();
    }

    isActive(): boolean {
        return this.active;
    }

    private handleMessage(event: RealtimeMessage): void {
        const timestamp = new Date().toISOString();
        if (event.type === 'session.created') this.sessionId = event.session?.id || event.event_id || '';
        if (event.type === 'session.updated') {
            this.readyResolve();
            this.push({ type: 'live_ready', timestamp });
        }
        if (event.type === 'response.output_text.delta') {
            this.text += event.delta || '';
            this.push({ type: 'text_delta', timestamp, delta: event.delta || '' });
            this.push({ type: 'message_delta', timestamp, delta: event.delta || '' });
        }
        if (event.type === 'response.output_audio.delta') {
            this.push({
                type: 'audio_output',
                timestamp,
                data: event.delta,
                format: { sampleRate: 24000, channels: 1, encoding: 'pcm16' },
            });
        }
        if (event.type === 'response.output_audio_transcript.delta') {
            this.text += event.delta || '';
            this.push({ type: 'transcription_output', timestamp, text: event.delta || '' });
        }
        if (event.type === 'conversation.item.input_audio_transcription.completed') {
            this.push({ type: 'transcription_input', timestamp, text: event.transcript || '' });
        }
        if (event.type === 'input_audio_buffer.speech_started') {
            this.push({ type: 'turn_start', timestamp, role: 'user' });
        }
        if (event.type === 'response.function_call_arguments.done') {
            this.push({
                type: 'tool_call',
                timestamp,
                toolCalls: [
                    {
                        id: event.item_id || event.call_id,
                        call_id: event.call_id,
                        type: 'function',
                        function: { name: event.name, arguments: event.arguments || '{}' },
                    },
                ],
            });
        }
        if (event.type === 'response.done') {
            const usage = event.response?.usage || {};
            const recorded = costTracker.addUsage({
                model: this.model,
                input_tokens: usage.input_tokens || 0,
                output_tokens: usage.output_tokens || 0,
                cached_tokens: usage.input_token_details?.cached_tokens || 0,
            });
            this.push({
                type: 'cost_update',
                timestamp,
                usage: {
                    inputTokens: recorded.input_tokens || 0,
                    outputTokens: recorded.output_tokens || 0,
                    totalTokens: recorded.total_tokens || 0,
                    totalCost: recorded.cost,
                },
            });
            this.push({
                type: 'turn_complete',
                timestamp,
                role: 'model',
                message: { type: 'message', role: 'assistant', status: 'completed', content: this.text },
            });
            this.text = '';
        }
        if (event.type === 'error') {
            this.push({
                type: 'error',
                timestamp,
                error: event.error?.message || 'OpenAI Realtime error',
                recoverable: false,
            });
        }
    }

    private send(payload: RealtimeMessage): void {
        if (this.socket.readyState !== 1) throw new Error('OpenAI Realtime socket is not open.');
        this.socket.send(JSON.stringify(payload));
    }

    private push(event: LiveEvent): void {
        this.queue.push(event);
        this.notify();
    }

    private notify(): void {
        for (const waiter of this.waiters.splice(0)) waiter();
    }
}

export async function createOpenAIRealtimeSession(
    config: LiveConfig,
    agent: AgentDefinition,
    model: string,
    options: LiveOptions = {},
    apiKey = process.env.OPENAI_API_KEY,
    socketFactory?: OpenAIRealtimeSocketFactory
): Promise<LiveSession> {
    if (!apiKey) throw new Error('OPENAI_API_KEY is required for OpenAI Realtime.');
    let resolvedSocketFactory = socketFactory;
    if (!resolvedSocketFactory) {
        const { default: WebSocket } = await import('ws');
        resolvedSocketFactory = (url, headers) => new WebSocket(url, { headers }) as unknown as RealtimeSocket;
    }
    const session = new OpenAIRealtimeSession(model, config, agent, options, apiKey, resolvedSocketFactory);
    await session.initialize();
    return session;
}
