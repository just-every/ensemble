# Ensemble Interactive Demos

This directory contains interactive web-based demonstrations of the core Ensemble library features.

## 🚀 Quick Start

**Run all demos with one command:**

```bash
npm run demo
```

This will:
1. Start all demo servers on their respective ports
2. Open a menu page at http://localhost:3000 where you can access all demos
3. Automatically open your browser to the menu page

## Individual Demos

You can also run demos individually:

```bash
# Voice Generation Demo (Text-to-Speech)
npm run demo:voice
# Opens at http://localhost:3004/voice-client.html

# Live Transcription Demo (Speech-to-Text)
npm run demo:transcription
# Opens at http://localhost:3003/transcription-client.html

# Chat Request Demo (Streaming AI Responses)
npm run demo:request
# Opens at http://localhost:3005/request-client.html

# Text Embeddings Demo (Vector Embeddings & Similarity)
npm run demo:embed
# Opens at http://localhost:3006/embed-client.html
```

## Demo Features

### 🎤 Voice Generation
- Convert text to natural-sounding speech
- Multiple voice providers (OpenAI, ElevenLabs, Gemini)
- Real-time audio streaming
- Various voice options and formats
- Speed control

### 🎧 Live Transcription
- Real-time speech-to-text
- Microphone input with visual feedback
- WebRTC-based audio streaming
- Support for multiple languages
- Continuous and non-continuous modes

### 💬 Chat Request
- Streaming AI responses
- Multiple model support (OpenAI, Anthropic, Google, etc.)
- Tool calling demonstrations
- Real-time token and cost tracking
- Model class selection

### 📊 Text Embeddings
- Generate vector embeddings
- Similarity search
- Visual comparison of text relationships
- Support for different embedding models
- Dimension customization

## Requirements

1. **API Keys**: Copy `.env.example` to `.env` and add your API keys:
   ```bash
   cp ../.env.example ../.env
   ```
   
   Available providers:
   ```env
   # LLM Providers
   OPENAI_API_KEY=your-key-here
   ANTHROPIC_API_KEY=your-key-here
   GOOGLE_API_KEY=your-key-here
   XAI_API_KEY=your-key-here
   DEEPSEEK_API_KEY=your-key-here
   OPENROUTER_API_KEY=your-key-here
   
   # Voice & Audio
   ELEVENLABS_API_KEY=your-key-here
   
   # Search
   BRAVE_API_KEY=your-key-here
   ```
   
   **Note**: Only add keys for providers you want to use. The demos will show which providers are available based on your configuration.

2. **Build**: The demos use the built distribution files, so make sure to build first:
   ```bash
   npm run build
   ```

3. **Browser**: Modern browser with WebSocket and Web Audio API support

## Architecture

Each demo consists of:
- **Client**: HTML file with interactive UI
- **Server**: TypeScript server handling WebSocket connections and API calls
- **WebSocket Communication**: Real-time bidirectional communication

The demos showcase best practices for:
- Streaming responses
- Error handling
- Real-time updates
- Cost tracking
- Tool integration

## Development

To modify a demo:
1. Edit the client HTML file for UI changes
2. Edit the server TS file for backend logic
3. The demos use the built ensemble library from `../dist`

## Troubleshooting

- **Connection Issues**: Check that the server is running and the WebSocket URL is correct
- **API Errors**: Verify your API keys are set correctly in `.env`
- **Audio Issues**: For transcription demo, ensure microphone permissions are granted
- **Build Issues**: Run `npm run build` if you see module not found errors