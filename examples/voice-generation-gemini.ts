/**
 * Example: Voice Generation with Gemini TTS
 *
 * This example demonstrates how to use Gemini's text-to-speech models
 * to generate natural-sounding speech from text.
 */

import { ensembleVoice } from '../index.js';
import type { AgentDefinition, VoiceGenerationOpts } from '../index.js';
import { writeFile } from 'fs/promises';
import { Buffer } from 'buffer';

// Example 1: Simple voice generation with default settings
async function simpleVoiceGeneration() {
    console.log('\n=== Simple Gemini Voice Generation ===');

    const agent: AgentDefinition = {
        model: 'gemini-2.5-flash-preview-tts',
    };

    const text =
        "Hello! This is a test of Gemini's text-to-speech capabilities. The voice quality is quite impressive.";

    try {
        const outputPath = 'output/gemini-voice-simple.mp3';
        let audioBuffer = Buffer.alloc(0);

        for await (const event of ensembleVoice(text, agent)) {
            if (event.type === 'audio_stream' && event.data) {
                const chunk = Buffer.from(event.data, 'base64');
                audioBuffer = Buffer.concat([audioBuffer, chunk]);
            }
        }

        await writeFile(outputPath, audioBuffer);
        console.log(`✓ Audio saved to ${outputPath}`);
    } catch (error) {
        console.error('Error:', error);
    }
}

// Example 2: Voice generation with specific voice selection
async function voiceSelectionExample() {
    console.log('\n=== Gemini Voice Selection Example ===');

    const agent: AgentDefinition = {
        model: 'gemini-2.5-pro-preview-tts', // Using the pro model for better quality
    };

    const voices = ['Kore', 'Puck', 'Charon', 'Fenrir', 'Aoede'];
    const text = 'Testing different voice options available in Gemini.';

    for (const voice of voices) {
        console.log(`\nGenerating with voice: ${voice}`);

        const options: VoiceGenerationOpts = {
            voice: voice,
        };

        try {
            const outputPath = `output/gemini-voice-${voice.toLowerCase()}.mp3`;
            let audioBuffer = Buffer.alloc(0);

            for await (const event of ensembleVoice(text, agent, options)) {
                if (event.type === 'audio_stream' && event.data) {
                    const chunk = Buffer.from(event.data, 'base64');
                    audioBuffer = Buffer.concat([audioBuffer, chunk]);
                }
            }

            await writeFile(outputPath, audioBuffer);
            console.log(`✓ Audio saved to ${outputPath}`);
        } catch (error) {
            console.error(`Error with voice ${voice}:`, error);
        }
    }
}

// Example 3: Streaming voice generation
async function streamingExample() {
    console.log('\n=== Gemini Streaming Voice Generation ===');

    const agent: AgentDefinition = {
        model: 'gemini-2.5-flash-preview-tts',
    };

    const text = `
        Gemini's text-to-speech models support streaming, which is perfect for real-time applications.
        You can generate natural conversations with multiple speakers, control expression and tone,
        and even switch between languages seamlessly. The models support over 24 languages
        and can produce remarkably human-like speech.
    `.trim();

    const options: VoiceGenerationOpts = {
        voice: 'nova', // This will be mapped to a Gemini voice
    };

    try {
        let audioBuffer = Buffer.alloc(0);

        for await (const event of ensembleVoice(text, agent, options)) {
            if (event.type === 'audio_stream' && event.data) {
                const chunk = Buffer.from(event.data, 'base64');
                audioBuffer = Buffer.concat([audioBuffer, chunk]);
                console.log(
                    `Received chunk ${event.chunkIndex} (${chunk.length} bytes)`
                );
            } else if (event.type === 'cost_update') {
                console.log('Cost:', event.usage);
            }
        }

        await writeFile('output/gemini-voice-streaming.mp3', audioBuffer);
        console.log(
            '✓ Streaming audio saved to output/gemini-voice-streaming.mp3'
        );
    } catch (error) {
        console.error('Streaming error:', error);
    }
}

// Example 4: Multi-language demonstration
async function multiLanguageExample() {
    console.log('\n=== Gemini Multi-Language Voice Generation ===');

    const agent: AgentDefinition = {
        model: 'gemini-2.5-pro-preview-tts',
    };

    const languages = [
        { text: 'Hello, this is English.', lang: 'en', voice: 'Kore' },
        { text: "Bonjour, c'est du français.", lang: 'fr', voice: 'Aoede' },
        { text: 'Hola, esto es español.', lang: 'es', voice: 'Charon' },
        { text: 'こんにちは、これは日本語です。', lang: 'ja', voice: 'Puck' },
        { text: '你好，这是中文。', lang: 'zh', voice: 'Fenrir' },
    ];

    for (const { text, lang, voice } of languages) {
        console.log(`\nGenerating ${lang} with voice ${voice}: "${text}"`);

        const options: VoiceGenerationOpts = {
            voice: voice,
        };

        try {
            const outputPath = `output/gemini-voice-${lang}.mp3`;
            let audioBuffer = Buffer.alloc(0);

            for await (const event of ensembleVoice(text, agent, options)) {
                if (event.type === 'audio_stream' && event.data) {
                    const chunk = Buffer.from(event.data, 'base64');
                    audioBuffer = Buffer.concat([audioBuffer, chunk]);
                }
            }

            await writeFile(outputPath, audioBuffer);
            console.log(`✓ Audio saved to ${outputPath}`);
        } catch (error) {
            console.error(`Error with language ${lang}:`, error);
        }
    }
}

// Example 5: Expression and speed control
async function expressionControlExample() {
    console.log('\n=== Gemini Expression Control Example ===');

    const agent: AgentDefinition = {
        model: 'gemini-2.5-pro-preview-tts',
    };

    const expressions = [
        {
            text: "I'm so excited about this new feature!",
            voice: 'Aoede',
            speed: 1.2,
            label: 'excited',
        },
        {
            text: 'This is a calm and soothing message.',
            voice: 'Kore',
            speed: 0.8,
            label: 'calm',
        },
        {
            text: 'ATTENTION! This is an urgent announcement!',
            voice: 'Fenrir',
            speed: 1.5,
            label: 'urgent',
        },
        {
            text: 'Let me tell you a secret...',
            voice: 'Charon',
            speed: 0.7,
            label: 'whisper',
        },
    ];

    for (const { text, voice, speed, label } of expressions) {
        console.log(`\nGenerating ${label} expression: "${text}"`);

        const options: VoiceGenerationOpts = {
            voice: voice,
            speed: speed,
        };

        try {
            const outputPath = `output/gemini-voice-${label}.mp3`;
            let audioBuffer = Buffer.alloc(0);

            for await (const event of ensembleVoice(text, agent, options)) {
                if (event.type === 'audio_stream' && event.data) {
                    const chunk = Buffer.from(event.data, 'base64');
                    audioBuffer = Buffer.concat([audioBuffer, chunk]);
                }
            }

            await writeFile(outputPath, audioBuffer);
            console.log(`✓ Audio saved to ${outputPath}`);
        } catch (error) {
            console.error(`Error with ${label} expression:`, error);
        }
    }
}

// Main function to run all examples
async function main() {
    console.log('🎙️  Gemini Voice Generation Examples\n');

    // Create output directory if it doesn't exist
    const { mkdir } = await import('fs/promises');
    try {
        await mkdir('output', { recursive: true });
    } catch {
        // Directory might already exist
    }

    // Run examples
    await simpleVoiceGeneration();
    await voiceSelectionExample();
    await streamingExample();
    await multiLanguageExample();
    await expressionControlExample();

    console.log('\n✅ All examples completed!');
    console.log(
        '\nNote: Make sure you have set the GOOGLE_API_KEY environment variable.'
    );
    console.log(
        'The generated audio files are saved in the ./output directory.'
    );
}

// Run the examples
main().catch(console.error);
