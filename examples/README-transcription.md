# Audio Transcription Examples

This directory contains examples of using the `ensembleListen` method for audio transcription.

## Security Considerations

When implementing audio transcription in web applications, you have two main approaches:

### 1. Client-Side Only (NOT RECOMMENDED for production)
- Simple to implement
- ⚠️ **Requires API keys in the browser** (security risk!)
- Only suitable for demos or trusted environments

### 2. Client-Server Architecture (RECOMMENDED)
- API keys stay secure on the server
- Client only handles audio capture
- Server handles all transcription logic
- Supports authentication, rate limiting, and monitoring

## Available Examples

### Basic File Transcription
```bash
npm run example:transcription file
```
Transcribes a local audio file using OpenAI Whisper.

### Real-time Transcription
```bash
npm run example:transcription realtime-openai
npm run example:transcription realtime-gemini
```
Demonstrates real-time streaming transcription with VAD support.

### Browser Examples
```bash
npm run example:transcription browser        # Shows client-side code (insecure)
npm run example:transcription client-server  # Shows secure architecture
```

## Running the Client-Server Example

The client-server example consists of two parts:

### 1. Server (audio-transcription-server.ts)
```bash
# Install dependencies if needed
npm install express ws

# Start the server
npx tsx examples/audio-transcription-server.ts
```

The server:
- Runs on port 3000 by default
- Accepts WebSocket connections at `/ws/transcribe`
- Accepts HTTP POST requests at `/api/transcribe`
- Uses your API keys from environment variables
- Handles all transcription using `ensembleListen`

### 2. Client (audio-transcription-client.html)
```bash
# Open in browser
open examples/audio-transcription-client.html
# Or serve with any HTTP server
python -m http.server 8080
```

The client:
- Pure browser JavaScript (no build step needed)
- No API keys required
- Captures audio from microphone
- Streams audio to server via WebSocket
- Displays real-time transcription

## Architecture Benefits

The client-server architecture provides:

1. **Security**: API keys never leave the server
2. **Control**: Server can authenticate users and apply rate limits
3. **Flexibility**: Works with any client (web, mobile, desktop)
4. **Monitoring**: Server can log usage and track costs
5. **Performance**: Server can cache and optimize requests

## WebSocket Protocol

The client and server communicate using a simple WebSocket protocol:

### Client → Server Messages
```javascript
// Start transcription session
{ type: 'start', model: 'whisper-1', options: {...} }

// Send audio chunk (base64 encoded PCM16)
{ type: 'audio', chunk: 'base64...' }

// End session
{ type: 'end' }
```

### Server → Client Messages
```javascript
// Transcription events
{ type: 'transcription_event', event: {...} }

// Errors
{ type: 'error', error: 'message' }

// Session ended
{ type: 'session_ended', message: '...' }
```

## Customization

You can customize the examples for your needs:

- Change the transcription model
- Add authentication middleware
- Implement custom VAD settings
- Add audio preprocessing
- Store transcriptions in a database
- Add real-time translation

## Browser Compatibility

The client example uses:
- `getUserMedia` for microphone access (requires HTTPS in production)
- `AudioContext` for audio processing
- `WebSocket` for real-time communication
- No external dependencies or build tools

Supported in all modern browsers (Chrome, Firefox, Safari, Edge).