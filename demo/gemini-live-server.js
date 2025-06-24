#!/usr/bin/env node
/**
 * Optimized Gemini Live API transcription server
 * Focuses on low-latency audio streaming and transcription
 */

import express from 'express';
import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import dotenv from 'dotenv';
import { GoogleGenAI, Modality } from '@google/genai';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '../.env') });

const app = express();
const server = createServer(app);
const PORT = 3002;

// Get API key from environment
const GEMINI_API_KEY = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;

if (!GEMINI_API_KEY) {
    console.error('❌ GOOGLE_API_KEY or GEMINI_API_KEY not found in environment');
    process.exit(1);
}

// Serve static files
app.use(express.static(__dirname));

// WebSocket server for Gemini Live streaming
const wss = new WebSocketServer({ noServer: true });

// Handle WebSocket upgrade
server.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url, `http://${request.headers.host}`);
    const pathname = url.pathname;

    if (pathname === '/gemini-live') {
        wss.handleUpgrade(request, socket, head, (ws) => {
            wss.emit('connection', ws, request);
        });
    } else {
        socket.destroy();
    }
});

// Connection handler
wss.on('connection', async (ws) => {
    console.log('🎤 New Gemini Live client connected');

    let session = null;
    let audioBuffer = Buffer.alloc(0);
    let isConnected = false;
    let lastSendTime = Date.now();
    let sessionStartTime = Date.now();
    let totalAudioBytes = 0;

    try {
        // Initialize Gemini AI client
        const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

        // Connect to Gemini Live API
        console.log('🔷 Connecting to Gemini Live API...');

        session = await ai.live.connect({
            model: 'gemini-live-2.5-flash-preview',
            config: {
                responseModalities: [Modality.TEXT],
                //inputAudioTranscription: {},
                systemInstruction: {
                    parts: [{
                        text: `You are a real-time transcription assistant. Your only task is to transcribe speech as you hear it. DO NOT ADD YOUR OWN RESPONSE OR COMMENTARY. TRANSCRIBE WHAT YOU HEAR ONLY.
Respond immediately with transcribed text as you process the audio.
If quick corrections are used e.g. "Let's go to Point A, no Point B" then just remove incorrect part e.g. respond with "Let's go to Point B".
When it makes the transcription clearer, remove filler words (like "um") add punctuation, correct obvious grammar issues and add in missing words.`
                    }]
                },
                realtimeInputConfig: {
                    automaticActivityDetection: {
                        prefixPaddingMs: 20,
                        silenceDurationMs: 100,
                    }
                }
            },
            callbacks: {
                onopen: () => {
                    console.log('✅ Gemini Live session connected successfully');
                    isConnected = true;
                    ws.send(JSON.stringify({
                        type: 'status',
                        message: 'Connected to Gemini Live API'
                    }));
                },
                onmessage: async (msg) => {
                    console.dir(msg, { depth: null });

                    // Handle different message types from Gemini
                    if (msg.serverContent?.modelTurn?.parts) {
                        // Process transcript parts
                        for (const part of msg.serverContent.modelTurn.parts) {
                            if (part.text && part.text.trim()) {
                                // Send transcript to client
                                ws.send(JSON.stringify({
                                    type: 'transcript',
                                    text: part.text,
                                    partial: false // Gemini Live doesn't distinguish partial/final
                                }));

                                console.log('📝 Transcript:', part.text);
                            }
                        }
                    }

                    // Extract usage metadata for cost tracking
                    if (msg.usageMetadata) {
                        // Extract token counts from the new format
                        const promptTokenCount = msg.usageMetadata.promptTokenCount || 0;
                        const responseTokenCount = msg.usageMetadata.responseTokenCount || 0;
                        const totalTokenCount = msg.usageMetadata.totalTokenCount || 0;

                        // Extract modality details if available
                        const promptDetails = msg.usageMetadata.promptTokensDetails || [];
                        const responseDetails = msg.usageMetadata.responseTokensDetails || [];

                        console.log('📊 Token Usage:', {
                            total: totalTokenCount,
                            prompt: promptTokenCount,
                            response: responseTokenCount,
                            promptDetails: promptDetails,
                            responseDetails: responseDetails
                        });

                        // Send usage data to client for accurate cost calculation
                        // Using input/output naming for consistency with client expectations
                        ws.send(JSON.stringify({
                            type: 'usage',
                            usage: {
                                totalTokenCount: totalTokenCount,
                                inputTokenCount: promptTokenCount,  // prompt = input
                                outputTokenCount: responseTokenCount, // response = output
                                promptTokensDetails: promptDetails,
                                responseTokensDetails: responseDetails
                            }
                        }));
                    }

                    // Log turn completion with usage data
                    if (msg.serverContent?.turnComplete) {
                        console.log('✓ Turn complete');

                        // Check if turn complete message has usage data
                        if (msg.usageMetadata) {
                            console.log('  └─ Tokens used this turn:', msg.usageMetadata.totalTokenCount);
                        }
                    }
                },
                onerror: (err) => {
                    console.error('❌ Gemini Live error:', err);
                    ws.send(JSON.stringify({
                        type: 'error',
                        message: err.message || 'Gemini Live API error'
                    }));
                },
                onclose: () => {
                    console.log('🔌 Gemini Live session closed');
                    isConnected = false;
                }
            }
        });

        // Handle incoming audio data from client
        ws.on('message', async (data) => {
            if (!session || !isConnected) {
                console.log('⚠️ Session not ready, buffering audio...');
                return;
            }

            totalAudioBytes += data.byteLength;

            // Append to buffer
            audioBuffer = Buffer.concat([audioBuffer, Buffer.from(data)]);

            // Send audio in optimal chunks (approximately 250ms worth at 16kHz)
            // 16kHz * 2 bytes per sample * 0.25 seconds = 8000 bytes
            const optimalChunkSize = 8000;

            while (audioBuffer.length >= optimalChunkSize) {
                const chunk = audioBuffer.slice(0, optimalChunkSize);
                audioBuffer = audioBuffer.slice(optimalChunkSize);

                try {
                    // Send audio to Gemini Live API
                    await session.sendRealtimeInput({
                        media: {
                            mimeType: "audio/pcm;rate=16000",
                            data: chunk.toString('base64')
                        }
                    });

                    lastSendTime = Date.now();
                } catch (err) {
                    console.error('❌ Error sending audio chunk:', err);
                    // Don't break the connection, just log the error
                }
            }
        });

        // Handle client disconnect
        ws.on('close', () => {
            console.log('👋 Client disconnected');

            const sessionDuration = (Date.now() - sessionStartTime) / 1000;
            console.log(`📊 Session stats:
  Duration: ${sessionDuration.toFixed(1)}s
  Audio data: ${(totalAudioBytes / 1024).toFixed(1)} KB
  Avg bitrate: ${((totalAudioBytes * 8) / sessionDuration / 1000).toFixed(1)} kbps`);

            if (session) {
                session.close();
                session = null;
            }
        });

        // Send any remaining audio when connection is idle
        const flushInterval = setInterval(async () => {
            if (!isConnected || !session) {
                clearInterval(flushInterval);
                return;
            }

            // If we have buffered audio and haven't sent in 500ms, flush it
            if (audioBuffer.length > 0 && Date.now() - lastSendTime > 500) {
                try {
                    await session.sendRealtimeInput({
                        media: {
                            mimeType: "audio/pcm;rate=16000",
                            data: audioBuffer.toString('base64')
                        }
                    });

                    console.log(`📤 Flushed ${audioBuffer.length} bytes of audio`);
                    audioBuffer = Buffer.alloc(0);
                    lastSendTime = Date.now();
                } catch (err) {
                    console.error('❌ Error flushing audio:', err);
                }
            }
        }, 250);

        // Cleanup interval on disconnect
        ws.on('close', () => {
            clearInterval(flushInterval);
        });

    } catch (error) {
        console.error('❌ Fatal error in Gemini Live connection:', error);
        ws.send(JSON.stringify({
            type: 'error',
            message: error.message || 'Failed to connect to Gemini Live API'
        }));
        ws.close();
    }
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        message: 'Gemini Live transcription server running',
        apiKey: GEMINI_API_KEY ? 'configured' : 'missing'
    });
});

// Root page
app.get('/', (req, res) => {
    res.send(`
        <h1>Gemini Live Transcription Server</h1>
        <p>Server is running on port ${PORT}</p>
        <p>Open <a href="/gemini-live-client.html">gemini-live-client.html</a> to start transcription</p>
        <hr>
        <p>API Key Status: ${GEMINI_API_KEY ? '✅ Configured' : '❌ Missing'}</p>
    `);
});

// Start server
server.listen(PORT, () => {
    console.log(`
🚀 Gemini Live Transcription Server
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📡 Server running at: http://localhost:${PORT}
🌐 Client URL: http://localhost:${PORT}/gemini-live-client.html
🔑 API Key: ${GEMINI_API_KEY ? '✅ Found' : '❌ Missing (set GOOGLE_API_KEY)'}

📝 Features:
  • Low-latency audio streaming
  • Real-time transcription
  • Optimized chunk sizes
  • Automatic buffer management

💡 Note: Gemini Live API provides real-time token usage data.
   Costs are calculated based on actual tokens used.
`);
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\n👋 Shutting down server...');
    server.close(() => {
        console.log('✅ Server closed');
        process.exit(0);
    });
});

// Handle uncaught errors
process.on('uncaughtException', (err) => {
    console.error('💥 Uncaught exception:', err);
    process.exit(1);
});

process.on('unhandledRejection', (err) => {
    console.error('💥 Unhandled rejection:', err);
    process.exit(1);
});