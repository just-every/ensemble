import type { AgentDefinition, VoiceGenerationOpts } from '../types/types.js';
import { getModelFromAgent, getModelProvider, type ModelProvider } from '../model_providers/model_provider.js';
import { findModel } from '../data/model_data.js';

// Re-export for convenience
export type { VoiceGenerationOpts };

/**
 * Generate speech audio from text using Text-to-Speech models
 *
 * @param text - Text to convert to speech
 * @param agent - Agent configuration with model selection
 * @param options - Optional configuration for voice generation
 * @returns AsyncGenerator that yields audio chunks with event metadata
 *
 * @example
 * ```typescript
 * // Stream audio with events
 * for await (const event of ensembleVoice('Hello, world!', {
 *   model: 'tts-1'
 * })) {
 *   if (event.type === 'audio_stream') {
 *     // Process audio chunk
 *     await processAudioChunk(event.data);
 *   }
 * }
 *
 * // With specific voice and format
 * for await (const event of ensembleVoice('Welcome to our service', {
 *   model: 'tts-1-hd'
 * }, {
 *   voice: 'nova',
 *   response_format: 'mp3'
 * })) {
 *   // Handle events
 * }
 * ```
 */
export async function* ensembleVoice(
    text: string,
    agent: AgentDefinition,
    options: VoiceGenerationOpts = {}
): AsyncGenerator<any> {
    // Force streaming
    const streamOptions = { ...options, stream: true };

    // Get the audio format and PCM parameters if applicable
    const format = options.response_format || 'mp3';
    const isPCM = format.includes('pcm');

    // Determine which model to use
    const model = await getModelFromAgent(agent, 'voice');
    const isGemini = model.startsWith('gemini');
    const isElevenLabs = model.startsWith('eleven_');

    // Start timing
    const startTime = Date.now();
    let firstByteTime: number | null = null;
    console.log(`[ensembleVoice] Starting TTS generation with model: ${model}`);

    // Emit initial event with format info
    const modelInfo = findModel(model);
    const isOpenAI = modelInfo?.provider === 'openai';
    const isWav = format === 'wav';

    // Determine effective format after any conversions
    const effectiveFormat = isGemini || (isElevenLabs && isPCM) ? 'wav' : format;

    // Determine if format supports streaming
    const supportsStreaming = effectiveFormat === 'wav' || effectiveFormat.includes('pcm');

    // Get MIME type
    const getMimeType = (fmt: string): string => {
        const mimeTypes: Record<string, string> = {
            mp3: 'audio/mpeg',
            opus: 'audio/opus',
            aac: 'audio/aac',
            flac: 'audio/flac',
            wav: 'audio/wav',
            pcm: 'audio/pcm',
            pcm_16000: 'audio/pcm',
            pcm_22050: 'audio/pcm',
            pcm_24000: 'audio/pcm',
            pcm_44100: 'audio/pcm',
        };
        return mimeTypes[fmt] || 'audio/mpeg';
    };

    // Emit format info event
    yield {
        type: 'format_info',
        timestamp: new Date().toISOString(),
        format: effectiveFormat,
        mimeType: getMimeType(effectiveFormat),
        supportsStreaming,
        ...(isPCM || isGemini || (isOpenAI && isWav)
            ? {
                  pcmParameters: {
                      sampleRate: isGemini
                          ? 24000 // Gemini TTS uses 24kHz
                          : isOpenAI
                            ? 24000 // OpenAI TTS uses 24kHz
                            : format === 'pcm_44100'
                              ? 44100
                              : format === 'pcm_22050'
                                ? 22050
                                : format === 'pcm_16000'
                                  ? 16000
                                  : 24000,
                      channels: 1, // Mono
                      bitDepth: 16, // 16-bit signed, little-endian
                  },
              }
            : {}),
    };

    // Also emit the legacy audio_stream event for backwards compatibility
    yield {
        type: 'audio_stream',
        timestamp: new Date().toISOString(),
        format: effectiveFormat,
        ...(isPCM || isGemini || (isOpenAI && isWav)
            ? {
                  pcmParameters: {
                      sampleRate: isGemini
                          ? 24000 // Gemini TTS uses 24kHz
                          : isOpenAI
                            ? 24000 // OpenAI TTS uses 24kHz
                            : format === 'pcm_44100'
                              ? 44100
                              : format === 'pcm_22050'
                                ? 22050
                                : format === 'pcm_16000'
                                  ? 16000
                                  : 24000,
                      channels: 1, // Mono
                      bitDepth: 16, // 16-bit signed, little-endian
                  },
              }
            : {}),
    };

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
        throw new Error(`Provider for model ${model} does not support voice generation`);
    }

    // Get the audio stream
    let result;
    try {
        const providerStartTime = Date.now();
        result = await provider.createVoice(text, model, agent, streamOptions);
        const providerTime = Date.now() - providerStartTime;
        console.log(
            `[ensembleVoice] Got result from provider in ${providerTime}ms:`,
            typeof result,
            result instanceof ReadableStream ? 'ReadableStream' : 'ArrayBuffer'
        );
    } catch (error) {
        console.error('[ensembleVoice] Error calling provider.createVoice:', error);
        throw error;
    }

    if (!(result instanceof ReadableStream)) {
        throw new Error('Expected streaming response but got buffer');
    }

    const reader = result.getReader();
    const CHUNK_SIZE = 8192; // 8KB chunks
    let buffer = new Uint8Array(0);
    let chunkIndex = 0;

    // For Gemini, ElevenLabs PCM, or OpenAI WAV, we need to handle WAV streaming
    const needsWavHandling = isGemini || (isElevenLabs && isPCM) || (isOpenAI && isWav);

    if (needsWavHandling) {
        const provider = isGemini ? 'Gemini' : isOpenAI ? 'OpenAI' : 'ElevenLabs';

        // Determine sample rate upfront
        let sampleRate: number;
        if (isGemini || isOpenAI) {
            sampleRate = 24000; // Both Gemini and OpenAI TTS use 24kHz
        } else {
            // ElevenLabs - extract sample rate from format string
            if (format === 'pcm_16000') sampleRate = 16000;
            else if (format === 'pcm_22050') sampleRate = 22050;
            else if (format === 'pcm_44100') sampleRate = 44100;
            else sampleRate = 24000; // Default for generic 'pcm'
        }
        console.log(`[ensembleVoice] ${provider}: Will stream with sample rate ${sampleRate}Hz`);

        // For Gemini, we know it returns all data at once, so use larger chunks
        const providerChunkSize = isGemini ? 32768 : CHUNK_SIZE; // 32KB for Gemini, 8KB for others

        let isFirstChunk = true;
        let hasWavHeader = false;
        let headerBuffer = new Uint8Array(0);

        while (true) {
            const { done, value } = await reader.read();

            if (value) {
                if (!firstByteTime) {
                    firstByteTime = Date.now();
                }

                // Append to buffer
                const newBuffer = new Uint8Array(buffer.length + value.length);
                newBuffer.set(buffer);
                newBuffer.set(value, buffer.length);
                buffer = newBuffer;
            }

            // Check for WAV header on first chunk
            if (isFirstChunk && buffer.length >= 4) {
                const header = new TextDecoder().decode(buffer.slice(0, 4));
                hasWavHeader = header === 'RIFF';
                isFirstChunk = false;

                // If no WAV header, prepare to add one
                if (!hasWavHeader) {
                    // Create WAV header with placeholder size (we'll use a large value)
                    const dataSize = 0x7ffffffe; // Maximum possible size for streaming
                    const wavHeader = new ArrayBuffer(44);
                    const view = new DataView(wavHeader);

                    // Helper to write string
                    const setString = (offset: number, str: string) => {
                        for (let i = 0; i < str.length; i++) {
                            view.setUint8(offset + i, str.charCodeAt(i));
                        }
                    };

                    // Write WAV header
                    setString(0, 'RIFF');
                    view.setUint32(4, dataSize + 36, true); // File size - 8
                    setString(8, 'WAVE');
                    setString(12, 'fmt ');
                    view.setUint32(16, 16, true); // fmt chunk size
                    view.setUint16(20, 1, true); // PCM format
                    view.setUint16(22, 1, true); // Mono
                    view.setUint32(24, sampleRate, true);
                    view.setUint32(28, sampleRate * 2, true); // Byte rate
                    view.setUint16(32, 2, true); // Block align
                    view.setUint16(34, 16, true); // Bits per sample
                    setString(36, 'data');
                    view.setUint32(40, dataSize, true); // Data size

                    // Prepend header to buffer
                    headerBuffer = new Uint8Array(wavHeader);
                    const newBuffer = new Uint8Array(headerBuffer.length + buffer.length);
                    newBuffer.set(headerBuffer);
                    newBuffer.set(buffer, headerBuffer.length);
                    buffer = newBuffer;
                }
            }

            // Process buffer in chunks
            while (buffer.length >= providerChunkSize || (done && buffer.length > 0)) {
                const chunkSize = Math.min(providerChunkSize, buffer.length);
                const chunk = buffer.slice(0, chunkSize);
                buffer = buffer.slice(chunkSize);

                const base64Chunk = Buffer.from(chunk).toString('base64');
                const isFinalChunk = done && buffer.length === 0;

                yield {
                    type: 'audio_stream',
                    chunkIndex: chunkIndex++,
                    isFinalChunk: isFinalChunk,
                    data: base64Chunk,
                    timestamp: new Date().toISOString(),
                };

                if (isFinalChunk) break;
            }

            if (done) break;
        }
    } else {
        // For other providers, stream as before
        while (true) {
            const { done, value } = await reader.read();

            if (value) {
                if (!firstByteTime) {
                    firstByteTime = Date.now();
                }

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
                yield audioEvent;

                if (isFinalChunk) break;
            }

            if (done) break;
        }
    }

    // Log total time
    const totalTime = Date.now() - startTime;
    console.log(`[ensembleVoice] ${model}: Total generation time: ${totalTime}ms`);

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
