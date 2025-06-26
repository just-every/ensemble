/**
 * AudioStreamPlayer - A utility class for streaming audio playback
 *
 * Handles both PCM/WAV streaming via Web Audio API and fallback for other formats.
 * This is the optimal approach for playing streaming audio from ensembleVoice.
 */

export interface AudioStreamPlayerOptions {
    onFirstAudioPlay?: () => void;
}

export class AudioStreamPlayer {
    private audioContext: AudioContext | null = null;
    private sourceNodes: AudioBufferSourceNode[] = [];
    private gainNodes: GainNode[] = [];
    private nextStartTime = 0;
    private expectedChunkIndex = 0;
    private receivedFinalChunk = false;
    private pcmParameters: { sampleRate: number; channels: number; bitDepth: number } | null = null;
    private pcmDataQueue: ArrayBuffer[] = [];
    private bufferDurationTarget = 0.2; // 200ms buffer chunks for smooth playback
    private bytesPerSample = 2; // 16-bit
    private isFirstBuffer = true;
    private currentFormat: string | null = null;

    // For non-PCM formats, we'll use regular audio element
    private fallbackAudio: HTMLAudioElement | null = null;
    private fallbackChunks: Uint8Array[] = [];

    // Options
    private onFirstAudioPlay?: () => void;

    constructor(options: AudioStreamPlayerOptions = {}) {
        this.onFirstAudioPlay = options.onFirstAudioPlay;
    }

    async initAudioContext(): Promise<void> {
        if (this.audioContext && this.audioContext.state === 'running') {
            return;
        }
        try {
            if (!this.audioContext) {
                this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
            }
            if (this.audioContext.state === 'suspended') {
                await this.audioContext.resume();
            }
        } catch (error) {
            console.error('Failed to initialize AudioContext:', error);
            this.audioContext = null;
        }
    }

    startStream(params: { sampleRate: number; channels: number; bitDepth: number } | undefined, format: string): void {
        this.stopStream();
        this.currentFormat = format;

        if ((format === 'wav' || format.includes('pcm')) && params) {
            // Use Web Audio API for PCM/WAV
            if (!this.audioContext || this.audioContext.state !== 'running') {
                console.error('AudioContext not ready');
                return;
            }
            this.pcmParameters = params;
            this.bytesPerSample = params.bitDepth / 8;
            this.expectedChunkIndex = 0;
            this.receivedFinalChunk = false;
            this.pcmDataQueue = [];
            this.isFirstBuffer = true;
            this.nextStartTime = 0;
        } else {
            // For MP3, we'll collect chunks and play when complete
            this.fallbackChunks = [];
            console.log(`Starting ${format} stream - will play when complete`);
        }
    }

    addChunk(base64Chunk: string, chunkIndex: number, isFinalChunk: boolean): void {
        const format = this.currentFormat;
        if (!format) {
            console.error('No format set');
            return;
        }

        // Don't accept new chunks if we've already received final chunk (fadeOutAndStop sets this)
        if (this.receivedFinalChunk) {
            return;
        }

        if (format === 'wav' || format.includes('pcm')) {
            this._addPcmChunk(base64Chunk, chunkIndex, isFinalChunk);
        } else {
            this._addFallbackChunk(base64Chunk, chunkIndex, isFinalChunk, format);
        }
    }

    private _addPcmChunk(base64Chunk: string, chunkIndex: number, isFinalChunk: boolean): void {
        if (!this.audioContext || !this.pcmParameters) {
            console.error('Not initialized for PCM');
            return;
        }

        if (chunkIndex !== this.expectedChunkIndex) {
            console.warn(`Out of order chunk: expected ${this.expectedChunkIndex}, got ${chunkIndex}`);
            return;
        }

        this.expectedChunkIndex++;
        this.receivedFinalChunk = isFinalChunk;

        try {
            // Decode base64
            const binaryString = atob(base64Chunk);
            const bytes = new Uint8Array(binaryString.length);
            for (let i = 0; i < binaryString.length; i++) {
                bytes[i] = binaryString.charCodeAt(i);
            }

            if (bytes.length > 0) {
                this.pcmDataQueue.push(bytes.buffer);
            }

            this._processPcmQueue();
        } catch (error) {
            console.error('Error processing PCM chunk:', error);
        }
    }

    private _processPcmQueue(): void {
        if (!this.audioContext || !this.pcmParameters) {
            return;
        }

        // Check if we're done or have been stopped
        if (this.receivedFinalChunk && this.pcmDataQueue.length === 0 && this.sourceNodes.length === 0) {
            console.log('PCM stream finished');
            this._resetState();
            return;
        }

        // Don't process if we've been stopped (currentFormat is cleared on stop)
        if (!this.currentFormat) {
            return;
        }

        // Check if we should wait before scheduling next buffer
        if (this.nextStartTime > this.audioContext.currentTime + 1.0) {
            setTimeout(() => this._processPcmQueue(), 100);
            return;
        }

        const totalBytes = this.pcmDataQueue.reduce((sum, buffer) => sum + buffer.byteLength, 0);
        const requiredBytes =
            this.pcmParameters.sampleRate *
            this.pcmParameters.channels *
            this.bytesPerSample *
            this.bufferDurationTarget;

        // Always wait for full buffer size unless we've received the final chunk
        if (totalBytes < requiredBytes && !(this.receivedFinalChunk && totalBytes > 0)) {
            return;
        }

        const bytesToProcess = this.receivedFinalChunk ? totalBytes : requiredBytes;
        let processedBytes = 0;
        const buffersToProcess: ArrayBuffer[] = [];

        while (processedBytes < bytesToProcess && this.pcmDataQueue.length > 0) {
            const buffer = this.pcmDataQueue.shift()!;
            buffersToProcess.push(buffer);
            processedBytes += buffer.byteLength;
        }

        if (buffersToProcess.length === 0 || processedBytes === 0) return;

        // Skip WAV header if present (44 bytes)
        let skipBytes = 0;
        if (this.nextStartTime === 0 && buffersToProcess.length > 0) {
            const firstBuffer = new Uint8Array(buffersToProcess[0]);
            if (firstBuffer.length >= 4) {
                const header = String.fromCharCode(...firstBuffer.slice(0, 4));
                if (header === 'RIFF') {
                    skipBytes = 44;
                }
            }
        }

        // Convert PCM to float32
        const totalSamples = (processedBytes - skipBytes) / this.bytesPerSample;
        const concatenatedPcm = new Int16Array(totalSamples);
        let offset = 0;
        let bytesSkipped = 0;

        for (const buffer of buffersToProcess) {
            const view = new DataView(buffer);
            for (let i = 0; i < buffer.byteLength; i += 2) {
                if (bytesSkipped < skipBytes) {
                    bytesSkipped += 2;
                    continue;
                }
                if (offset < concatenatedPcm.length && i + 1 < buffer.byteLength) {
                    concatenatedPcm[offset] = view.getInt16(i, true);
                    offset++;
                }
            }
        }

        const float32Array = new Float32Array(concatenatedPcm.length);
        for (let i = 0; i < concatenatedPcm.length; i++) {
            float32Array[i] = concatenatedPcm[i] / 32768;
        }

        // Create and play audio buffer
        const numberOfSamples = float32Array.length / this.pcmParameters.channels;
        const audioBuffer = this.audioContext.createBuffer(
            this.pcmParameters.channels,
            numberOfSamples,
            this.pcmParameters.sampleRate
        );

        audioBuffer.getChannelData(0).set(float32Array);

        const sourceNode = this.audioContext.createBufferSource();
        sourceNode.buffer = audioBuffer;

        // Create gain node for volume control
        const gainNode = this.audioContext.createGain();
        gainNode.gain.value = 1.0;

        // Connect source -> gain -> destination
        sourceNode.connect(gainNode);
        gainNode.connect(this.audioContext.destination);

        const currentTime = this.audioContext.currentTime;
        const startTime = this.nextStartTime <= currentTime ? currentTime : this.nextStartTime;

        sourceNode.start(startTime);
        this.nextStartTime = startTime + audioBuffer.duration;

        // Track both nodes
        this.sourceNodes.push(sourceNode);
        this.gainNodes.push(gainNode);

        // Fire event when this is the first audio to actually play
        if (this.isFirstBuffer && this.onFirstAudioPlay) {
            this.isFirstBuffer = false;
            if (startTime === currentTime) {
                this.onFirstAudioPlay();
            } else {
                const delay = (startTime - currentTime) * 1000;
                setTimeout(() => this.onFirstAudioPlay?.(), delay);
            }
        }

        sourceNode.onended = () => {
            const index = this.sourceNodes.indexOf(sourceNode);
            if (index > -1) {
                this.sourceNodes.splice(index, 1);
                // Also remove corresponding gain node
                const gainNode = this.gainNodes[index];
                if (gainNode) {
                    this.gainNodes.splice(index, 1);
                }
            }
            // Add small delay to allow more data to accumulate
            setTimeout(() => this._processPcmQueue(), 20);
        };

        // Continue processing if we have more data or are still receiving
        if (this.pcmDataQueue.length > 0 || !this.receivedFinalChunk) {
            // Check more frequently to ensure smooth playback
            setTimeout(() => this._processPcmQueue(), 50);
        }
    }

    private _addFallbackChunk(base64Chunk: string, chunkIndex: number, isFinalChunk: boolean, format: string): void {
        const binaryString = atob(base64Chunk);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }
        this.fallbackChunks.push(bytes);

        // For MP3/AAC/etc, we must wait for ALL chunks before playing
        if (isFinalChunk) {
            this.receivedFinalChunk = true;

            if (!this.fallbackAudio) {
                const mimeType =
                    format === 'mp3'
                        ? 'audio/mpeg'
                        : format === 'opus'
                          ? 'audio/opus'
                          : format === 'aac'
                            ? 'audio/aac'
                            : format === 'flac'
                              ? 'audio/flac'
                              : 'audio/mpeg';

                const blob = new Blob(this.fallbackChunks, { type: mimeType });
                const url = URL.createObjectURL(blob);

                this.fallbackAudio = new Audio();
                this.fallbackAudio.src = url;

                this.fallbackAudio
                    .play()
                    .then(() => {
                        if (this.onFirstAudioPlay) {
                            this.onFirstAudioPlay();
                        }
                    })
                    .catch(err => console.error('Playback failed:', err));
            }
        }
    }

    stopStream(): void {
        // Stop all source nodes
        this.sourceNodes.forEach(node => {
            try {
                node.onended = null;
                node.stop();
            } catch {
                // Ignore errors when stopping nodes
            }
        });
        this.sourceNodes = [];
        this.gainNodes = [];

        if (this.fallbackAudio) {
            this.fallbackAudio.pause();
            this.fallbackAudio = null;
        }

        this._resetState();
    }

    fadeOutAndStop(fadeTimeMs: number = 150): void {
        // Immediately mark as final to prevent new chunks from being processed
        this.receivedFinalChunk = true;

        // Clear the queue to prevent further processing
        this.pcmDataQueue = [];

        if (!this.audioContext) {
            this.stopStream();
            return;
        }

        const currentTime = this.audioContext.currentTime;
        const fadeTimeSeconds = fadeTimeMs / 1000;

        // Fade out all gain nodes
        this.gainNodes.forEach((gainNode, index) => {
            try {
                // Cancel any scheduled changes
                gainNode.gain.cancelScheduledValues(currentTime);
                // Set current value immediately
                gainNode.gain.setValueAtTime(gainNode.gain.value, currentTime);
                // Ramp to 0 over the fade time
                gainNode.gain.linearRampToValueAtTime(0, currentTime + fadeTimeSeconds);

                // Schedule the source node to stop after fade completes
                const sourceNode = this.sourceNodes[index];
                if (sourceNode) {
                    sourceNode.stop(currentTime + fadeTimeSeconds);
                }
            } catch {
                // Ignore errors
            }
        });

        // Handle fallback audio fade
        if (this.fallbackAudio && !this.fallbackAudio.paused) {
            const audio = this.fallbackAudio;
            const initialVolume = audio.volume;
            const fadeSteps = 20;
            const stepTime = fadeTimeMs / fadeSteps;
            let step = 0;

            const fadeInterval = setInterval(() => {
                step++;
                audio.volume = initialVolume * (1 - step / fadeSteps);

                if (step >= fadeSteps) {
                    clearInterval(fadeInterval);
                    audio.pause();
                    this.fallbackAudio = null;
                }
            }, stepTime);
        }

        // Clear state immediately to prevent any new processing
        // but keep nodes alive for fade out
        const tempSourceNodes = [...this.sourceNodes];
        const tempGainNodes = [...this.gainNodes];

        // Reset most state immediately
        this.expectedChunkIndex = 0;
        this.pcmDataQueue = [];
        this.fallbackChunks = [];
        this.nextStartTime = 0;
        this.isFirstBuffer = true;
        this.currentFormat = null;

        // Clear node arrays after fade completes
        setTimeout(() => {
            tempSourceNodes.forEach(node => {
                try {
                    node.disconnect();
                } catch {
                    // Ignore
                }
            });
            tempGainNodes.forEach(node => {
                try {
                    node.disconnect();
                } catch {
                    // Ignore
                }
            });
            this.sourceNodes = [];
            this.gainNodes = [];
        }, fadeTimeMs + 50);
    }

    private _resetState(): void {
        this.expectedChunkIndex = 0;
        this.receivedFinalChunk = false;
        this.pcmDataQueue = [];
        this.fallbackChunks = [];
        this.nextStartTime = 0;
        this.isFirstBuffer = true;
        this.currentFormat = null;
        this.gainNodes = [];
    }

    get isPlaying(): boolean {
        return this.sourceNodes.length > 0 || (this.fallbackAudio !== null && !this.fallbackAudio.paused);
    }

    get isStreaming(): boolean {
        return !this.receivedFinalChunk || this.pcmDataQueue.length > 0 || this.sourceNodes.length > 0;
    }
}
