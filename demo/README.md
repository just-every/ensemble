# Ensemble Demo Applications

This directory contains demo applications showcasing the capabilities of the Ensemble library.

## Setup

1. Add your API keys to the `.env` file in the root directory:
   ```bash
   # At minimum, add one of these:
   GOOGLE_API_KEY=your-key-here
   OPENAI_API_KEY=your-key-here
   ANTHROPIC_API_KEY=your-key-here
   ```

2. Build the project:
   ```bash
   npm run build
   ```

3. Check your setup:
   ```bash
   npm run demo:setup
   ```

## Available Demos

### 1. Live Bidirectional Communication Demo

A real-time voice conversation demo using the `ensembleLive` API with Gemini's Live API.

**Features:**
- 🎤 Real-time voice input/output
- 🔧 Tool execution (weather, calculator)
- 💬 Live transcription
- 📊 Cost tracking
- 🎨 Audio visualization

**Files:**
- `live-server.ts` - WebSocket server handling live sessions
- `live-client.html` - Browser-based client with UI

**To run:**
```bash
# Make sure you have your API key set
export GOOGLE_API_KEY=your-api-key-here

# Run the server
npx tsx demo/live-server.ts

# Open http://localhost:3004 in your browser
```

### 2. Transcription Demo

A speech-to-text demo using the `ensembleListen` API for transcription.

**Features:**
- 🎤 Real-time audio streaming
- 📝 Live transcription
- 💰 Cost tracking
- 📊 Session statistics

**Files:**
- `transcription-server.ts` - WebSocket server for transcription
- `transcription-client.html` - Browser client

**To run:**
```bash
# Set your API key
export GOOGLE_API_KEY=your-api-key-here

# Run the server
npx tsx demo/transcription-server.ts

# Open http://localhost:3003 in your browser
```

## Requirements

- Node.js 18+
- A valid Google/Gemini API key
- Chrome/Edge/Safari browser (for WebRTC audio capture)
- Microphone access

## API Keys

Both demos require a Google/Gemini API key. Set it as an environment variable:

```bash
export GOOGLE_API_KEY=your-api-key-here
# or
export GEMINI_API_KEY=your-api-key-here
```

## Browser Compatibility

These demos use modern browser APIs:
- WebRTC for audio capture
- Web Audio API for processing
- WebSocket for real-time communication

Tested on:
- Chrome 90+
- Edge 90+
- Safari 15+
- Firefox 90+

## Troubleshooting

### "API Key Missing" Error
Make sure you've set the GOOGLE_API_KEY environment variable before starting the server.

### No Audio Input
1. Check that your browser has microphone permissions
2. Ensure no other application is using the microphone
3. Try refreshing the page

### Connection Failed
1. Verify the server is running
2. Check the WebSocket URL in settings (default: ws://localhost:3004 or 3003)
3. Check browser console for errors

### High Latency
The Live API works best with:
- Stable internet connection
- Low-latency audio settings
- Proximity to Google's servers

## Cost Considerations

Both demos use Google's Gemini API which has associated costs:
- **Live API**: ~$0.20 per 1M input tokens, ~$0.80 per 1M output tokens
- **Audio**: Additional costs for audio processing
- Monitor the cost display in the UI

## Development

To modify these demos:

1. Edit the TypeScript server files
2. Run with `npx tsx demo/[filename].ts`
3. Modify the HTML clients directly
4. No build step required for client changes

## Security Notes

These demos are for development/testing only:
- Don't expose to public internet without authentication
- The calculator tool uses eval() - replace in production
- Add rate limiting for production use
- Implement proper error handling

## Core Method Demos

Demonstrate each core Ensemble method:

### ensembleRequest Demo
```bash
npm run demo:request
```
- Basic streaming
- Tool calling
- Multi-model comparison
- Advanced options

### ensembleListen Demo
```bash
npm run demo:listen
```
- Speech-to-text transcription
- Streaming audio
- Multi-language support
- Buffer configuration

### ensembleVoice Demo
```bash
npm run demo:voice
```
- Text-to-speech generation
- Multiple voices
- Multi-language speech
- Audio options (speed, pitch)

### ensembleImage Demo
```bash
npm run demo:image
```
- Image generation
- Multiple sizes
- Style variations
- Batch generation

### ensembleEmbed Demo
```bash
npm run demo:embed
```
- Text embeddings
- Similarity comparison
- Semantic search
- Clustering

### Run All Demos
```bash
npm run demo:all
```
Runs all available demos based on your API keys.

## Environment Variables

The demos use the following environment variables from the root `.env` file:

```bash
# API Keys
GOOGLE_API_KEY=your-key        # For Gemini models
OPENAI_API_KEY=your-key        # For GPT models and DALL-E
ANTHROPIC_API_KEY=your-key     # For Claude models
ELEVENLABS_API_KEY=your-key    # For premium voices

# Model Configuration (optional)
DEFAULT_MODEL=gpt-4o-mini      # Default chat model
LIVE_MODEL=gemini-live-2.5-flash-preview  # Live transcription
VOICE_MODEL=gemini-1.5-flash   # Voice generation
IMAGE_MODEL=dall-e-3           # Image generation
EMBEDDING_MODEL=text-embedding-3-small  # Embeddings

# Server Ports
PORT=3004                      # Live demo port
TRANSCRIPTION_PORT=3003       # Transcription demo port
```

## Output Files

Generated files are saved to `demo/output/`:
- Audio files (MP3) from voice demos
- Images (PNG) from image demos
- Transcripts from speech demos

## Learn More

- [Ensemble Documentation](https://github.com/just-every/ensemble)
- [Gemini API Docs](https://ai.google.dev/gemini-api/docs)
- [OpenAI API Docs](https://platform.openai.com/docs)
- [Anthropic API Docs](https://docs.anthropic.com)
- [WebRTC Guide](https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API)