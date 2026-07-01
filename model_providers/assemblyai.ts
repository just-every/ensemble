import { BaseModelProvider } from './base_provider.js';
import type {
    AgentDefinition,
    ProviderStreamEvent,
    TranscriptionAudioSource,
    TranscriptionEvent,
    TranscriptionOpts,
} from '../types/types.js';
import type { WebSocket } from 'ws';

const ASSEMBLYAI_STREAMING_URL = 'wss://streaming.assemblyai.com/v3/ws';
const ASSEMBLYAI_STREAMING_MODELS = new Set(['u3-rt-pro']);
const DEFAULT_SAMPLE_RATE = 16000;
const DEFAULT_CHANNELS = 1;
const BYTES_PER_SAMPLE = 2;
const TARGET_CHUNK_MS = 50;
const WEBSOCKET_OPEN_STATE = 1;

type AssemblyAIStreamingOptions = TranscriptionOpts & {
    mode?: 'min_latency' | 'balanced' | 'max_accuracy';
    languageCode?: string;
    language_code?: string;
    keytermsPrompt?: string[];
    keyterms_prompt?: string[];
    minTurnSilence?: number;
    min_turn_silence?: number;
    maxTurnSilence?: number;
    max_turn_silence?: number;
    vadThreshold?: number;
    vad_threshold?: number;
    agentContext?: string;
    agent_context?: string;
    throttleAudio?: boolean;
    disableRealtimeThrottle?: boolean;
};

type QueueItem = TranscriptionEvent | typeof DONE;

const DONE = Symbol('done');

function normalizeAudioSource(source: TranscriptionAudioSource): ReadableStream<Uint8Array> {
    if (source instanceof ReadableStream) {
        return source;
    }

    if (typeof source === 'object' && source !== null && Symbol.asyncIterator in source) {
        return new ReadableStream({
            async start(controller) {
                try {
                    for await (const chunk of source as AsyncIterable<Uint8Array>) {
                        controller.enqueue(chunk);
                    }
                    controller.close();
                } catch (error) {
                    controller.error(error);
                }
            },
        });
    }

    if (typeof source === 'function') {
        return normalizeAudioSource(source() as TranscriptionAudioSource);
    }

    if (source instanceof ArrayBuffer || source instanceof Uint8Array) {
        const data = source instanceof ArrayBuffer ? new Uint8Array(source) : source;
        return new ReadableStream({
            start(controller) {
                controller.enqueue(data);
                controller.close();
            },
        });
    }

    throw new Error(`Unsupported audio source type: ${typeof source}`);
}

function appendBuffer(
    left: Uint8Array<ArrayBufferLike>,
    right: Uint8Array<ArrayBufferLike>
): Uint8Array<ArrayBufferLike> {
    if (left.length === 0) return right;
    const merged = new Uint8Array(left.length + right.length);
    merged.set(left);
    merged.set(right, left.length);
    return merged;
}

function copyChunk(chunk: Uint8Array<ArrayBufferLike>): Uint8Array<ArrayBufferLike> {
    const copy = new Uint8Array(chunk.length);
    copy.set(chunk);
    return copy;
}

function wait(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function getTranscriptDelta(previous: string, next: string): string {
    if (!previous) return next;
    if (next.startsWith(previous)) return next.slice(previous.length);

    let commonPrefixLength = 0;
    const limit = Math.min(previous.length, next.length);
    while (commonPrefixLength < limit && previous[commonPrefixLength] === next[commonPrefixLength]) {
        commonPrefixLength++;
    }

    return next.slice(commonPrefixLength);
}

function setParam(params: URLSearchParams, name: string, value: unknown): void {
    if (value === undefined || value === null || value === '') return;
    if (Array.isArray(value)) {
        if (value.length === 0) return;
        params.set(name, JSON.stringify(value));
        return;
    }
    params.set(name, String(value));
}

function buildStreamingUrl(model: string, opts: AssemblyAIStreamingOptions): string {
    const params = new URLSearchParams();
    params.set('sample_rate', String(opts.audioFormat?.sampleRate || DEFAULT_SAMPLE_RATE));
    params.set('speech_model', model);
    setParam(params, 'mode', opts.mode);
    setParam(params, 'prompt', opts.prompt);
    setParam(params, 'language_code', opts.language_code || opts.languageCode || opts.language);
    setParam(params, 'keyterms_prompt', opts.keyterms_prompt || opts.keytermsPrompt);
    setParam(params, 'min_turn_silence', opts.min_turn_silence || opts.minTurnSilence);
    setParam(params, 'max_turn_silence', opts.max_turn_silence || opts.maxTurnSilence);
    setParam(params, 'vad_threshold', opts.vad_threshold || opts.vadThreshold);
    setParam(params, 'agent_context', opts.agent_context || opts.agentContext);
    return `${ASSEMBLYAI_STREAMING_URL}?${params.toString()}`;
}

function isSocketOpen(ws: WebSocket): boolean {
    return ws.readyState === WEBSOCKET_OPEN_STATE;
}

export class AssemblyAIProvider extends BaseModelProvider {
    constructor(private apiKey?: string) {
        super('assemblyai');
    }

    async *createResponseStream(): AsyncGenerator<ProviderStreamEvent> {
        yield* [] as ProviderStreamEvent[];
        throw new Error('AssemblyAI provider only supports streaming transcription');
    }

    async *createTranscription(
        audio: TranscriptionAudioSource,
        _agent: AgentDefinition,
        model: string,
        opts: AssemblyAIStreamingOptions = {}
    ): AsyncGenerator<TranscriptionEvent> {
        if (!ASSEMBLYAI_STREAMING_MODELS.has(model)) {
            throw new Error(
                `Model ${model} does not support AssemblyAI streaming transcription. Supported models: ${Array.from(
                    ASSEMBLYAI_STREAMING_MODELS
                ).join(', ')}`
            );
        }

        const apiKey = this.apiKey || process.env.ASSEMBLYAI_API_KEY;
        if (!apiKey) {
            throw new Error('Failed to initialize AssemblyAI transcription. Make sure ASSEMBLYAI_API_KEY is set.');
        }

        const { WebSocket } = await import('ws');
        const ws = new WebSocket(buildStreamingUrl(model, opts), {
            headers: { Authorization: apiKey },
        });

        const queue: QueueItem[] = [];
        let wake: (() => void) | undefined;
        let finished = false;
        let socketError: Error | undefined;
        const previousTurnTranscripts = new Map<number, string>();

        const push = (item: QueueItem) => {
            queue.push(item);
            wake?.();
            wake = undefined;
        };

        const markDone = () => {
            if (finished) return;
            finished = true;
            push(DONE);
        };

        const connected = new Promise<void>((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('AssemblyAI streaming connection timeout'));
            }, 10000);

            ws.once('open', () => {
                clearTimeout(timeout);
                resolve();
            });
            ws.once('error', error => {
                clearTimeout(timeout);
                reject(error);
            });
        });

        ws.on('message', data => {
            let message: any;
            try {
                message = JSON.parse(data.toString());
            } catch (error) {
                socketError = error instanceof Error ? error : new Error(String(error));
                push({
                    type: 'error',
                    timestamp: new Date().toISOString(),
                    error: `Failed to parse AssemblyAI message: ${socketError.message}`,
                });
                return;
            }

            const timestamp = new Date().toISOString();
            switch (message.type) {
                case 'Begin':
                    break;
                case 'SpeechStarted':
                    push({
                        type: 'transcription_turn_start',
                        timestamp,
                    });
                    break;
                case 'Turn': {
                    const transcript = typeof message.transcript === 'string' ? message.transcript : '';
                    const turnOrder = typeof message.turn_order === 'number' ? message.turn_order : 0;
                    const previousTranscript = previousTurnTranscripts.get(turnOrder) || '';
                    const delta = getTranscriptDelta(previousTranscript, transcript);
                    previousTurnTranscripts.set(turnOrder, transcript);

                    if (delta) {
                        push({
                            type: 'transcription_turn_delta',
                            timestamp,
                            delta,
                            partial: !message.end_of_turn,
                        } as TranscriptionEvent);
                    }

                    if (message.end_of_turn) {
                        previousTurnTranscripts.delete(turnOrder);
                        push({
                            type: 'transcription_turn_complete',
                            timestamp,
                            text: transcript,
                        });
                    }
                    break;
                }
                case 'Termination':
                    markDone();
                    break;
                case 'Error':
                    socketError = new Error(message.error || 'AssemblyAI streaming error');
                    push({
                        type: 'error',
                        timestamp,
                        error: socketError.message,
                    });
                    markDone();
                    break;
                default:
                    break;
            }
        });

        ws.on('error', error => {
            socketError = error instanceof Error ? error : new Error(String(error));
            push({
                type: 'error',
                timestamp: new Date().toISOString(),
                error: socketError.message,
            });
            markDone();
        });

        ws.on('close', (code, reason) => {
            if (!finished && code !== 1000) {
                const detail = reason.toString() || `AssemblyAI streaming socket closed with code ${code}`;
                push({
                    type: 'error',
                    timestamp: new Date().toISOString(),
                    error: detail,
                });
            }
            markDone();
        });

        let audioPump: Promise<void> | undefined;

        try {
            await connected;
            audioPump = this.streamAudio(ws, audio, opts)
                .then(() => {
                    if (isSocketOpen(ws)) {
                        ws.send(JSON.stringify({ type: 'Terminate' }));
                    }
                })
                .catch(error => {
                    socketError = error instanceof Error ? error : new Error(String(error));
                    push({
                        type: 'error',
                        timestamp: new Date().toISOString(),
                        error: socketError.message,
                    });
                    if (isSocketOpen(ws)) {
                        ws.close();
                    }
                    markDone();
                });

            while (true) {
                if (queue.length === 0) {
                    await new Promise<void>(resolve => {
                        wake = resolve;
                    });
                }

                const item = queue.shift();
                if (!item) continue;
                if (item === DONE) break;
                yield item;
            }

            if (socketError) {
                return;
            }
        } finally {
            await audioPump?.catch(() => undefined);
            if (isSocketOpen(ws)) {
                ws.close();
            }
        }
    }

    private async streamAudio(
        ws: WebSocket,
        audio: TranscriptionAudioSource,
        opts: AssemblyAIStreamingOptions
    ): Promise<void> {
        const stream = normalizeAudioSource(audio);
        const reader = stream.getReader();
        const sampleRate = opts.audioFormat?.sampleRate || DEFAULT_SAMPLE_RATE;
        const channels = opts.audioFormat?.channels || DEFAULT_CHANNELS;
        const throttleAudio =
            opts.throttleAudio ??
            (!opts.disableRealtimeThrottle && (audio instanceof ArrayBuffer || audio instanceof Uint8Array));
        const targetBytes = Math.max(
            1,
            Math.floor((sampleRate * channels * BYTES_PER_SAMPLE * TARGET_CHUNK_MS) / 1000)
        );
        let buffer: Uint8Array<ArrayBufferLike> = new Uint8Array(0);

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (value?.length) {
                buffer = appendBuffer(buffer, copyChunk(value));
            }

            while (buffer.length >= targetBytes) {
                const chunk = buffer.slice(0, targetBytes);
                buffer = buffer.slice(targetBytes);
                await this.sendAudioChunk(ws, chunk, throttleAudio);
            }
        }

        if (buffer.length > 0) {
            await this.sendAudioChunk(ws, buffer, throttleAudio);
        }
    }

    private async sendAudioChunk(
        ws: WebSocket,
        chunk: Uint8Array<ArrayBufferLike>,
        throttleAudio: boolean
    ): Promise<void> {
        if (!isSocketOpen(ws)) {
            throw new Error('AssemblyAI streaming socket closed before audio could be sent');
        }

        await new Promise<void>((resolve, reject) => {
            ws.send(chunk, error => {
                if (error) reject(error);
                else resolve();
            });
        });

        if (throttleAudio) {
            await wait(TARGET_CHUNK_MS);
        }
    }
}

export const assemblyAIProvider = new AssemblyAIProvider();
