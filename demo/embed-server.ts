#!/usr/bin/env node
/**
 * Ensemble Embed server demonstrating text embeddings
 *
 * This server shows how to use ensembleEmbed for generating vector embeddings
 * with support for multiple models, similarity search, and visualization.
 */

import dotenv from 'dotenv';
import { join } from 'path';
import express from 'express';
import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { ensembleEmbed, ensembleRequest } from '../dist/index.js';
import type { AgentDefinition } from '../dist/types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load .env from root directory
dotenv.config({ path: join(__dirname, '..', '.env') });

const app = express();
const server = createServer(app);
const PORT = process.env.EMBED_PORT || process.env.PORT || 3006;

// Serve static files
app.use(express.static(__dirname));

// Serve the dist directory for modules
app.use('/dist', express.static(join(__dirname, '..', 'dist')));

// WebSocket server for real-time communication
const wss = new WebSocketServer({ server });

// In-memory store for embeddings (in production, use a vector database)
interface StoredEmbedding {
    id: string;
    text: string;
    embedding: number[];
    model: string;
    dimensions: number;
    timestamp: Date;
    metadata?: Record<string, any>;
}

const embeddingStore: StoredEmbedding[] = [];

// Track active connections
const activeConnections = new Map<
    string,
    {
        startTime: number;
        embedCount: number;
        ws: any;
        isProcessing: boolean;
    }
>();

// Calculate cosine similarity between two vectors
function cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) {
        throw new Error('Vectors must have the same length');
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
        dotProduct += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
    }

    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

// Handle WebSocket connections
wss.on('connection', ws => {
    const connectionId = Math.random().toString(36).substring(7);
    console.log(`New client connected: ${connectionId}`);

    // Store connection info
    activeConnections.set(connectionId, {
        startTime: Date.now(),
        embedCount: 0,
        ws,
        isProcessing: false,
    });

    // Send connection acknowledgment with current store
    ws.send(
        JSON.stringify({
            type: 'connected',
            connectionId,
            storeCount: embeddingStore.length,
            availableModels: [
                { id: 'text-embedding-3-small', name: 'OpenAI Small (1536d)', provider: 'openai' },
                { id: 'text-embedding-3-large', name: 'OpenAI Large (3072d)', provider: 'openai' },
                { id: 'text-embedding-ada-002', name: 'OpenAI Ada v2 (1536d)', provider: 'openai' },
                { id: 'gemini-embedding-exp-03-07', name: 'Gemini Experimental (768d)', provider: 'google' },
            ],
        })
    );

    // Handle incoming messages
    ws.on('message', async data => {
        const connInfo = activeConnections.get(connectionId);
        if (!connInfo) return;

        try {
            const message = JSON.parse(data.toString());

            switch (message.type) {
                case 'embed':
                    if (connInfo.isProcessing) {
                        ws.send(
                            JSON.stringify({
                                type: 'error',
                                error: 'Already processing an embedding request',
                            })
                        );
                        return;
                    }

                    connInfo.isProcessing = true;
                    await handleEmbed(connectionId, message);
                    connInfo.isProcessing = false;
                    break;

                case 'search':
                    await handleSearch(connectionId, message);
                    break;

                case 'analyze':
                    await handleAnalyze(connectionId, message);
                    break;

                case 'clear':
                    embeddingStore.length = 0;
                    ws.send(
                        JSON.stringify({
                            type: 'store_cleared',
                            message: 'All embeddings cleared',
                        })
                    );
                    break;

                case 'delete': {
                    const index = embeddingStore.findIndex(e => e.id === message.id);
                    if (index !== -1) {
                        embeddingStore.splice(index, 1);
                        ws.send(
                            JSON.stringify({
                                type: 'embedding_deleted',
                                id: message.id,
                            })
                        );
                    }
                    break;
                }

                case 'get_store':
                    ws.send(
                        JSON.stringify({
                            type: 'store_data',
                            embeddings: embeddingStore.map(e => ({
                                id: e.id,
                                text: e.text,
                                model: e.model,
                                dimensions: e.dimensions,
                                timestamp: e.timestamp,
                                metadata: e.metadata,
                            })),
                        })
                    );
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
        console.log(`Client disconnected: ${connectionId}`);

        const connInfo = activeConnections.get(connectionId);
        if (connInfo) {
            const duration = (Date.now() - connInfo.startTime) / 1000;
            console.log(`   Session duration: ${duration.toFixed(1)}s`);
            console.log(`   Embeddings created: ${connInfo.embedCount}`);
        }

        activeConnections.delete(connectionId);
    });

    // Handle errors
    ws.on('error', error => {
        console.error(`WebSocket error for ${connectionId}:`, error);
    });
});

// Handle embedding request
async function handleEmbed(connectionId: string, message: any) {
    const connInfo = activeConnections.get(connectionId);
    if (!connInfo) return;

    const { ws } = connInfo;
    const { texts, model, dimensions } = message;

    if (!texts || texts.length === 0) {
        ws.send(
            JSON.stringify({
                type: 'error',
                error: 'No texts provided',
            })
        );
        return;
    }

    console.log(`Generating embeddings for ${connectionId}:`);
    console.log(`   Model: ${model}`);
    console.log(`   Dimensions: ${dimensions || 'default'}`);
    console.log(`   Texts: ${texts.length}`);

    try {
        // Send start event
        ws.send(
            JSON.stringify({
                type: 'embed_start',
                model,
                dimensions,
                textCount: texts.length,
            })
        );

        const startTime = Date.now();
        const embeddings: StoredEmbedding[] = [];

        // Generate embeddings for each text
        for (let i = 0; i < texts.length; i++) {
            const text = texts[i];

            // Create agent definition
            const agent: AgentDefinition = {
                agent_id: connectionId,
                model,
            };

            // Generate embedding
            const embedding = await ensembleEmbed(text, agent, dimensions ? { dimensions } : undefined);

            // Store the embedding
            const stored: StoredEmbedding = {
                id: Math.random().toString(36).substring(7),
                text,
                embedding,
                model,
                dimensions: embedding.length,
                timestamp: new Date(),
            };

            embeddingStore.push(stored);
            embeddings.push(stored);
            connInfo.embedCount++;

            // Send progress
            ws.send(
                JSON.stringify({
                    type: 'embed_progress',
                    current: i + 1,
                    total: texts.length,
                    id: stored.id,
                    dimensions: stored.dimensions,
                })
            );
        }

        const duration = (Date.now() - startTime) / 1000;

        // Send completion
        ws.send(
            JSON.stringify({
                type: 'embed_complete',
                embeddings: embeddings.map(e => ({
                    id: e.id,
                    text: e.text,
                    dimensions: e.dimensions,
                    preview: e.embedding.slice(0, 5).map(n => n.toFixed(4)),
                })),
                duration,
                averageTime: duration / texts.length,
            })
        );
    } catch (err) {
        console.error('Error in embed:', err);
        ws.send(
            JSON.stringify({
                type: 'error',
                error: err instanceof Error ? err.message : 'Unknown error',
            })
        );
    }
}

// Handle similarity search
async function handleSearch(connectionId: string, message: any) {
    const connInfo = activeConnections.get(connectionId);
    if (!connInfo) return;

    const { ws } = connInfo;
    const { query, model, dimensions, topK = 5 } = message;

    if (!query) {
        ws.send(
            JSON.stringify({
                type: 'error',
                error: 'No query provided',
            })
        );
        return;
    }

    console.log(`Searching for ${connectionId}: "${query}"`);

    try {
        // Send start event
        ws.send(
            JSON.stringify({
                type: 'search_start',
                query,
                model,
            })
        );

        // Generate embedding for query
        const agent: AgentDefinition = {
            agent_id: connectionId,
            model,
        };

        const queryEmbedding = await ensembleEmbed(query, agent, dimensions ? { dimensions } : undefined);

        // Find similar embeddings (filter by dimensions)
        const candidates = embeddingStore.filter(e => e.dimensions === queryEmbedding.length);

        if (candidates.length === 0) {
            ws.send(
                JSON.stringify({
                    type: 'search_complete',
                    results: [],
                    message: `No embeddings found with ${queryEmbedding.length} dimensions`,
                })
            );
            return;
        }

        // Calculate similarities
        const similarities = candidates.map(stored => ({
            ...stored,
            similarity: cosineSimilarity(queryEmbedding, stored.embedding),
        }));

        // Sort by similarity and take top K
        similarities.sort((a, b) => b.similarity - a.similarity);
        const topResults = similarities.slice(0, topK);

        // Send results
        ws.send(
            JSON.stringify({
                type: 'search_complete',
                results: topResults.map(r => ({
                    id: r.id,
                    text: r.text,
                    similarity: r.similarity,
                    model: r.model,
                    timestamp: r.timestamp,
                })),
                queryDimensions: queryEmbedding.length,
                totalCandidates: candidates.length,
            })
        );
    } catch (err) {
        console.error('Error in search:', err);
        ws.send(
            JSON.stringify({
                type: 'error',
                error: err instanceof Error ? err.message : 'Unknown error',
            })
        );
    }
}

// Handle embedding analysis
async function handleAnalyze(connectionId: string, message: any) {
    const connInfo = activeConnections.get(connectionId);
    if (!connInfo) return;

    const { ws } = connInfo;
    const { ids } = message;

    if (!ids || ids.length < 2) {
        ws.send(
            JSON.stringify({
                type: 'error',
                error: 'Need at least 2 embeddings to analyze',
            })
        );
        return;
    }

    console.log(`Analyzing embeddings for ${connectionId}`);

    try {
        // Get embeddings
        const embeddings = ids
            .map((id: string) => embeddingStore.find(e => e.id === id))
            .filter(Boolean) as StoredEmbedding[];

        if (embeddings.length < 2) {
            ws.send(
                JSON.stringify({
                    type: 'error',
                    error: 'Could not find all requested embeddings',
                })
            );
            return;
        }

        // Check dimensions match
        const dims = embeddings[0].dimensions;
        if (!embeddings.every(e => e.dimensions === dims)) {
            ws.send(
                JSON.stringify({
                    type: 'error',
                    error: 'All embeddings must have the same dimensions',
                })
            );
            return;
        }

        // Calculate similarity matrix
        const similarities: number[][] = [];
        for (let i = 0; i < embeddings.length; i++) {
            similarities[i] = [];
            for (let j = 0; j < embeddings.length; j++) {
                similarities[i][j] = cosineSimilarity(embeddings[i].embedding, embeddings[j].embedding);
            }
        }

        // Use AI to analyze the relationships
        const agent: AgentDefinition = {
            agent_id: connectionId,
            modelClass: 'mini',
        };

        // Create a list of pairwise similarities (excluding self-comparisons)
        const pairwiseSimilarities: string[] = [];
        for (let i = 0; i < embeddings.length; i++) {
            for (let j = i + 1; j < embeddings.length; j++) {
                pairwiseSimilarities.push(`Text ${i + 1} vs Text ${j + 1}: ${similarities[i][j].toFixed(3)}`);
            }
        }

        const analysisPrompt = `Analyze the semantic relationships between these texts based on their cosine similarities:

${embeddings.map((e, i) => `Text ${i + 1}: "${e.text}"`).join('\n')}

Cosine similarities (values from -1 to 1, where 1 = identical):
${pairwiseSimilarities.join('\n')}

Provide a brief analysis of:
1. Which texts are most similar and why
2. Which texts are most different and why
3. Any interesting patterns or clusters
4. What these similarities reveal about the semantic relationships`;

        const analysis = await ensembleRequest([{ role: 'user', content: analysisPrompt }], agent);

        let aiAnalysis = '';
        for await (const event of analysis) {
            if (event.type === 'message_delta' && event.content) {
                aiAnalysis = event.content;
            } else if (event.type === 'message_complete' && event.content) {
                aiAnalysis = event.content;
            }
        }

        console.log(`Analysis result for ${connectionId}: ${aiAnalysis.length} characters`);
        if (!aiAnalysis) {
            console.warn('Analysis was empty! Sending default message.');
            aiAnalysis = 'Analysis generation failed. Please try again.';
        }

        // Send analysis results
        ws.send(
            JSON.stringify({
                type: 'analyze_complete',
                embeddings: embeddings.map(e => ({
                    id: e.id,
                    text: e.text,
                    model: e.model,
                })),
                similarities: similarities.map((row, i) => ({
                    from: embeddings[i].id,
                    to: row.map((sim, j) => ({
                        id: embeddings[j].id,
                        similarity: sim,
                    })),
                })),
                analysis: aiAnalysis,
            })
        );
    } catch (err) {
        console.error('Error in analyze:', err);
        ws.send(
            JSON.stringify({
                type: 'error',
                error: err instanceof Error ? err.message : 'Unknown error',
            })
        );
    }
}

// Start server
server.listen(PORT, () => {
    console.log(`Embed server running on port ${PORT}`);
});
