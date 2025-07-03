import React, { useState, useEffect, useRef, useCallback } from 'react';
import useWebSocket, { ReadyState } from 'react-use-websocket';
import NavBar from './components/NavBar';
import './components/glassmorphism.css';
import { AudioStreamPlayer } from '../../dist/utils/audio_stream_player.js';

interface GenerationHistory {
    text: string;
    model: string;
    voice: string;
    format: string;
    size: number;
    duration: number;
    blob: Blob;
}

const VoiceDemo: React.FC = () => {
    // State management
    const [text, setText] = useState(
        'Welcome to Ensemble Voice Generation! This demo showcases high-quality text-to-speech synthesis using multiple providers.'
    );
    const [selectedModel, setSelectedModel] = useState('gpt-4o-mini-tts');
    const [selectedVoice, setSelectedVoice] = useState('sage');
    const [selectedFormat, setSelectedFormat] = useState('mp3');
    const [speed, setSpeed] = useState(1.0);
    const [isGenerating, setIsGenerating] = useState(false);
    const [audioUrl, setAudioUrl] = useState<string | null>(null);
    const [progress, setProgress] = useState(0);
    const [latency, setLatency] = useState<number | null>(null);
    const [duration, setDuration] = useState(0);
    const [dataSize, setDataSize] = useState(0);
    const [cost, setCost] = useState(0);
    const [error, setError] = useState<string | null>(null);
    const [history, setHistory] = useState<GenerationHistory[]>([]);
    const [showCodeModal, setShowCodeModal] = useState(false);
    const [activeCodeTab, setActiveCodeTab] = useState<'server' | 'client'>('server');
    const [charCounter, setCharCounter] = useState(text.length);

    // Refs
    const audioPlayerRef = useRef<AudioStreamPlayer | null>(null);
    const audioElementRef = useRef<HTMLAudioElement>(null);
    const audioChunksRef = useRef<Uint8Array[]>([]);
    const startTimeRef = useRef<number>(0);
    const currentAudioBlobRef = useRef<Blob | null>(null);
    const isInitializingRef = useRef(true);

    // WebSocket configuration
    const socketUrl = 'ws://localhost:3004';
    const { sendMessage, lastMessage, readyState } = useWebSocket(socketUrl, {
        shouldReconnect: () => true,
        reconnectAttempts: 10,
        reconnectInterval: 3000,
    });

    // Voice options for different providers
    const voiceOptions: Record<string, Array<{ value: string; label: string }>> = {
        openai: [
            { value: 'sage', label: 'Sage (Clear)' },
            { value: 'echo', label: 'Echo (Male)' },
            { value: 'alloy', label: 'Alloy (Neutral)' },
            { value: 'ash', label: 'Ash (Conversational)' },
            { value: 'coral', label: 'Coral (Pleasant)' },
            { value: 'fable', label: 'Fable (British)' },
            { value: 'nova', label: 'Nova (Friendly)' },
            { value: 'onyx', label: 'Onyx (Deep)' },
            { value: 'shimmer', label: 'Shimmer (Soft)' },
        ],
        elevenlabs: [
            { value: 'jessica', label: 'Jessica (Expressive female)' },
            { value: 'james', label: 'James (Australian male)' },
            { value: 'rachel', label: 'Rachel (Natural female)' },
            { value: 'domi', label: 'Domi (Warm)' },
            { value: 'bella', label: 'Bella (Youthful female)' },
            { value: 'antoni', label: 'Antoni (Professional male)' },
            { value: 'elli', label: 'Elli (Friendly)' },
            { value: 'josh', label: 'Josh (Deep male)' },
            { value: 'arnold', label: 'Arnold (Authoritative)' },
            { value: 'adam', label: 'Adam (Narrative male)' },
            { value: 'sam', label: 'Sam (Energetic male)' },
            { value: 'george', label: 'George (Distinguished)' },
            { value: 'laura', label: 'Laura (Sophisticated female)' },
            { value: 'callum', label: 'Callum (British male)' },
            { value: 'unreal', label: 'Unreal (Synthetic/Unique)' },
            { value: 'blondie', label: 'Blondie (Bright female)' },
        ],
        gemini: [
            { value: 'Aoede', label: 'Aoede (Breezy)' },
            { value: 'Zephyr', label: 'Zephyr (Bright)' },
            { value: 'Puck', label: 'Puck (Upbeat)' },
            { value: 'Charon', label: 'Charon (Informative)' },
            { value: 'Kore', label: 'Kore (Firm)' },
            { value: 'Fenrir', label: 'Fenrir (Excitable)' },
            { value: 'Leda', label: 'Leda (Youthful)' },
            { value: 'Orus', label: 'Orus (Firm)' },
            { value: 'Callirrhoe', label: 'Callirrhoe (Easy-going)' },
            { value: 'Autonoe', label: 'Autonoe (Bright)' },
            { value: 'Enceladus', label: 'Enceladus (Breathy)' },
            { value: 'Iapetus', label: 'Iapetus (Clear)' },
            { value: 'Umbriel', label: 'Umbriel (Easy-going)' },
            { value: 'Algieba', label: 'Algieba (Smooth)' },
            { value: 'Despina', label: 'Despina (Smooth)' },
            { value: 'Erinome', label: 'Erinome (Clear)' },
            { value: 'Algenib', label: 'Algenib (Gravelly)' },
            { value: 'Rasalgethi', label: 'Rasalgethi (Informative)' },
            { value: 'Laomedeia', label: 'Laomedeia (Upbeat)' },
            { value: 'Achernar', label: 'Achernar (Soft)' },
            { value: 'Alnilam', label: 'Alnilam (Firm)' },
            { value: 'Schedar', label: 'Schedar (Even)' },
            { value: 'Gacrux', label: 'Gacrux (Mature)' },
            { value: 'Pulcherrima', label: 'Pulcherrima (Forward)' },
            { value: 'Achird', label: 'Achird (Friendly)' },
            { value: 'Zubenelgenubi', label: 'Zubenelgenubi (Casual)' },
            { value: 'Vindemiatrix', label: 'Vindemiatrix (Gentle)' },
            { value: 'Sadachbia', label: 'Sadachbia (Lively)' },
            { value: 'Sadaltager', label: 'Sadaltager (Knowledgeable)' },
            { value: 'Sulafat', label: 'Sulafat (Warm)' },
        ],
    };

    // Example texts
    const exampleTexts = {
        news: "Breaking news: Scientists have discovered a new species of deep-sea fish in the Mariana Trench. The bioluminescent creature, named 'Abyssal Lumina', exhibits unique adaptations to extreme pressure and darkness.",
        story: 'Once upon a time, in a village nestled between rolling hills, lived a young inventor named Luna. She spent her days crafting marvelous contraptions that could turn moonlight into music and capture dreams in glass bottles.',
        technical:
            'The implementation utilizes a distributed architecture with microservices communicating via message queues. Each service maintains its own database, ensuring loose coupling and independent scalability.',
        poetry: "Beneath the starlit canopy of night, where whispers dance on silver streams of light, the universe unfolds its ancient tale, written in the cosmic wind's soft wail.",
    };

    // Initialize
    useEffect(() => {
        isInitializingRef.current = true;
        setTimeout(() => {
            isInitializingRef.current = false;
        }, 100);
    }, []);

    // Update char counter
    useEffect(() => {
        setCharCounter(text.length);
    }, [text]);

    // Get current provider from model
    const getCurrentProvider = useCallback(() => {
        if (selectedModel.startsWith('eleven_')) return 'elevenlabs';
        if (selectedModel.startsWith('gemini')) return 'gemini';
        return 'openai';
    }, [selectedModel]);

    // Get available voices for current model
    const getAvailableVoices = useCallback(() => {
        const provider = getCurrentProvider();
        return voiceOptions[provider] || [];
    }, [getCurrentProvider]);

    // Get format options for current model
    const getFormatOptions = useCallback(() => {
        if (selectedModel.startsWith('eleven_')) {
            return [
                { value: 'pcm_22050', label: 'PCM 22kHz (Streaming)' },
                { value: 'pcm_16000', label: 'PCM 16kHz (Streaming)' },
                { value: 'pcm_44100', label: 'PCM 44.1kHz (Pro only, Streaming)' },
                { value: 'mp3_44100_128', label: 'MP3 128kbps (No streaming)' },
                { value: 'mp3_44100_192', label: 'MP3 192kbps (No streaming)' },
                { value: 'mp3_44100_64', label: 'MP3 64kbps (No streaming)' },
            ];
        } else if (selectedModel.startsWith('gemini')) {
            return [{ value: 'wav', label: 'WAV' }];
        } else {
            return [
                { value: 'pcm', label: 'PCM (Streaming, 24kHz)' },
                { value: 'wav', label: 'WAV (Streaming)' },
                { value: 'mp3', label: 'MP3 (No streaming)' },
                { value: 'opus', label: 'Opus (No streaming)' },
                { value: 'aac', label: 'AAC (No streaming)' },
                { value: 'flac', label: 'FLAC (No streaming)' },
            ];
        }
    }, [selectedModel]);

    // Update voice when model changes
    useEffect(() => {
        const voices = getAvailableVoices();
        if (voices.length > 0 && !voices.find(v => v.value === selectedVoice)) {
            setSelectedVoice(voices[0].value);
        }
    }, [selectedModel, selectedVoice, getAvailableVoices]);

    // Update format when model changes
    useEffect(() => {
        const formats = getFormatOptions();
        if (formats.length > 0 && !formats.find(f => f.value === selectedFormat)) {
            setSelectedFormat(formats[0].value);
        }
    }, [selectedModel, selectedFormat, getFormatOptions]);

    // Auto-generate on voice change
    useEffect(() => {
        if (!isInitializingRef.current && readyState === ReadyState.OPEN && !isGenerating && text.trim()) {
            generateSpeech();
        }
    }, [selectedVoice]);

    // Auto-generate on text change (debounced)
    useEffect(() => {
        if (!isInitializingRef.current && readyState === ReadyState.OPEN && !isGenerating && text.trim()) {
            const timeout = setTimeout(() => generateSpeech(), 500);
            return () => clearTimeout(timeout);
        }
    }, [text]);

    // Handle WebSocket messages
    useEffect(() => {
        if (!lastMessage) return;

        try {
            const data = JSON.parse(lastMessage.data);
            handleServerMessage(data);
        } catch (error) {
            console.error('Failed to parse WebSocket message:', error);
        }
    }, [lastMessage]);

    const handleServerMessage = (data: {
        type: string;
        connectionId?: string;
        format?: string;
        pcmParameters?: {
            sampleRate: number;
            channels: number;
            bitDepth: number;
        };
        data?: string;
        chunkIndex?: number;
        isFinalChunk?: boolean;
        totalBytes?: number;
        duration?: number;
        usage?: { cost?: number };
        error?: string;
    }) => {
        switch (data.type) {
            case 'connected':
                console.log('Connected with ID:', data.connectionId);
                break;

            case 'generation_start':
                console.log('Generation started:', data);
                if (!selectedFormat.includes('pcm') && selectedFormat !== 'wav') {
                    console.log(
                        `Note: ${selectedFormat.toUpperCase()} format does not support true streaming. Audio will play when generation completes.`
                    );
                }
                break;

            case 'audio_format':
                console.log('Audio format:', data.format, 'PCM params:', data.pcmParameters);

                // For OpenAI PCM without parameters, set defaults
                if (!data.pcmParameters && data.format === 'pcm') {
                    data.pcmParameters = {
                        sampleRate: 24000,
                        channels: 1,
                        bitDepth: 16,
                    };
                }

                // Start the audio stream
                if (audioPlayerRef.current) {
                    audioPlayerRef.current.startStream(data.pcmParameters, data.format || 'pcm');
                }
                break;

            case 'audio_chunk':
                if (isGenerating && data.data) {
                    // Convert base64 to binary for our records
                    const binaryString = atob(data.data);
                    const bytes = new Uint8Array(binaryString.length);
                    for (let i = 0; i < binaryString.length; i++) {
                        bytes[i] = binaryString.charCodeAt(i);
                    }
                    audioChunksRef.current.push(bytes);

                    // Stream the audio chunk
                    console.log(
                        `Received chunk ${data.chunkIndex || 0}, final: ${data.isFinalChunk}, size: ${bytes.length}`
                    );
                    if (audioPlayerRef.current) {
                        audioPlayerRef.current.addChunk(data.data, data.chunkIndex || 0, data.isFinalChunk || false);
                    }

                    // Update progress (estimate based on chunks)
                    const progress = Math.min(95, (data.chunkIndex || 0) * 5);
                    setProgress(progress);

                    // Update size
                    const totalSize = audioChunksRef.current.reduce((sum, chunk) => sum + chunk.length, 0);
                    setDataSize(totalSize);

                    // Update duration
                    const elapsed = (Date.now() - startTimeRef.current) / 1000;
                    setDuration(elapsed);
                }
                break;

            case 'generation_complete':
                if (data.totalBytes !== undefined && data.duration !== undefined) {
                    onGenerationComplete({ totalBytes: data.totalBytes, duration: data.duration });
                }
                break;

            case 'cost_update':
                if (data.usage) {
                    setCost(data.usage.cost || 0);
                }
                break;

            case 'error':
                showError(data.error || 'Unknown error');
                stopGeneration();
                break;
        }
    };

    const onGenerationComplete = (data: { totalBytes: number; duration: number }) => {
        if (!isGenerating) return;

        setIsGenerating(false);
        setProgress(100);

        // Create final audio blob - all format handling is now done in ensembleVoice
        const audioFormat = selectedFormat || 'mp3';

        // Gemini and ElevenLabs PCM always return WAV after our conversion in ensembleVoice
        const effectiveFormat =
            selectedModel.startsWith('gemini') || (selectedModel.startsWith('eleven_') && audioFormat.includes('pcm'))
                ? 'wav'
                : audioFormat;
        const mimeType = getMimeType(effectiveFormat);
        const blob = new Blob(audioChunksRef.current, { type: mimeType });
        currentAudioBlobRef.current = blob;

        // Wait for streaming to finish before setting up the audio player
        const checkStreamingComplete = () => {
            if (!audioPlayerRef.current) return;

            // Check if streaming is still in progress using public getters
            if (audioPlayerRef.current.isStreaming) {
                // Still streaming, check again
                console.log('Still streaming...');
                setTimeout(checkStreamingComplete, 100);
                return;
            }

            console.log('Streaming complete, setting up audio player for controls');
            if (audioElementRef.current && currentAudioBlobRef.current) {
                const audioUrl = URL.createObjectURL(currentAudioBlobRef.current);
                setAudioUrl(audioUrl);
            }
        };

        // Start checking after a small delay to ensure streaming has started
        setTimeout(checkStreamingComplete, 100);

        // Add to history
        addToHistory({
            text: text,
            model: selectedModel,
            voice: selectedVoice,
            format: audioFormat,
            size: data.totalBytes,
            duration: data.duration,
            blob: blob,
        });

        // Final stats update
        setDuration(data.duration);
        setDataSize(data.totalBytes);
    };

    const getMimeType = (format: string): string => {
        const mimeTypes: Record<string, string> = {
            mp3: 'audio/mpeg',
            mp3_high: 'audio/mpeg',
            mp3_44100_64: 'audio/mpeg',
            mp3_44100_128: 'audio/mpeg',
            mp3_44100_192: 'audio/mpeg',
            opus: 'audio/opus',
            aac: 'audio/aac',
            flac: 'audio/flac',
            wav: 'audio/wav',
            pcm: 'audio/pcm',
            pcm_16000: 'audio/pcm',
            pcm_22050: 'audio/pcm',
            pcm_44100: 'audio/pcm',
        };
        return mimeTypes[format] || 'audio/mpeg';
    };

    const generateSpeech = async () => {
        const trimmedText = text.trim();
        if (!trimmedText) {
            showError('Please enter some text to convert to speech');
            return;
        }

        // Wait for connection if still connecting
        if (readyState === ReadyState.CONNECTING) {
            setTimeout(() => generateSpeech(), 100);
            return;
        }

        if (readyState !== ReadyState.OPEN) {
            showError('Connection lost, please refresh the page');
            return;
        }

        // Stop any currently playing audio
        stopPlayback();

        setIsGenerating(true);
        audioChunksRef.current = [];
        startTimeRef.current = Date.now();
        setError(null);
        setProgress(0);
        setLatency(null);
        setDuration(0);
        setDataSize(0);
        setAudioUrl(null);

        // Create AudioStreamPlayer with callback
        audioPlayerRef.current = new AudioStreamPlayer({
            onFirstAudioPlay: () => {
                const latency = Date.now() - startTimeRef.current;
                setLatency(latency);
                console.log(`First audio played after ${latency}ms`);
            },
        });

        // Initialize audio context for streaming
        await audioPlayerRef.current.initAudioContext();

        // Send generation request
        sendMessage(
            JSON.stringify({
                type: 'generate',
                text: trimmedText,
                model: selectedModel,
                options: {
                    voice: selectedVoice,
                    response_format: selectedFormat,
                    speed: speed,
                    stream: true,
                },
            })
        );
    };

    const stopGeneration = () => {
        setIsGenerating(false);
        stopPlayback();
        setProgress(0);
    };

    const stopPlayback = () => {
        // Stop streaming with fade out
        if (audioPlayerRef.current) {
            audioPlayerRef.current.fadeOutAndStop();
        }

        // Stop audio player
        if (audioElementRef.current) {
            audioElementRef.current.pause();
            audioElementRef.current.currentTime = 0;
        }
    };

    const downloadAudio = () => {
        if (!currentAudioBlobRef.current) return;

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
        const format = selectedFormat.split('_')[0];
        const filename = `voice-generation-${timestamp}.${format}`;

        const a = document.createElement('a');
        a.href = URL.createObjectURL(currentAudioBlobRef.current);
        a.download = filename;
        a.click();
    };

    const addToHistory = (item: GenerationHistory) => {
        setHistory(prev => {
            const newHistory = [item, ...prev];
            if (newHistory.length > 10) {
                newHistory.pop();
            }
            return newHistory;
        });
    };

    const playHistoryItem = (index: number) => {
        const item = history[index];
        if (!item || !item.blob) return;

        const audioUrl = URL.createObjectURL(item.blob);
        setAudioUrl(audioUrl);
        if (audioElementRef.current) {
            audioElementRef.current.play();
        }
    };

    const useHistoryText = (index: number) => {
        const item = history[index];
        if (!item) return;
        setText(item.text);
    };

    const showError = (message: string) => {
        setError(message);
        setTimeout(() => setError(null), 5000);
    };

    const generateServerCode = (): string => {
        return `#!/usr/bin/env node
// Minimal server for Ensemble Voice Generation
// Model: ${selectedModel}, Voice: ${selectedVoice}, Format: ${selectedFormat}

import dotenv from 'dotenv';
import express from 'express';
import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import { ensembleVoice } from '@just-every/ensemble';

dotenv.config();

const app = express();
const server = createServer(app);
const PORT = process.env.PORT || 3004;

// Serve static files
app.use(express.static('public'));

// Enable CORS for production use
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    next();
});

// WebSocket server
const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
    console.log('Client connected');

    ws.on('message', async (data) => {
        try {
            const message = JSON.parse(data.toString());

            if (message.type === 'generate') {
                const { text } = message;

                if (!text || text.trim().length === 0) {
                    ws.send(JSON.stringify({
                        type: 'error',
                        error: 'Text is required'
                    }));
                    return;
                }

                // Generate speech with your selected settings
                for await (const event of ensembleVoice(
                    text,
                    { model: '${selectedModel}' },
                    {
                        voice: '${selectedVoice}',
                        response_format: '${selectedFormat}',
                        speed: ${speed}
                    }
                )) {
                    // Simply forward all events to the client
                    ws.send(JSON.stringify(event));
                }

                ws.send(JSON.stringify({ type: 'complete' }));
            }
        } catch (error) {
            console.error('Error:', error);
            ws.send(JSON.stringify({
                type: 'error',
                error: error.message || 'An error occurred'
            }));
        }
    });

    ws.on('error', (error) => {
        console.error('WebSocket error:', error);
    });

    ws.on('close', () => console.log('Client disconnected'));
});

server.listen(PORT, () => {
    console.log(\`Voice server running on port \${PORT}\`);
    console.log(\`WebSocket: ws://localhost:\${PORT}\`);
});`;
    };

    const generateClientCode = (): string => {
        const baseFormat = selectedFormat.split('_')[0];
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Voice Generation - ${selectedModel}</title>
    <style>
        body {
            font-family: system-ui, -apple-system, sans-serif;
            max-width: 800px;
            margin: 0 auto;
            padding: 20px;
            background: #f5f5f5;
        }
        .container {
            background: white;
            padding: 30px;
            border-radius: 12px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        }
        h1 { color: #333; }
        textarea {
            width: 100%;
            min-height: 120px;
            padding: 12px;
            border: 1px solid #ddd;
            border-radius: 8px;
            font-size: 16px;
            resize: vertical;
            box-sizing: border-box;
        }
        button {
            background: #1a73e8;
            color: white;
            border: none;
            padding: 12px 24px;
            border-radius: 8px;
            font-size: 16px;
            cursor: pointer;
            margin-top: 16px;
        }
        button:hover { background: #1557b0; }
        button:disabled { opacity: 0.5; cursor: not-allowed; }
        #status { margin-top: 20px; font-weight: 500; }
        .error { color: #d93025; }
        .success { color: #1e8e3e; }
        .info { color: #5f6368; }
    </style>
</head>
<body>
    <div class="container">
        <h1>Voice Generation</h1>
        <p>Model: ${selectedModel} | Voice: ${selectedVoice} | Format: ${selectedFormat}</p>

        <textarea id="textInput" placeholder="Enter text to convert to speech...">Hello! This is a test of the voice generation system.</textarea>

        <button id="generateBtn" onclick="generateSpeech()">Generate Speech</button>

        <div id="status"></div>
        <audio id="audioPlayer" controls style="display: none; width: 100%; margin-top: 20px;"></audio>
    </div>

    <script type="module">
        import { AudioStreamPlayer } from 'https://unpkg.com/@just-every/ensemble/dist/utils/audio_stream_player.js';

        // Configuration
        const CONFIG = {
            WS_URL: 'ws://localhost:3004',
            RECONNECT_DELAY: 1000,
            MAX_RECONNECT_ATTEMPTS: 5
        };

        // State
        let ws = null;
        let audioPlayer = null;
        let audioChunks = [];
        let reconnectAttempts = 0;
        let connectionTimeout = null;

        // Helper function to convert base64 to Uint8Array
        function base64ToUint8Array(base64) {
            const binaryString = atob(base64);
            const bytes = new Uint8Array(binaryString.length);
            for (let i = 0; i < binaryString.length; i++) {
                bytes[i] = binaryString.charCodeAt(i);
            }
            return bytes;
        }

        // Helper function to get MIME type
        function getMimeType(format) {
            const mimeTypes = {
                'mp3': 'audio/mpeg',
                'wav': 'audio/wav',
                'opus': 'audio/opus',
                'aac': 'audio/aac',
                'flac': 'audio/flac',
                'pcm': 'audio/wav' // PCM will be wrapped in WAV
            };
            return mimeTypes[format] || 'audio/mpeg';
        }

        // Update status display
        function updateStatus(message, className = '') {
            const statusEl = document.getElementById('status');
            statusEl.textContent = message;
            statusEl.className = className;
        }

        // Connect to WebSocket server
        function connect() {
            updateStatus('Connecting...', 'info');

            ws = new WebSocket(CONFIG.WS_URL);

            ws.onopen = () => {
                updateStatus('Connected', 'success');
                reconnectAttempts = 0;
                document.getElementById('generateBtn').disabled = false;
            };

            ws.onmessage = async (event) => {
                const data = JSON.parse(event.data);

                switch (data.type) {
                    case 'format_info':
                        // Initialize audio player
                        audioPlayer = new AudioStreamPlayer({
                            onFirstAudioPlay: () => {
                                console.log('Audio started playing');
                            }
                        });

                        await audioPlayer.initAudioContext();
                        audioPlayer.startStream(data.pcmParameters, data.format);
                        break;

                    case 'audio_stream':
                        if (data.data) {
                            // Stream audio chunk
                            audioPlayer.addChunk(data.data, data.chunkIndex, data.isFinalChunk);

                            // Collect for download
                            audioChunks.push(base64ToUint8Array(data.data));
                        }
                        break;

                    case 'complete':
                        // Create downloadable audio
                        const effectiveFormat = data.format || '${baseFormat}';
                        const mimeType = getMimeType(effectiveFormat);
                        const blob = new Blob(audioChunks, { type: mimeType });
                        const url = URL.createObjectURL(blob);

                        const audioElement = document.getElementById('audioPlayer');
                        audioElement.src = url;
                        audioElement.style.display = 'block';

                        updateStatus('Generation complete!', 'success');
                        document.getElementById('generateBtn').disabled = false;
                        break;

                    case 'error':
                        updateStatus('Error: ' + data.error, 'error');
                        document.getElementById('generateBtn').disabled = false;
                        break;
                }
            };

            ws.onerror = () => {
                updateStatus('Connection error', 'error');
            };

            ws.onclose = () => {
                updateStatus('Disconnected', 'error');
                document.getElementById('generateBtn').disabled = true;

                // Attempt reconnection
                if (reconnectAttempts < CONFIG.MAX_RECONNECT_ATTEMPTS) {
                    reconnectAttempts++;
                    updateStatus(\`Reconnecting... (attempt \${reconnectAttempts})\`, 'info');
                    setTimeout(connect, CONFIG.RECONNECT_DELAY);
                }
            };
        }

        // Generate speech
        window.generateSpeech = async function() {
            const text = document.getElementById('textInput').value.trim();
            if (!text) {
                updateStatus('Please enter some text', 'error');
                return;
            }

            if (!ws || ws.readyState !== WebSocket.OPEN) {
                updateStatus('Not connected to server', 'error');
                return;
            }

            // Reset state
            document.getElementById('generateBtn').disabled = true;
            updateStatus('Generating...', 'info');
            audioChunks = [];

            // Stop any existing playback
            if (audioPlayer) {
                audioPlayer.stopStream();
            }

            ws.send(JSON.stringify({
                type: 'generate',
                text: text
            }));
        };

        // Connect on load
        connect();

        // Cleanup on unload
        window.addEventListener('beforeunload', () => {
            if (ws) {
                ws.close();
            }
        });
    </script>
</body>
</html>`;
    };

    return (
        <>
            <NavBar />
            <div className="min-h-screen" style={{ background: 'var(--bg-primary)', paddingTop: '80px' }}>
                <div className="container mx-auto px-4 py-8">
                    {/* Header */}
                    <div className="flex justify-between items-center mb-6">
                        <h1 className="text-4xl font-bold" style={{ color: 'var(--text-primary)' }}>
                            <span style={{ fontWeight: 300 }}>🎵</span> Voice Generation
                        </h1>
                        <button onClick={() => setShowCodeModal(true)} className="glass-button">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                                <path d="M9.4 16.6L4.8 12l4.6-4.6L8 6l-6 6 6 6 1.4-1.4zm5.2 0l4.6-4.6-4.6-4.6L16 6l6 6-6 6-1.4-1.4z" />
                            </svg>
                            Show Code
                        </button>
                    </div>

                    {/* Connection Warning */}
                    {readyState !== ReadyState.OPEN && (
                        <div className="connection-warning mb-4" style={{ display: 'flex' }}>
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                                <path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z" />
                            </svg>
                            Unable to connect to server. Please ensure the server is running on port 3004.
                        </div>
                    )}

                    {/* Main Content */}
                    <div className="glass-card mb-6">
                        <div className="input-section">
                            <h2 className="text-xl font-semibold mb-4">Text to Speech</h2>

                            {/* Text Input */}
                            <div className="textarea-wrapper mb-4">
                                <textarea
                                    id="textInput"
                                    value={text}
                                    onChange={e => setText(e.target.value)}
                                    placeholder="Enter the text you want to convert to speech..."
                                    maxLength={5000}
                                    className="w-full min-h-[120px] p-3 bg-surface-glass border border-border-glass rounded-xl text-text-primary"
                                    style={{ resize: 'vertical' }}
                                />
                                <span className="char-counter">{charCounter} / 5000</span>
                            </div>

                            {/* Example texts */}
                            <div className="examples-section mb-6">
                                <strong>Example texts:</strong>
                                <div className="flex gap-2 flex-wrap mt-2">
                                    <button className="example-btn" onClick={() => setText(exampleTexts.news)}>
                                        News
                                    </button>
                                    <button className="example-btn" onClick={() => setText(exampleTexts.story)}>
                                        Story
                                    </button>
                                    <button className="example-btn" onClick={() => setText(exampleTexts.technical)}>
                                        Technical
                                    </button>
                                    <button className="example-btn" onClick={() => setText(exampleTexts.poetry)}>
                                        Poetry
                                    </button>
                                </div>
                            </div>
                        </div>

                        {/* Settings */}
                        <div className="settings-section mb-6">
                            <h2 className="text-xl font-semibold mb-4">Voice Settings</h2>
                            <div className="settings-grid">
                                <div className="setting-group">
                                    <label className="setting-label">Model</label>
                                    <select
                                        id="modelSelect"
                                        value={selectedModel}
                                        onChange={e => setSelectedModel(e.target.value)}
                                        className="model-select">
                                        <optgroup label="OpenAI Models">
                                            <option value="gpt-4o-mini-tts">GPT-4o mini TTS (Latest)</option>
                                            <option value="tts-1-hd">TTS-1-HD (High Quality)</option>
                                            <option value="tts-1">TTS-1 (Standard)</option>
                                        </optgroup>
                                        <optgroup label="ElevenLabs Models">
                                            <option value="eleven_turbo_v2_5">Turbo V2.5 (Balanced)</option>
                                            <option value="eleven_flash_v2_5">Flash V2.5 (Ultra Low Latency)</option>
                                            <option value="eleven_multilingual_v2">
                                                Multilingual V2 (High Quality)
                                            </option>
                                        </optgroup>
                                        <optgroup label="Gemini Models">
                                            <option value="gemini-2.5-pro-preview-tts">
                                                Gemini 2.5 Pro TTS (High Quality)
                                            </option>
                                            <option value="gemini-2.5-flash-preview-tts">
                                                Gemini 2.5 Flash TTS (Fast)
                                            </option>
                                        </optgroup>
                                    </select>
                                </div>

                                <div className="setting-group">
                                    <label className="setting-label">Voice</label>
                                    <select
                                        id="voiceSelect"
                                        value={selectedVoice}
                                        onChange={e => setSelectedVoice(e.target.value)}
                                        className="model-select">
                                        {getAvailableVoices().map(voice => (
                                            <option key={voice.value} value={voice.value}>
                                                {voice.label}
                                            </option>
                                        ))}
                                    </select>
                                </div>

                                <div className="setting-group">
                                    <label className="setting-label">Format</label>
                                    <select
                                        id="formatSelect"
                                        value={selectedFormat}
                                        onChange={e => setSelectedFormat(e.target.value)}
                                        className="model-select">
                                        {getFormatOptions().map(format => (
                                            <option key={format.value} value={format.value}>
                                                {format.label}
                                            </option>
                                        ))}
                                    </select>
                                </div>

                                <div className="setting-group">
                                    <label className="setting-label">Speed</label>
                                    <div className="slider-container">
                                        <input
                                            type="range"
                                            id="speedSlider"
                                            min="0.25"
                                            max="4"
                                            step="0.05"
                                            value={speed}
                                            onChange={e => setSpeed(parseFloat(e.target.value))}
                                            className="slider"
                                        />
                                        <span className="slider-value">{speed}x</span>
                                    </div>
                                </div>
                            </div>

                            {/* Controls */}
                            <div className="controls">
                                <button
                                    id="generateBtn"
                                    onClick={() => (isGenerating ? stopGeneration() : generateSpeech())}
                                    disabled={!text.trim() || readyState !== ReadyState.OPEN}
                                    className={isGenerating ? 'danger-btn' : 'primary-btn'}>
                                    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                                        {isGenerating ? <path d="M6 6h12v12H6z" /> : <path d="M8 5v14l11-7z" />}
                                    </svg>
                                    {isGenerating ? 'Stop' : 'Generate Speech'}
                                </button>
                            </div>
                        </div>

                        {/* Progress Bar */}
                        <div className={`progress-bar ${isGenerating ? 'active' : ''}`}>
                            <div className="progress-fill" style={{ width: `${progress}%` }}></div>
                        </div>

                        {/* Audio Player Section */}
                        {audioUrl && (
                            <div className="audio-player-section">
                                <h3>Generated Audio</h3>
                                <audio
                                    ref={audioElementRef}
                                    id="audioPlayer"
                                    className="audio-player"
                                    controls
                                    src={audioUrl}
                                />
                                <button className="download-btn" onClick={downloadAudio}>
                                    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                                        <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z" />
                                    </svg>
                                    Download Audio
                                </button>
                            </div>
                        )}

                        {/* Stats Grid */}
                        <div className="stats-grid">
                            <div className="stat-card">
                                <div className="stat-value">{latency ? `${latency}ms` : '-'}</div>
                                <div className="stat-label">Latency</div>
                            </div>
                            <div className="stat-card">
                                <div className="stat-value">{duration.toFixed(1)}s</div>
                                <div className="stat-label">Generation Time</div>
                            </div>
                            <div className="stat-card">
                                <div className="stat-value">{(dataSize / 1024).toFixed(1)} KB</div>
                                <div className="stat-label">Audio Size</div>
                            </div>
                            <div className="stat-card">
                                <div className="stat-value">${cost.toFixed(4)}</div>
                                <div className="stat-label">Estimated Cost</div>
                            </div>
                        </div>

                        {/* Error Container */}
                        {error && (
                            <div className="error-message">
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                                    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z" />
                                </svg>
                                {error}
                            </div>
                        )}

                        {/* History Section */}
                        <div className="history-section">
                            <h3>Generation History</h3>
                            <div id="historyContainer">
                                {history.length === 0 ? (
                                    <p style={{ color: 'var(--text-secondary)', textAlign: 'center', padding: '20px' }}>
                                        No generations yet
                                    </p>
                                ) : (
                                    history.map((item, index) => (
                                        <div key={index} className="history-item">
                                            <div className="history-text">
                                                {item.text.substring(0, 50)}
                                                {item.text.length > 50 ? '...' : ''}
                                            </div>
                                            <div className="history-controls">
                                                <button
                                                    className="history-btn secondary-btn"
                                                    onClick={() => playHistoryItem(index)}>
                                                    Play
                                                </button>
                                                <button
                                                    className="history-btn secondary-btn"
                                                    onClick={() => useHistoryText(index)}>
                                                    Use Text
                                                </button>
                                            </div>
                                        </div>
                                    ))
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Code Generation Modal */}
            {showCodeModal && (
                <div
                    className="modal-overlay active"
                    onClick={e => {
                        if (e.target === e.currentTarget) setShowCodeModal(false);
                    }}>
                    <div className="modal">
                        <div className="modal-header">
                            <h2 className="modal-title">Generated Code</h2>
                            <button className="modal-close" onClick={() => setShowCodeModal(false)}>
                                <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                                    <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
                                </svg>
                            </button>
                        </div>
                        <div className="modal-tabs-section">
                            <div className="code-tabs">
                                <button
                                    className={`code-tab ${activeCodeTab === 'server' ? 'active' : ''}`}
                                    onClick={() => setActiveCodeTab('server')}>
                                    Server Code
                                </button>
                                <button
                                    className={`code-tab ${activeCodeTab === 'client' ? 'active' : ''}`}
                                    onClick={() => setActiveCodeTab('client')}>
                                    Client Code
                                </button>
                            </div>
                        </div>
                        <div className="modal-body">
                            <div
                                className="code-container"
                                style={{ display: activeCodeTab === 'server' ? 'block' : 'none' }}>
                                <button
                                    className="copy-button"
                                    onClick={e => {
                                        const code = generateServerCode();
                                        navigator.clipboard.writeText(code);
                                        const btn = e.currentTarget;
                                        btn.textContent = 'Copied!';
                                        btn.classList.add('copied');
                                        setTimeout(() => {
                                            btn.textContent = 'Copy';
                                            btn.classList.remove('copied');
                                        }, 2000);
                                    }}>
                                    Copy
                                </button>
                                <pre>{generateServerCode()}</pre>
                            </div>
                            <div
                                className="code-container"
                                style={{ display: activeCodeTab === 'client' ? 'block' : 'none' }}>
                                <button
                                    className="copy-button"
                                    onClick={e => {
                                        const code = generateClientCode();
                                        navigator.clipboard.writeText(code);
                                        const btn = e.currentTarget;
                                        btn.textContent = 'Copied!';
                                        btn.classList.add('copied');
                                        setTimeout(() => {
                                            btn.textContent = 'Copy';
                                            btn.classList.remove('copied');
                                        }, 2000);
                                    }}>
                                    Copy
                                </button>
                                <pre>{generateClientCode()}</pre>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
};

export default VoiceDemo;
