#!/usr/bin/env -S npx tsx
/**
 * Example of using ensembleVoice for Text-to-Speech generation
 */

import { ensembleVoice } from '../index.js';
import { createWriteStream } from 'fs';

// Example 1: Generate speech and save to file
async function generateSpeechBuffer() {
    console.log('\n=== Example 1: Generate speech and save to file ===');

    try {
        const text = 'Hello! This is a test of the OpenAI text-to-speech API.';
        const outputStream = createWriteStream('output-buffer.mp3');
        let totalChunks = 0;

        // Generate speech with streaming
        for await (const event of ensembleVoice(
            text,
            {
                model: 'tts-1',
            },
            {
                voice: 'nova',
                response_format: 'mp3',
            }
        )) {
            if (event.type === 'audio_stream' && event.data) {
                totalChunks++;
                const buffer = Buffer.from(event.data, 'base64');
                outputStream.write(buffer);
            }
        }

        outputStream.end();
        console.log(
            `✓ Saved speech to output-buffer.mp3 (${totalChunks} chunks)`
        );
    } catch (error) {
        console.error('Error generating speech:', error);
    }
}

// Example 2: Process audio with real-time chunk monitoring
async function streamSpeechToFile() {
    console.log('\n=== Example 2: Process audio with real-time monitoring ===');

    try {
        const text =
            'This is a longer text that will be streamed directly to a file. ' +
            'Streaming is more efficient for longer texts because you can start ' +
            'playing the audio before the entire generation is complete.';

        const outputStream = createWriteStream('output-stream.mp3');
        let bytesReceived = 0;

        // Generate speech with streaming
        for await (const event of ensembleVoice(
            text,
            {
                model: 'tts-1',
            },
            {
                voice: 'echo',
                response_format: 'mp3',
            }
        )) {
            if (event.type === 'audio_stream' && event.data) {
                const buffer = Buffer.from(event.data, 'base64');
                bytesReceived += buffer.length;
                outputStream.write(buffer);

                if (event.chunkIndex % 5 === 0) {
                    console.log(
                        `  Processing... ${bytesReceived} bytes received`
                    );
                }
            }
        }

        outputStream.end();
        console.log(
            `✓ Streamed speech to output-stream.mp3 (${bytesReceived} bytes total)`
        );
    } catch (error) {
        console.error('Error streaming speech:', error);
    }
}

// Example 3: Process audio events with detailed tracking
async function processAudioEvents() {
    console.log('\n=== Example 3: Process audio events ===');

    try {
        const text =
            'This example shows how to process audio chunks as they arrive.';

        const outputStream = createWriteStream('output-events.mp3');
        let totalChunks = 0;
        let totalBytes = 0;

        // Stream with events
        for await (const event of ensembleVoice(
            text,
            {
                model: 'tts-1-hd', // High quality model
            },
            {
                voice: 'alloy',
                response_format: 'mp3',
                speed: 1.2, // Slightly faster speech
            }
        )) {
            if (event.type === 'audio_stream') {
                if (event.data) {
                    totalChunks++;
                    const buffer = Buffer.from(event.data, 'base64');
                    totalBytes += buffer.length;
                    outputStream.write(buffer);
                    console.log(
                        `Received chunk ${event.chunkIndex} (${buffer.length} bytes)`
                    );
                } else if (event.format) {
                    console.log(`Audio format: ${event.format}`);
                }
            }
        }

        outputStream.end();
        console.log(
            `✓ Processed ${totalChunks} audio chunks to output-events.mp3 (${totalBytes} bytes)`
        );
    } catch (error) {
        console.error('Error processing audio events:', error);
    }
}

// Example 4: Multiple voices comparison
async function compareVoices() {
    console.log('\n=== Example 4: Compare different voices ===');

    const text = 'Each voice has its own unique characteristics.';
    const voices = [
        'alloy',
        'echo',
        'fable',
        'onyx',
        'nova',
        'shimmer',
    ] as const;

    for (const voice of voices) {
        try {
            console.log(`Generating with voice: ${voice}...`);

            const outputStream = createWriteStream(`voice-${voice}.mp3`);

            for await (const event of ensembleVoice(
                text,
                {
                    model: 'tts-1',
                },
                {
                    voice,
                    response_format: 'mp3',
                }
            )) {
                if (event.type === 'audio_stream' && event.data) {
                    outputStream.write(Buffer.from(event.data, 'base64'));
                }
            }

            outputStream.end();
            console.log(`✓ Saved voice-${voice}.mp3`);
        } catch (error) {
            console.error(`Error with voice ${voice}:`, error);
        }
    }
}

// Example 5: Different audio formats
async function testAudioFormats() {
    console.log('\n=== Example 5: Test different audio formats ===');

    const text = 'Testing different audio output formats.';
    const formats = ['mp3', 'opus', 'aac', 'flac'] as const;

    for (const format of formats) {
        try {
            console.log(`Generating ${format} format...`);

            const outputStream = createWriteStream(`format-test.${format}`);

            for await (const event of ensembleVoice(
                text,
                {
                    model: 'tts-1',
                },
                {
                    voice: 'nova',
                    response_format: format,
                }
            )) {
                if (event.type === 'audio_stream' && event.data) {
                    outputStream.write(Buffer.from(event.data, 'base64'));
                }
            }

            outputStream.end();
            console.log(`✓ Saved format-test.${format}`);
        } catch (error) {
            console.error(`Error with format ${format}:`, error);
        }
    }
}

// Example 6: ElevenLabs voice generation
async function elevenLabsExample() {
    console.log('\n=== Example 6: ElevenLabs voice generation ===');

    try {
        const text =
            'This is a test of the ElevenLabs text-to-speech API with high-quality voices.';

        // Generate with ElevenLabs multilingual model
        const outputStream = createWriteStream('elevenlabs-output.mp3');

        for await (const event of ensembleVoice(
            text,
            {
                model: 'eleven_multilingual_v2',
            },
            {
                voice: 'adam', // Using preset voice name
                response_format: 'mp3_high',
            }
        )) {
            if (event.type === 'audio_stream' && event.data) {
                outputStream.write(Buffer.from(event.data, 'base64'));
            }
        }

        outputStream.end();
        console.log('✓ Saved ElevenLabs speech to elevenlabs-output.mp3');
    } catch (error) {
        console.error('Error with ElevenLabs:', error);
    }
}

// Example 7: ElevenLabs streaming with custom voice settings
async function elevenLabsStreamingExample() {
    console.log(
        '\n=== Example 7: ElevenLabs streaming with custom settings ==='
    );

    try {
        const text =
            'ElevenLabs provides natural-sounding voices with advanced voice cloning capabilities. ' +
            'You can customize the voice settings to achieve different emotional tones and speaking styles.';

        let totalChunks = 0;
        const outputStream = createWriteStream('elevenlabs-stream.mp3');

        for await (const event of ensembleVoice(
            text,
            {
                model: 'eleven_turbo_v2_5', // Turbo model for low latency
            },
            {
                voice: 'rachel',
                response_format: 'mp3',
                voice_settings: {
                    stability: 0.7,
                    similarity_boost: 0.8,
                    style: 0.2,
                    use_speaker_boost: true,
                },
            }
        )) {
            if (event.type === 'audio_stream' && event.data) {
                totalChunks++;
                // Convert base64 to buffer
                const buffer = Buffer.from(event.data, 'base64');
                outputStream.write(buffer);

                if (event.isFinalChunk) {
                    console.log(`✓ Completed streaming ${totalChunks} chunks`);
                }
            } else if (event.type === 'cost_update') {
                console.log(
                    `Cost: $${event.usage.cost?.toFixed(4) || '0.0000'}`
                );
            }
        }

        outputStream.end();
        console.log('✓ Saved ElevenLabs stream to elevenlabs-stream.mp3');
    } catch (error) {
        console.error('Error with ElevenLabs streaming:', error);
    }
}

// Example 8: Compare ElevenLabs voices
async function compareElevenLabsVoices() {
    console.log('\n=== Example 8: Compare ElevenLabs voices ===');

    const text =
        'Each ElevenLabs voice has unique characteristics and speaking style.';
    const voices = ['rachel', 'adam', 'bella', 'josh', 'sam'];

    for (const voice of voices) {
        try {
            console.log(`Generating with ElevenLabs voice: ${voice}...`);

            const outputStream = createWriteStream(
                `elevenlabs-voice-${voice}.mp3`
            );

            for await (const event of ensembleVoice(
                text,
                {
                    model: 'eleven_multilingual_v2',
                },
                {
                    voice,
                    response_format: 'mp3',
                }
            )) {
                if (event.type === 'audio_stream' && event.data) {
                    outputStream.write(Buffer.from(event.data, 'base64'));
                }
            }

            outputStream.end();
            console.log(`✓ Saved elevenlabs-voice-${voice}.mp3`);
        } catch (error) {
            console.error(`Error with ElevenLabs voice ${voice}:`, error);
        }
    }
}

// Run examples
async function main() {
    console.log('Text-to-Speech Examples (OpenAI & ElevenLabs)');
    console.log('=============================================');

    // OpenAI examples
    console.log('\n--- OpenAI Examples ---');
    await generateSpeechBuffer();
    await streamSpeechToFile();
    await processAudioEvents();
    await compareVoices();
    await testAudioFormats();

    // ElevenLabs examples (only if API key is available)
    if (process.env.ELEVENLABS_API_KEY) {
        console.log('\n--- ElevenLabs Examples ---');
        await elevenLabsExample();
        await elevenLabsStreamingExample();
        await compareElevenLabsVoices();
    } else {
        console.log(
            '\n⚠️  Skipping ElevenLabs examples (no ELEVENLABS_API_KEY found)'
        );
    }

    console.log('\n✓ All examples completed!');
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch(console.error);
}
