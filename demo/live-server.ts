#!/usr/bin/env node
/**
 * Demo: Real-time bidirectional communication server using ensembleLive
 *
 * This demonstrates how to use ensembleLive for real-time interactive
 * conversations with audio input/output and tool execution capabilities.
 */

import dotenv from 'dotenv';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

// Load .env from root directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, '..', '.env') });
import express from 'express';
import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import { ensembleLiveAudio, type LiveEvent, type ToolFunction } from '../dist/index.js';

const app = express();
const server = createServer(app);
const PORT = process.env.PORT || process.env.LIVE_PORT || 3004;

// Serve static files (including the client HTML)
app.use(express.static(__dirname));

// Define example tools
const exampleTools: ToolFunction[] = [
    {
        definition: {
            type: 'function',
            function: {
                name: 'get_weather',
                description: 'Get current weather for a location',
                parameters: {
                    type: 'object',
                    properties: {
                        location: {
                            type: 'string',
                            description: 'City and state, e.g. San Francisco, CA',
                        },
                    },
                    required: ['location'],
                },
            },
        },
        function: async (location: string) => {
            // Simulate weather API call
            const weather = ['sunny', 'cloudy', 'rainy', 'snowy'][Math.floor(Math.random() * 4)];
            const temp = Math.floor(Math.random() * 30) + 50;
            return `The weather in ${location} is ${weather} with a temperature of ${temp}°F`;
        },
    },
    {
        definition: {
            type: 'function',
            function: {
                name: 'calculate',
                description: 'Perform basic math calculations',
                parameters: {
                    type: 'object',
                    properties: {
                        expression: {
                            type: 'string',
                            description: 'Math expression to evaluate, e.g. "2 + 2"',
                        },
                    },
                    required: ['expression'],
                },
            },
        },
        function: async (expression: string) => {
            try {
                // SECURITY WARNING: In production, use a proper math parser
                // This is just for demo purposes
                const result = Function(`"use strict"; return (${expression})`)();
                return `The result of ${expression} is ${result}`;
            } catch {
                return `Error calculating ${expression}: Invalid expression`;
            }
        },
    },
];

// WebSocket server for live communication
const wss = new WebSocketServer({ server });

// Track active sessions
const activeSessions = new Map<
    string,
    {
        liveGenerator: AsyncGenerator<LiveEvent>;
        audioQueue: Uint8Array[];
        isProcessing: boolean;
        stats: {
            startTime: number;
            audioBytesSent: number;
            audioBytesReceived: number;
            toolCalls: number;
            turns: number;
        };
    }
>();

// Handle WebSocket connections
wss.on('connection', ws => {
    const sessionId = Math.random().toString(36).substring(7);
    console.log(`🎭 New live session connected: ${sessionId}`);

    // Initialize session
    const sessionInfo = {
        liveGenerator: null as any,
        audioQueue: [] as Uint8Array[],
        isProcessing: false,
        stats: {
            startTime: Date.now(),
            audioBytesSent: 0,
            audioBytesReceived: 0,
            toolCalls: 0,
            turns: 0,
        },
    };
    activeSessions.set(sessionId, sessionInfo);

    // Handle incoming messages
    ws.on('message', async (data, isBinary) => {
        const session = activeSessions.get(sessionId);
        if (!session) return;

        if (isBinary) {
            // Audio data - add to queue
            const audioData = new Uint8Array(data as ArrayBuffer);
            session.audioQueue.push(audioData);
            session.stats.audioBytesReceived += audioData.length;
            console.log(
                `[WS ${sessionId}] Received audio chunk, size: ${audioData.length} bytes, queue size: ${session.audioQueue.length}, total received: ${session.stats.audioBytesReceived}`
            );
        } else {
            // Control message
            try {
                const message = JSON.parse(data.toString());
                console.log(`📨 Control message from ${sessionId}:`, message.type);

                switch (message.type) {
                    case 'start':
                        startLiveSession(sessionId, ws, message.mode || 'audio', message.settings);
                        break;
                    case 'text':
                        // For text mode - not implemented in this demo
                        ws.send(
                            JSON.stringify({
                                type: 'error',
                                error: 'Text mode not implemented in this demo',
                            })
                        );
                        break;
                }
            } catch {
                console.error('Invalid control message');
            }
        }
    });

    // Handle client disconnect
    ws.on('close', () => {
        console.log(`👋 Live session disconnected: ${sessionId}`);
        const session = activeSessions.get(sessionId);
        if (session) {
            // Log session stats
            const duration = (Date.now() - session.stats.startTime) / 1000;
            console.log(`📊 Session stats for ${sessionId}:
  Duration: ${duration.toFixed(1)}s
  Audio sent: ${(session.stats.audioBytesSent / 1024).toFixed(1)} KB
  Audio received: ${(session.stats.audioBytesReceived / 1024).toFixed(1)} KB
  Tool calls: ${session.stats.toolCalls}
  Turns: ${session.stats.turns}`);

            activeSessions.delete(sessionId);
        }
    });

    // Send initial status
    ws.send(
        JSON.stringify({
            type: 'status',
            sessionId,
            message: 'Connected to live server',
        })
    );
});

// Start live session for a connection
async function startLiveSession(sessionId: string, ws: any, mode: string, settings?: any) {
    const session = activeSessions.get(sessionId);
    if (!session || session.isProcessing) return;

    session.isProcessing = true;

    try {
        console.log(`🚀 Starting live session ${sessionId} in ${mode} mode`);
        if (settings) {
            console.log(`📋 Settings:`, settings);
        }

        // Create audio source generator
        async function* audioSource() {
            console.log(`[audioSource ${sessionId}] Starting audio source generator`);
            let chunkCount = 0;
            while (session.isProcessing) {
                if (session.audioQueue.length > 0) {
                    const chunk = session.audioQueue.shift()!;
                    chunkCount++;
                    console.log(
                        `[audioSource ${sessionId}] Yielding chunk ${chunkCount}, size: ${chunk.length} bytes, queue remaining: ${session.audioQueue.length}`
                    );
                    yield chunk;
                } else {
                    // Wait for more audio
                    await new Promise(resolve => setTimeout(resolve, 50));
                }
            }
            console.log(`[audioSource ${sessionId}] Audio source generator completed, total chunks: ${chunkCount}`);
        }

        // Start ensembleLive session
        const liveEvents = ensembleLiveAudio(
            audioSource(),
            {
                agent_id: 'demo-assistant',
                name: 'Demo Assistant',
                model: settings?.model || process.env.LIVE_MODEL || 'gemini-live-2.5-flash-preview',
                instructions: `You are a helpful voice assistant. You can:
1. Answer questions conversationally
2. Use the get_weather tool to check weather
3. Use the calculate tool for math
4. Be friendly and engaging

Keep responses concise and natural for voice interaction.`,
                tools: exampleTools,
                maxToolCalls: 10,
                onToolResult: result => {
                    console.log(`🔧 Tool result for ${sessionId}:`, result);
                    session.stats.toolCalls++;
                },
            },
            {
                voice: settings?.voice || 'Kore',
                language: 'en-US',
                // Enable v1alpha features from client settings or environment
                enableAffectiveDialog:
                    settings?.enableAffectiveDialog || process.env.ENABLE_AFFECTIVE_DIALOG === 'true',
                enableProactivity: settings?.enableProactivity || process.env.ENABLE_PROACTIVITY === 'true',
            }
        );

        // Process events
        for await (const event of liveEvents) {
            // Forward event to client
            if (ws.readyState === ws.OPEN) {
                ws.send(JSON.stringify(event));

                // Log significant events
                switch (event.type) {
                    case 'live_start':
                        console.log(`🎯 Live session started: ${event.sessionId}`);
                        break;

                    case 'audio_output': {
                        // Count audio bytes sent
                        console.log(`🔊 Audio output event:`, {
                            hasData: !!event.data,
                            dataLength: event.data?.length,
                            format: event.format,
                        });

                        if (event.data) {
                            const audioBytes = Buffer.from(event.data, 'base64').length;
                            session.stats.audioBytesSent += audioBytes;
                            console.log(`🔊 Audio output: ${audioBytes} bytes`);
                        } else {
                            console.error(`❌ Audio output event missing data!`);
                        }
                        break;
                    }

                    case 'text_output':
                        console.log(`💬 Text output: ${event.text}`);
                        break;

                    case 'tool_call':
                        console.log(
                            `🔧 Tool calls:`,
                            event.toolCalls.map(tc => tc.function.name)
                        );
                        break;

                    case 'turn_complete':
                        session.stats.turns++;
                        console.log(`🔄 Turn ${session.stats.turns} complete`);
                        break;

                    case 'transcription_preview':
                        console.log(`🎤 User said: "${event.text}"`);
                        break;

                    case 'transcription_delta':
                        console.log(`📝 Assistant: ${event.delta}`);
                        break;

                    case 'cost_update':
                        console.log(`💰 Cost update:`, event.usage);
                        break;

                    case 'error':
                        console.error(`❌ Error: ${event.error}`);
                        break;

                    case 'live_end':
                        console.log(`🏁 Session ended: ${event.reason}`);
                        session.isProcessing = false;
                        break;
                }
            }
        }
    } catch (error) {
        console.error(`❌ Live session error for ${sessionId}:`, error);
        if (ws.readyState === ws.OPEN) {
            ws.send(
                JSON.stringify({
                    type: 'error',
                    error: error instanceof Error ? error.message : 'Live session failed',
                })
            );
        }
        session.isProcessing = false;
    }
}

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        message: 'Live server running',
        activeSessions: activeSessions.size,
        apiKey: process.env.GOOGLE_API_KEY ? 'configured' : 'missing',
    });
});

// Root page with info
app.get('/', (req, res) => {
    res.send(`
        <h1>Ensemble Live Demo Server</h1>
        <p>Server is running on port ${PORT}</p>
        <p>Active sessions: ${activeSessions.size}</p>
        <p>Open <a href="/live-client.html">live-client.html</a> to start</p>
        <hr>
        <p>API Key Status: ${process.env.GOOGLE_API_KEY ? '✅ Configured' : '❌ Missing'}</p>
        <p>WebSocket endpoint: ws://localhost:${PORT}</p>
        <h3>Available Tools:</h3>
        <ul>
            <li>get_weather(location) - Check weather for a city</li>
            <li>calculate(expression) - Perform math calculations</li>
        </ul>
    `);
});

// Start server
server.listen(PORT, () => {
    console.log(`
🚀 Ensemble Live Demo Server
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📡 Server running at: http://localhost:${PORT}
🌐 Client URL: http://localhost:${PORT}/live-client.html
🔑 API Key: ${process.env.GOOGLE_API_KEY ? '✅ Found' : '❌ Missing (set GOOGLE_API_KEY)'}

🎭 Features:
  • Real-time bidirectional audio streaming
  • Gemini Live API with native audio
  • Tool execution (weather, calculator)
  • Voice selection and configuration
  • Live transcription of conversation
  • Cost tracking
  • Affective Dialog: ${process.env.ENABLE_AFFECTIVE_DIALOG === 'true' ? '✅ Enabled' : '❌ Disabled'}
  • Proactivity: ${process.env.ENABLE_PROACTIVITY === 'true' ? '✅ Enabled' : '❌ Disabled'}

💡 Usage:
  1. Set your GOOGLE_API_KEY environment variable
  2. Run: npx tsx demo/live-server.ts
  3. Open the client URL in your browser
  4. Click "Start Conversation" and speak!

🗣️ Try saying:
  • "What's the weather in San Francisco?"
  • "Calculate 25 times 4"
  • "Tell me a joke"
  • "What can you help me with?"

🔧 Advanced Features:
  • Enable affective dialog: ENABLE_AFFECTIVE_DIALOG=true npm run demo:live
  • Enable proactivity: ENABLE_PROACTIVITY=true npm run demo:live
  • Enable both: ENABLE_AFFECTIVE_DIALOG=true ENABLE_PROACTIVITY=true npm run demo:live
`);
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\n👋 Shutting down server...');

    // Close all active sessions
    activeSessions.forEach((session, id) => {
        console.log(`Closing session ${id}...`);
        session.isProcessing = false;
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
