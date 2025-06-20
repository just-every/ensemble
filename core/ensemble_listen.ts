/**
 * Audio transcription streaming functionality for the ensemble system
 */

import type {
    AgentDefinition,
    TranscriptionOpts,
    TranscriptionAudioSource,
    TranscriptionEvent,
} from '../types/types.js';
import {
    getModelFromAgent,
    getModelProvider,
    type ModelProvider,
} from '../model_providers/model_provider.js';
import { streamOpenAIRealtime } from '../utils/openai_realtime_client.js';
import { streamGeminiLive } from '../utils/gemini_live_client.js';

// Re-export for convenience
export type { TranscriptionOpts, TranscriptionAudioSource, TranscriptionEvent };

/**
 * Stream audio transcription using Speech-to-Text models
 *
 * @param audio - Audio input to transcribe (stream, buffer, blob, or base64)
 * @param agent - Agent configuration with model selection
 * @param options - Optional configuration for transcription
 * @returns AsyncGenerator that yields transcription events
 *
 * @example
 * ```typescript
 * // Stream audio from microphone
 * const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
 * const audioStream = new ReadableStream({
 *   // ... convert MediaStream to ReadableStream<Uint8Array>
 * });
 *
 * for await (const event of ensembleListen(audioStream, {
 *   model: 'gpt-4o-realtime-preview'
 * })) {
 *   if (event.type === 'transcription_delta') {
 *     console.log('Partial:', event.delta);
 *   } else if (event.type === 'transcription_complete') {
 *     console.log('Final:', event.text);
 *   }
 * }
 *
 * // Transcribe audio file
 * const audioFile = await fetch('audio.wav').then(r => r.arrayBuffer());
 * for await (const event of ensembleListen(audioFile, {
 *   model: 'whisper-1'
 * }, {
 *   language: 'en',
 *   response_format: 'verbose_json'
 * })) {
 *   // Handle events
 * }
 * ```
 */
export async function* ensembleListen(
    audio: TranscriptionAudioSource,
    agent: AgentDefinition,
    options: TranscriptionOpts = {}
): AsyncGenerator<TranscriptionEvent> {
    // Force streaming mode
    const streamOptions = { ...options, stream: true };

    // Determine which model to use
    console.log('[ensembleListen] Agent:', agent);
    const model = await getModelFromAgent(agent, 'transcription');
    console.log('[ensembleListen] Selected model:', model);

    // Get the provider for this model
    let provider: ModelProvider;
    try {
        console.log('[ensembleListen] Getting provider for model:', model);
        provider = getModelProvider(model);
        console.log('[ensembleListen] Got provider:', provider.provider_id);
    } catch (error) {
        throw new Error(
            `Failed to initialize provider for model ${model}: ${error instanceof Error ? error.message : 'Unknown error'}`
        );
    }

    // Check if we need to use special streaming clients
    if (
        model.includes('realtime') ||
        model === 'gpt-4o-realtime-preview' ||
        model === 'gpt-4o-realtime-preview-2024-12-17'
    ) {
        // Use OpenAI Realtime WebSocket
        const apiKey = process.env.OPENAI_API_KEY;
        if (!apiKey) {
            throw new Error(
                'OPENAI_API_KEY environment variable is required for OpenAI Realtime models'
            );
        }

        yield* streamOpenAIRealtime(audio, {
            apiKey,
            model,
            options: streamOptions,
        });
        return;
    } else if (model.includes('gemini') && model.includes('live')) {
        // Use Gemini Live API
        const apiKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
        if (!apiKey) {
            throw new Error(
                'GOOGLE_API_KEY or GEMINI_API_KEY environment variable is required for Gemini Live models'
            );
        }

        yield* streamGeminiLive(audio, {
            apiKey,
            model,
            options: streamOptions,
        });
        return;
    }

    // Check if provider supports transcription
    if (!provider.createTranscription) {
        throw new Error(
            `Provider for model ${model} does not support audio transcription`
        );
    }

    // Use the provider's transcription method
    try {
        yield* provider.createTranscription(audio, model, streamOptions);
    } catch (error) {
        console.error('[ensembleListen] Error during transcription:', error);
        throw error;
    }

    // Emit cost event if available
    try {
        const costTrackerModule = await import('../utils/cost_tracker.js');
        const costTracker = costTrackerModule.costTracker;
        const usage = (costTracker as any).entries || [];

        if (usage.length > 0) {
            const latestUsage = usage[usage.length - 1];
            yield {
                type: 'cost_update' as const,
                timestamp: new Date().toISOString(),
                usage: latestUsage,
            };
        }
    } catch (error) {
        // Cost tracking is optional
        console.debug('Cost tracking not available:', error);
    }
}

/**
 * Helper function to convert browser MediaStream to ReadableStream<Uint8Array>
 * This is a common pattern when using getUserMedia
 *
 * @param mediaStream - MediaStream from getUserMedia
 * @param options - Audio processing options
 * @returns ReadableStream<Uint8Array> of PCM audio data
 *
 * @example
 * ```typescript
 * const mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
 * const audioStream = createAudioStreamFromMediaStream(mediaStream, {
 *   sampleRate: 16000,
 *   channelCount: 1
 * });
 *
 * for await (const event of ensembleListen(audioStream, agent)) {
 *   // Handle transcription events
 * }
 * ```
 */
export function createAudioStreamFromMediaStream(
    mediaStream: MediaStream,
    options: {
        sampleRate?: number;
        channelCount?: number;
        bufferSize?: number;
    } = {}
): ReadableStream<Uint8Array> {
    const audioContext = new (window.AudioContext ||
        (window as any).webkitAudioContext)({
        sampleRate: options.sampleRate || 16000,
    });

    const source = audioContext.createMediaStreamSource(mediaStream);

    // Create a ScriptProcessorNode (deprecated but still works)
    // In production, you might want to use AudioWorklet instead
    const bufferSize = options.bufferSize || 4096;
    const processor = audioContext.createScriptProcessor(
        bufferSize,
        options.channelCount || 1,
        1
    );

    const chunks: Uint8Array[] = [];

    processor.onaudioprocess = event => {
        const inputData = event.inputBuffer.getChannelData(0);

        // Convert Float32Array to Int16Array (PCM16)
        const pcm16 = new Int16Array(inputData.length);
        for (let i = 0; i < inputData.length; i++) {
            const s = Math.max(-1, Math.min(1, inputData[i]));
            pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
        }

        // Convert to Uint8Array
        const buffer = new ArrayBuffer(pcm16.length * 2);
        const view = new DataView(buffer);
        for (let i = 0; i < pcm16.length; i++) {
            view.setInt16(i * 2, pcm16[i], true); // little-endian
        }

        chunks.push(new Uint8Array(buffer));
    };

    source.connect(processor);
    processor.connect(audioContext.destination);

    return new ReadableStream<Uint8Array>({
        async pull(controller) {
            // Wait for chunks to accumulate
            while (chunks.length === 0) {
                await new Promise(resolve => setTimeout(resolve, 10));
            }

            // Send accumulated chunks
            const chunk = chunks.shift()!;
            controller.enqueue(chunk);
        },

        cancel() {
            processor.disconnect();
            source.disconnect();
            audioContext.close();
            mediaStream.getTracks().forEach(track => track.stop());
        },
    });
}
