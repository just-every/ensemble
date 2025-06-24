#!/usr/bin/env node
/**
 * Example: Real-time transcription server using ensembleListen
 *
 * This demonstrates how to use ensembleListen in a server environment
 * where audio is captured on the client and streamed via WebSocket.
 */

import express from 'express';
import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { Readable } from 'stream';
import { ensembleListen, setGlobalEventHandler } from '../dist/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const app = express();
const server = createServer(app);
const PORT = process.env.PORT || 3003;

// Serve static files (including the client HTML)
app.use(express.static(__dirname));

// WebSocket server for audio streaming
const wss = new WebSocketServer({ server });

// Track active connections
const activeConnections = new Map<
    string,
    {
        audioStream: Readable;
        startTime: number;
        totalBytes: number;
        ws?: any; // WebSocket connection
    }
>();

// Set up global event handler to forward cost_update events to clients
setGlobalEventHandler(event => {
    if (event.type === 'cost_update') {
        // Forward cost_update events to all active connections
        activeConnections.forEach((connInfo, connectionId) => {
            if (connInfo.ws && connInfo.ws.readyState === connInfo.ws.OPEN) {
                connInfo.ws.send(JSON.stringify(event));
                console.log(
                    `💰 [${connectionId}] Forwarded cost update:`,
                    event.usage
                );
            }
        });
    }
});

// Handle WebSocket connections
wss.on('connection', ws => {
    const connectionId = Math.random().toString(36).substring(7);
    console.log(`🎤 New client connected: ${connectionId}`);

    // Create a readable stream for this connection
    const audioStream = new Readable({
        read() {}, // No-op, we'll push data manually
    });

    // Store connection info
    activeConnections.set(connectionId, {
        audioStream,
        startTime: Date.now(),
        totalBytes: 0,
        ws, // Store WebSocket connection for cost_update forwarding
    });

    // Handle incoming messages
    ws.on('message', async (data, isBinary) => {
        const connInfo = activeConnections.get(connectionId);
        if (!connInfo) return;

        if (isBinary) {
            // Audio data - push to stream
            connInfo.totalBytes += data.length;
            connInfo.audioStream.push(Buffer.from(data as ArrayBuffer));
        } else {
            // Control message
            try {
                const message = JSON.parse(data.toString());
                if (message.type === 'start') {
                    console.log(
                        `📢 Starting transcription for ${connectionId}`
                    );
                    startTranscription(connectionId, ws);
                }
            } catch (err) {
                console.error('Invalid control message:', err);
            }
        }
    });

    // Handle client disconnect
    ws.on('close', () => {
        console.log(`👋 Client disconnected: ${connectionId}`);
        const connInfo = activeConnections.get(connectionId);
        if (connInfo) {
            // End the stream
            connInfo.audioStream.push(null);

            // Log session stats
            const duration = (Date.now() - connInfo.startTime) / 1000;
            console.log(`📊 Session stats for ${connectionId}:
  Duration: ${duration.toFixed(1)}s
  Audio data: ${(connInfo.totalBytes / 1024).toFixed(1)} KB
  Avg bitrate: ${((connInfo.totalBytes * 8) / duration / 1000).toFixed(1)} kbps`);

            activeConnections.delete(connectionId);
        }
    });

    // Send initial status
    ws.send(
        JSON.stringify({
            type: 'status',
            connectionId,
            message: 'Connected to transcription server',
        })
    );
});

// Start transcription for a connection
async function startTranscription(connectionId: string, ws: any) {
    const connInfo = activeConnections.get(connectionId);
    if (!connInfo) return;

    try {
        // Start transcription using ensembleListen
        for await (const event of ensembleListen(
            connInfo.audioStream,
            {
                model: 'gemini-live-2.5-flash-preview',
                instructions:
                    'Transcribe speech accurately with proper punctuation and grammar corrections.',
            },
            {
                audioFormat: {
                    sampleRate: 16000,
                    channels: 1,
                    encoding: 'pcm',
                },
                bufferConfig: {
                    chunkSize: 8000, // 250ms at 16kHz
                    flushInterval: 500, // Flush after 500ms of silence
                },
            }
        )) {
            // Forward all events to the client
            if (ws.readyState === ws.OPEN) {
                ws.send(JSON.stringify(event));

                // Log significant events
                switch (event.type) {
                    case 'transcription_start':
                        console.log(
                            `🎯 Transcription started for ${connectionId}`
                        );
                        break;
                    case 'transcription_delta':
                        console.log(
                            `📝 [${connectionId}] Delta: ${event.delta}`
                        );
                        break;
                    // Note: cost_update events are emitted globally by costTracker,
                    // not by ensembleListen directly
                    case 'error':
                        console.error(
                            `❌ [${connectionId}] Error:`,
                            event.error
                        );
                        break;
                }
            }
        }
    } catch (error) {
        console.error(`❌ Transcription error for ${connectionId}:`, error);
        if (ws.readyState === ws.OPEN) {
            ws.send(
                JSON.stringify({
                    type: 'error',
                    error:
                        error instanceof Error
                            ? error.message
                            : 'Transcription failed',
                })
            );
        }
    }
}

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        message: 'Transcription server running',
        activeConnections: activeConnections.size,
        apiKey:
            process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY
                ? 'configured'
                : 'missing',
    });
});

// Root page with info
app.get('/', (req, res) => {
    res.send(`
        <h1>Ensemble Transcription Server</h1>
        <p>Server is running on port ${PORT}</p>
        <p>Active connections: ${activeConnections.size}</p>
        <p>Open <a href="/transcription-client.html">transcription-client.html</a> to start</p>
        <hr>
        <p>API Key Status: ${process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY ? '✅ Configured' : '❌ Missing'}</p>
        <p>WebSocket endpoint: ws://localhost:${PORT}</p>
    `);
});

// Start server
server.listen(PORT, () => {
    console.log(`
🚀 Ensemble Transcription Server
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📡 Server running at: http://localhost:${PORT}
🌐 Client URL: http://localhost:${PORT}/transcription-client.html
🔑 API Key: ${process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY ? '✅ Found' : '❌ Missing (set GOOGLE_API_KEY)'}

📝 Features:
  • Real-time audio streaming via WebSocket
  • Gemini Live API integration
  • Automatic buffering and chunk management
  • Cost tracking per session

💡 Usage:
  1. Set your GOOGLE_API_KEY environment variable
  2. Run: npm run example:transcription-server
  3. Open the client URL in your browser
  4. Allow microphone access and start speaking
`);
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\n👋 Shutting down server...');

    // Close all active connections
    activeConnections.forEach((connInfo, id) => {
        console.log(`Closing connection ${id}...`);
        connInfo.audioStream.push(null);
    });

    server.close(() => {
        console.log('✅ Server closed');
        process.exit(0);
    });
});

// Handle uncaught errors
process.on('uncaughtException', err => {
    console.error('💥 Uncaught exception:', err);
    process.exit(1);
});

process.on('unhandledRejection', err => {
    console.error('💥 Unhandled rejection:', err);
    process.exit(1);
});
