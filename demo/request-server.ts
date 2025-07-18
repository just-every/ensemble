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
import { ensembleRequest, setEnsembleLogger } from '../dist/index.js';
import type { ToolFunction, AgentDefinition } from '../dist/types.js';
import { MODEL_REGISTRY, MODEL_CLASSES } from '../dist/data/model_data.js';
import { enableRequestDemoLogger } from '@just-every/demo-ui';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load .env from root directory
dotenv.config({ path: join(__dirname, '..', '.env') });

const app = express();
const server = createServer(app);
const PORT = process.env.REQUEST_PORT || process.env.PORT || 3005;

// Utility function to remove code block wrapping from responses
function removeCodeBlockWrapping(text: string): string {
    if (!text || typeof text !== 'string') return text;

    // Remove leading/trailing whitespace
    let cleaned = text.trim();

    // Check for code block patterns and remove them
    // Patterns: ```json, ```javascript, ```js, ```typescript, ```ts, ```python, ```py, ```
    const codeBlockRegex = /^```[\w]*\n?([\s\S]*?)\n?```$/;
    const match = cleaned.match(codeBlockRegex);

    if (match) {
        // Extract content between code blocks
        cleaned = match[1].trim();
    }

    return cleaned;
}

// Serve static files
app.use(express.static(__dirname));

// Serve the dist directory for modules
app.use('/dist', express.static(join(__dirname, '..', 'dist')));

// WebSocket server for streaming
const wss = new WebSocketServer({ server });

// Helper function to generate mock responses using a mini model
async function generateMockResponse(toolName: string, args: any): Promise<string> {
    try {
        // Use a mini model to generate more realistic mock responses
        const prompt = `Generate a realistic mock response for a tool called "${toolName}" with arguments: ${JSON.stringify(args)}.
Keep it brief but realistic. Only return the response content in JSON form without any additional text or formatting.`;

        const mockAgent: AgentDefinition = {
            agent_id: 'mock-tool-response',
            modelClass: 'mini',
            maxTokens: 200,
            temperature: 0.7,
        };

        let response = '';
        for await (const event of ensembleRequest([{ role: 'user', content: prompt }], mockAgent)) {
            if (event.type === 'message_complete' && event.content) {
                response = event.content;
            }
        }

        // Remove code block wrapping from the response
        const cleanedResponse = removeCodeBlockWrapping(response);
        return cleanedResponse ? `Mock Response:\n${cleanedResponse}` : `Mock response for ${toolName}`;
    } catch (error) {
        // Fallback to simple mock responses if mini model fails
        console.log(`Failed to generate mock response with mini model: ${error}`);

        // Return more realistic fallback responses based on tool name
        switch (toolName) {
            case 'get_weather': {
                const location = args.location || 'Unknown';
                const temp = Math.floor(Math.random() * 20) + 15;
                const conditions = ['sunny', 'partly cloudy', 'cloudy', 'rainy'];
                const condition = conditions[Math.floor(Math.random() * conditions.length)];
                return `Mock Response:\n$Weather in ${location}: ${temp}°C, ${condition}. Humidity: ${60 + Math.floor(Math.random() * 30)}%. Wind: ${5 + Math.floor(Math.random() * 15)} km/h`;
            }

            case 'web_search': {
                const query = args.query || 'search term';
                return `Mock Response:
Search results for "${query}"
1. ${query} - Wikipedia: Comprehensive overview and history
2. Latest ${query} news and updates - TechCrunch
3. Understanding ${query}: A beginner's guide - Medium
4. ${query} best practices and tips - Stack Overflow`;
            }

            default:
                return `Mock response for ${toolName} with args: ${JSON.stringify(args)}`;
        }
    }
}

// Example tools for demonstration
const exampleTools: ToolFunction[] = [
    {
        function: async (location: string) => {
            return await generateMockResponse('get_weather', { location });
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
        function: async (expression: string) => {
            console.log('[Calculate] ===== FUNCTION CALLED =====');
            console.log('[Calculate] Function called with expression:', expression);
            try {
                // Simple test first
                if (expression === '15 * 23') {
                    console.log('[Calculate] Hardcoded test: 15 * 23 = 345');
                    return `Result: 345`;
                }

                // Create a safe math context with common functions
                const mathContext = {
                    Math: Math,
                    sqrt: Math.sqrt,
                    pow: Math.pow,
                    abs: Math.abs,
                    round: Math.round,
                    floor: Math.floor,
                    ceil: Math.ceil,
                    sin: Math.sin,
                    cos: Math.cos,
                    tan: Math.tan,
                    log: Math.log,
                    exp: Math.exp,
                    PI: Math.PI,
                    E: Math.E,
                };

                // Create a function with the math context
                const func = new Function(...Object.keys(mathContext), `"use strict"; return (${expression})`);
                const result = func(...Object.values(mathContext));

                console.log('[Calculate] Result:', result);
                const response = `Result: ${result}`;
                console.log('[Calculate] Returning:', response);
                return response;
            } catch (error) {
                console.error('[Calculate] Error:', error);
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
        function: async (query: string) => {
            return await generateMockResponse('web_search', { query });
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
const activeConnections = new Map<
    string,
    {
        startTime: number;
        messageCount: number;
        ws: any;
        isStreaming: boolean;
        abortController?: AbortController;
    }
>();

// Handle WebSocket connections
wss.on('connection', ws => {
    const connectionId = Math.random().toString(36).substring(7);
    console.log(`New client connected: ${connectionId}`);

    // Set up the logger before any operations
    const { disconnect } = enableRequestDemoLogger(ws, setEnsembleLogger);

    // Store connection info
    activeConnections.set(connectionId, {
        startTime: Date.now(),
        messageCount: 0,
        ws,
        isStreaming: false,
    });

    // Send connection acknowledgment with live model data
    ws.send(
        JSON.stringify({
            type: 'connected',
            connectionId,
            availableTools: exampleTools.map(t => ({
                name: t.definition.function.name,
                description: t.definition.function.description,
            })),
            models: Object.values(MODEL_REGISTRY).map(model => ({
                id: model.id,
                provider: model.provider,
                description: model.description || '',
                aliases: model.aliases || [],
                features: model.features,
            })),
            modelClasses: Object.entries(MODEL_CLASSES).map(([id, classData]) => ({
                id,
                models: classData.models,
                description: classData.description,
                random: classData.random,
            })),
        })
    );

    // Handle incoming messages
    ws.on('message', async data => {
        const connInfo = activeConnections.get(connectionId);
        if (!connInfo) return;

        try {
            const message = JSON.parse(data.toString());

            switch (message.type) {
                case 'chat':
                    if (connInfo.isStreaming) {
                        ws.send(
                            JSON.stringify({
                                type: 'error',
                                error: 'Request already in progress',
                            })
                        );
                        return;
                    }

                    connInfo.isStreaming = true;
                    connInfo.messageCount++;

                    // Handle follow-up requests separately
                    console.log('📨 Chat message received, isFollowUp:', message.isFollowUp);
                    if (message.isFollowUp) {
                        await handleFollowUpRequest(ws, message);
                    } else {
                        await handleChat(connectionId, message);
                    }

                    connInfo.isStreaming = false;
                    break;

                case 'stop':
                    if (connInfo.abortController) {
                        connInfo.abortController.abort();
                        console.log(`Aborted stream for ${connectionId}`);
                    }
                    break;

                case 'ping':
                    ws.send(JSON.stringify({ type: 'pong' }));
                    break;

                case 'get_models':
                    ws.send(
                        JSON.stringify({
                            type: 'models_list',
                            models: Object.keys(MODEL_REGISTRY),
                            modelClasses: Object.keys(MODEL_CLASSES),
                        })
                    );
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
        console.log(`Client disconnected: ${connectionId}`);

        // Disconnect the logger
        disconnect();

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

// Handle follow-up request separately
async function handleFollowUpRequest(ws: any, message: any) {
    const { messages, modelClass, maxTokens, temperature } = message;

    console.log('🔮 Handling follow-up request separately');

    try {
        // Create a simple agent for follow-up generation
        const agent: AgentDefinition = {
            agent_id: 'follow-up-generator',
            modelClass: modelClass || 'mini',
            maxTokens: maxTokens || 100,
            temperature: temperature || 0.8,
        };

        // Collect the full response without sending any events
        let followUpContent = '';

        for await (const event of ensembleRequest(messages, agent)) {
            if (event.type === 'message_delta' && event.content) {
                followUpContent += event.content;
            } else if (event.type === 'message_complete' && event.content) {
                followUpContent = event.content;
            }
        }

        // Send only the final follow-up suggestion
        ws.send(
            JSON.stringify({
                type: 'follow_up_suggestion',
                content: followUpContent.trim(),
            })
        );
    } catch (err) {
        console.error('Error generating follow-up:', err);
        // Don't send error to client for follow-up generation
    }
}

// Handle chat request
async function handleChat(connectionId: string, message: any) {
    const connInfo = activeConnections.get(connectionId);
    if (!connInfo) return;

    const { ws } = connInfo;
    const {
        messages,
        model,
        modelClass,
        toolsEnabled,
        maxTokens,
        temperature,
        topP,
        frequencyPenalty,
        presencePenalty,
        seed,
    } = message;

    if (!messages || messages.length === 0) {
        ws.send(
            JSON.stringify({
                type: 'error',
                error: 'No messages provided',
            })
        );
        return;
    }

    console.log(`Processing chat for ${connectionId}:`);
    console.log(`   Model: ${model || modelClass || 'default'}`);
    console.log(`   Messages: ${messages.length}`);
    console.log(`   Tools enabled: ${toolsEnabled}`);

    try {
        // Create abort controller
        connInfo.abortController = new AbortController();

        // Create agent definition
        const agent: AgentDefinition = {
            agent_id: connectionId,
            ...(model ? { model } : { modelClass }),
            maxTokens,
            ...(temperature !== undefined && { temperature }),
            ...(topP !== undefined && { topP }),
            ...(frequencyPenalty !== undefined && { frequencyPenalty }),
            ...(presencePenalty !== undefined && { presencePenalty }),
            ...(seed !== undefined && { seed }),
            tools: toolsEnabled ? exampleTools : undefined,
            abortSignal: connInfo.abortController.signal,
        };

        // Send stream start event
        ws.send(
            JSON.stringify({
                type: 'stream_start',
                model: model || modelClass,
                messageCount: messages.length,
            })
        );

        // Send the user message as a response_output event to ensure it appears in the conversation
        const userMessage = messages[messages.length - 1]; // Get the latest user message
        if (userMessage && userMessage.role === 'user') {
            ws.send(
                JSON.stringify({
                    type: 'response_output',
                    message: {
                        id: `user-${Date.now()}`,
                        type: 'message',
                        role: 'user',
                        content: userMessage.content,
                    },
                    request_id: connectionId,
                })
            );
        }

        // Normal streaming for regular messages
        for await (const event of ensembleRequest(messages, agent)) {
            // Forward all events to the client
            ws.send(JSON.stringify(event));
        }

        // Send completion event
        ws.send(JSON.stringify({ type: 'stream_complete' }));
    } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') {
            ws.send(
                JSON.stringify({
                    type: 'stream_aborted',
                    message: 'Request was aborted',
                })
            );
        } else {
            console.error('Error in chat:', err);
            ws.send(
                JSON.stringify({
                    type: 'error',
                    error: err instanceof Error ? err.message : 'Unknown error',
                })
            );
        }
    } finally {
        connInfo.abortController = undefined;
    }
}

// Start server
server.listen(PORT, () => {
    console.log(`Request server running on port ${PORT}`);
});
