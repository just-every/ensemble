#!/usr/bin/env node
import dotenv from 'dotenv';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { ensembleVoice } from '../dist/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '..', '.env') });

const testText = 'Hello, this is a test of voice generation speed.';

async function testProvider(model: string, voice: string) {
    console.log(`\n========== Testing ${model} ==========`);
    const startTime = Date.now();

    try {
        let firstChunkTime: number | null = null;
        let chunkCount = 0;

        for await (const event of ensembleVoice(testText, { model }, { voice, response_format: 'mp3' })) {
            if (event.type === 'audio_stream' && event.data) {
                chunkCount++;
                if (!firstChunkTime) {
                    firstChunkTime = Date.now() - startTime;
                    console.log(`First audio chunk at: ${firstChunkTime}ms`);
                }
            }
        }

        const totalTime = Date.now() - startTime;
        console.log(`Total time: ${totalTime}ms`);
        console.log(`Total chunks: ${chunkCount}`);
    } catch (error) {
        console.error(`Error testing ${model}:`, error);
    }
}

async function main() {
    // Test OpenAI
    await testProvider('tts-1', 'alloy');

    // Test ElevenLabs
    await testProvider('eleven_multilingual_v2', 'rachel');

    // Test Gemini
    await testProvider('gemini-2.5-flash-preview-tts', 'Kore');
}

main().catch(console.error);
