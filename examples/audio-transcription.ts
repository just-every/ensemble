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

// Example 4: Browser microphone transcription (SECURITY WARNING!)
async function browserMicrophoneExample() {
    console.log('\n=== Example 4: Browser Microphone Transcription ===\n');
    console.log('⚠️  SECURITY WARNING: This example requires API keys in the browser!');
    console.log('For production use, see the client-server example below.\n');
    console.log('This example shows how to use ensembleListen directly in a browser:\n');

    const exampleCode = `
import { ensembleListen, createAudioStreamFromMediaStream} from '@just-every/ensemble';

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

// Example 5: Secure client-server architecture (RECOMMENDED)
async function clientServerExample() {
    console.log('\n=== Example 5: Client-Server Architecture (RECOMMENDED) ===\n');
    console.log('This is the recommended approach for production applications.');
    console.log('API keys stay secure on the server, while audio is collected in the browser.\n');
    
    console.log('📁 Server-side code (audio-transcription-server.ts):');
    console.log('   - Express server with WebSocket support');
    console.log('   - Handles transcription using ensembleListen');
    console.log('   - Keeps API keys secure on the server');
    console.log('   - Supports both HTTP and WebSocket endpoints\n');
    
    console.log('📁 Client-side code (audio-transcription-client.html):');
    console.log('   - Pure browser JavaScript (no API keys!)');
    console.log('   - Captures audio from microphone');
    console.log('   - Streams audio to server via WebSocket');
    console.log('   - Receives transcription events from server\n');
    
    console.log('Key benefits:');
    console.log('✅ API keys never exposed to client');
    console.log('✅ Server can handle authentication/authorization');
    console.log('✅ Server can log/monitor usage');
    console.log('✅ Server can apply rate limiting');
    console.log('✅ Works with any client (web, mobile, desktop)\n');
    
    console.log('To run the example:');
    console.log('1. Start the server:');
    console.log('   npx tsx examples/audio-transcription-server.ts\n');
    console.log('2. Open the client in a browser:');
    console.log('   open examples/audio-transcription-client.html\n');
    console.log('3. Click "Start Transcription" and speak!\n');
    
    console.log('The server handles all the transcription logic while the client');
    console.log('only handles audio capture and UI updates.');
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
            case 'client-server':
                await clientServerExample();
                break;
            default:
                console.log(
                    'Usage: npm run example:transcription [file|realtime-openai|realtime-gemini|browser|client-server]'
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
                    '  browser        - Example code for browser microphone (requires API keys in browser)'
                );
                console.log(
                    '  client-server  - Secure client-server architecture (RECOMMENDED)'
                );
        }
    } catch (error) {
        console.error('Error:', error);
    }
}

// Run the example
main().catch(console.error);
