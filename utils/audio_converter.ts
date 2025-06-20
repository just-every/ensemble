/**
 * Audio format conversion utilities for transcription
 */

import type { TranscriptionOpts } from '../types/types.js';

/**
 * Convert various audio formats to PCM16 for transcription APIs
 */
export class AudioConverter {
    /**
     * Convert audio data to PCM16 format
     * @param audioData - Input audio data
     * @param sourceFormat - Source audio format information
     * @param targetSampleRate - Target sample rate (default: 16000 for most STT APIs)
     * @returns PCM16 audio data as Uint8Array
     */
    static async convertToPCM16(
        audioData: Uint8Array | ArrayBuffer,
        sourceFormat?: TranscriptionOpts['audio_format'],
        targetSampleRate: number = 16000
    ): Promise<Uint8Array> {
        const data =
            audioData instanceof ArrayBuffer
                ? new Uint8Array(audioData)
                : audioData;

        // If already in the correct format, return as-is
        if (
            sourceFormat?.encoding === 'pcm' &&
            sourceFormat.sampleRate === targetSampleRate &&
            sourceFormat.bitDepth === 16 &&
            sourceFormat.channels === 1
        ) {
            return data;
        }

        // Handle different encodings
        switch (sourceFormat?.encoding) {
            case 'opus':
                return this.decodeOpus(data, targetSampleRate);
            case 'flac':
                return this.decodeFlac(data, targetSampleRate);
            default:
                // Assume PCM, but may need resampling or channel conversion
                return this.processPCM(data, sourceFormat, targetSampleRate);
        }
    }

    /**
     * Process PCM audio (resample, convert channels, adjust bit depth)
     */
    private static processPCM(
        data: Uint8Array,
        sourceFormat?: TranscriptionOpts['audio_format'],
        targetSampleRate: number = 16000
    ): Uint8Array {
        const sourceSampleRate = sourceFormat?.sampleRate || 44100;
        const sourceBitDepth = sourceFormat?.bitDepth || 16;
        const sourceChannels = sourceFormat?.channels || 2;

        // Convert to Float32 for processing
        let float32Data: Float32Array;

        if (sourceBitDepth === 16) {
            const int16Array = new Int16Array(
                data.buffer,
                data.byteOffset,
                data.byteLength / 2
            );
            float32Data = new Float32Array(int16Array.length);
            for (let i = 0; i < int16Array.length; i++) {
                float32Data[i] = int16Array[i] / 32768.0;
            }
        } else if (sourceBitDepth === 24) {
            // 24-bit PCM conversion
            const samples = data.length / 3;
            float32Data = new Float32Array(samples);
            for (let i = 0; i < samples; i++) {
                const offset = i * 3;
                // Little-endian 24-bit to 32-bit conversion
                const sample =
                    ((data[offset] |
                        (data[offset + 1] << 8) |
                        (data[offset + 2] << 16)) <<
                        8) >>
                    8;
                float32Data[i] = sample / 8388608.0;
            }
        } else if (sourceBitDepth === 32) {
            const int32Array = new Int32Array(
                data.buffer,
                data.byteOffset,
                data.byteLength / 4
            );
            float32Data = new Float32Array(int32Array.length);
            for (let i = 0; i < int32Array.length; i++) {
                float32Data[i] = int32Array[i] / 2147483648.0;
            }
        } else {
            // Assume 16-bit if unknown
            const int16Array = new Int16Array(
                data.buffer,
                data.byteOffset,
                data.byteLength / 2
            );
            float32Data = new Float32Array(int16Array.length);
            for (let i = 0; i < int16Array.length; i++) {
                float32Data[i] = int16Array[i] / 32768.0;
            }
        }

        // Convert to mono if needed
        if (sourceChannels > 1) {
            const monoLength = Math.floor(float32Data.length / sourceChannels);
            const monoData = new Float32Array(monoLength);
            for (let i = 0; i < monoLength; i++) {
                let sum = 0;
                for (let ch = 0; ch < sourceChannels; ch++) {
                    sum += float32Data[i * sourceChannels + ch];
                }
                monoData[i] = sum / sourceChannels;
            }
            float32Data = monoData;
        }

        // Resample if needed
        if (sourceSampleRate !== targetSampleRate) {
            float32Data = this.resample(
                float32Data,
                sourceSampleRate,
                targetSampleRate
            );
        }

        // Convert back to Int16
        const int16Result = new Int16Array(float32Data.length);
        for (let i = 0; i < float32Data.length; i++) {
            const sample = Math.max(-1, Math.min(1, float32Data[i]));
            int16Result[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
        }

        // Convert to Uint8Array (little-endian)
        const result = new Uint8Array(int16Result.length * 2);
        const view = new DataView(result.buffer);
        for (let i = 0; i < int16Result.length; i++) {
            view.setInt16(i * 2, int16Result[i], true);
        }

        return result;
    }

    /**
     * Simple linear interpolation resampling
     */
    private static resample(
        input: Float32Array,
        inputSampleRate: number,
        outputSampleRate: number
    ): Float32Array {
        const ratio = inputSampleRate / outputSampleRate;
        const outputLength = Math.floor(input.length / ratio);
        const output = new Float32Array(outputLength);

        for (let i = 0; i < outputLength; i++) {
            const inputIndex = i * ratio;
            const inputIndexFloor = Math.floor(inputIndex);
            const inputIndexCeil = Math.min(
                inputIndexFloor + 1,
                input.length - 1
            );
            const fraction = inputIndex - inputIndexFloor;

            output[i] =
                input[inputIndexFloor] * (1 - fraction) +
                input[inputIndexCeil] * fraction;
        }

        return output;
    }

    /**
     * Decode Opus audio to PCM16
     * Note: This is a placeholder - real implementation would use opus decoder
     */

    private static async decodeOpus(
        _data: Uint8Array,
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        _targetSampleRate: number
    ): Promise<Uint8Array> {
        // In a real implementation, you would use an Opus decoder library
        // For now, throw an error indicating Opus decoding is not implemented
        throw new Error(
            'Opus decoding not implemented. Please provide PCM audio or use a different format.'
        );
    }

    /**
     * Decode FLAC audio to PCM16
     * Note: This is a placeholder - real implementation would use FLAC decoder
     */

    private static async decodeFlac(
        _data: Uint8Array,
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        _targetSampleRate: number
    ): Promise<Uint8Array> {
        // In a real implementation, you would use a FLAC decoder library
        // For now, throw an error indicating FLAC decoding is not implemented
        throw new Error(
            'FLAC decoding not implemented. Please provide PCM audio or use a different format.'
        );
    }

    /**
     * Create a WAV file header for PCM16 audio
     */
    static createWavHeader(
        dataLength: number,
        sampleRate: number = 16000,
        channels: number = 1,
        bitDepth: number = 16
    ): Uint8Array {
        const header = new ArrayBuffer(44);
        const view = new DataView(header);

        // RIFF chunk descriptor
        view.setUint32(0, 0x52494646, false); // "RIFF"
        view.setUint32(4, 36 + dataLength, true); // File size - 8
        view.setUint32(8, 0x57415645, false); // "WAVE"

        // fmt sub-chunk
        view.setUint32(12, 0x666d7420, false); // "fmt "
        view.setUint32(16, 16, true); // Subchunk1Size
        view.setUint16(20, 1, true); // AudioFormat (PCM)
        view.setUint16(22, channels, true); // NumChannels
        view.setUint32(24, sampleRate, true); // SampleRate
        view.setUint32(28, sampleRate * channels * (bitDepth / 8), true); // ByteRate
        view.setUint16(32, channels * (bitDepth / 8), true); // BlockAlign
        view.setUint16(34, bitDepth, true); // BitsPerSample

        // data sub-chunk
        view.setUint32(36, 0x64617461, false); // "data"
        view.setUint32(40, dataLength, true); // Subchunk2Size

        return new Uint8Array(header);
    }

    /**
     * Wrap PCM16 data in a WAV container
     */
    static wrapInWav(
        pcmData: Uint8Array,
        sampleRate: number = 16000,
        channels: number = 1,
        bitDepth: number = 16
    ): Uint8Array {
        const header = this.createWavHeader(
            pcmData.length,
            sampleRate,
            channels,
            bitDepth
        );
        const wav = new Uint8Array(header.length + pcmData.length);
        wav.set(header, 0);
        wav.set(pcmData, header.length);
        return wav;
    }
}
