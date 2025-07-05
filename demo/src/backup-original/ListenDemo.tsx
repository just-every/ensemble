import React, { useState, useEffect, useRef } from 'react';
import useWebSocket, { ReadyState } from 'react-use-websocket';
import './components/style.scss';
import ConnectionWarning from './components/ConnectionWarning';

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
    const [activeCodeTab, setActiveCodeTab] = useState<'server' | 'client'>('server');
    const [hasAttemptedConnection, setHasAttemptedConnection] = useState(false);

    // Refs
    const mediaStreamRef = useRef<MediaStream | null>(null);
    const audioContextRef = useRef<AudioContext | null>(null);
    const processorRef = useRef<ScriptProcessorNode | null>(null);
    const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
    const analyserRef = useRef<AnalyserNode | null>(null);
    const visualizerBarsRef = useRef<HTMLDivElement[]>([]);
    const startTimeRef = useRef<number | null>(null);
    const animationFrameRef = useRef<number | null>(null);
    const durationIntervalRef = useRef<NodeJS.Timeout | null>(null);
    const shouldVisualizeRef = useRef<boolean>(false);

    // WebSocket configuration
    const socketUrl = 'ws://localhost:3003';
    const { sendMessage, lastMessage, readyState, getWebSocket } = useWebSocket(isRecording ? socketUrl : null, {
        shouldReconnect: () => true,
        reconnectAttempts: 10,
        reconnectInterval: 3000,
    });

    // Handle WebSocket connection status
    useEffect(() => {
        if (!isRecording) {
            setConnectionStatus('disconnected');
            return;
        }

        switch (readyState) {
            case ReadyState.CONNECTING:
                setConnectionStatus('connecting');
                break;
            case ReadyState.OPEN:
                setConnectionStatus('connected');
                sendMessage(
                    JSON.stringify({
                        type: 'start',
                        model: selectedModel,
                    })
                );
                break;
            case ReadyState.CLOSING:
            case ReadyState.CLOSED:
                setConnectionStatus('disconnected');
                break;
        }
    }, [readyState, isRecording, selectedModel, sendMessage]);

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

    // Update duration timer
    useEffect(() => {
        if (isRecording && startTimeRef.current) {
            durationIntervalRef.current = setInterval(() => {
                const elapsed = Math.floor((Date.now() - startTimeRef.current!) / 1000);
                setDuration(elapsed);
            }, 1000);
        } else {
            if (durationIntervalRef.current) {
                clearInterval(durationIntervalRef.current);
                durationIntervalRef.current = null;
            }
        }

        return () => {
            if (durationIntervalRef.current) {
                clearInterval(durationIntervalRef.current);
            }
        };
    }, [isRecording]);

    const handleServerMessage = (data: {
        type: string;
        delta?: string;
        text?: string;
        error?: string;
        message?: string;
        usage?: {
            total_tokens?: number;
            input_tokens?: number;
            output_tokens?: number;
        };
    }) => {
        switch (data.type) {
            case 'transcription_start':
                console.log('Transcription started');
                break;

            case 'transcription_turn_delta':
                appendTranscript(data.delta || '', 'preview');
                break;

            case 'transcription_turn_complete':
                console.log('Turn complete:', data.text);
                appendTranscript(data.text || '');
                appendTranscript('\n--- Turn Complete ---\n');
                break;

            case 'cost_update':
                if (data.usage) {
                    setTotalTokens(data.usage.total_tokens || 0);
                    const inputCost = ((data.usage.input_tokens || 0) * 0.2) / 1_000_000;
                    const outputCost = ((data.usage.output_tokens || 0) * 0.8) / 1_000_000;
                    setCost(inputCost + outputCost);
                }
                break;

            case 'transcription_complete':
                console.log('Transcription complete:', data.text);
                break;

            case 'error':
                showError(data.error || 'Unknown error');
                break;

            case 'status':
                console.log('Server status:', data.message);
                break;
        }
    };

    const appendTranscript = (text: string, type: 'default' | 'preview' = 'default') => {
        const container = document.getElementById('transcript');
        if (!container) return;

        // Remove empty state message if present
        const emptyMsg = container.querySelector('.transcript-empty');
        if (emptyMsg) {
            emptyMsg.remove();
        }

        // Check if we can append to existing preview line
        if (type === 'preview') {
            const lastLine = container.lastElementChild;
            if (lastLine && lastLine.classList.contains('preview')) {
                // Append to existing preview line
                lastLine.textContent = (lastLine.textContent || '') + text;
                setTranscript(prev => prev + text);
                container.scrollTop = container.scrollHeight;
                return;
            }
        }

        // Add new transcript line
        const line = document.createElement('div');
        line.className = type === 'preview' ? 'transcript-line preview' : 'transcript-line';
        line.textContent = text;
        container.appendChild(line);

        // Update full transcript
        setTranscript(prev => prev + text);

        // Auto-scroll to bottom
        container.scrollTop = container.scrollHeight;
    };

    const startRecording = async () => {
        try {
            setConnectionStatus('connecting');

            // Get microphone access
            mediaStreamRef.current = await navigator.mediaDevices.getUserMedia({
                audio: {
                    channelCount: 1,
                    sampleRate: 16000,
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true,
                },
            });

            // Only mark connection attempt after mic is granted
            setHasAttemptedConnection(true);
            setIsRecording(true);
            startTimeRef.current = Date.now();
            setError(null);
            shouldVisualizeRef.current = true;

            // Start audio capture
            await startAudioCapture();
        } catch (error) {
            console.error('Failed to start recording:', error);
            showError((error as Error).message || 'Failed to access microphone');
            setConnectionStatus('error');
        }
    };

    const startAudioCapture = async () => {
        if (!mediaStreamRef.current) return;

        audioContextRef.current = new AudioContext({
            sampleRate: 16000,
            latencyHint: 'interactive',
        });

        sourceRef.current = audioContextRef.current.createMediaStreamSource(mediaStreamRef.current);

        // Create analyser for visualization
        analyserRef.current = audioContextRef.current.createAnalyser();
        analyserRef.current.fftSize = 512; // Higher for better frequency resolution
        analyserRef.current.smoothingTimeConstant = 0.8; // More smoothing for frequency display
        analyserRef.current.minDecibels = -70; // Less sensitive to quiet sounds
        analyserRef.current.maxDecibels = -20; // More headroom for loud sounds

        // Create script processor
        processorRef.current = audioContextRef.current.createScriptProcessor(1024, 1, 1);

        processorRef.current.onaudioprocess = e => {
            const ws = getWebSocket();
            if (ws && ws.readyState === WebSocket.OPEN) {
                const float32Audio = e.inputBuffer.getChannelData(0);
                const int16Audio = convertFloat32ToInt16(float32Audio);

                // Send audio data as binary
                ws.send(int16Audio.buffer);
                setTotalBytes(prev => prev + int16Audio.buffer.byteLength);
            }
        };

        // Connect audio pipeline: source -> analyser -> processor -> destination
        sourceRef.current.connect(analyserRef.current);
        analyserRef.current.connect(processorRef.current);
        processorRef.current.connect(audioContextRef.current.destination);

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

        // Start visualization
        visualize();
    };

    const convertFloat32ToInt16 = (float32Array: Float32Array): Int16Array => {
        const int16Array = new Int16Array(float32Array.length);
        for (let i = 0; i < float32Array.length; i++) {
            const s = Math.max(-1, Math.min(1, float32Array[i]));
            int16Array[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
        }
        return int16Array;
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
        setIsRecording(false);
        setHasAttemptedConnection(false);
        shouldVisualizeRef.current = false;
        cleanup();
    };

    const cleanup = () => {
        // Reset visualizer bars
        visualizerBarsRef.current.forEach(bar => {
            bar.style.height = '4px';
        });

        // Stop animation
        if (animationFrameRef.current) {
            cancelAnimationFrame(animationFrameRef.current);
            animationFrameRef.current = null;
        }

        // Stop audio
        if (processorRef.current) {
            processorRef.current.disconnect();
            processorRef.current = null;
        }

        if (sourceRef.current) {
            sourceRef.current.disconnect();
            sourceRef.current = null;
        }

        if (analyserRef.current) {
            analyserRef.current.disconnect();
            analyserRef.current = null;
        }

        if (audioContextRef.current) {
            audioContextRef.current.close();
            audioContextRef.current = null;
        }

        if (mediaStreamRef.current) {
            mediaStreamRef.current.getTracks().forEach(track => track.stop());
            mediaStreamRef.current = null;
        }

        setConnectionStatus('disconnected');
    };

    const clearTranscript = () => {
        setTranscript('');
        const container = document.getElementById('transcript');
        if (container) {
            container.innerHTML = '<div class="transcript-empty">Transcript will appear here...</div>';
        }
    };

    const showError = (message: string) => {
        setError(message);
        setTimeout(() => setError(null), 5000);
    };

    const formatDuration = (seconds: number): string => {
        const minutes = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${minutes}:${secs.toString().padStart(2, '0')}`;
    };

    const generateServerCode = (): string => {
        return `#!/usr/bin/env node
// Real-time transcription server using ensembleListen
// Model: ${selectedModel}

import dotenv from 'dotenv';
import express from 'express';
import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import { ensembleListen } from '@just-every/ensemble';

dotenv.config();

const app = express();
const server = createServer(app);
const PORT = process.env.PORT || 3003;

// Serve static files
app.use(express.static('public'));

// WebSocket server for real-time audio streaming
const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
    console.log('Client connected for transcription');
    let transcriptionStream = null;

    ws.on('message', async (data) => {
        try {
            // Handle text messages (commands)
            if (data.toString().length < 1000) {
                const message = JSON.parse(data.toString());

                if (message.type === 'start') {
                    console.log('Starting transcription with model:', message.model);

                    // Start the transcription stream
                    transcriptionStream = ensembleListen({
                        model: message.model || '${selectedModel}',
                        language: 'en'
                    });

                    // Forward all transcription events to the client
                    for await (const event of transcriptionStream) {
                        ws.send(JSON.stringify(event));
                    }
                }
            } else {
                // Handle binary audio data
                if (transcriptionStream) {
                    // Send audio data to the transcription stream
                    transcriptionStream.sendAudio(data);
                }
            }
        } catch (error) {
            console.error('Transcription error:', error);
            ws.send(JSON.stringify({
                type: 'error',
                error: error.message
            }));
        }
    });

    ws.on('error', (error) => {
        console.error('WebSocket error:', error);
    });

    ws.on('close', () => {
        console.log('Client disconnected');
        if (transcriptionStream) {
            transcriptionStream.close();
        }
    });

    // Send connection confirmation
    ws.send(JSON.stringify({
        type: 'connected',
        message: 'Transcription server ready'
    }));
});

server.listen(PORT, () => {
    console.log(\`Transcription server running on port \${PORT}\`);
    console.log(\`WebSocket: ws://localhost:\${PORT}\`);
});`;
    };

    const generateClientCode = (): string => {
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Real-time Transcription - ${selectedModel}</title>
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
        h1 { color: #333; margin-bottom: 20px; }
        .controls {
            display: flex;
            gap: 12px;
            margin-bottom: 20px;
        }
        button {
            background: #1a73e8;
            color: white;
            border: none;
            padding: 12px 24px;
            border-radius: 8px;
            font-size: 16px;
            cursor: pointer;
            transition: background 0.2s;
        }
        button:hover { background: #1557b0; }
        button:disabled { opacity: 0.5; cursor: not-allowed; }
        button.stop { background: #ea4335; }
        button.stop:hover { background: #d33b2c; }
        #transcript {
            background: #f8f9fa;
            border-radius: 8px;
            padding: 20px;
            min-height: 200px;
            font-family: monospace;
            font-size: 14px;
            line-height: 1.6;
            white-space: pre-wrap;
            overflow-y: auto;
            border: 1px solid #e0e0e0;
        }
        #status {
            margin-top: 15px;
            padding: 10px;
            border-radius: 6px;
            font-weight: 500;
        }
        .status-connected { background: #e6f4ea; color: #1e8e3e; }
        .status-error { background: #fce8e6; color: #d93025; }
        .status-info { background: #e8f0fe; color: #1a73e8; }
        .audio-bar {
            width: 3px;
            background: #1a73e8;
            border-radius: 2px;
            transition: height 0.1s ease;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>Real-time Transcription</h1>
        <p>Model: ${selectedModel}</p>

        <div class="controls">
            <button id="startBtn" onclick="startRecording()">Start Recording</button>
            <button id="stopBtn" style="display: none;" onclick="stopRecording()" class="stop">Stop Recording</button>
        </div>

        <div id="status" class="status-info">Ready to record</div>

        <div id="audioVisualizer" style="display: none; height: 120px; background: #f0f0f0; border-radius: 8px; margin: 20px 0; position: relative;">
            <div id="visualizer" style="display: flex; align-items: center; justify-content: center; height: 100%; gap: 2px; padding: 0 20px;"></div>
        </div>

        <h3>Transcript:</h3>
        <div id="transcript">Transcript will appear here...</div>
    </div>

    <script>
        let ws = null;
        let mediaRecorder = null;
        let audioContext = null;
        let processor = null;
        let source = null;
        let analyser = null;
        let visualizerBars = [];
        let isRecording = false;
        let animationId = null;

        // Create visualizer bars
        function createVisualizer() {
            const visualizer = document.getElementById('visualizer');
            const barCount = 64;
            
            for (let i = 0; i < barCount; i++) {
                const bar = document.createElement('div');
                bar.className = 'audio-bar';
                bar.style.height = '4px';
                bar.style.flex = '1';
                visualizer.appendChild(bar);
                visualizerBars.push(bar);
            }
        }

        // Connect to WebSocket server
        function connectWebSocket() {
            ws = new WebSocket('ws://localhost:3003');
            ws.binaryType = 'arraybuffer';

            ws.onopen = () => {
                console.log('Connected to server');
                updateStatus('Connected - Speak into your microphone', 'status-connected');
                
                // Send start message
                ws.send(JSON.stringify({
                    type: 'start',
                    model: '${selectedModel}'
                }));
            };

            ws.onmessage = (event) => {
                const data = JSON.parse(event.data);
                handleServerMessage(data);
            };

            ws.onerror = (error) => {
                console.error('WebSocket error:', error);
                updateStatus('Connection error', 'status-error');
            };

            ws.onclose = () => {
                console.log('Disconnected from server');
                updateStatus('Disconnected', 'status-info');
            };
        }

        // Handle server messages
        function handleServerMessage(data) {
            const transcript = document.getElementById('transcript');
            
            switch (data.type) {
                case 'transcription_turn_delta':
                    // Append preview text
                    transcript.textContent += data.delta;
                    transcript.scrollTop = transcript.scrollHeight;
                    break;
                    
                case 'transcription_turn_complete':
                    // Add completed turn
                    transcript.textContent += '\n--- Turn Complete ---\n';
                    transcript.scrollTop = transcript.scrollHeight;
                    break;
                    
                case 'error':
                    updateStatus('Error: ' + data.error, 'status-error');
                    break;
            }
        }

        // Update status display
        function updateStatus(text, className) {
            const status = document.getElementById('status');
            status.textContent = text;
            status.className = className;
        }

        // Convert float32 audio to int16
        function convertFloat32ToInt16(float32Array) {
            const int16Array = new Int16Array(float32Array.length);
            for (let i = 0; i < float32Array.length; i++) {
                const s = Math.max(-1, Math.min(1, float32Array[i]));
                int16Array[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
            }
            return int16Array;
        }

        // Visualize audio
        function visualize() {
            if (!analyser || !isRecording) return;

            const dataArray = new Uint8Array(analyser.fftSize);
            analyser.getByteTimeDomainData(dataArray);

            // Update bars
            for (let i = 0; i < visualizerBars.length; i++) {
                const index = Math.floor(i * dataArray.length / visualizerBars.length);
                const value = dataArray[index];
                const amplitude = Math.abs(value - 128);
                const height = Math.max(4, amplitude * 0.8);
                visualizerBars[i].style.height = height + 'px';
            }

            animationId = requestAnimationFrame(visualize);
        }

        // Start recording
        async function startRecording() {
            try {
                updateStatus('Requesting microphone access...', 'status-info');
                
                const stream = await navigator.mediaDevices.getUserMedia({
                    audio: {
                        channelCount: 1,
                        sampleRate: 16000,
                        echoCancellation: true,
                        noiseSuppression: true,
                        autoGainControl: true
                    }
                });

                isRecording = true;
                connectWebSocket();

                // Setup audio processing
                audioContext = new AudioContext({ sampleRate: 16000 });
                source = audioContext.createMediaStreamSource(stream);
                
                // Create analyser for visualization
                analyser = audioContext.createAnalyser();
                analyser.fftSize = 256;
                source.connect(analyser);

                // Create processor
                processor = audioContext.createScriptProcessor(1024, 1, 1);
                processor.onaudioprocess = (e) => {
                    if (ws && ws.readyState === WebSocket.OPEN) {
                        const float32Audio = e.inputBuffer.getChannelData(0);
                        const int16Audio = convertFloat32ToInt16(float32Audio);
                        ws.send(int16Audio.buffer);
                    }
                };

                source.connect(processor);
                processor.connect(audioContext.destination);

                // Show visualizer
                document.getElementById('audioVisualizer').style.display = 'block';
                visualize();

                // Update UI
                document.getElementById('startBtn').style.display = 'none';
                document.getElementById('stopBtn').style.display = 'inline-block';
                document.getElementById('transcript').textContent = '';

            } catch (error) {
                console.error('Error starting recording:', error);
                updateStatus('Failed to access microphone', 'status-error');
            }
        }

        // Stop recording
        function stopRecording() {
            isRecording = false;

            // Stop audio
            if (processor) {
                processor.disconnect();
                processor = null;
            }
            if (source) {
                source.disconnect();
                source = null;
            }
            if (audioContext) {
                audioContext.close();
                audioContext = null;
            }

            // Stop animation
            if (animationId) {
                cancelAnimationFrame(animationId);
            }

            // Close WebSocket
            if (ws) {
                ws.close();
                ws = null;
            }

            // Hide visualizer
            document.getElementById('audioVisualizer').style.display = 'none';

            // Update UI
            document.getElementById('startBtn').style.display = 'inline-block';
            document.getElementById('stopBtn').style.display = 'none';
            updateStatus('Recording stopped', 'status-info');
        }

        // Initialize
        createVisualizer();
    </script>
</body>
</html>`;
    };

    return (
        <div className="container">
            {/* Header section above everything */}
            <div className="header-card">
                <div className="header-row">
                    <h1>
                        <svg width="32" height="32" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M12 15c1.66 0 3-1.34 3-3V6c0-1.66-1.34-3-3-3S9 4.34 9 6v6c0 1.66 1.34 3 3 3z" />
                            <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z" />
                        </svg>
                        Ensemble Listen Demo
                    </h1>
                    <button className="glass-button" onClick={() => setShowCodeModal(true)}>
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M9.4 16.6L4.8 12l4.6-4.6L8 6l-6 6 6 6 1.4-1.4zm5.2 0l4.6-4.6-4.6-4.6L16 6l6 6-6 6-1.4-1.4z" />
                        </svg>
                        <span>Show Code</span>
                    </button>
                </div>
            </div>

            {/* Connection warning - only show if connection was attempted */}
            {hasAttemptedConnection && <ConnectionWarning readyState={readyState} port={3003} delay={2000} />}

            {/* Main content */}
            <div className="card">
                <div className="status-section">
                    <div className="control-header">
                        <div id="status" className={`status ${connectionStatus}`}>
                            <span className="status-indicator"></span>
                            <span className="status-text">
                                {connectionStatus === 'connected'
                                    ? 'Connected - Speak into your microphone'
                                    : connectionStatus === 'connecting'
                                      ? 'Connecting...'
                                      : connectionStatus === 'error'
                                        ? 'Connection error'
                                        : 'Disconnected'}
                            </span>
                        </div>

                        <select
                            id="modelSelect"
                            className="model-select"
                            value={selectedModel}
                            onChange={e => setSelectedModel(e.target.value)}
                            disabled={isRecording}>
                            <optgroup label="OpenAI Models">
                                <option value="gpt-4o-transcribe">GPT-4o Transcribe (Streaming)</option>
                                <option value="gpt-4o-mini-transcribe">GPT-4o Mini Transcribe (Streaming)</option>
                                <option value="whisper-1">Whisper-1 (Complete at once)</option>
                            </optgroup>
                            <optgroup label="Gemini Models">
                                <option value="gemini-live-2.5-flash-preview">Gemini Live 2.5 Flash Preview</option>
                                <option value="gemini-2.0-flash-live-001">Gemini 2.0 Flash Live</option>
                            </optgroup>
                        </select>

                        <div className="controls">
                            {!isRecording ? (
                                <button
                                    id="connectBtn"
                                    className="primary-btn"
                                    onClick={startRecording}
                                    disabled={connectionStatus === 'connecting'}>
                                    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                                        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" />
                                    </svg>
                                    <span>{connectionStatus === 'connecting' ? 'Connecting...' : 'Connect'}</span>
                                </button>
                            ) : (
                                <button id="stopBtn" className="danger-btn" onClick={stopRecording}>
                                    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                                        <path d="M6 6h12v12H6z" />
                                    </svg>
                                    <span>Stop</span>
                                </button>
                            )}
                        </div>
                    </div>
                </div>

                <div className="audio-visualizer" id="audioVisualizer">
                    <div
                        id="visualizer"
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            height: '100%',
                            width: '100%',
                            gap: '2px',
                            padding: '0 20px',
                        }}></div>
                </div>

                <div className="transcript-section">
                    <div className="transcript-header">
                        <h2>Live Transcript</h2>
                        <button id="clearBtn" className="glass-button" onClick={clearTranscript}>
                            <span>Clear</span>
                        </button>
                    </div>
                    <div id="transcript" className="transcript-container">
                        <div className="transcript-empty">Transcript will appear here...</div>
                    </div>
                </div>

                <div className="stats-grid">
                    <div className="stat-card">
                        <div className="stat-value" id="duration">
                            {formatDuration(duration)}
                        </div>
                        <div className="stat-label">Duration</div>
                    </div>
                    <div className="stat-card">
                        <div className="stat-value" id="dataSize">
                            {(totalBytes / 1024).toFixed(1)} KB
                        </div>
                        <div className="stat-label">Audio Data</div>
                    </div>
                    <div className="stat-card">
                        <div className="stat-value" id="tokenCount">
                            {totalTokens.toLocaleString()}
                        </div>
                        <div className="stat-label">Tokens Used</div>
                    </div>
                    <div className="stat-card">
                        <div className="stat-value" id="cost">
                            ${cost.toFixed(4)}
                        </div>
                        <div className="stat-label">Estimated Cost</div>
                    </div>
                </div>

                <div id="errorContainer">
                    {error && (
                        <div className="error-message">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z" />
                            </svg>
                            {error}
                        </div>
                    )}
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
                                    className="glass-button"
                                    style={{
                                        position: 'absolute',
                                        top: '12px',
                                        right: '12px',
                                        padding: '6px 12px',
                                        fontSize: '12px',
                                    }}
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
                                    <span>Copy</span>
                                </button>
                                <pre>{generateServerCode()}</pre>
                            </div>
                            <div
                                className="code-container"
                                style={{ display: activeCodeTab === 'client' ? 'block' : 'none' }}>
                                <button
                                    className="glass-button"
                                    style={{
                                        position: 'absolute',
                                        top: '12px',
                                        right: '12px',
                                        padding: '6px 12px',
                                        fontSize: '12px',
                                    }}
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
                                    <span>Copy</span>
                                </button>
                                <pre>{generateClientCode()}</pre>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default ListenDemo;
