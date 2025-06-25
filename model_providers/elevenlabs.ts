import { BaseModelProvider } from './base_provider.js';
import { costTracker } from '../utils/cost_tracker.js';
import { VoiceGenerationOpts } from '../types/types.js';

// ElevenLabs Voice ID mappings for convenience
export const ELEVENLABS_VOICES = {
    rachel: '21m00Tcm4TlvDq8ikWAM',
    domi: 'AZnzlk1XvdvUeBnXmlld',
    bella: 'EXAVITQu4vr4xnSDxMaL',
    antoni: 'ErXwobaYiN019PkySvjV',
    elli: 'MF3mGyEYCl7XYWbV9V6O',
    josh: 'TxGEqnHWrfWFTfGW9XjX',
    arnold: 'VR6AewLTigWG4xSOukaG',
    adam: 'pNInz6obpgDQGcFmaJgB',
    sam: 'yoZ06aMxZJJ28mfd3POQ',
    george: 'JBFqnCBsd6RMkjVDRZzb',
    jessica: 'cgSgspJ2msm6clMCkdW9',
    laura: 'FGY2WhTYpPnrIDTdsKH5',
    callum: 'N2lVS1w4EtoT3dr4eOWO',
    unreal: 'YOq2y2Up4RgXP2HyXjE5',
    blondie: 'exsUS4vynmxd379XN4yO',
    james: 'h0KXSKLMvNtfCIMB8I9L',
} as const;

/**
 * ElevenLabs provider for voice generation
 */
class ElevenLabsProvider extends BaseModelProvider {
    private _apiKey?: string;
    private baseUrl = 'https://api.elevenlabs.io/v1';

    constructor() {
        super('elevenlabs');
    }

    /**
     * Lazily access the API key
     */
    private get apiKey(): string {
        if (!this._apiKey) {
            this._apiKey = process.env.ELEVENLABS_API_KEY;
            if (!this._apiKey) {
                throw new Error(
                    'ElevenLabs API key is required. Please set the ELEVENLABS_API_KEY environment variable.'
                );
            }
        }
        return this._apiKey;
    }

    /**
     * Check if the provider supports the given model
     */
    supportsModel(model: string): boolean {
        return model.startsWith('eleven_') || model.startsWith('elevenlabs-');
    }

    /**
     * Get model information
     */
    getModelInfo(): any {
        // Return model info from the registry
        return undefined; // Will be populated from model registry
    }

    /**
     * Not implemented for voice-only provider
     */
    async request(): Promise<any> {
        throw new Error('ElevenLabs provider only supports voice generation');
    }

    /**
     * Not implemented for voice-only provider
     */
    async embed(): Promise<any> {
        throw new Error('ElevenLabs provider does not support embeddings');
    }

    /**
     * Not implemented for voice-only provider
     */
    async image(): Promise<any> {
        throw new Error('ElevenLabs provider does not support image generation');
    }

    /**
     * Generate speech audio from text using ElevenLabs API
     */
    async createVoice(
        text: string,
        model: string,
        opts?: VoiceGenerationOpts
    ): Promise<ReadableStream<Uint8Array> | ArrayBuffer> {
        try {
            // Use the model ID as-is (ElevenLabs expects the full ID including prefix)
            const modelId = model;

            // Map voice to voice ID if it's a preset name
            let voiceId = opts?.voice || 'adam';
            if (voiceId in ELEVENLABS_VOICES) {
                voiceId = ELEVENLABS_VOICES[voiceId as keyof typeof ELEVENLABS_VOICES];
            }

            // Convert our format options to ElevenLabs format
            const outputFormat = this.mapOutputFormat(opts?.response_format || 'mp3_44100_128');

            console.log(
                `[ElevenLabs] Generating speech with model ${modelId}, voice: ${voiceId}, format: ${outputFormat}, streaming: ${opts?.stream || false}`
            );

            // Add in affect for supported models
            if (model === 'eleven_v3' && opts?.affect) {
                text = `[${opts.affect.toUpperCase()}] ${text}`;
            }

            const requestBody = {
                text,
                model_id: modelId,
                voice_settings: {
                    speed: 0.9,
                    stability: 0.4,
                    similarity_boost: 0.5,
                    use_speaker_boost: true,
                    ...(opts?.voice_settings || {}),
                },
            };

            // Add speed to voice_settings if provided
            if (opts?.speed !== undefined) {
                (requestBody.voice_settings as any).speed = opts.speed;
            }

            // Use streaming endpoint if streaming is requested
            const endpoint = opts?.stream ? 'stream' : '';
            const url = `${this.baseUrl}/text-to-speech/${voiceId}${endpoint ? '/stream' : ''}?output_format=${outputFormat}`;

            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'xi-api-key': this.apiKey,
                    'Content-Type': 'application/json',
                    Accept: opts?.stream ? 'application/octet-stream' : 'audio/mpeg',
                },
                body: JSON.stringify(requestBody),
            });

            if (!response.ok) {
                const error = await response.text();
                throw new Error(`ElevenLabs API error: ${response.status} - ${error}`);
            }

            // Track usage for cost calculation
            const characterCount = text.length;

            costTracker.addUsage({
                model,
                input_tokens: Math.ceil(characterCount / 4), // Approximate character count
                output_tokens: 0,
                metadata: {
                    character_count: characterCount,
                    voice: voiceId,
                    format: outputFormat,
                },
            });

            // Handle streaming vs buffer response
            if (opts?.stream && response.body) {
                // Return the response body as a ReadableStream
                return response.body;
            } else {
                // Return as ArrayBuffer
                const buffer = await response.arrayBuffer();
                return buffer;
            }
        } catch (error) {
            console.error('[ElevenLabs] Error generating speech:', error);
            throw error;
        }
    }

    /**
     * Map our generic format options to ElevenLabs specific formats
     */
    private mapOutputFormat(format: string): string {
        const formatMap: Record<string, string> = {
            mp3: 'mp3_44100_128',
            mp3_low: 'mp3_22050_32',
            mp3_high: 'mp3_44100_192',
            pcm: 'pcm_24000',
            pcm_16000: 'pcm_16000',
            pcm_22050: 'pcm_22050',
            pcm_24000: 'pcm_24000',
            pcm_44100: 'pcm_44100',
            ulaw: 'ulaw_8000',
        };

        return formatMap[format] || format;
    }

    /**
     * Create a streaming completion - not supported
     */
    async *createResponseStream(): AsyncGenerator<any> {
        yield; // Satisfy generator requirement
        throw new Error('ElevenLabs provider only supports voice generation');
    }
}

// Export an instance of the provider
export const elevenLabsProvider = new ElevenLabsProvider();

// Also export the class for testing
export { ElevenLabsProvider };
