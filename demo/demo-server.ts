#!/usr/bin/env node
/**
 * Unified demo server for all Ensemble demos
 *
 * This server runs all demo endpoints on a single port with a unified interface
 */

import dotenv from 'dotenv';
import { join } from 'path';
import express from 'express';
import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

// Import all demo handlers
import './voice-server.js';
import './transcription-server.js';
import './request-server.js';
import './embed-server.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load .env from root directory
dotenv.config({ path: join(__dirname, '..', '.env') });

// Create a unified server
const app = express();
const server = createServer(app);
const PORT = process.env.DEMO_PORT || process.env.PORT || 3000;

// Serve static files
app.use(express.static(__dirname));

// Serve the dist directory for modules
app.use('/dist', express.static(join(__dirname, '..', 'dist')));

// Root route serves the demo menu
app.get('/', (req, res) => {
    res.sendFile(join(__dirname, 'index.html'));
});

// WebSocket servers for each demo on different paths
const wssVoice = new WebSocketServer({ noServer: true });
const wssTranscription = new WebSocketServer({ noServer: true });
const wssRequest = new WebSocketServer({ noServer: true });
const wssEmbed = new WebSocketServer({ noServer: true });

// Import handlers from individual servers
async function setupHandlers() {
    // Dynamically load the individual server modules to get their handlers
    const voiceModule = await import('./voice-server.js');
    const transcriptionModule = await import('./transcription-server.js');
    const requestModule = await import('./request-server.js');
    const embedModule = await import('./embed-server.js');

    // Set up WebSocket routing
    server.on('upgrade', (request, socket, head) => {
        const pathname = new URL(request.url!, `http://${request.headers.host}`).pathname;

        if (pathname === '/voice') {
            wssVoice.handleUpgrade(request, socket, head, ws => {
                wssVoice.emit('connection', ws, request);
            });
        } else if (pathname === '/transcription') {
            wssTranscription.handleUpgrade(request, socket, head, ws => {
                wssTranscription.emit('connection', ws, request);
            });
        } else if (pathname === '/request') {
            wssRequest.handleUpgrade(request, socket, head, ws => {
                wssRequest.emit('connection', ws, request);
            });
        } else if (pathname === '/embed') {
            wssEmbed.handleUpgrade(request, socket, head, ws => {
                wssEmbed.emit('connection', ws, request);
            });
        } else {
            socket.destroy();
        }
    });

    // Re-export the handlers to work with our unified server
    if (voiceModule.setupVoiceHandlers) {
        voiceModule.setupVoiceHandlers(wssVoice);
    }
    if (transcriptionModule.setupTranscriptionHandlers) {
        transcriptionModule.setupTranscriptionHandlers(wssTranscription);
    }
    if (requestModule.setupRequestHandlers) {
        requestModule.setupRequestHandlers(wssRequest);
    }
    if (embedModule.setupEmbedHandlers) {
        embedModule.setupEmbedHandlers(wssEmbed);
    }
}

// Start unified server
server.listen(PORT, async () => {
    console.log(`\n🚀 Ensemble Demos running on port ${PORT}`);
    console.log(`🌐 Open http://localhost:${PORT} to access all demos\n`);
    console.log('📋 Available demos:');
    console.log('   • Voice Generation - Text-to-speech with streaming');
    console.log('   • Live Transcription - Real-time speech-to-text');
    console.log('   • Chat Request - Streaming AI responses with tools');
    console.log('   • Text Embeddings - Vector embeddings and similarity search\n');

    // Set up handlers after server starts
    await setupHandlers();
});
