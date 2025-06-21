/**
 * Server-side audio transcription example
 * 
 * This example demonstrates how to handle audio transcription on the server
 * while collecting audio on the client, keeping API keys secure.
 */

import express from 'express';
import { WebSocketServer } from 'ws';
import { ensembleListen } from '../index.js';
import type { AgentDefinition, TranscriptionOpts } from '../index.js';

// Express server for HTTP endpoints
const app = express();
app.use(express.json());

// WebSocket server for real-time audio streaming
const wss = new WebSocketServer({ noServer: true });

/**
 * HTTP endpoint for single audio file transcription
 * Client sends audio as base64 or multipart form data
 */
app.post('/api/transcribe', async (req, res) => {
    try {
        const { audio, options = {} } = req.body;
        
        if (!audio) {
            return res.status(400).json({ error: 'No audio data provided' });
        }

        const agent: AgentDefinition = {
            model: options.model || 'whisper-1',
        };

        const transcriptionOpts: TranscriptionOpts = {
            language: options.language,
            response_format: options.response_format || 'text',
            temperature: options.temperature,
        };

        const events = [];
        
        for await (const event of ensembleListen(audio, agent, transcriptionOpts)) {
            events.push(event);
            
            // Send SSE updates if client accepts them
            if (req.headers.accept?.includes('text/event-stream')) {
                res.write(`data: ${JSON.stringify(event)}\n\n`);
            }
        }

        // Return final transcript
        const completeEvent = events.find(e => e.type === 'transcription_complete');
        res.json({
            transcript: completeEvent?.text || '',
            events: events,
        });
    } catch (error) {
        console.error('Transcription error:', error);
        res.status(500).json({ 
            error: 'Transcription failed',
            message: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});

/**
 * WebSocket endpoint for real-time audio streaming
 * Ideal for continuous transcription with VAD
 */
wss.on('connection', (ws) => {
    console.log('Client connected for real-time transcription');
    
    let audioChunks: Uint8Array[] = [];
    let transcriptionStream: AsyncGenerator<any> | null = null;
    let isTranscribing = false;

    ws.on('message', async (data) => {
        try {
            const message = JSON.parse(data.toString());
            
            switch (message.type) {
                case 'start':
                    // Initialize transcription session
                    const agent: AgentDefinition = {
                        model: message.model || 'gpt-4o-realtime-preview',
                    };
                    
                    const options: TranscriptionOpts = {
                        stream: true,
                        vad: {
                            enabled: true,
                            mode: message.vadMode || 'server_vad',
                            threshold: 0.5,
                            prefix_padding_ms: 300,
                            silence_duration_ms: 500,
                        },
                        audio_format: {
                            sampleRate: message.sampleRate || 16000,
                            channels: 1,
                            bitDepth: 16,
                            encoding: 'pcm',
                        },
                        ...message.options,
                    };

                    // Create a readable stream from chunks
                    const audioStream = new ReadableStream<Uint8Array>({
                        start(controller) {
                            // This will be fed by incoming audio chunks
                            ws.on('message', (data) => {
                                const msg = JSON.parse(data.toString());
                                if (msg.type === 'audio' && msg.chunk) {
                                    const chunk = Buffer.from(msg.chunk, 'base64');
                                    controller.enqueue(new Uint8Array(chunk));
                                } else if (msg.type === 'end') {
                                    controller.close();
                                }
                            });
                        }
                    });

                    // Start transcription
                    isTranscribing = true;
                    transcriptionStream = ensembleListen(audioStream, agent, options);
                    
                    // Process transcription events
                    for await (const event of transcriptionStream) {
                        if (!isTranscribing) break;
                        
                        // Send event to client
                        ws.send(JSON.stringify({
                            type: 'transcription_event',
                            event: event,
                        }));
                    }
                    break;

                case 'audio':
                    // Receive audio chunk
                    if (message.chunk) {
                        const chunk = Buffer.from(message.chunk, 'base64');
                        audioChunks.push(new Uint8Array(chunk));
                    }
                    break;

                case 'end':
                    // End transcription session
                    isTranscribing = false;
                    ws.send(JSON.stringify({
                        type: 'session_ended',
                        message: 'Transcription session ended',
                    }));
                    break;
            }
        } catch (error) {
            console.error('WebSocket error:', error);
            ws.send(JSON.stringify({
                type: 'error',
                error: error instanceof Error ? error.message : 'Unknown error',
            }));
        }
    });

    ws.on('close', () => {
        console.log('Client disconnected');
        isTranscribing = false;
    });
});

// Start HTTP server
const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});

// Upgrade HTTP server to handle WebSocket connections
server.on('upgrade', (request, socket, head) => {
    if (request.url === '/ws/transcribe') {
        wss.handleUpgrade(request, socket, head, (ws) => {
            wss.emit('connection', ws, request);
        });
    } else {
        socket.destroy();
    }
});

/**
 * Example client code for the browser:
 * 
 * ```javascript
 * // Client-side code (no API keys needed!)
 * class AudioTranscriptionClient {
 *     constructor(serverUrl) {
 *         this.serverUrl = serverUrl;
 *         this.ws = null;
 *         this.mediaStream = null;
 *         this.audioContext = null;
 *         this.processor = null;
 *     }
 * 
 *     async startTranscription(options = {}) {
 *         // Get microphone access
 *         this.mediaStream = await navigator.mediaDevices.getUserMedia({
 *             audio: {
 *                 channelCount: 1,
 *                 sampleRate: 16000,
 *                 echoCancellation: true,
 *                 noiseSuppression: true,
 *             }
 *         });
 * 
 *         // Set up audio processing
 *         this.audioContext = new AudioContext({ sampleRate: 16000 });
 *         const source = this.audioContext.createMediaStreamSource(this.mediaStream);
 *         this.processor = this.audioContext.createScriptProcessor(4096, 1, 1);
 * 
 *         // Connect WebSocket
 *         this.ws = new WebSocket(`${this.serverUrl}/ws/transcribe`);
 *         
 *         this.ws.onopen = () => {
 *             console.log('Connected to transcription server');
 *             
 *             // Start transcription session
 *             this.ws.send(JSON.stringify({
 *                 type: 'start',
 *                 model: options.model || 'whisper-1',
 *                 vadMode: options.vadMode,
 *                 sampleRate: 16000,
 *                 options: options
 *             }));
 *         };
 * 
 *         this.ws.onmessage = (event) => {
 *             const data = JSON.parse(event.data);
 *             
 *             if (data.type === 'transcription_event') {
 *                 // Handle transcription events
 *                 this.onTranscriptionEvent(data.event);
 *             }
 *         };
 * 
 *         // Process audio and send to server
 *         this.processor.onaudioprocess = (e) => {
 *             const inputData = e.inputBuffer.getChannelData(0);
 *             
 *             // Convert to PCM16
 *             const pcm16 = new Int16Array(inputData.length);
 *             for (let i = 0; i < inputData.length; i++) {
 *                 const s = Math.max(-1, Math.min(1, inputData[i]));
 *                 pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
 *             }
 *             
 *             // Convert to base64 and send
 *             const base64 = btoa(String.fromCharCode(...new Uint8Array(pcm16.buffer)));
 *             
 *             if (this.ws.readyState === WebSocket.OPEN) {
 *                 this.ws.send(JSON.stringify({
 *                     type: 'audio',
 *                     chunk: base64
 *                 }));
 *             }
 *         };
 * 
 *         source.connect(this.processor);
 *         this.processor.connect(this.audioContext.destination);
 *     }
 * 
 *     onTranscriptionEvent(event) {
 *         // Override this method to handle events
 *         console.log('Transcription event:', event);
 *     }
 * 
 *     stopTranscription() {
 *         if (this.ws) {
 *             this.ws.send(JSON.stringify({ type: 'end' }));
 *             this.ws.close();
 *         }
 *         
 *         if (this.processor) {
 *             this.processor.disconnect();
 *         }
 *         
 *         if (this.mediaStream) {
 *             this.mediaStream.getTracks().forEach(track => track.stop());
 *         }
 *         
 *         if (this.audioContext) {
 *             this.audioContext.close();
 *         }
 *     }
 * }
 * 
 * // Usage
 * const client = new AudioTranscriptionClient('ws://localhost:3000');
 * 
 * // Start transcription
 * await client.startTranscription({
 *     model: 'whisper-1',
 *     language: 'en'
 * });
 * 
 * // Handle events
 * client.onTranscriptionEvent = (event) => {
 *     if (event.type === 'transcription_delta') {
 *         document.getElementById('transcript').textContent += event.delta;
 *     }
 * };
 * ```
 */