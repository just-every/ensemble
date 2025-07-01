#!/usr/bin/env node
/**
 * Ensemble Request server demonstrating streaming AI responses
 *
 * This server shows how to use ensembleRequest for streaming chat completions
 * with support for tool calling, multiple models, and real-time token/cost tracking.
 */

import dotenv from 'dotenv';
import { join } from 'path';
import express from 'express';
import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { ensembleRequest } from '../dist/index.js';
import type { ToolFunction, AgentDefinition, StreamEvent } from '../dist/types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load .env from root directory
dotenv.config({ path: join(__dirname, '..', '.env') });

// Debug: Log which API keys were loaded
console.log('🔐 Environment variables loaded:');
console.log('   OPENAI_API_KEY:', process.env.OPENAI_API_KEY ? '✅ Set' : '❌ Not set');
console.log('   ANTHROPIC_API_KEY:', process.env.ANTHROPIC_API_KEY ? '✅ Set' : '❌ Not set');
console.log('   GOOGLE_API_KEY:', process.env.GOOGLE_API_KEY ? '✅ Set' : '❌ Not set');
console.log('   XAI_API_KEY:', process.env.XAI_API_KEY ? '✅ Set' : '❌ Not set');
console.log('   DEEPSEEK_API_KEY:', process.env.DEEPSEEK_API_KEY ? '✅ Set' : '❌ Not set');

const app = express();
const server = createServer(app);
const PORT = process.env.REQUEST_PORT || process.env.PORT || 3005;

// Serve static files
app.use(express.static(__dirname));

// Serve the dist directory for modules
app.use('/dist', express.static(join(__dirname, '..', 'dist')));

// WebSocket server for streaming
const wss = new WebSocketServer({ server });

// Example tools for demonstration
const exampleTools: ToolFunction[] = [
    {
        function: async ({ location }: { location: string }) => {
            // Simulate weather API call
            const conditions = ['sunny', 'cloudy', 'rainy', 'snowy'];
            const temp = Math.floor(Math.random() * 30) + 10;
            const condition = conditions[Math.floor(Math.random() * conditions.length)];
            return `The weather in ${location} is ${condition} with a temperature of ${temp}°C.`;
        },
        definition: {
            type: 'function',
            function: {
                name: 'get_weather',
                description: 'Get the current weather for a location',
                parameters: {
                    type: 'object',
                    properties: {
                        location: {
                            type: 'string',
                            description: 'The city and country, e.g. "London, UK"',
                        },
                    },
                    required: ['location'],
                },
            },
        },
    },
    {
        function: async ({ expression }: { expression: string }) => {
            try {
                // Simple safe math evaluation
                const result = Function('"use strict"; return (' + expression + ')')();
                return `Result: ${result}`;
            } catch (error) {
                return `Error evaluating expression: ${error instanceof Error ? error.message : 'Unknown error'}`;
            }
        },
        definition: {
            type: 'function',
            function: {
                name: 'calculate',
                description: 'Perform mathematical calculations',
                parameters: {
                    type: 'object',
                    properties: {
                        expression: {
                            type: 'string',
                            description: 'The mathematical expression to evaluate',
                        },
                    },
                    required: ['expression'],
                },
            },
        },
    },
    {
        function: async ({ query }: { query: string }) => {
            // Simulate web search
            const results = [
                `Result 1: Information about "${query}" from Wikipedia...`,
                `Result 2: Recent news about "${query}" from tech blogs...`,
                `Result 3: Academic paper discussing "${query}" in detail...`,
            ];
            return results.join('\n\n');
        },
        definition: {
            type: 'function',
            function: {
                name: 'web_search',
                description: 'Search the web for information',
                parameters: {
                    type: 'object',
                    properties: {
                        query: {
                            type: 'string',
                            description: 'The search query',
                        },
                    },
                    required: ['query'],
                },
            },
        },
    },
];

// Track active connections
const activeConnections = new Map<string, {
    startTime: number;
    messageCount: number;
    ws: any;
    isStreaming: boolean;
    abortController?: AbortController;
}>();

// Handle WebSocket connections
wss.on('connection', ws => {
    const connectionId = Math.random().toString(36).substring(7);
    console.log(`💬 New client connected: ${connectionId}`);

    // Store connection info
    activeConnections.set(connectionId, {
        startTime: Date.now(),
        messageCount: 0,
        ws,
        isStreaming: false,
    });

    // Send connection acknowledgment
    ws.send(JSON.stringify({
        type: 'connected',
        connectionId,
        availableTools: exampleTools.map(t => ({
            name: t.definition.function.name,
            description: t.definition.function.description,
        })),
    }));

    // Handle incoming messages
    ws.on('message', async data => {
        const connInfo = activeConnections.get(connectionId);
        if (!connInfo) return;

        try {
            const message = JSON.parse(data.toString());

            switch (message.type) {
                case 'chat':
                    if (connInfo.isStreaming) {
                        ws.send(JSON.stringify({
                            type: 'error',
                            error: 'Request already in progress',
                        }));
                        return;
                    }

                    connInfo.isStreaming = true;
                    connInfo.messageCount++;
                    await handleChat(connectionId, message);
                    connInfo.isStreaming = false;
                    break;

                case 'stop':
                    if (connInfo.abortController) {
                        connInfo.abortController.abort();
                        console.log(`🛑 Aborted stream for ${connectionId}`);
                    }
                    break;

                case 'ping':
                    ws.send(JSON.stringify({ type: 'pong' }));
                    break;

                default:
                    console.warn(`Unknown message type: ${message.type}`);
            }
        } catch (err) {
            console.error('Error handling message:', err);
            ws.send(JSON.stringify({
                type: 'error',
                error: err instanceof Error ? err.message : 'Unknown error',
            }));
        }
    });

    // Handle client disconnect
    ws.on('close', () => {
        console.log(`👋 Client disconnected: ${connectionId}`);

        const connInfo = activeConnections.get(connectionId);
        if (connInfo) {
            if (connInfo.abortController) {
                connInfo.abortController.abort();
            }
            const duration = (Date.now() - connInfo.startTime) / 1000;
            console.log(`   Session duration: ${duration.toFixed(1)}s`);
            console.log(`   Messages sent: ${connInfo.messageCount}`);
        }

        activeConnections.delete(connectionId);
    });

    // Handle errors
    ws.on('error', error => {
        console.error(`WebSocket error for ${connectionId}:`, error);
    });
});

// Handle chat request
async function handleChat(connectionId: string, message: any) {
    const connInfo = activeConnections.get(connectionId);
    if (!connInfo) return;

    const { ws } = connInfo;
    const { messages, model, modelClass, toolsEnabled, maxTokens, temperature } = message;

    if (!messages || messages.length === 0) {
        ws.send(JSON.stringify({
            type: 'error',
            error: 'No messages provided',
        }));
        return;
    }

    console.log(`🤖 Processing chat for ${connectionId}:`);
    console.log(`   Model: ${model || modelClass || 'default'}`);
    console.log(`   Messages: ${messages.length}`);
    console.log(`   Tools enabled: ${toolsEnabled}`);

    try {
        // Create abort controller
        connInfo.abortController = new AbortController();

        // Send stream start event
        ws.send(JSON.stringify({
            type: 'stream_start',
            model: model || modelClass,
            messageCount: messages.length,
        }));

        // Create agent definition
        const agent: AgentDefinition = {
            agent_id: connectionId,
            ...(model ? { model } : { modelClass }),
            maxTokens,
            temperature,
        };

        // Stream the response
        for await (const event of ensembleRequest(
            messages,
            agent,
            {
                tools: toolsEnabled ? exampleTools : undefined,
                signal: connInfo.abortController.signal,
            }
        )) {
            // Forward all events to the client
            ws.send(JSON.stringify(event));
        }

        // Send completion event
        ws.send(JSON.stringify({ type: 'stream_complete' }));

    } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') {
            ws.send(JSON.stringify({
                type: 'stream_aborted',
                message: 'Request was aborted',
            }));
        } else {
            console.error('Error in chat:', err);
            ws.send(JSON.stringify({
                type: 'error',
                error: err instanceof Error ? err.message : 'Unknown error',
            }));
        }
    } finally {
        connInfo.abortController = undefined;
    }
}

// Start server
server.listen(PORT, () => {
    console.log(`\n🚀 Ensemble Request server running on port ${PORT}`);
    console.log(`📡 WebSocket: ws://localhost:${PORT}`);
    console.log(`🌐 Open http://localhost:${PORT}/request-client.html to test\n`);
});