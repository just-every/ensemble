/**
 * Integration test for ensembleListen with real API keys
 */

import { ensembleListen } from '../index.js';
import type { AgentDefinition, TranscriptionOpts } from '../index.js';
import fs from 'fs/promises';

async function testTranscription() {
    console.log('Testing ensembleListen with real API keys...\n');

    // Test 1: OpenAI Whisper with the test WAV file
    console.log('=== Test 1: OpenAI Whisper ===');
    try {
        const audioBuffer = await fs.readFile('./samples/speech.wav');

        const agent: AgentDefinition = {
            model: 'whisper-1',
        };

        const options: TranscriptionOpts = {
            language: 'en',
            response_format: 'text',
            temperature: 0,
        };

        console.log(`Transcribing ${audioBuffer.length} bytes of audio...`);

        for await (const event of ensembleListen(audioBuffer, agent, options)) {
            console.log(`Event: ${event.type}`);

            if (event.type === 'transcription_delta') {
                console.log(`Partial transcript: "${event.delta}"`);
            } else if (event.type === 'transcription_complete') {
                console.log(`Final transcript: "${event.text}"`);
            } else if (event.type === 'cost_update') {
                console.log(`Cost: $${event.usage?.cost || 0}`);
            } else if (event.type === 'error') {
                console.error('Error:', event.error);
            }
        }

        console.log('✅ OpenAI Whisper test passed\n');
    } catch (error) {
        console.error('❌ OpenAI Whisper test failed:', error);
    }

    // Test 2: Using model class selection
    console.log('=== Test 2: Model Class Selection ===');
    try {
        const audioBuffer = await fs.readFile('./samples/speech.wav');

        const agent: AgentDefinition = {
            modelClass: 'transcription',
        };

        console.log('Using model class "transcription"...');

        for await (const event of ensembleListen(audioBuffer, agent)) {
            if (event.type === 'transcription_start') {
                console.log('Transcription started');
            } else if (event.type === 'transcription_complete') {
                console.log(`Transcript received: "${event.text}"`);
            }
        }

        console.log('✅ Model class selection test passed\n');
    } catch (error) {
        console.error('❌ Model class selection test failed:', error);
    }

    // Test 3: Different audio formats
    console.log('=== Test 3: Different Audio Formats ===');
    try {
        // Test with base64
        const audioBuffer = await fs.readFile('./samples/speech.wav');
        const base64Audio = audioBuffer.toString('base64');

        const agent: AgentDefinition = {
            model: 'whisper-1',
        };

        console.log('Testing with base64 encoded audio...');

        for await (const event of ensembleListen(base64Audio, agent)) {
            if (event.type === 'transcription_complete') {
                console.log(`Base64 transcript: "${event.text}"`);
            }
        }

        console.log('✅ Audio format test passed\n');
    } catch (error) {
        console.error('❌ Audio format test failed:', error);
    }

    // Test 4: Verbose JSON format for detailed output
    console.log('=== Test 4: Verbose JSON Format ===');
    try {
        const audioBuffer = await fs.readFile('./samples/speech.wav');

        const agent: AgentDefinition = {
            model: 'whisper-1',
        };

        const options: TranscriptionOpts = {
            response_format: 'verbose_json',
            timestamp_granularities: ['segment'],
        };

        console.log('Testing verbose JSON format...');

        for await (const event of ensembleListen(audioBuffer, agent, options)) {
            if (event.type === 'transcription_delta') {
                console.log(
                    `Segment [${event.start_time}s - ${event.end_time}s]: "${event.delta}"`
                );
            } else if (event.type === 'transcription_complete') {
                console.log(`Complete transcript: "${event.text}"`);
                if (event.segments) {
                    console.log(`Number of segments: ${event.segments.length}`);
                }
                if (event.duration) {
                    console.log(`Duration: ${event.duration}s`);
                }
            }
        }

        console.log('✅ Verbose JSON test passed\n');
    } catch (error) {
        console.error('❌ Verbose JSON test failed:', error);
    }

    console.log('All tests completed!');
}

// Run the tests
testTranscription().catch(console.error);
