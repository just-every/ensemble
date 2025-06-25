#!/usr/bin/env node
import dotenv from 'dotenv';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { GoogleGenAI } from '@google/genai';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '..', '.env') });

async function testGeminiDirect() {
    const apiKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
    if (!apiKey) {
        console.error('No Google/Gemini API key found');
        return;
    }

    console.log('Testing Gemini TTS directly...');
    const startTime = Date.now();

    const ai = new GoogleGenAI({
        apiKey,
    });

    const config = {
        responseModalities: ['audio'],
        speechConfig: {
            voiceConfig: {
                prebuiltVoiceConfig: {
                    voiceName: 'Kore',
                },
            },
        },
    };

    const model = 'gemini-2.5-flash-preview-tts';
    const text =
        'Welcome to Ensemble Voice Generation! This demo showcases high-quality text-to-speech synthesis using multiple providers.';

    console.log(`Text length: ${text.length} characters`);
    console.log('Calling generateContentStream...');

    const streamStartTime = Date.now();
    const response = await ai.models.generateContentStream({
        model,
        config,
        contents: [
            {
                role: 'user',
                parts: [{ text }],
            },
        ],
    });

    console.log(`Stream created in ${Date.now() - streamStartTime}ms`);

    let firstChunkTime: number | null = null;
    let chunkCount = 0;
    let totalBytes = 0;

    for await (const chunk of response) {
        if (!firstChunkTime) {
            firstChunkTime = Date.now() - startTime;
            console.log(`First chunk at: ${firstChunkTime}ms`);
        }

        chunkCount++;

        if (chunk.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data) {
            const bytes = chunk.candidates[0].content.parts[0].inlineData.data.length;
            totalBytes += bytes;

            if (chunkCount % 10 === 0) {
                console.log(`Chunk ${chunkCount}: ${bytes} bytes (base64), total: ${totalBytes}`);
            }
        }
    }

    const totalTime = Date.now() - startTime;
    console.log(`\nTotal time: ${totalTime}ms`);
    console.log(`Total chunks: ${chunkCount}`);
    console.log(`Total data: ${totalBytes} bytes (base64)`);
}

testGeminiDirect().catch(console.error);
