import type { AgentDefinition, VoiceGenerationOpts } from '../types/types.js';
import {
    getModelFromAgent,
    getModelProvider,
    type ModelProvider,
} from '../model_providers/model_provider.js';

// Re-export for convenience
export type { VoiceGenerationOpts };

/**
 * Generate speech audio from text using Text-to-Speech models
 *
 * @param text - Text to convert to speech
 * @param agent - Agent configuration with model selection
 * @param options - Optional configuration for voice generation
 * @returns Promise that resolves to audio data stream or buffer
 *
 * @example
 * ```typescript
 * // Simple voice generation
 * const audioStream = await ensembleVoice('Hello, world!', {
 *   model: 'tts-1'
 * });
 *
 * // With specific voice and format
 * const audioStream = await ensembleVoice('Welcome to our service', {
 *   model: 'tts-1-hd'
 * }, {
 *   voice: 'nova',
 *   response_format: 'mp3'
 * });
 *
 * // Streaming audio
 * const stream = await ensembleVoice('Long text content...', {
 *   model: 'tts-1'
 * }, {
 *   stream: true
 * });
 * ```
 */
export async function ensembleVoice(
    text: string,
    agent: AgentDefinition,
    options: VoiceGenerationOpts = {}
): Promise<ReadableStream<Uint8Array> | ArrayBuffer> {
    // Determine which model to use
    const model = await getModelFromAgent(agent, 'voice');

    // Get the provider for this model
    let provider: ModelProvider;
    try {
        provider = getModelProvider(model);
    } catch (error) {
        throw new Error(
            `Failed to initialize provider for model ${model}: ${error instanceof Error ? error.message : 'Unknown error'}`
        );
    }

    if (!provider.createVoice) {
        throw new Error(
            `Provider for model ${model} does not support voice generation`
        );
    }

    // Generate the voice using the provider
    return provider.createVoice(text, model, options);
}

/**
 * Generate streaming speech audio from text
 * This is a convenience wrapper that always returns a stream
 *
 * @param text - Text to convert to speech
 * @param agent - Agent configuration with model selection
 * @param options - Optional configuration for voice generation
 * @returns AsyncGenerator that yields audio chunks with event metadata
 *
 * @example
 * ```typescript
 * // Stream audio with events
 * for await (const event of ensembleVoiceStream('Hello, world!', {
 *   model: 'tts-1'
 * })) {
 *   if (event.type === 'audio_stream') {
 *     // Process audio chunk
 *     await processAudioChunk(event.data);
 *   }
 * }
 * ```
 */
export async function* ensembleVoiceStream(
    text: string,
    agent: AgentDefinition,
    options: VoiceGenerationOpts = {}
): AsyncGenerator<any> {
    // Force streaming
    const streamOptions = { ...options, stream: true };

    // Determine which model to use (for cost tracking)
    await getModelFromAgent(agent, 'voice');

    // Get the audio format and PCM parameters if applicable
    const format = options.response_format || 'mp3';
    const isPCM = format.includes('pcm');

    // Emit initial event with format info
    yield {
        type: 'audio_stream',
        timestamp: new Date().toISOString(),
        format: format,
        ...(isPCM && {
            pcmParameters: {
                sampleRate:
                    format === 'pcm_44100'
                        ? 44100
                        : format === 'pcm_22050'
                          ? 22050
                          : format === 'pcm_16000'
                            ? 16000
                            : 24000,
                channels: 1, // Mono
                bitDepth: 16, // 16-bit signed, little-endian
            },
        }),
    };

    // Get the audio stream
    let result;
    try {
        result = await ensembleVoice(text, agent, streamOptions);
        console.log(
            '[ensembleVoiceStream] Got result from ensembleVoice:',
            typeof result,
            result instanceof ReadableStream ? 'ReadableStream' : 'ArrayBuffer'
        );
    } catch (error) {
        console.error(
            '[ensembleVoiceStream] Error calling ensembleVoice:',
            error
        );
        throw error;
    }

    if (!(result instanceof ReadableStream)) {
        throw new Error('Expected streaming response but got buffer');
    }

    const reader = result.getReader();
    const CHUNK_SIZE = 8192; // 8KB chunks
    let buffer = new Uint8Array(0);
    let chunkIndex = 0;

    try {
        let totalBytesReceived = 0;
        while (true) {
            const { done, value } = await reader.read();

            if (value) {
                totalBytesReceived += value.length;
                console.log(
                    `[ensembleVoiceStream] Received chunk: ${value.length} bytes, total: ${totalBytesReceived} bytes`
                );
                // Append to buffer
                const newBuffer = new Uint8Array(buffer.length + value.length);
                newBuffer.set(buffer);
                newBuffer.set(value, buffer.length);
                buffer = newBuffer;
            }

            // Process buffer in chunks or on completion
            while (buffer.length >= CHUNK_SIZE || (done && buffer.length > 0)) {
                const chunkSize = Math.min(CHUNK_SIZE, buffer.length);
                const chunk = buffer.slice(0, chunkSize);
                buffer = buffer.slice(chunkSize);

                // Convert to base64
                const base64Chunk = Buffer.from(chunk).toString('base64');
                const isFinalChunk = done && buffer.length === 0;

                const audioEvent = {
                    type: 'audio_stream',
                    chunkIndex: chunkIndex++,
                    isFinalChunk: isFinalChunk,
                    data: base64Chunk,
                    timestamp: new Date().toISOString(),
                };
                console.log(
                    `[ensembleVoiceStream] Yielding audio chunk ${audioEvent.chunkIndex}, size: ${chunk.length} bytes, final: ${isFinalChunk}`
                );
                yield audioEvent;

                if (isFinalChunk) break;
            }

            if (done) break;
        }
    } finally {
        reader.releaseLock();
    }

    // Also emit cost event
    try {
        const costTrackerModule = await import('../utils/cost_tracker.js');
        const costTracker = costTrackerModule.costTracker;
        const usage = (costTracker as any).entries || [];

        if (usage.length > 0) {
            const latestUsage = usage[usage.length - 1];
            yield {
                type: 'cost_update',
                usage: latestUsage,
            };
        }
    } catch (error) {
        // Cost tracking is optional
        console.debug('Cost tracking not available:', error);
    }
}
