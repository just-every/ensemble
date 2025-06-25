#!/usr/bin/env node
/**
 * Voice generation server using ensembleVoice
 *
 * This demonstrates how to use ensembleVoice in a server environment
 * where text is sent from the client and audio is streamed back via WebSocket.
 */

import dotenv from 'dotenv';
import { join } from 'path';
import express from 'express';
import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { ensembleVoice } from '../dist/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load .env from root directory
dotenv.config({ path: join(__dirname, '..', '.env') });

// Debug: Log which API keys were loaded
console.log('🔐 Environment variables loaded:');
console.log('   OPENAI_API_KEY:', process.env.OPENAI_API_KEY ? '✅ Set' : '❌ Not set');
console.log('   ELEVENLABS_API_KEY:', process.env.ELEVENLABS_API_KEY ? '✅ Set' : '❌ Not set');

const app = express();
const server = createServer(app);
const PORT = process.env.VOICE_PORT || process.env.PORT || 3004;

// Serve static files (including the client HTML)
app.use(express.static(__dirname));

// Serve the dist directory for the AudioStreamPlayer module
app.use('/dist', express.static(join(__dirname, '..', 'dist')));

// WebSocket server for audio streaming
const wss = new WebSocketServer({ server });

// Track active connections
const activeConnections = new Map<
    string,
    {
        startTime: number;
        totalBytes: number;
        ws: any; // WebSocket connection
        isGenerating: boolean;
    }
>();

// Handle WebSocket connections
wss.on('connection', ws => {
    const connectionId = Math.random().toString(36).substring(7);
    console.log(`🔊 New client connected: ${connectionId}`);

    // Store connection info
    activeConnections.set(connectionId, {
        startTime: Date.now(),
        totalBytes: 0,
        ws,
        isGenerating: false,
    });

    // Send connection acknowledgment
    ws.send(
        JSON.stringify({
            type: 'connected',
            connectionId,
        })
    );

    // Handle incoming messages
    ws.on('message', async data => {
        const connInfo = activeConnections.get(connectionId);
        if (!connInfo) return;

        try {
            const message = JSON.parse(data.toString());

            switch (message.type) {
                case 'generate':
                    if (connInfo.isGenerating) {
                        ws.send(
                            JSON.stringify({
                                type: 'error',
                                error: 'Generation already in progress',
                            })
                        );
                        return;
                    }

                    connInfo.isGenerating = true;
                    await handleGenerate(connectionId, message);
                    connInfo.isGenerating = false;
                    break;

                case 'ping':
                    ws.send(JSON.stringify({ type: 'pong' }));
                    break;

                default:
                    console.warn(`Unknown message type: ${message.type}`);
            }
        } catch (err) {
            console.error('Error handling message:', err);
            ws.send(
                JSON.stringify({
                    type: 'error',
                    error: err instanceof Error ? err.message : 'Unknown error',
                })
            );
        }
    });

    // Handle client disconnect
    ws.on('close', () => {
        console.log(`👋 Client disconnected: ${connectionId}`);

        const connInfo = activeConnections.get(connectionId);
        if (connInfo) {
            const duration = (Date.now() - connInfo.startTime) / 1000;
            console.log(`   Session duration: ${duration.toFixed(1)}s`);
            console.log(`   Total data sent: ${(connInfo.totalBytes / 1024).toFixed(1)}KB`);
        }

        activeConnections.delete(connectionId);
    });

    // Handle errors
    ws.on('error', error => {
        console.error(`WebSocket error for ${connectionId}:`, error);
    });
});

// Handle voice generation
async function handleGenerate(connectionId: string, message: any) {
    const connInfo = activeConnections.get(connectionId);
    if (!connInfo) return;

    const { ws } = connInfo;
    const { text, model, options } = message;

    if (!text) {
        ws.send(
            JSON.stringify({
                type: 'error',
                error: 'No text provided',
            })
        );
        return;
    }

    console.log(`🎤 Generating speech for ${connectionId}:`);
    console.log(`   Model: ${model}`);
    console.log(`   Voice: ${options?.voice || 'default'}`);
    console.log(`   Text length: ${text.length} characters`);

    try {
        // Send generation start event
        ws.send(
            JSON.stringify({
                type: 'generation_start',
                model,
                voice: options?.voice,
                textLength: text.length,
            })
        );

        let chunkCount = 0;
        let totalAudioBytes = 0;
        const startTime = Date.now();

        // Generate speech with streaming
        for await (const event of ensembleVoice(text, { model }, options)) {
            if (event.type === 'format_info') {
                // Forward format information from new event type
                ws.send(
                    JSON.stringify({
                        type: 'audio_format',
                        format: event.format,
                        pcmParameters: event.pcmParameters,
                        mimeType: event.mimeType,
                        supportsStreaming: event.supportsStreaming,
                    })
                );
            } else if (event.type === 'audio_stream') {
                if (event.data) {
                    chunkCount++;
                    const audioBytes = Buffer.from(event.data, 'base64').length;
                    totalAudioBytes += audioBytes;
                    connInfo.totalBytes += audioBytes;

                    // Forward audio chunk to client
                    ws.send(
                        JSON.stringify({
                            type: 'audio_chunk',
                            chunkIndex: event.chunkIndex,
                            data: event.data,
                            isFinalChunk: event.isFinalChunk,
                        })
                    );

                    if (chunkCount % 10 === 0) {
                        console.log(`   Sent ${chunkCount} chunks (${(totalAudioBytes / 1024).toFixed(1)}KB)`);
                    }
                } else if (event.format) {
                    // Send format information (backwards compatibility)
                    ws.send(
                        JSON.stringify({
                            type: 'audio_format',
                            format: event.format,
                            pcmParameters: event.pcmParameters,
                        })
                    );
                }
            } else if (event.type === 'cost_update') {
                // Forward cost information
                ws.send(
                    JSON.stringify({
                        type: 'cost_update',
                        usage: event.usage,
                    })
                );
            }
        }

        const duration = (Date.now() - startTime) / 1000;

        // Send completion event
        ws.send(
            JSON.stringify({
                type: 'generation_complete',
                totalChunks: chunkCount,
                totalBytes: totalAudioBytes,
                duration,
            })
        );

        console.log(`✅ Generation complete for ${connectionId}:`);
        console.log(`   Total chunks: ${chunkCount}`);
        console.log(`   Total audio: ${(totalAudioBytes / 1024).toFixed(1)}KB`);
        console.log(`   Duration: ${duration.toFixed(2)}s`);
    } catch (error) {
        console.error(`Error generating speech for ${connectionId}:`, error);
        ws.send(
            JSON.stringify({
                type: 'error',
                error: error instanceof Error ? error.message : 'Generation failed',
            })
        );
    }
}

// Start server
server.listen(PORT, () => {
    console.log(`\n🚀 Voice generation server running on port ${PORT}`);
    console.log(`   Open http://localhost:${PORT}/voice-client.html in your browser`);
    console.log(`   WebSocket endpoint: ws://localhost:${PORT}`);
    console.log('\n📡 Waiting for connections...\n');
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\n\n👋 Shutting down server...');

    // Close all active connections
    activeConnections.forEach((connInfo, connectionId) => {
        console.log(`   Closing connection: ${connectionId}`);
        connInfo.ws.close();
    });

    server.close(() => {
        console.log('✅ Server closed');
        process.exit(0);
    });
});
