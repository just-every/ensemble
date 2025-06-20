/**
 * Example of using ensembleListen for audio transcription
 */

import { ensembleListen } from '../index.js';
import type { AgentDefinition, TranscriptionOpts } from '../index.js';
import fs from 'fs/promises';

// Example 1: Transcribe an audio file using Whisper
async function transcribeAudioFile() {
    console.log('\n=== Example 1: Transcribe Audio File with Whisper ===\n');

    // Read audio file
    const audioBuffer = await fs.readFile('./samples/speech.wav');

    const agent: AgentDefinition = {
        model: 'whisper-1', // OpenAI's Whisper model
    };

    const options: TranscriptionOpts = {
        language: 'en',
        response_format: 'verbose_json',
        temperature: 0,
        timestamp_granularities: ['segment', 'word'],
    };

    console.log('Transcribing audio file...');

    for await (const event of ensembleListen(audioBuffer, agent, options)) {
        switch (event.type) {
            case 'transcription_start':
                console.log('Transcription started:', event);
                break;

            case 'transcription_delta':
                console.log('Partial transcript:', event.delta);
                break;

            case 'transcription_complete':
                console.log('\nFinal transcript:', event.text);
                if (event.segments) {
                    console.log('\nSegments:');
                    event.segments.forEach(segment => {
                        console.log(
                            `  [${segment.start}s - ${segment.end}s]: ${segment.text}`
                        );
                    });
                }
                break;

            case 'cost_update':
                console.log('\nCost:', event.usage);
                break;

            case 'error':
                console.error('Error:', event.error);
                break;
        }
    }
}

// Example 2: Real-time transcription with OpenAI Realtime API
async function realtimeTranscriptionOpenAI() {
    console.log('\n=== Example 2: Real-time Transcription with OpenAI ===\n');

    // Simulate a streaming audio source (in real app, use MediaStream)
    const audioStream = new ReadableStream<Uint8Array>({
        async start(controller) {
            // Read a WAV file and stream it in chunks
            const audioData = await fs.readFile('./samples/speech.wav');
            const chunkSize = 4096;

            for (let i = 0; i < audioData.length; i += chunkSize) {
                const chunk = audioData.slice(i, i + chunkSize);
                controller.enqueue(new Uint8Array(chunk));
                // Simulate real-time streaming
                await new Promise(resolve => setTimeout(resolve, 50));
            }

            controller.close();
        },
    });

    const agent: AgentDefinition = {
        model: 'gpt-4o-realtime-preview',
    };

    const options: TranscriptionOpts = {
        stream: true,
        vad: {
            enabled: true,
            mode: 'server_vad',
            threshold: 0.5,
            silence_duration_ms: 500,
        },
    };

    console.log('Starting real-time transcription...');

    for await (const event of ensembleListen(audioStream, agent, options)) {
        switch (event.type) {
            case 'transcription_start':
                console.log('Connected to OpenAI Realtime API');
                break;

            case 'vad_speech_start':
                console.log('\n🎤 Speech detected');
                break;

            case 'vad_speech_end':
                console.log('🔇 Speech ended');
                break;

            case 'transcription_delta':
                process.stdout.write(event.delta);
                break;

            case 'transcription_complete':
                console.log('\n\nFinal transcript:', event.text);
                break;

            case 'error':
                console.error('\nError:', event.error);
                break;
        }
    }
}

// Example 3: Real-time transcription with Gemini Live
async function realtimeTranscriptionGemini() {
    console.log(
        '\n=== Example 3: Real-time Transcription with Gemini Live ===\n'
    );

    // Create a simple audio stream
    const audioStream = new ReadableStream<Uint8Array>({
        async start(controller) {
            const audioData = await fs.readFile('./samples/speech.wav');
            controller.enqueue(new Uint8Array(audioData));
            controller.close();
        },
    });

    const agent: AgentDefinition = {
        model: 'gemini-2.0-flash-live-001',
    };

    const options: TranscriptionOpts = {
        stream: true,
        vad: {
            enabled: true,
            threshold: 0.5,
            prefix_padding_ms: 300,
            silence_duration_ms: 700,
        },
        temperature: 0.5,
    };

    console.log('Starting Gemini Live transcription...');

    for await (const event of ensembleListen(audioStream, agent, options)) {
        switch (event.type) {
            case 'transcription_start':
                console.log('Connected to Gemini Live API');
                break;

            case 'vad_speech_start':
                console.log('\n🎤 Speech detected');
                break;

            case 'vad_speech_end':
                console.log('🔇 Speech ended');
                break;

            case 'transcription_delta':
                console.log('Transcript:', event.delta);
                break;

            case 'transcription_complete':
                console.log('\nFinal transcript:', event.text);
                break;

            case 'error':
                console.error('\nError:', event.error);
                break;
        }
    }
}

// Example 4: Browser microphone transcription (for web apps)
async function browserMicrophoneExample() {
    console.log('\n=== Example 4: Browser Microphone Transcription ===\n');
    console.log('This example shows how to use ensembleListen in a browser:\n');

    const exampleCode = `
// In a browser environment:
async function startMicrophoneTranscription() {
    // Get microphone access
    const mediaStream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
            channelCount: 1,
            sampleRate: 16000,
            echoCancellation: true,
            noiseSuppression: true,
        }
    });

    // Convert MediaStream to ReadableStream<Uint8Array>
    const audioStream = createAudioStreamFromMediaStream(mediaStream, {
        sampleRate: 16000,
        channelCount: 1,
        bufferSize: 4096,
    });

    // Configure the agent
    const agent = {
        model: 'gpt-4o-realtime-preview', // or 'gemini-2.0-flash-live-001'
    };

    const options = {
        stream: true,
        vad: {
            enabled: true,
            mode: 'server_vad',
            threshold: 0.5,
        },
        language: 'en',
    };

    // Start transcription
    for await (const event of ensembleListen(audioStream, agent, options)) {
        switch (event.type) {
            case 'transcription_delta':
                // Update UI with partial transcript
                document.getElementById('transcript').textContent += event.delta;
                break;
                
            case 'vad_speech_start':
                document.getElementById('status').textContent = 'Listening...';
                break;
                
            case 'vad_speech_end':
                document.getElementById('status').textContent = 'Processing...';
                break;
                
            case 'transcription_complete':
                document.getElementById('final-transcript').textContent = event.text;
                break;
        }
    }
}
`;

    console.log(exampleCode);
}

// Main function to run examples
async function main() {
    const args = process.argv.slice(2);
    const example = args[0] || 'file';

    try {
        switch (example) {
            case 'file':
                await transcribeAudioFile();
                break;
            case 'realtime-openai':
                await realtimeTranscriptionOpenAI();
                break;
            case 'realtime-gemini':
                await realtimeTranscriptionGemini();
                break;
            case 'browser':
                await browserMicrophoneExample();
                break;
            default:
                console.log(
                    'Usage: npm run example:transcription [file|realtime-openai|realtime-gemini|browser]'
                );
                console.log('\nExamples:');
                console.log(
                    '  file           - Transcribe an audio file using Whisper'
                );
                console.log(
                    '  realtime-openai - Real-time transcription with OpenAI'
                );
                console.log(
                    '  realtime-gemini - Real-time transcription with Gemini'
                );
                console.log(
                    '  browser        - Example code for browser microphone'
                );
        }
    } catch (error) {
        console.error('Error:', error);
    }
}

// Run the example
main().catch(console.error);
