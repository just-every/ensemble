import type {
    AgentDefinition,
    TranscriptionOpts,
    TranscriptionAudioSource,
    TranscriptionEvent,
} from '../types/types.js';
import { getModelFromAgent, getModelProvider, type ModelProvider } from '../model_providers/model_provider.js';
import { createTraceContext } from '../utils/trace_context.js';
import { randomUUID } from 'crypto';

// Re-export for convenience
export type { TranscriptionOpts, TranscriptionAudioSource, TranscriptionEvent };

/**
 * Normalize various audio source types to a ReadableStream
 */
function normalizeAudioSource(source: TranscriptionAudioSource): ReadableStream<Uint8Array> {
    // Already a ReadableStream
    if (source instanceof ReadableStream) {
        return source;
    }

    // AsyncIterable (including async generators)
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

    // Factory function
    if (typeof source === 'function') {
        const iterable = source();
        return normalizeAudioSource(iterable as TranscriptionAudioSource);
    }

    // ArrayBuffer or Uint8Array
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

/**
 * Transcribe audio to text using Speech-to-Text models
 *
 * @param audioSource - Audio input to transcribe (stream, buffer, etc.)
 * @param agent - Agent configuration with model selection
 * @param options - Optional configuration for transcription
 * @returns AsyncGenerator that yields transcription events
 *
 * @example
 * ```typescript
 * // Server-side with WebSocket stream
 * const audioStream = new Readable({ read() {} });
 * ws.on('message', data => audioStream.push(data));
 *
 * for await (const event of ensembleListen(audioStream, {
 *   model: 'gemini-live-2.5-flash-preview'
 * })) {
 *   if (event.type === 'transcription_turn_delta') {
 *     console.log('New text:', event.delta);
 *   }
 * }
 * ```
 */
export async function* ensembleListen(
    audioSource: TranscriptionAudioSource,
    agent: AgentDefinition,
    options: TranscriptionOpts = {}
): AsyncGenerator<TranscriptionEvent> {
    const trace = createTraceContext(agent, 'transcription');
    const requestId = randomUUID();
    let requestStarted = false;
    let turnStatus: 'completed' | 'error' = 'completed';
    let requestStatus = 'completed';
    let requestError: string | undefined;
    let transcriptionDuration: number | undefined;
    let finalTranscript: string | undefined;

    // Force streaming
    const streamOptions = { ...options, stream: true };

    // Get audio format info
    const audioFormat = options.audioFormat || {
        sampleRate: 16000,
        channels: 1,
        encoding: 'pcm' as const,
    };

    const audioSourceType =
        audioSource instanceof ReadableStream
            ? 'readable_stream'
            : audioSource instanceof ArrayBuffer
              ? 'array_buffer'
              : audioSource instanceof Uint8Array
                ? 'uint8array'
                : typeof audioSource === 'function'
                  ? 'factory'
                  : typeof audioSource === 'object' && audioSource !== null && Symbol.asyncIterator in audioSource
                    ? 'async_iterable'
                    : typeof audioSource;

    await trace.emitTurnStart({
        audio_source_type: audioSourceType,
        options: streamOptions,
    });

    try {
        // Determine which model to use
        const model = await getModelFromAgent(agent, 'transcription');
        await trace.emitRequestStart(requestId, {
            agent_id: agent.agent_id,
            model,
            payload: {
                audio_source_type: audioSourceType,
                options: streamOptions,
            },
        });
        requestStarted = true;

        // Emit initial event
        const startEvent: TranscriptionEvent = {
            type: 'transcription_start',
            timestamp: new Date().toISOString(),
            format: audioFormat.encoding || 'pcm',
            audioFormat: audioFormat,
        };
        yield startEvent;

        // Get the provider for this model
        let provider: ModelProvider;
        try {
            provider = getModelProvider(model);
        } catch (error) {
            requestStatus = 'error';
            turnStatus = 'error';
            requestError = `Failed to initialize provider for model ${model}: ${
                error instanceof Error ? error.message : 'Unknown error'
            }`;
            const errorEvent: TranscriptionEvent = {
                type: 'error',
                timestamp: new Date().toISOString(),
                error: requestError,
            };
            yield errorEvent;
            return;
        }

        if (!provider.createTranscription) {
            requestStatus = 'error';
            turnStatus = 'error';
            requestError = `Provider for model ${model} does not support transcription`;
            const errorEvent: TranscriptionEvent = {
                type: 'error',
                timestamp: new Date().toISOString(),
                error: requestError,
            };
            yield errorEvent;
            return;
        }

        // Normalize audio source to ReadableStream
        let audioStream: ReadableStream<Uint8Array>;
        try {
            audioStream = normalizeAudioSource(audioSource);
        } catch (error) {
            requestStatus = 'error';
            turnStatus = 'error';
            requestError = `Failed to normalize audio source: ${error instanceof Error ? error.message : 'Unknown error'}`;
            const errorEvent: TranscriptionEvent = {
                type: 'error',
                timestamp: new Date().toISOString(),
                error: requestError,
            };
            yield errorEvent;
            return;
        }

        // Start transcription
        const startTime = Date.now();
        let fullTranscript = '';
        let currentTurnText = '';
        const allTurns: string[] = [];

        try {
            // Pass audio stream and options to provider
            const transcriptionGenerator = provider.createTranscription(audioStream, agent, model, streamOptions);

            for await (const event of transcriptionGenerator) {
                // Track full transcript for complete event
                if (event.type === 'transcription_turn_delta' && event.delta) {
                    fullTranscript += event.delta;
                    currentTurnText += event.delta;
                }

                // Handle turn complete
                if (event.type === 'transcription_turn_complete') {
                    // Add text to the turn event
                    const turnEvent: TranscriptionEvent = {
                        ...event,
                        text: currentTurnText,
                    };
                    yield turnEvent;

                    // Save turn and reset for next turn
                    if (currentTurnText.trim()) {
                        allTurns.push(currentTurnText.trim());
                    }
                    currentTurnText = '';
                } else {
                    // Pass through all other events
                    yield event;
                }
            }

            // If there's remaining text not in a turn, add it as a final turn
            if (currentTurnText.trim()) {
                allTurns.push(currentTurnText.trim());
            }

            // Emit complete event with all turns joined
            const duration = (Date.now() - startTime) / 1000;
            const transcript = allTurns.length > 0 ? allTurns.join('\n') : fullTranscript;
            transcriptionDuration = duration;
            finalTranscript = transcript;
            const completeEvent: TranscriptionEvent = {
                type: 'transcription_complete',
                timestamp: new Date().toISOString(),
                text: transcript,
                duration: duration,
            };
            yield completeEvent;
        } catch (error) {
            requestStatus = 'error';
            turnStatus = 'error';
            requestError = error instanceof Error ? error.message : 'Transcription failed';
            console.error('[ensembleListen] Error during transcription:', error);
            const errorEvent: TranscriptionEvent = {
                type: 'error',
                timestamp: new Date().toISOString(),
                error: requestError,
            };
            yield errorEvent;
        }
    } catch (error) {
        requestStatus = 'error';
        turnStatus = 'error';
        requestError = error instanceof Error ? error.message : String(error);
        const errorEvent: TranscriptionEvent = {
            type: 'error',
            timestamp: new Date().toISOString(),
            error: requestError,
        };
        yield errorEvent;
        throw error;
    } finally {
        if (requestStarted) {
            await trace.emitRequestEnd(requestId, {
                status: requestStatus,
                error: requestError,
                duration: transcriptionDuration,
                final_response: finalTranscript,
            });
        }
        await trace.emitTurnEnd(turnStatus, turnStatus === 'completed' ? 'completed' : 'exception', {
            error: requestError,
            final_response: finalTranscript,
        });
    }
}

/**
 * Helper function to create an audio stream from a MediaStream (browser)
 * This would typically be used on the client side before sending to server
 *
 * @param mediaStream - Browser MediaStream from getUserMedia
 * @param audioContext - Optional AudioContext for processing
 * @returns ReadableStream of PCM audio data
 */
export function createAudioStreamFromMediaStream(
    mediaStream: MediaStream,
    audioContext?: AudioContext
): ReadableStream<Uint8Array> {
    const ctx = audioContext || new AudioContext({ sampleRate: 16000 });
    const source = ctx.createMediaStreamSource(mediaStream);
    const processor = ctx.createScriptProcessor(4096, 1, 1);

    return new ReadableStream({
        start(controller) {
            processor.onaudioprocess = e => {
                const float32Audio = e.inputBuffer.getChannelData(0);
                const int16Audio = new Int16Array(float32Audio.length);

                // Convert Float32 to Int16
                for (let i = 0; i < float32Audio.length; i++) {
                    const s = Math.max(-1, Math.min(1, float32Audio[i]));
                    int16Audio[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
                }

                controller.enqueue(new Uint8Array(int16Audio.buffer));
            };

            source.connect(processor);
            processor.connect(ctx.destination);
        },
        cancel() {
            processor.disconnect();
            source.disconnect();
        },
    });
}
