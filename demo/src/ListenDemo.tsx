import React, { useState, useEffect, useRef } from 'react';
import useWebSocket, { ReadyState } from 'react-use-websocket';
import './components/style.scss';
import ConnectionWarning from './components/ConnectionWarning';
import { LISTEN_WS_URL } from './config/websocket';
import {
    DemoHeader,
    Card,
    GlassButton,
    ConnectionStatus,
    StatsGrid,
    ModelSelector,
    ShowCodeButton,
    CodeModal,
    formatDuration,
    formatBytes,
    formatNumber,
    formatCurrency,
} from '@just-every/demo-ui';

const ListenDemo: React.FC = () => {
    // State management
    const [isRecording, setIsRecording] = useState(false);
    const [selectedModel, setSelectedModel] = useState('gemini-live-2.5-flash-preview');
    const [, setTranscript] = useState('');
    const [connectionStatus, setConnectionStatus] = useState<'disconnected' | 'connecting' | 'connected' | 'error'>(
        'disconnected'
    );
    const [error, setError] = useState<string | null>(null);
    const [duration, setDuration] = useState(0);
    const [totalBytes, setTotalBytes] = useState(0);
    const [totalTokens, setTotalTokens] = useState(0);
    const [cost, setCost] = useState(0);
    const [showCodeModal, setShowCodeModal] = useState(false);
    const [, setHasAttemptedConnection] = useState(false);
    const [showConnectionWarning, setShowConnectionWarning] = useState(false);
    const [audioChunksSent, setAudioChunksSent] = useState(0);
    // Refs
    const mediaStreamRef = useRef<MediaStream | null>(null);
    const audioContextRef = useRef<AudioContext | null>(null);
    const processorRef = useRef<ScriptProcessorNode | null>(null);
    const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
    const analyserRef = useRef<AnalyserNode | null>(null);
    const visualizerBarsRef = useRef<HTMLDivElement[]>([]);
    const startTimeRef = useRef<number | null>(null);
    const durationIntervalRef = useRef<NodeJS.Timeout | null>(null);
    const transcriptContainerRef = useRef<HTMLDivElement>(null);
    const animationFrameRef = useRef<number | null>(null);
    const shouldVisualizeRef = useRef<boolean>(false);

    // WebSocket configuration
    const { sendMessage, lastMessage, readyState, getWebSocket } = useWebSocket(isRecording ? LISTEN_WS_URL : null, {
        shouldReconnect: () => true,
        reconnectAttempts: 10,
        reconnectInterval: 3000,
        onOpen: () => {
            console.log('🔌 WebSocket opened - connection established');
        },
        onError: error => {
            console.error('❌ WebSocket error:', error);
        },
        onMessage: event => {
            console.log('📨 Raw WebSocket message received:', event);
        },
    });

    // Handle WebSocket connection status
    useEffect(() => {
        console.log('🔄 WebSocket state change - readyState:', readyState, 'isRecording:', isRecording);

        if (!isRecording) {
            console.log('📴 Not recording - setting status to disconnected');
            setConnectionStatus('disconnected');
            setShowConnectionWarning(false);
            return;
        }

        switch (readyState) {
            case ReadyState.CONNECTING:
                console.log('🔄 WebSocket connecting...');
                setConnectionStatus('connecting');
                break;
            case ReadyState.OPEN: {
                console.log('✅ WebSocket connected successfully');
                setConnectionStatus('connected');
                setShowConnectionWarning(false);

                // Set binary type for audio data
                const ws = getWebSocket();
                if (ws && 'binaryType' in ws) {
                    (ws as WebSocket).binaryType = 'arraybuffer';
                    console.log('🔧 WebSocket binary type set to arraybuffer');
                } else {
                    console.warn('⚠️ WebSocket is null when trying to set binary type');
                }

                const startMessage = {
                    type: 'start',
                    model: selectedModel,
                };
                console.log('📤 Sending start message:', startMessage);
                sendMessage(JSON.stringify(startMessage));
                break;
            }
            case ReadyState.CLOSING:
                console.log('⏹️ WebSocket closing...');
                setConnectionStatus('disconnected');
                break;
            case ReadyState.CLOSED:
                console.log('❌ WebSocket closed');
                setConnectionStatus('disconnected');
                break;
        }
    }, [readyState, isRecording, selectedModel, sendMessage]);

    // Handle WebSocket messages
    useEffect(() => {
        if (!lastMessage) return;

        console.log('📥 New WebSocket message received:', lastMessage.data);

        try {
            const data = JSON.parse(lastMessage.data);
            console.log('📋 Parsed message data:', data);
            handleServerMessage(data);
        } catch (error) {
            console.error('❌ Failed to parse WebSocket message:', error, 'Raw data:', lastMessage.data);
        }
    }, [lastMessage]);

    // Create visualizer bars on component mount
    useEffect(() => {
        const createVisualizer = () => {
            const visualizer = document.getElementById('visualizer');
            const container = document.getElementById('audioVisualizer');
            if (!visualizer || !container) return;

            // Clear any existing bars
            visualizer.innerHTML = '';
            visualizerBarsRef.current = [];

            // Calculate optimal bar count based on container width
            const containerWidth = container.offsetWidth || 800;
            const pixelsPerBar = 10; // Adjusted for narrower bars
            const barCount = Math.min(64, Math.max(32, Math.floor(containerWidth / pixelsPerBar)));

            for (let i = 0; i < barCount; i++) {
                const bar = document.createElement('div');
                bar.className = 'audio-bar';
                bar.style.height = '4px';
                bar.style.flex = '1';
                visualizer.appendChild(bar);
                visualizerBarsRef.current.push(bar);
            }
        };

        createVisualizer();

        // Recreate on window resize
        const handleResize = () => createVisualizer();
        window.addEventListener('resize', handleResize);

        return () => window.removeEventListener('resize', handleResize);
    }, []);

    // Message handler functions
    const handleServerMessage = (data: {
        type: string;
        delta?: string;
        text?: string;
        error?: string;
        [key: string]: unknown;
    }) => {
        console.log('🎯 Handling server message - type:', data.type, 'data:', data);

        switch (data.type) {
            case 'transcription_start':
                console.log('🎙️ Transcription started - server is ready to receive audio');
                break;
            case 'transcription_turn_delta':
                console.log('📝 Transcription delta received:', data.delta);
                // Append delta text directly like original
                handleTranscription({ text: data.delta || '' });
                break;
            case 'transcription_turn_complete':
                console.log('✅ Turn complete:', data.text);
                // Add turn complete separator like original
                handleTranscription({ text: '\n\n--- Turn Complete ---\n\n' });
                break;
            case 'cost_update':
                console.log('💰 Cost update received:', data.usage);
                if (data.usage && typeof data.usage === 'object') {
                    const usage = data.usage as {
                        total_tokens?: number;
                        input_tokens?: number;
                        output_tokens?: number;
                    };
                    setTotalTokens(usage.total_tokens || 0);
                    const inputCost = ((usage.input_tokens || 0) * 0.2) / 1_000_000;
                    const outputCost = ((usage.output_tokens || 0) * 0.8) / 1_000_000;
                    setCost(inputCost + outputCost);
                }
                break;
            case 'error':
                console.error('❌ Server error received:', data.error);
                setError(data.error || 'An error occurred');
                stopRecording();
                break;
            case 'status':
                console.log('📊 Server status:', data.message);
                break;
            default:
                console.warn('⚠️ Unknown message type received:', data.type);
        }
    };

    const handleTranscription = (data: { text?: string; [key: string]: unknown }) => {
        const containerEl = transcriptContainerRef.current;
        if (!containerEl) return;

        // Remove empty state message if present
        const emptyMsg = containerEl.querySelector('.transcript-empty');
        if (emptyMsg) {
            emptyMsg.remove();
        }

        // Simple append like the original
        if (containerEl.textContent !== null && data.text) {
            containerEl.textContent += data.text;
        }
        containerEl.scrollTop = containerEl.scrollHeight;
    };

    // Audio setup
    const startAudioCapture = async () => {
        try {
            console.log('🎤 Starting audio capture...');

            if (!navigator.mediaDevices?.getUserMedia) {
                console.error('❌ Browser does not support getUserMedia');
                throw new Error('Browser does not support audio capture');
            }

            console.log('🎧 Requesting microphone access...');
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    channelCount: 1,
                    sampleRate: 16000,
                    echoCancellation: true,
                    noiseSuppression: true,
                },
            });
            console.log('✅ Microphone access granted, stream:', stream);

            mediaStreamRef.current = stream;

            console.log('🎵 Creating audio context...');
            audioContextRef.current = new (window.AudioContext ||
                (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)({
                sampleRate: 16000,
            });
            console.log('✅ Audio context created:', audioContextRef.current);

            console.log('🔗 Creating audio nodes...');
            sourceRef.current = audioContextRef.current.createMediaStreamSource(stream);
            processorRef.current = audioContextRef.current.createScriptProcessor(1024, 1, 1);

            // Create analyser for visualization with proper settings
            analyserRef.current = audioContextRef.current.createAnalyser();
            analyserRef.current.fftSize = 512; // Higher for better frequency resolution
            analyserRef.current.smoothingTimeConstant = 0.8; // More smoothing for frequency display
            analyserRef.current.minDecibels = -70; // Less sensitive to quiet sounds
            analyserRef.current.maxDecibels = -20; // More headroom for loud sounds
            console.log(
                '✅ Audio nodes created - source:',
                sourceRef.current,
                'processor:',
                processorRef.current,
                'analyser:',
                analyserRef.current
            );

            console.log('🔌 Connecting audio nodes...');
            sourceRef.current.connect(analyserRef.current);
            sourceRef.current.connect(processorRef.current);
            processorRef.current.connect(audioContextRef.current.destination);
            console.log('✅ Audio nodes connected');

            let audioChunkCount = 0;
            let totalAudioBytesSent = 0;

            processorRef.current.onaudioprocess = (e: AudioProcessingEvent) => {
                audioChunkCount++;

                // Log every 100 audio chunks to avoid spam
                if (audioChunkCount % 100 === 0) {
                    console.log(
                        `🎵 Audio processor called ${audioChunkCount} times, connection status:`,
                        connectionStatus
                    );
                }

                const ws = getWebSocket();
                if (ws && ws.readyState === WebSocket.OPEN) {
                    const inputData = e.inputBuffer.getChannelData(0);
                    const int16Array = new Int16Array(inputData.length);

                    // Check if we have actual audio data
                    let hasAudioData = false;
                    for (let i = 0; i < inputData.length; i++) {
                        const s = Math.max(-1, Math.min(1, inputData[i]));
                        int16Array[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
                        if (Math.abs(inputData[i]) > 0.01) {
                            hasAudioData = true;
                        }
                    }

                    if ('send' in ws) {
                        (ws as WebSocket).send(int16Array.buffer);
                    }
                    totalAudioBytesSent += int16Array.buffer.byteLength;
                    setTotalBytes(prev => prev + int16Array.buffer.byteLength);
                    setAudioChunksSent(prev => prev + 1);

                    // Log first few audio sends for debugging
                    if (audioChunkCount <= 10) {
                        console.log(
                            `📤 Sent audio chunk ${audioChunkCount}, size: ${int16Array.buffer.byteLength} bytes, has audio data: ${hasAudioData}, WebSocket readyState: ${ws.readyState}`
                        );
                    }

                    // Log every 1000 chunks with summary
                    if (audioChunkCount % 1000 === 0) {
                        console.log(
                            `📊 Audio summary - ${audioChunkCount} chunks sent, ${totalAudioBytesSent} total bytes, WebSocket state: ${ws.readyState}`
                        );
                    }
                } else {
                    // Only log first few times to avoid spam
                    if (audioChunkCount <= 5) {
                        console.log(
                            `🔄 Audio processor called but WebSocket not ready - state: ${ws?.readyState || 'null'}, chunk ${audioChunkCount}`
                        );
                    }
                }
            };

            // Ensure visualizer bars exist before starting visualization
            const visualizer = document.getElementById('visualizer');
            const container = document.getElementById('audioVisualizer');

            if (visualizer && visualizerBarsRef.current.length === 0) {
                const containerWidth = container?.offsetWidth || 800;
                const pixelsPerBar = 10; // Adjusted for narrower bars
                const barCount = Math.min(64, Math.max(32, Math.floor(containerWidth / pixelsPerBar)));

                visualizer.innerHTML = '';
                visualizerBarsRef.current = [];

                for (let i = 0; i < barCount; i++) {
                    const bar = document.createElement('div');
                    bar.className = 'audio-bar';
                    bar.style.height = '4px';
                    bar.style.flex = '1';
                    visualizer.appendChild(bar);
                    visualizerBarsRef.current.push(bar);
                }
            }

            // Set flag to start visualization
            shouldVisualizeRef.current = true;

            // Start visualization
            visualize();

            console.log('✅ Audio processor event handler set up');
            return true;
        } catch (err) {
            console.error('❌ Failed to start audio capture:', err);
            setError(err instanceof Error ? err.message : 'Failed to access microphone');
            return false;
        }
    };

    // Recording controls
    const startRecording = async () => {
        console.log('🎬 Starting recording session...');
        setError(null);
        setHasAttemptedConnection(true);

        // Immediately set to connecting state for UI feedback
        setConnectionStatus('connecting');

        console.log('🎤 Initializing audio capture...');
        const audioStarted = await startAudioCapture();
        if (!audioStarted) {
            console.error('❌ Audio capture failed to start');
            return;
        }
        console.log('✅ Audio capture started successfully');

        setIsRecording(true);
        startTimeRef.current = Date.now();
        console.log('⏰ Recording timer started at:', new Date(startTimeRef.current));

        // Show connection warning after a delay if still not connected
        setTimeout(() => {
            if (connectionStatus !== 'connected') {
                console.warn('⚠️ Connection timeout - showing warning after 3 seconds');
                setShowConnectionWarning(true);
            }
        }, 3000);

        durationIntervalRef.current = setInterval(() => {
            if (startTimeRef.current) {
                setDuration(Math.floor((Date.now() - startTimeRef.current) / 1000));
            }
        }, 100);

        console.log('🎥 Recording session initialized');
    };

    const visualize = () => {
        if (!analyserRef.current || !shouldVisualizeRef.current) {
            return;
        }

        const bufferLength = analyserRef.current.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);
        analyserRef.current.getByteFrequencyData(dataArray);

        const barCount = visualizerBarsRef.current.length;
        if (barCount === 0) return;

        // Focus on voice frequency range (roughly 80Hz to 2000Hz)
        // At 16kHz sample rate, each bin represents ~31.25Hz
        const minFreqBin = Math.floor(80 / 31.25); // ~2-3
        const maxFreqBin = Math.floor(2000 / 31.25); // ~64
        const usefulBins = maxFreqBin - minFreqBin;

        // Map bars to frequency bins - create symmetric visualization
        const heights: string[] = new Array(barCount);
        const halfBarCount = Math.floor(barCount / 2);

        // Process frequency data for half the bars
        const halfHeights: number[] = new Array(halfBarCount);

        for (let i = 0; i < halfBarCount; i++) {
            // Map to frequency bins, starting from low frequencies
            const binIndex = minFreqBin + Math.floor((i / halfBarCount) * usefulBins);
            const value = dataArray[binIndex] || 0;

            // Convert byte (0-255) to height with logarithmic scaling
            const normalizedValue = value / 255;
            const scaledValue = Math.pow(normalizedValue, 0.7);
            const height = Math.max(4, scaledValue * 60);
            halfHeights[i] = height;
        }

        // Create symmetric visualization - low frequencies in center
        for (let i = 0; i < barCount; i++) {
            if (i < halfBarCount) {
                // Left side - reversed (high to low frequencies)
                const sourceIndex = halfBarCount - 1 - i;
                heights[i] = `${halfHeights[sourceIndex]}px`;
            } else {
                // Right side - normal (low to high frequencies)
                const sourceIndex = i - halfBarCount;
                heights[i] = `${halfHeights[sourceIndex]}px`;
            }
        }

        // Apply all height changes at once
        requestAnimationFrame(() => {
            for (let i = 0; i < barCount; i++) {
                if (visualizerBarsRef.current[i]) {
                    visualizerBarsRef.current[i].style.height = heights[i];
                }
            }
        });

        animationFrameRef.current = requestAnimationFrame(visualize);
    };

    const stopRecording = () => {
        console.log('🛑 Stopping recording session...');

        shouldVisualizeRef.current = false;

        if (durationIntervalRef.current) {
            clearInterval(durationIntervalRef.current);
            durationIntervalRef.current = null;
            console.log('⏰ Duration timer cleared');
        }

        // Reset visualizer bars
        visualizerBarsRef.current.forEach(bar => {
            bar.style.height = '4px';
        });

        // Stop animation
        if (animationFrameRef.current) {
            cancelAnimationFrame(animationFrameRef.current);
            animationFrameRef.current = null;
        }

        if (processorRef.current) {
            processorRef.current.disconnect();
            processorRef.current = null;
            console.log('🔌 Audio processor disconnected');
        }

        if (sourceRef.current) {
            sourceRef.current.disconnect();
            sourceRef.current = null;
            console.log('🔌 Audio source disconnected');
        }

        if (analyserRef.current) {
            analyserRef.current.disconnect();
            analyserRef.current = null;
            console.log('🔌 Audio analyser disconnected');
        }

        if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
            audioContextRef.current.close();
            audioContextRef.current = null;
            console.log('🔌 Audio context closed');
        }

        if (mediaStreamRef.current) {
            mediaStreamRef.current.getTracks().forEach(track => {
                track.stop();
                console.log('🔌 Media track stopped:', track.kind);
            });
            mediaStreamRef.current = null;
            console.log('🔌 Media stream cleared');
        }

        setIsRecording(false);

        const ws = getWebSocket();
        if (ws && ws.readyState === WebSocket.OPEN) {
            const stopMessage = { type: 'stop' };
            console.log('📤 Sending stop message to server:', stopMessage);
            if ('send' in ws) {
                (ws as WebSocket).send(JSON.stringify(stopMessage));
            }
        } else {
            console.warn('⚠️ Cannot send stop message - WebSocket state:', ws?.readyState || 'null');
        }

        console.log('✅ Recording session stopped');
    };

    const clearTranscript = () => {
        if (transcriptContainerRef.current) {
            transcriptContainerRef.current.innerHTML =
                '<div class="transcript-empty" style="color: var(--text-secondary); text-align: center; padding: 40px;">Press "Connect" to begin live transcription</div>';
        }
        setTranscript('');
        setDuration(0);
        setTotalBytes(0);
        setTotalTokens(0);
        setCost(0);
        setError(null);
        setAudioChunksSent(0);
        console.log('🧹 Cleared all stats and transcript');
    };

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            if (isRecording) {
                stopRecording();
            }
        };
    }, [isRecording]);

    const modelOptions = [
        {
            label: 'OpenAI Models',
            options: [
                { value: 'gpt-4o-transcribe', label: 'GPT-4o Transcribe (Streaming)' },
                { value: 'gpt-4o-mini-transcribe', label: 'GPT-4o Mini Transcribe (Streaming)' },
                { value: 'whisper-1', label: 'Whisper-1 (Complete at once)' },
            ],
        },
        {
            label: 'Gemini Models',
            options: [
                { value: 'gemini-live-2.5-flash-preview', label: 'Gemini Live 2.5 Flash Preview' },
                { value: 'gemini-2.0-flash-live-001', label: 'Gemini 2.0 Flash Live' },
            ],
        },
    ];

    const generateCode = () => ({
        server: `import WebSocket from 'ws';
import { createServer } from 'http';
import express from 'express';
import { ensembleVoiceToText } from '@just-every/ensemble';

const app = express();
const server = createServer(app);
const wss = new WebSocket.Server({ server });

wss.on('connection', (ws) => {
    let currentStream = null;

    ws.on('message', async (data) => {
        if (typeof data === 'string') {
            const message = JSON.parse(data);

            if (message.type === 'start') {
                currentStream = await ensembleVoiceToText({
                    model: message.model,
                    onPartialTranscript: (text) => {
                        ws.send(JSON.stringify({
                            type: 'transcription',
                            text,
                            isPartial: true
                        }));
                    },
                    onFinalTranscript: (text) => {
                        ws.send(JSON.stringify({
                            type: 'transcription',
                            text,
                            isPartial: false
                        }));
                    },
                    onCostUpdate: (cost) => {
                        ws.send(JSON.stringify({
                            type: 'cost_update',
                            cost
                        }));
                    }
                });
            } else if (message.type === 'stop' && currentStream) {
                currentStream.stop();
                currentStream = null;
            }
        } else if (currentStream) {
            // Binary audio data
            currentStream.write(data);
        }
    });

    ws.on('close', () => {
        if (currentStream) {
            currentStream.stop();
        }
    });
});

server.listen(3003, () => {
    console.log('WebSocket server running on ws://localhost:3003');
});`,
        client: `<!DOCTYPE html>
<html>
<head>
    <title>Live Transcription Demo</title>
    <style>
        body { font-family: Arial, sans-serif; padding: 20px; }
        #transcript {
            border: 1px solid #ccc;
            height: 300px;
            overflow-y: scroll;
            padding: 10px;
            margin: 20px 0;
        }
        .transcript-line { margin: 5px 0; }
        .transcript-line.preview { color: #666; font-style: italic; }
        button { padding: 10px 20px; margin: 5px; }
    </style>
</head>
<body>
    <h1>Live Transcription Demo</h1>

    <select id="modelSelect">
        <option value="gemini-live-2.5-flash-preview">Gemini 2.0 Flash</option>
        <option value="deepseek-r1-voice-preview">DeepSeek r1-voice</option>
    </select>

    <button id="startBtn" onclick="startRecording()">Start Recording</button>
    <button id="stopBtn" onclick="stopRecording()" disabled>Stop Recording</button>

    <div id="transcript"></div>

    <script>
        let ws = null;
        let mediaStream = null;
        let audioContext = null;
        let processor = null;
        let source = null;

        async function startRecording() {
            const model = document.getElementById('modelSelect').value;

            // Get microphone access
            mediaStream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    channelCount: 1,
                    sampleRate: 16000
                }
            });

            // Setup WebSocket
            ws = new WebSocket('ws://localhost:3003');

            ws.onopen = () => {
                ws.send(JSON.stringify({ type: 'start', model }));
                setupAudioProcessing();
            };

            ws.onmessage = (event) => {
                const data = JSON.parse(event.data);
                handleTranscription(data);
            };

            document.getElementById('startBtn').disabled = true;
            document.getElementById('stopBtn').disabled = false;
        }

        function setupAudioProcessing() {
            audioContext = new AudioContext({ sampleRate: 16000 });
            source = audioContext.createMediaStreamSource(mediaStream);
            processor = audioContext.createScriptProcessor(4096, 1, 1);

            processor.onaudioprocess = (e) => {
                const inputData = e.inputBuffer.getChannelData(0);
                const int16Array = new Int16Array(inputData.length);

                for (let i = 0; i < inputData.length; i++) {
                    const s = Math.max(-1, Math.min(1, inputData[i]));
                    int16Array[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
                }

                if (ws.readyState === WebSocket.OPEN) {
                    ws.send(int16Array.buffer);
                }
            };

            source.connect(processor);
            processor.connect(audioContext.destination);
        }

        function handleTranscription(data) {
            const transcript = document.getElementById('transcript');

            if (data.type === 'transcription') {
                if (data.isPartial) {
                    // Update or create preview
                    let preview = transcript.querySelector('.preview');
                    if (!preview) {
                        preview = document.createElement('div');
                        preview.className = 'transcript-line preview';
                        transcript.appendChild(preview);
                    }
                    preview.textContent = data.text;
                } else {
                    // Remove preview and add final
                    const preview = transcript.querySelector('.preview');
                    if (preview) preview.remove();

                    const line = document.createElement('div');
                    line.className = 'transcript-line';
                    line.textContent = data.text;
                    transcript.appendChild(line);
                }

                transcript.scrollTop = transcript.scrollHeight;
            }
        }

        function stopRecording() {
            if (processor) processor.disconnect();
            if (source) source.disconnect();
            if (audioContext) audioContext.close();
            if (mediaStream) mediaStream.getTracks().forEach(t => t.stop());
            if (ws) {
                ws.send(JSON.stringify({ type: 'stop' }));
                ws.close();
            }

            document.getElementById('startBtn').disabled = false;
            document.getElementById('stopBtn').disabled = true;
        }
    </script>
</body>
</html>`,
    });

    return (
        <div className="container">
            <DemoHeader
                title="Listen Demo"
                icon={
                    <svg width="32" height="32" viewBox="0 0 384 512" fill="currentColor">
                        <path d="M192 0C139 0 96 43 96 96V256c0 53 43 96 96 96s96-43 96-96V96c0-53-43-96-96-96zM64 216c0-13.3-10.7-24-24-24s-24 10.7-24 24v40c0 89.1 66.2 162.7 152 174.4V464H112c-13.3 0-24 10.7-24 24s10.7 24 24 24h160c13.3 0 24-10.7 24-24s-10.7-24-24-24H216V430.4c85.8-11.7 152-85.3 152-174.4V216c0-13.3-10.7-24-24-24s-24 10.7-24 24v40c0 70.7-57.3 128-128 128s-128-57.3-128-128V216z" />
                    </svg>
                }>
                <ShowCodeButton onClick={() => setShowCodeModal(true)} />
            </DemoHeader>

            {showConnectionWarning && connectionStatus === 'disconnected' && (
                <ConnectionWarning readyState={readyState} port={3003} />
            )}

            <Card style={{ marginBottom: '20px' }}>
                <div className="status-section">
                    <div className="control-header">
                        <ConnectionStatus status={connectionStatus} />

                        <div style={{ flex: 1, minWidth: '250px', maxWidth: '350px' }}>
                            <ModelSelector
                                groups={modelOptions}
                                selectedValue={selectedModel}
                                onChange={setSelectedModel}
                                disabled={isRecording}
                            />
                        </div>

                        <div className="controls">
                            {!isRecording ? (
                                <GlassButton
                                    variant="primary"
                                    onClick={startRecording}
                                    disabled={connectionStatus === 'connecting'}>
                                    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                                        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" />
                                    </svg>
                                    <span>{connectionStatus === 'connecting' ? 'Connecting...' : 'Connect'}</span>
                                </GlassButton>
                            ) : (
                                <GlassButton variant="danger" onClick={stopRecording}>
                                    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                                        <path d="M6 6h12v12H6z" />
                                    </svg>
                                    <span>Stop</span>
                                </GlassButton>
                            )}
                        </div>
                    </div>
                </div>

                {error && (
                    <div
                        style={{
                            marginTop: '16px',
                            color: 'var(--error)',
                            padding: '12px',
                            background: 'var(--surface-glass)',
                            borderRadius: '8px',
                            border: '1px solid var(--error)',
                        }}>
                        {error}
                    </div>
                )}
            </Card>

            <div className="audio-visualizer" id="audioVisualizer">
                <div
                    id="visualizer"
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        height: '100%',
                        width: '100%',
                        gap: '2px',
                        padding: '0 20px',
                    }}></div>
            </div>

            <Card style={{ marginBottom: '20px' }}>
                <div>
                    <div className="transcript-header">
                        <h2>Live Transcript</h2>
                        <button id="clearBtn" className="glass-button" onClick={clearTranscript}>
                            <span>Clear</span>
                        </button>
                    </div>
                    <div
                        id="transcript"
                        ref={transcriptContainerRef}
                        className="transcript-container"
                        style={{
                            background: 'var(--surface-glass)',
                            backdropFilter: 'var(--blur-glass)',
                            WebkitBackdropFilter: 'var(--blur-glass)',
                            border: '1px solid var(--border-glass)',
                            borderRadius: '12px',
                            padding: '20px',
                            minHeight: '300px',
                            maxHeight: '500px',
                            overflowY: 'auto',
                            fontFamily: "'SF Mono', Monaco, 'Cascadia Code', monospace",
                            fontSize: '14px',
                            lineHeight: '2',
                            whiteSpace: 'pre-line',
                        }}>
                        <div
                            className="transcript-empty"
                            style={{
                                color: 'var(--text-secondary)',
                                textAlign: 'center',
                                padding: '40px',
                            }}>
                            Transcript will appear here...
                        </div>
                    </div>
                </div>
            </Card>

            <Card>
                <StatsGrid
                    stats={[
                        { label: 'Duration', value: formatDuration(duration * 1000), icon: '⏱️' },
                        { label: 'Data Sent', value: formatBytes(totalBytes), icon: '📊' },
                        { label: 'Audio Chunks', value: formatNumber(audioChunksSent), icon: '🎵' },
                        { label: 'Tokens', value: formatNumber(totalTokens), icon: '🔤' },
                        { label: 'Cost', value: formatCurrency(cost), icon: '💰' },
                    ]}
                    columns={4}
                />
            </Card>

            {showCodeModal && (
                <CodeModal
                    isOpen={showCodeModal}
                    onClose={() => setShowCodeModal(false)}
                    title="Generated Code"
                    tabs={[
                        { id: 'server', label: 'Server Code', code: generateCode().server },
                        { id: 'client', label: 'Client Code', code: generateCode().client },
                    ]}
                />
            )}
        </div>
    );
};

export default ListenDemo;
