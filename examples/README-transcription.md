# Ensemble Transcription Examples

This directory contains examples demonstrating real-time audio transcription using the `ensembleListen` API with Gemini Live.

## Overview

The transcription feature provides:
- Real-time speech-to-text conversion
- Streaming transcripts with low latency
- Cost tracking per session
- Secure client-server architecture (API keys stay on server)

## Prerequisites

1. **Gemini API Key**: Set your Google API key as an environment variable:
   ```bash
   export GOOGLE_API_KEY="your-api-key-here"
   # or
   export GEMINI_API_KEY="your-api-key-here"
   ```

2. **Dependencies**: Ensure the ensemble package is built:
   ```bash
   npm run build
   ```

## Examples

### 1. Server-Side Transcription (`transcription-server.ts`)

A complete Express + WebSocket server that:
- Accepts audio streams from browser clients
- Processes audio using `ensembleListen` with Gemini Live
- Returns real-time transcripts and cost data

**Run the server:**
```bash
# From the ensemble root directory
node examples/transcription-server.js
```

The server will start on port 3003 (or PORT env variable).

### 2. Browser Client (`transcription-client.html`)

A web interface that:
- Captures microphone audio using Web Audio API
- Streams PCM audio to the server via WebSocket
- Displays real-time transcripts
- Shows usage statistics and costs

**Access the client:**
1. Start the server (see above)
2. Open http://localhost:3003/transcription-client.html
3. Click "Connect & Start"
4. Allow microphone access
5. Start speaking!

## Architecture

```
┌─────────────────┐     Audio Stream    ┌─────────────────┐
│                 │   (WebSocket/PCM)    │                 │
│  Browser Client ├────────────────────►│  Node.js Server │
│                 │                      │                 │
│ - getUserMedia  │                      │ - ensembleListen│
│ - Audio capture │                      │ - Gemini Live   │
│ - No API keys   │                      │ - Has API keys  │
│                 │                      │                 │
│                 │◄────────────────────┤                 │
│                 │   Transcript Events  │                 │
└─────────────────┘    (WebSocket/JSON)  └─────────────────┘
```

## API Usage

### Basic Server-Side Usage

```typescript
import { ensembleListen } from '@just-every/ensemble';
import { Readable } from 'stream';

// Create a stream from WebSocket messages
const audioStream = new Readable({
    read() {} // No-op
});

// Process WebSocket audio data
ws.on('message', (data) => {
    audioStream.push(Buffer.from(data));
});

// Start transcription
for await (const event of ensembleListen(audioStream, {
    model: 'gemini-live-2.5-flash-preview'
})) {
    switch (event.type) {
        case 'transcription_delta':
            console.log('New text:', event.delta);
            break;
        case 'cost_update':
            console.log('Tokens:', event.usage);
            break;
    }
}
```

### Audio Format Requirements

The Gemini Live API expects:
- **Format**: PCM (raw audio)
- **Sample Rate**: 16000 Hz
- **Channels**: 1 (mono)
- **Bit Depth**: 16-bit signed integers
- **Byte Order**: Little-endian

### Cost Tracking

Gemini Live pricing (as of demo):
- **Input**: $0.20 per 1M tokens
- **Output**: $0.80 per 1M tokens

The `cost_update` events provide token usage for accurate billing.

## Security Considerations

**IMPORTANT**: Never expose API keys in browser code!

This example demonstrates the recommended pattern:
- Client captures and streams audio
- Server holds API keys and makes API calls
- Only transcripts are sent to client

## Troubleshooting

### No audio input
- Check microphone permissions
- Verify sample rate matches (16kHz)
- Ensure PCM conversion is working

### Connection issues
- Verify server is running
- Check WebSocket URL in client
- Look for CORS issues if hosting separately

### No transcripts
- Check API key is set correctly
- Verify Gemini Live API access
- Check server logs for errors

### High latency
- Ensure optimal chunk size (8KB/250ms)
- Check network connection
- Consider geographic proximity to API endpoints

## Advanced Configuration

### Custom Instructions

```typescript
for await (const event of ensembleListen(audioStream, {
    model: 'gemini-live-2.5-flash-preview',
    instructions: 'Transcribe in Spanish with medical terminology'
})) {
    // ...
}
```

### Buffer Configuration

```typescript
for await (const event of ensembleListen(audioStream, {
    model: 'gemini-live-2.5-flash-preview'
}, {
    bufferConfig: {
        chunkSize: 16000,    // 500ms chunks
        flushInterval: 1000  // 1s timeout
    }
})) {
    // ...
}
```

## License

See the main ensemble package license.