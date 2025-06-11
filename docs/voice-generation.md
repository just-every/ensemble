# Voice Generation with ensembleVoice

The `ensembleVoice` function provides a unified interface for Text-to-Speech (TTS) generation across different providers. Currently supported providers include OpenAI and ElevenLabs, each offering unique voices and capabilities.

## Overview

Voice generation allows you to convert text into natural-sounding speech audio. This is useful for:
- Creating audio content from written material
- Building voice assistants and chatbots
- Accessibility features
- Audio notifications
- Content narration

## Basic Usage

```typescript
import { ensembleVoice } from '@just-every/ensemble';

// Simple voice generation
const audioBuffer = await ensembleVoice('Hello, world!', {
    model: 'tts-1'
});

// Save to file
import { writeFile } from 'fs/promises';
await writeFile('output.mp3', Buffer.from(audioBuffer));
```

## Models

### OpenAI TTS Models

- **tts-1**: Standard quality, optimized for real-time use ($15 per million characters)
- **tts-1-hd**: High-definition quality for superior audio ($30 per million characters)

```typescript
// Standard quality - faster generation
const audio = await ensembleVoice(text, {
    model: 'tts-1'
});

// High quality - better audio fidelity
const audio = await ensembleVoice(text, {
    model: 'tts-1-hd'
});
```

### ElevenLabs Models

- **eleven_multilingual_v2**: Multilingual model supporting 29 languages ($300 per million characters)
- **eleven_turbo_v2_5**: Turbo model optimized for low-latency streaming ($180 per million characters)

```typescript
// Multilingual support
const audio = await ensembleVoice(text, {
    model: 'eleven_multilingual_v2'
});

// Low-latency streaming
const audio = await ensembleVoice(text, {
    model: 'eleven_turbo_v2_5'
});
```

## Voice Options

### Available Voices

#### OpenAI Voices

OpenAI provides 6 different voices, each with unique characteristics:

- **alloy**: Neutral and balanced
- **echo**: Warm and conversational  
- **fable**: Expressive and dynamic
- **onyx**: Deep and authoritative
- **nova**: Friendly and upbeat
- **shimmer**: Soft and gentle

```typescript
const audio = await ensembleVoice('Welcome to our service', {
    model: 'tts-1'
}, {
    voice: 'nova' // Friendly voice
});
```

#### ElevenLabs Voices

ElevenLabs offers natural-sounding voices with advanced customization:

- **rachel**: Clear and professional
- **domi**: Warm and engaging
- **bella**: Youthful and energetic
- **antoni**: Deep and confident
- **elli**: Soft and friendly
- **josh**: Casual and conversational
- **arnold**: Strong and authoritative
- **adam**: Versatile and neutral
- **sam**: Smooth and articulate
- **george**: Mature and distinguished

You can also use custom voice IDs directly:

```typescript
// Using preset voice name
const audio = await ensembleVoice('Hello there', {
    model: 'eleven_multilingual_v2'
}, {
    voice: 'rachel'
});

// Using custom voice ID
const audio = await ensembleVoice('Custom voice', {
    model: 'eleven_multilingual_v2'
}, {
    voice: 'your-custom-voice-id'
});
```

#### ElevenLabs Voice Settings

Fine-tune voice output with custom settings:

```typescript
const audio = await ensembleVoice(text, {
    model: 'eleven_multilingual_v2'
}, {
    voice: 'adam',
    voice_settings: {
        stability: 0.7,        // Voice consistency (0-1)
        similarity_boost: 0.8, // Voice clarity (0-1)
        style: 0.2,           // Style strength (0-1)
        use_speaker_boost: true // Enhanced quality
    }
});
```

### Audio Formats

Multiple output formats are supported:

#### Standard Formats
- **mp3**: Default, good compression and compatibility
- **opus**: Excellent compression for streaming
- **aac**: Good quality and compression
- **flac**: Lossless audio
- **wav**: Uncompressed audio
- **pcm**: Raw audio data

#### ElevenLabs Extended Formats
- **mp3_low**: Lower quality MP3 (22050Hz, 32kbps)
- **mp3_high**: Higher quality MP3 (44100Hz, 192kbps)
- **pcm_16000**: PCM 16kHz sample rate
- **pcm_22050**: PCM 22.05kHz sample rate
- **pcm_24000**: PCM 24kHz sample rate (default for PCM)
- **pcm_44100**: PCM 44.1kHz sample rate
- **ulaw**: μ-law 8kHz (telephony)

```typescript
// OpenAI format
const audio = await ensembleVoice(text, {
    model: 'tts-1'
}, {
    response_format: 'opus' // Optimized for streaming
});

// ElevenLabs high-quality format
const audio = await ensembleVoice(text, {
    model: 'eleven_multilingual_v2'
}, {
    response_format: 'mp3_high' // 44.1kHz, 192kbps
});
```

### Speech Speed

Control the speaking rate from 0.25x to 4.0x:

```typescript
const audio = await ensembleVoice(text, {
    model: 'tts-1'
}, {
    speed: 1.5 // 50% faster than normal
});
```

## Streaming Audio

For long texts or real-time applications, use streaming:

```typescript
// Get audio as a stream
const audioStream = await ensembleVoice(longText, {
    model: 'tts-1'
}, {
    stream: true
});

// Process the stream
if (audioStream instanceof ReadableStream) {
    const reader = audioStream.getReader();
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        // Process audio chunk
        processAudioChunk(value);
    }
}
```

## Event-Based Streaming

Use `ensembleVoiceStream` for event-based processing:

```typescript
for await (const event of ensembleVoiceStream(text, {
    model: 'tts-1'
})) {
    if (event.type === 'audio_stream') {
        console.log(`Received ${event.data.length} bytes`);
        // Process audio chunk
        audioPlayer.feed(event.data);
    }
}
```

## Complete Example

```typescript
import { ensembleVoice, ensembleVoiceStream } from '@just-every/ensemble';
import { createWriteStream } from 'fs';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';

async function generatePodcastEpisode(script: string) {
    // Use high-quality model with expressive voice
    const audioStream = await ensembleVoice(script, {
        model: 'tts-1-hd'
    }, {
        voice: 'fable',      // Expressive voice
        response_format: 'mp3',
        speed: 0.95,         // Slightly slower for clarity
        stream: true         // Stream for large content
    });

    if (audioStream instanceof ReadableStream) {
        // Convert Web stream to Node stream
        const nodeStream = Readable.from(audioStream);
        
        // Save to file
        await pipeline(
            nodeStream,
            createWriteStream('podcast-episode.mp3')
        );
        
        console.log('✓ Podcast episode generated successfully');
    }
}

// Generate with progress tracking
async function generateWithProgress(text: string) {
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;
    
    for await (const event of ensembleVoiceStream(text, {
        model: 'tts-1'
    }, {
        voice: 'nova'
    })) {
        if (event.type === 'audio_stream') {
            chunks.push(event.data);
            totalBytes += event.data.length;
            
            // Show progress
            console.log(`Progress: ${totalBytes} bytes received`);
        }
    }
    
    // Combine chunks
    const fullAudio = Buffer.concat(chunks);
    return fullAudio;
}
```

## Cost Tracking

Voice generation costs are automatically tracked:

```typescript
import { costTracker } from '@just-every/ensemble';

// Generate audio
await ensembleVoice(text, { model: 'tts-1' });

// Check costs
const usage = costTracker.getUsage();
console.log(`Total cost: $${usage.totalCost}`);
```

## Best Practices

1. **Choose the Right Model**
   - Use `tts-1` for real-time applications with OpenAI
   - Use `tts-1-hd` when audio quality is paramount
   - Use `eleven_turbo_v2_5` for low-latency ElevenLabs streaming
   - Use `eleven_multilingual_v2` for multi-language support

2. **Select Appropriate Voice**
   - Test different voices for your use case
   - Consider your audience and content type
   - Use ElevenLabs for more natural-sounding voices
   - Use OpenAI for cost-effective generation

3. **Optimize Format**
   - Use `opus` for streaming applications
   - Use `mp3` for general compatibility
   - Use `flac` or `wav` for audio processing
   - Use PCM formats for real-time audio processing

4. **Handle Streaming**
   - Use streaming for texts longer than a few paragraphs
   - Implement proper error handling for network issues
   - Use event-based streaming for progress tracking

5. **Manage Costs**
   - TTS is charged per character, not token
   - OpenAI: $15-30 per million characters
   - ElevenLabs: $180-300 per million characters
   - Consider caching generated audio
   - Monitor usage with cost tracking

## Error Handling

```typescript
try {
    const audio = await ensembleVoice(text, {
        model: 'tts-1'
    });
} catch (error) {
    if (error.message.includes('does not support voice')) {
        console.error('Provider does not support TTS');
    } else if (error.message.includes('rate limit')) {
        console.error('Rate limit exceeded, retry later');
    } else {
        console.error('TTS generation failed:', error);
    }
}
```

## ElevenLabs Streaming Example

Here's a complete example using ElevenLabs with event-based streaming:

```typescript
import { ensembleVoiceStream } from '@just-every/ensemble';
import { createWriteStream } from 'fs';

async function streamElevenLabsAudio() {
    const text = `
        ElevenLabs provides incredibly natural-sounding voices
        with support for multiple languages and voice cloning.
    `;
    
    const outputStream = createWriteStream('elevenlabs-output.mp3');
    let totalChunks = 0;
    
    for await (const event of ensembleVoiceStream(text, {
        model: 'eleven_turbo_v2_5'
    }, {
        voice: 'rachel',
        response_format: 'mp3_high',
        voice_settings: {
            stability: 0.8,
            similarity_boost: 0.9,
            style: 0.3,
            use_speaker_boost: true
        }
    })) {
        if (event.type === 'audio_stream' && event.data) {
            // Convert base64 to buffer
            const buffer = Buffer.from(event.data, 'base64');
            outputStream.write(buffer);
            
            totalChunks++;
            if (event.isFinalChunk) {
                console.log(`✓ Completed ${totalChunks} chunks`);
            }
        } else if (event.type === 'cost_update') {
            console.log(`Cost: $${event.usage.cost?.toFixed(4)}`);
        }
    }
    
    outputStream.end();
}
```

## Provider Comparison

| Feature | OpenAI | ElevenLabs |
|---------|---------|------------|
| **Pricing** | $15-30/M chars | $180-300/M chars |
| **Voice Quality** | Good | Excellent |
| **Voice Options** | 6 preset | 10+ preset + custom |
| **Languages** | Multiple | 29 languages |
| **Streaming** | Yes | Yes |
| **Voice Cloning** | No | Yes |
| **Latency** | Low | Low (turbo model) |
| **Voice Settings** | Speed only | Full customization |

## Future Providers

The voice generation system is designed to support multiple providers. Future additions may include:
- Google Cloud Text-to-Speech
- Amazon Polly
- Azure Speech Services
- Play.ht
- Coqui AI

Each provider will maintain the same interface while offering provider-specific features through the options parameter.