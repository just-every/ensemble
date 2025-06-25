import type {
    AgentDefinition,
    TranscriptionOpts,
    TranscriptionAudioSource,
    TranscriptionEvent,
} from '../types/types.js';
import { getModelFromAgent, getModelProvider, type ModelProvider } from '../model_providers/model_provider.js';

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
    // Force streaming
    const streamOptions = { ...options, stream: true };

    // Get audio format info
    const audioFormat = options.audioFormat || {
        sampleRate: 16000,
        channels: 1,
        encoding: 'pcm' as const,
    };

    // Emit initial event
    const startEvent: TranscriptionEvent = {
        type: 'transcription_start',
        timestamp: new Date().toISOString(),
        format: audioFormat.encoding || 'pcm',
        audioFormat: audioFormat,
    };
    yield startEvent;

    // Determine which model to use
    const model = await getModelFromAgent(agent, 'transcription');

    // Get the provider for this model
    let provider: ModelProvider;
    try {
        provider = getModelProvider(model);
    } catch (error) {
        const errorEvent: TranscriptionEvent = {
            type: 'error',
            timestamp: new Date().toISOString(),
            error: `Failed to initialize provider for model ${model}: ${
                error instanceof Error ? error.message : 'Unknown error'
            }`,
        };
        yield errorEvent;
        return;
    }

    if (!provider.createTranscription) {
        const errorEvent: TranscriptionEvent = {
            type: 'error',
            timestamp: new Date().toISOString(),
            error: `Provider for model ${model} does not support transcription`,
        };
        yield errorEvent;
        return;
    }

    // Normalize audio source to ReadableStream
    let audioStream: ReadableStream<Uint8Array>;
    try {
        audioStream = normalizeAudioSource(audioSource);
    } catch (error) {
        const errorEvent: TranscriptionEvent = {
            type: 'error',
            timestamp: new Date().toISOString(),
            error: `Failed to normalize audio source: ${error instanceof Error ? error.message : 'Unknown error'}`,
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
        const completeEvent: TranscriptionEvent = {
            type: 'transcription_complete',
            timestamp: new Date().toISOString(),
            text: allTurns.length > 0 ? allTurns.join('\n') : fullTranscript,
            duration: duration,
        };
        yield completeEvent;
    } catch (error) {
        console.error('[ensembleListen] Error during transcription:', error);
        const errorEvent: TranscriptionEvent = {
            type: 'error',
            timestamp: new Date().toISOString(),
            error: error instanceof Error ? error.message : 'Transcription failed',
        };
        yield errorEvent;
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
