/**
 * OpenAI Realtime API WebSocket client for audio streaming and transcription
 */

// Dynamic import for WebSocket to support both Node.js and browser
let WebSocket: any;
if (typeof window !== 'undefined' && window.WebSocket) {
    WebSocket = window.WebSocket;
} else {
    // In Node.js, we'll load it dynamically when needed
    WebSocket = null;
}
import type {
    TranscriptionOpts,
    TranscriptionEvent,
    TranscriptionAudioSource,
    TranscriptionStartEvent,
    TranscriptionDeltaEvent,
    TranscriptionCompleteEvent,
    VADSpeechEvent,
    ErrorEvent,
} from '../types/types.js';

export interface OpenAIRealtimeConfig {
    apiKey: string;
    model?: string;
    options?: TranscriptionOpts;
}

export interface OpenAIRealtimeMessage {
    type: string;
    event_id?: string;
    session?: any;
    conversation?: any;
    audio?: string;
    item?: any;
    error?: any;
    delta?: any;
}

/**
 * Connects to OpenAI Realtime API and streams audio for transcription
 */
export async function* streamOpenAIRealtime(
    audio: TranscriptionAudioSource,
    config: OpenAIRealtimeConfig
): AsyncGenerator<TranscriptionEvent> {
    // Load WebSocket for Node.js if needed
    if (!WebSocket) {
        try {
            const wsModule = await import('ws');
            WebSocket = wsModule.default;
        } catch {
            throw new Error(
                'WebSocket not available. In Node.js, install the "ws" package.'
            );
        }
    }

    const wsUrl = 'wss://api.openai.com/v1/realtime';
    const model = config.model || 'gpt-4o-realtime-preview-2024-12-17';

    // Create WebSocket connection with headers
    const ws = new WebSocket(wsUrl, {
        headers: {
            Authorization: `Bearer ${config.apiKey}`,
            'OpenAI-Beta': 'realtime=v1',
        },
    });

    // Event queue for handling async events
    const eventQueue: TranscriptionEvent[] = [];
    let wsConnected = false;
    let sessionConfigured = false;
    let audioStreamEnded = false;
    let transcriptionComplete = false;
    let currentTranscript = '';
    let error: Error | null = null;

    // Handle WebSocket events
    ws.on('open', () => {
        console.log('[OpenAI Realtime] WebSocket connected');
        wsConnected = true;

        // Configure session
        const sessionConfig = {
            type: 'session.update',
            session: {
                model: model,
                modalities: ['text'], // Only text output for transcription
                instructions: 'Transcribe the audio input accurately.',
                voice: 'echo', // Default voice (not used for transcription)
                input_audio_format: 'pcm16',
                output_audio_format: 'pcm16',
                input_audio_transcription: {
                    enabled: true,
                    model: 'whisper-1',
                },
                turn_detection:
                    config.options?.vad?.enabled !== false
                        ? {
                              type: config.options?.vad?.mode || 'server_vad',
                              threshold: config.options?.vad?.threshold || 0.5,
                              prefix_padding_ms:
                                  config.options?.vad?.prefix_padding_ms || 300,
                              silence_duration_ms:
                                  config.options?.vad?.silence_duration_ms ||
                                  200,
                          }
                        : null,
                temperature: config.options?.temperature || 0.8,
                max_output_tokens: 'inf',
            },
        };

        ws.send(JSON.stringify(sessionConfig));
        sessionConfigured = true;

        // Emit start event
        const startEvent: TranscriptionStartEvent = {
            type: 'transcription_start',
            timestamp: new Date().toISOString(),
            format: config.options?.response_format || 'text',
            language: config.options?.language,
            audio_format: {
                sampleRate: 24000,
                channels: 1,
                bitDepth: 16,
                encoding: 'pcm',
            },
        };
        eventQueue.push(startEvent);
    });

    ws.on('message', (data: Buffer) => {
        try {
            const message: OpenAIRealtimeMessage = JSON.parse(data.toString());
            console.log('[OpenAI Realtime] Received message:', message.type);

            switch (message.type) {
                case 'session.created':
                case 'session.updated':
                    console.log('[OpenAI Realtime] Session configured');
                    break;

                case 'input_audio_buffer.speech_started': {
                    const vadStartEvent: VADSpeechEvent = {
                        type: 'vad_speech_start',
                        timestamp: new Date().toISOString(),
                        audio_ms: message.audio
                            ? parseInt(message.audio)
                            : undefined,
                    };
                    eventQueue.push(vadStartEvent);
                    break;
                }

                case 'input_audio_buffer.speech_stopped': {
                    const vadEndEvent: VADSpeechEvent = {
                        type: 'vad_speech_end',
                        timestamp: new Date().toISOString(),
                        audio_ms: message.audio
                            ? parseInt(message.audio)
                            : undefined,
                    };
                    eventQueue.push(vadEndEvent);
                    break;
                }

                case 'conversation.item.input_audio_transcription.completed':
                    if (message.item?.transcript) {
                        currentTranscript = message.item.transcript;
                        const deltaEvent: TranscriptionDeltaEvent = {
                            type: 'transcription_delta',
                            timestamp: new Date().toISOString(),
                            delta: message.item.transcript,
                        };
                        eventQueue.push(deltaEvent);
                    }
                    break;

                case 'conversation.item.input_audio_transcription.failed': {
                    const errorEvent: ErrorEvent = {
                        type: 'error',
                        timestamp: new Date().toISOString(),
                        error: message.error?.message || 'Transcription failed',
                    };
                    eventQueue.push(errorEvent);
                    break;
                }

                case 'error':
                    error = new Error(
                        message.error?.message || 'Unknown error'
                    );
                    break;
            }
        } catch (err) {
            console.error('[OpenAI Realtime] Error parsing message:', err);
            error = err as Error;
        }
    });

    ws.on('error', (err: Error) => {
        console.error('[OpenAI Realtime] WebSocket error:', err);
        error = err;
    });

    ws.on('close', () => {
        console.log('[OpenAI Realtime] WebSocket closed');
        wsConnected = false;
        transcriptionComplete = true;
    });

    // Wait for connection
    while (!wsConnected && !error) {
        await new Promise(resolve => setTimeout(resolve, 10));
    }

    if (error) {
        throw error;
    }

    // Wait for session configuration
    while (!sessionConfigured && !error) {
        await new Promise(resolve => setTimeout(resolve, 10));
    }

    // Start streaming audio
    if (audio instanceof ReadableStream) {
        // Handle browser ReadableStream
        const reader = audio.getReader();

        (async () => {
            try {
                while (true) {
                    const { done, value } = await reader.read();

                    if (done) {
                        audioStreamEnded = true;
                        break;
                    }

                    if (value && wsConnected) {
                        // Convert Uint8Array to PCM16 if needed
                        const pcmData = await convertToPCM16(
                            value,
                            config.options?.audio_format
                        );

                        // Send audio chunk
                        const audioMessage = {
                            type: 'input_audio_buffer.append',
                            audio: Buffer.from(pcmData).toString('base64'),
                        };
                        ws.send(JSON.stringify(audioMessage));
                    }
                }

                // Commit the audio buffer to trigger final transcription
                if (wsConnected) {
                    ws.send(
                        JSON.stringify({ type: 'input_audio_buffer.commit' })
                    );
                }
            } catch (err) {
                console.error(
                    '[OpenAI Realtime] Error reading audio stream:',
                    err
                );
                error = err as Error;
            } finally {
                reader.releaseLock();
            }
        })();
    } else if (audio instanceof ArrayBuffer) {
        // Handle ArrayBuffer
        const pcmData = await convertToPCM16(
            new Uint8Array(audio),
            config.options?.audio_format
        );

        const audioMessage = {
            type: 'input_audio_buffer.append',
            audio: Buffer.from(pcmData).toString('base64'),
        };
        ws.send(JSON.stringify(audioMessage));
        ws.send(JSON.stringify({ type: 'input_audio_buffer.commit' }));
        audioStreamEnded = true;
    } else if (typeof audio === 'string') {
        // Handle base64 string
        const audioMessage = {
            type: 'input_audio_buffer.append',
            audio: audio,
        };
        ws.send(JSON.stringify(audioMessage));
        ws.send(JSON.stringify({ type: 'input_audio_buffer.commit' }));
        audioStreamEnded = true;
    }

    // Yield events from the queue
    while (!transcriptionComplete || eventQueue.length > 0) {
        if (error) {
            throw error;
        }

        if (eventQueue.length > 0) {
            const event = eventQueue.shift()!;
            yield event;
        } else {
            // Wait for more events
            await new Promise(resolve => setTimeout(resolve, 10));
        }

        // Check if we should close
        if (audioStreamEnded && eventQueue.length === 0) {
            // Wait a bit for final events
            await new Promise(resolve => setTimeout(resolve, 500));

            // Send final transcription event
            if (currentTranscript) {
                const completeEvent: TranscriptionCompleteEvent = {
                    type: 'transcription_complete',
                    timestamp: new Date().toISOString(),
                    text: currentTranscript,
                };
                yield completeEvent;
            }

            // Close WebSocket
            ws.close();
            break;
        }
    }
}

/**
 * Convert audio data to PCM16 format required by OpenAI
 */
async function convertToPCM16(
    audioData: Uint8Array,
    audioFormat?: TranscriptionOpts['audio_format']
): Promise<Uint8Array> {
    // Import AudioConverter dynamically to avoid circular dependencies
    const { AudioConverter } = await import('./audio_converter.js');

    // OpenAI Realtime API requires 24kHz PCM16
    return AudioConverter.convertToPCM16(audioData, audioFormat, 24000);
}
