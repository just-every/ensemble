/**
 * Create a test WAV file for transcription testing
 */

import fs from 'fs/promises';
import { AudioConverter } from '../utils/audio_converter.js';

async function createTestWav() {
    // Create a 2-second audio file at 16kHz
    const sampleRate = 16000;
    const duration = 2;
    const numSamples = sampleRate * duration;

    // Create PCM16 data
    const pcmData = new Int16Array(numSamples);

    // Generate a simple pattern that sounds like speech rhythm
    // This creates bursts of tones with gaps, simulating speech patterns
    for (let i = 0; i < numSamples; i++) {
        const t = i / sampleRate;

        // Create speech-like patterns with varying frequencies
        let sample = 0;

        // First "word" from 0.1 to 0.4 seconds
        if (t >= 0.1 && t < 0.4) {
            const freq = 200 + Math.sin(t * 10) * 50; // Varying frequency
            sample = Math.sin(2 * Math.PI * freq * t) * 0.3;
        }
        // Second "word" from 0.6 to 0.9 seconds
        else if (t >= 0.6 && t < 0.9) {
            const freq = 250 + Math.sin(t * 15) * 30;
            sample = Math.sin(2 * Math.PI * freq * t) * 0.25;
        }
        // Third "word" from 1.1 to 1.5 seconds
        else if (t >= 1.1 && t < 1.5) {
            const freq = 180 + Math.sin(t * 8) * 40;
            sample = Math.sin(2 * Math.PI * freq * t) * 0.35;
        }

        // Add some noise to make it more speech-like
        sample += (Math.random() - 0.5) * 0.02;

        // Convert to 16-bit PCM
        pcmData[i] = Math.round(sample * 32767);
    }

    // Convert to Uint8Array
    const buffer = new ArrayBuffer(pcmData.length * 2);
    const view = new DataView(buffer);
    for (let i = 0; i < pcmData.length; i++) {
        view.setInt16(i * 2, pcmData[i], true); // little-endian
    }

    const pcmBytes = new Uint8Array(buffer);

    // Wrap in WAV format
    const wavData = AudioConverter.wrapInWav(pcmBytes, sampleRate, 1, 16);

    // Save to file
    await fs.writeFile('./samples/speech.wav', wavData);
    console.log('Created test WAV file: ./samples/speech.wav');
    console.log(`Duration: ${duration} seconds, Sample rate: ${sampleRate}Hz`);
}

// Run the script
createTestWav().catch(console.error);
