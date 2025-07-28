import { useState, useCallback, useEffect, useRef } from 'react';
import { REQUEST_WS_URL } from './config/websocket';
import {
    ShowCodeButton,
    formatNumber,
    formatCurrency,
    Conversation,
    ConversationInput,
    DemoHeader,
    CodeModal,
    generateRequestCode,
    generateHTMLDemo,
    Header,
    HeaderTab,
    useTaskState,
    LLMRequestLog,
} from '@just-every/demo-ui';
import './RequestDemo.scss';

type TabType = 'conversation' | 'requests';

interface RequestEvent {
    type: string;
    connectionId?: string;
    models?: unknown;
    request_id?: string;
    error?: string;
    [key: string]: unknown;
}

// Example prompts
const examples = {
    weather: {
        icon: '☀️',
        text: "What's the weather like in Tokyo, London, and New York? Compare the temperatures.",
        label: 'Ask about weather',
    },
    math: {
        icon: '🧮',
        text: 'Calculate the following: (15 * 23) + (sqrt(144) / 3) - 78. Show your work step by step.',
        label: 'Solve math problem',
    },
    search: {
        icon: '🔍',
        text: 'Search for information about quantum computing and its potential applications in medicine.',
        label: 'Search for information',
    },
    code: {
        icon: '💻',
        text: 'Write a Python function that implements binary search on a sorted array. Include comments and example usage.',
        label: 'Write some code',
    },
    creative: {
        icon: '✨',
        text: 'Write a short story about a robot who discovers it can dream. Make it philosophical and touching.',
        label: 'Creative writing',
    },
};

export default function RequestDemo() {
    const [selectedExample, setSelectedExample] = useState<string>('');
    const [customPrompt, setCustomPrompt] = useState(
        'Please write a short story about an ensemble playing in the current weather in New York.'
    );
    const [activeTab, setActiveTab] = useState<TabType>('conversation');
    const [showCodeModal, setShowCodeModal] = useState(false);
    const [showIntro, setShowIntro] = useState(true);
    const [showAdvanced, setShowAdvanced] = useState(false);

    // Settings
    const [selectedModelClass, setSelectedModelClass] = useState('');
    const [enableTools, setEnableTools] = useState(true);
    const [temperature, setTemperature] = useState(1.0);
    const [availableModelClasses, setAvailableModelClasses] = useState<string[]>([]);

    const [isConnected, setIsConnected] = useState(false);
    const [isReconnecting, setIsReconnecting] = useState(false);
    const [showConnectionWarning, setShowConnectionWarning] = useState(false);
    const [taskStatus, setTaskStatus] = useState<'idle' | 'running' | 'completed' | 'error'>('idle');
    const [, setTaskError] = useState<string | undefined>();
    const wsRef = useRef<WebSocket | null>(null);
    const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const connectionWarningTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const reconnectAttemptsRef = useRef(0);
    const maxReconnectAttempts = 10;
    const baseReconnectDelay = 1000; // Start with 1 second
    const connectionWarningDelay = 3000; // Show warning after 3 seconds

    const { state: taskState, processEvent } = useTaskState();

    // Process WebSocket event
    const processRequestEvent = useCallback(
        (data: RequestEvent) => {
            switch (data.type) {
                case 'connected':
                    console.log('Connected with ID:', data.connectionId);
                    // We're not using individual model selection anymore
                    // if (data.models) {
                    //     const modelNames = Array.isArray(data.models)
                    //         ? data.models.map((m: any) => typeof m === 'object' ? m.id : m)
                    //         : data.models
                    //     const uniqueModels = Array.from(new Set(modelNames)) as string[]
                    //     setAvailableModels(uniqueModels)
                    // }
                    if (data.modelClasses) {
                        const classes = Array.isArray(data.modelClasses)
                            ? data.modelClasses.map((cls: unknown) =>
                                  typeof cls === 'object' && cls !== null && 'id' in cls
                                      ? (cls as { id: string }).id
                                      : cls
                              )
                            : data.modelClasses;
                        setAvailableModelClasses(Array.from(new Set(classes)) as string[]);
                        if (!selectedModelClass && classes.includes('standard')) {
                            setSelectedModelClass('standard');
                        }
                    }
                    break;

                case 'stream_start':
                    setTaskStatus('running');
                    setShowIntro(false);
                    // TODO: Handle message creation properly
                    // const newMessage: MessageData = {
                    //     role: 'assistant',
                    //     content: '',
                    //     model: data.model,
                    //     streaming: true,
                    //     tools: [],
                    // }
                    // setTaskState(prev => ({
                    //     ...prev,
                    //     isStreaming: true,
                    //     currentMessage: newMessage,
                    //     messages: [...prev.messages, newMessage],
                    // }))
                    break;

                case 'message_delta':
                    // The processEvent function will handle message updates
                    break;

                case 'tool_start':
                    // The processEvent function will handle tool tracking
                    break;

                case 'tool_done':
                    // The processEvent function will handle tool results
                    break;

                case 'follow_up_suggestion':
                    // The processEvent function will handle follow-up suggestions
                    break;

                case 'stream_end':
                case 'stream_complete':
                    // Just update the task status, processEvent handles the rest
                    setTaskStatus('completed');
                    break;

                case 'cost_update':
                    // The processEvent function will handle cost updates
                    break;

                case 'agent_start':
                    // The processEvent function will handle agent tracking
                    break;

                case 'error':
                    setTaskStatus('error');
                    setTaskError(data.error || 'Unknown error occurred');
                    // The processEvent function will handle cleanup
                    break;
            }
        },
        [selectedModelClass]
    );

    // WebSocket connection management
    const connectWebSocket = useCallback(() => {
        // Close existing connection if any
        if (wsRef.current) {
            wsRef.current.close();
            wsRef.current = null;
        }

        // Show connection warning after delay on first attempt, or immediately after 2 failed attempts
        if (reconnectAttemptsRef.current >= 2) {
            setShowConnectionWarning(true);
        } else if (reconnectAttemptsRef.current === 0 && !connectionWarningTimeoutRef.current) {
            connectionWarningTimeoutRef.current = setTimeout(() => {
                setShowConnectionWarning(true);
            }, connectionWarningDelay);
        }

        try {
            const ws = new WebSocket(REQUEST_WS_URL);

            ws.onopen = () => {
                console.log('WebSocket connected successfully');
                setIsConnected(true);
                setIsReconnecting(false);
                setShowConnectionWarning(false);
                setTaskError(undefined);
                reconnectAttemptsRef.current = 0; // Reset reconnect attempts on successful connection

                // Clear connection warning timeout
                if (connectionWarningTimeoutRef.current) {
                    clearTimeout(connectionWarningTimeoutRef.current);
                    connectionWarningTimeoutRef.current = null;
                }
            };

            ws.onmessage = event => {
                try {
                    const data = JSON.parse(event.data);
                    processEvent(data);
                    processRequestEvent(data);
                } catch (error) {
                    console.error('Error processing WebSocket message:', error);
                }
            };

            ws.onerror = error => {
                console.error('WebSocket connection error:', error);
                setIsConnected(false);
                setTaskStatus('error');
                setTaskError('WebSocket connection error');
            };

            ws.onclose = () => {
                console.log('WebSocket disconnected');
                setIsConnected(false);
                wsRef.current = null;

                // Attempt reconnection with exponential backoff
                if (reconnectAttemptsRef.current < maxReconnectAttempts) {
                    reconnectAttemptsRef.current++;
                    const delay = Math.min(baseReconnectDelay * Math.pow(2, reconnectAttemptsRef.current - 1), 30000); // Cap at 30 seconds
                    console.log(
                        `Reconnecting in ${delay}ms (attempt ${reconnectAttemptsRef.current}/${maxReconnectAttempts})`
                    );
                    setIsReconnecting(true);

                    reconnectTimeoutRef.current = setTimeout(() => {
                        connectWebSocket();
                    }, delay);
                } else {
                    setIsReconnecting(false);
                }
            };

            wsRef.current = ws;
        } catch (error) {
            console.error('Failed to connect WebSocket:', error);
            setIsConnected(false);
            setTaskStatus('error');
            setTaskError('Failed to connect to server');

            // Trigger reconnection on connection failure
            if (reconnectAttemptsRef.current < maxReconnectAttempts) {
                reconnectAttemptsRef.current++;
                const delay = Math.min(baseReconnectDelay * Math.pow(2, reconnectAttemptsRef.current - 1), 30000);
                console.log(
                    `Reconnecting after failure in ${delay}ms (attempt ${reconnectAttemptsRef.current}/${maxReconnectAttempts})`
                );
                setIsReconnecting(true);

                reconnectTimeoutRef.current = setTimeout(() => {
                    connectWebSocket();
                }, delay);
            } else {
                setIsReconnecting(false);
            }
        }
    }, [processEvent, processRequestEvent, connectionWarningDelay]);

    const sendMessage = useCallback(
        (message: string) => {
            if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
                console.error('WebSocket not connected');
                return;
            }

            // The server will send the user message as a response_output event
            // so we don't need to add it manually here

            // Build conversation history
            const conversationHistory = taskState.messages.map(m => {
                const msg = m.message as Record<string, unknown>;
                return {
                    role: (msg.role as string) || (msg.type === 'user' ? 'user' : 'assistant'),
                    content: (msg.content as string) || '',
                };
            });

            // Add the new user message
            conversationHistory.push({ role: 'user', content: message });

            // Send request to WebSocket
            const request = {
                type: 'chat',
                messages: conversationHistory,
                modelClass: selectedModelClass || 'standard',
                toolsEnabled: enableTools,
                temperature,
            };

            wsRef.current.send(JSON.stringify(request));
            setTaskStatus('running');
        },
        [selectedModelClass, enableTools, temperature]
    );

    const stopTask = useCallback(() => {
        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({ type: 'stop' }));
        }
        setTaskStatus('completed');
    }, []);

    // Connect WebSocket on mount
    useEffect(() => {
        connectWebSocket();

        return () => {
            // Clear any pending timeouts
            if (reconnectTimeoutRef.current) {
                clearTimeout(reconnectTimeoutRef.current);
                reconnectTimeoutRef.current = null;
            }
            if (connectionWarningTimeoutRef.current) {
                clearTimeout(connectionWarningTimeoutRef.current);
                connectionWarningTimeoutRef.current = null;
            }
            // Prevent reconnection on unmount
            reconnectAttemptsRef.current = maxReconnectAttempts;
            if (wsRef.current) {
                wsRef.current.close();
                wsRef.current = null;
            }
        };
    }, []); // Remove connectWebSocket dependency to avoid infinite loops

    const handleRunTask = useCallback(() => {
        const prompt = selectedExample || customPrompt;
        if (!prompt) return;
        sendMessage(prompt);
    }, [selectedExample, customPrompt, sendMessage]);

    const handleStop = useCallback(() => {
        stopTask();
    }, [stopTask]);

    // Handle URL routing
    useEffect(() => {
        const path = window.location.pathname.substring(1);
        const validTabs: TabType[] = ['conversation', 'requests'];
        if (validTabs.includes(path as TabType)) {
            setActiveTab(path as TabType);
        }

        const handlePopState = () => {
            const path = window.location.pathname.substring(1);
            if (validTabs.includes(path as TabType)) {
                setActiveTab(path as TabType);
            }
        };

        window.addEventListener('popstate', handlePopState);
        return () => window.removeEventListener('popstate', handlePopState);
    }, []);

    const codeTabs = [
        {
            id: 'typescript',
            label: 'TypeScript',
            language: 'typescript',
            code: generateRequestCode({
                model: selectedModelClass,
                messages: taskState.messages.map(m => {
                    const msg = m.message as Record<string, unknown>;
                    return {
                        role: (msg.role as string) || (msg.type === 'user' ? 'user' : 'assistant'),
                        content: (msg.content as string) || '',
                    };
                }),
                temperature,
                tools: enableTools,
            }),
        },
        {
            id: 'html',
            label: 'HTML + CDN',
            language: 'html',
            code: generateHTMLDemo({
                title: 'Ensemble Demo',
                wsUrl: REQUEST_WS_URL,
                features: enableTools ? ['tools'] : [],
            }),
        },
    ];

    return (
        <div className="container flex flex-col">
            <div
                style={{
                    display: 'flex',
                    height: 'calc(100vh - 85px)',
                    width: '100%',
                    position: 'relative',
                }}>
                {/* Left Sidebar */}
                <div
                    className="sidebar"
                    style={{
                        width: '320px',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '20px',
                        padding: '0 20px 20px 0',
                        height: '100%',
                        overflowY: 'auto',
                        position: 'relative',
                        zIndex: 10,
                    }}>
                    <DemoHeader
                        title="Request"
                        icon={
                            <svg width="32" height="32" viewBox="0 0 512 512" fill="currentColor">
                                <path d="M288 64l0 96-64 0c-35.3 0-64 28.7-64 64l0 64-96 0L64 64l224 0zM64 352l96 0 0 96c0 35.3 28.7 64 64 64l224 0c35.3 0 64-28.7 64-64l0-224c0-35.3-28.7-64-64-64l-96 0 0-96c0-35.3-28.7-64-64-64L64 0C28.7 0 0 28.7 0 64L0 288c0 35.3 28.7 64 64 64zM448 224l0 224-224 0 0-96 64 0c35.3 0 64-28.7 64-64l0-64 96 0z" />
                            </svg>
                        }
                    />

                    {/* Connection Status */}
                    {!isConnected && showConnectionWarning && (
                        <div
                            style={{
                                background: isReconnecting ? 'var(--surface-glass)' : 'rgba(239, 68, 68, 0.1)',
                                border: `1px solid ${isReconnecting ? 'var(--border-glass)' : 'rgba(239, 68, 68, 0.3)'}`,
                                borderRadius: '12px',
                                padding: '12px 16px',
                                marginBottom: '16px',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '12px',
                                fontSize: '14px',
                                color: isReconnecting ? 'var(--text-secondary)' : 'rgba(239, 68, 68, 0.9)',
                            }}>
                            <div
                                style={{
                                    width: '8px',
                                    height: '8px',
                                    borderRadius: '50%',
                                    background: isReconnecting ? 'var(--accent-warning)' : 'var(--accent-error)',
                                    animation: isReconnecting ? 'pulse 2s infinite' : 'none',
                                }}
                            />
                            {isReconnecting
                                ? `Reconnecting... (attempt ${reconnectAttemptsRef.current}/${maxReconnectAttempts})`
                                : 'Not connected to server. Make sure the server is running on port 3005.'}
                        </div>
                    )}

                    {/* Settings Card - moved to top */}
                    <div
                        className="card"
                        style={{
                            background: 'var(--surface-glass)',
                            backdropFilter: 'var(--blur-glass)',
                            WebkitBackdropFilter: 'var(--blur-glass)',
                            border: '1px solid var(--border-glass)',
                            borderRadius: '16px',
                            padding: '24px',
                            boxShadow: 'var(--shadow-glass)',
                        }}>
                        <h2 style={{ marginBottom: '16px', color: 'var(--text)', fontSize: '18px' }}>Settings</h2>

                        <div style={{ marginBottom: '16px' }}>
                            <label
                                className="setting-label"
                                style={{ fontWeight: '500', fontSize: '14px', color: 'var(--text-secondary)' }}>
                                Model Class
                            </label>
                            <select
                                className="glass-select"
                                value={selectedModelClass}
                                onChange={e => setSelectedModelClass(e.target.value)}
                                disabled={!isConnected}
                                style={{
                                    fontSize: '14px',
                                    cursor: isConnected ? 'pointer' : 'not-allowed',
                                    maxWidth: '100%',
                                    opacity: isConnected ? 1 : 0.7,
                                }}>
                                {!isConnected ? (
                                    <option value="">Loading...</option>
                                ) : availableModelClasses.length === 0 ? (
                                    <option value="">No model classes available</option>
                                ) : (
                                    availableModelClasses.map((cls, index) => {
                                        // Format the class name: capitalize and replace underscores
                                        const displayName = String(cls)
                                            .split('_')
                                            .map(word => word.charAt(0).toUpperCase() + word.slice(1))
                                            .join(' ');
                                        return (
                                            <option
                                                key={`${cls}-${index}`}
                                                value={cls}
                                                style={{ background: '#1a1a2e' }}>
                                                {displayName}
                                            </option>
                                        );
                                    })
                                )}
                            </select>
                        </div>

                        <div
                            className="advanced-toggle"
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '8px',
                                padding: '8px',
                                borderRadius: '8px',
                                cursor: 'pointer',
                                transition: 'background 0.3s ease',
                                marginTop: '16px',
                            }}
                            onClick={() => setShowAdvanced(!showAdvanced)}>
                            <span
                                style={{
                                    transform: showAdvanced ? 'rotate(90deg)' : 'rotate(0deg)',
                                    transition: 'transform 0.3s ease',
                                }}>
                                ▶
                            </span>
                            <span style={{ fontWeight: '500', fontSize: '14px' }}>Advanced Settings</span>
                        </div>

                        {showAdvanced && (
                            <div
                                className="advanced-settings"
                                style={{
                                    display: 'flex',
                                    flexDirection: 'column',
                                    gap: '16px',
                                    padding: '16px',
                                    borderRadius: '8px',
                                }}>
                                <div
                                    className="setting-group"
                                    style={{
                                        marginBottom: '20px',
                                    }}>
                                    <label
                                        style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '10px',
                                            cursor: 'pointer',
                                            fontSize: '14px',
                                            color: 'var(--text-secondary)',
                                        }}>
                                        <input
                                            type="checkbox"
                                            checked={enableTools}
                                            onChange={e => setEnableTools(e.target.checked)}
                                            style={{
                                                width: '18px',
                                                height: '18px',
                                                cursor: 'pointer',
                                            }}
                                        />
                                        &nbsp; &nbsp; Enable Tool Calling
                                    </label>
                                </div>

                                <div
                                    className="setting-group"
                                    style={{
                                        display: 'flex',
                                        flexDirection: 'column',
                                        gap: '8px',
                                        marginBottom: '20px',
                                    }}>
                                    <label
                                        className="setting-label"
                                        style={{
                                            fontWeight: '500',
                                            fontSize: '14px',
                                            color: 'var(--text-secondary)',
                                        }}>
                                        Temperature
                                    </label>
                                    <div className="slider-container">
                                        <input
                                            type="range"
                                            min="0"
                                            max="2"
                                            step="0.1"
                                            value={temperature}
                                            onChange={e => setTemperature(parseFloat(e.target.value))}
                                        />
                                        <span className="slider-value">{temperature.toFixed(1)}</span>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* Show Code Button - moved from header */}
                        <div style={{ marginTop: '20px' }}>
                            <div style={{ width: '100%' }}>
                                <ShowCodeButton onClick={() => setShowCodeModal(true)} />
                            </div>
                        </div>
                        {/* Stats Row */}
                        <div
                            style={{
                                display: 'flex',
                                gap: '16px',
                                marginTop: '20px',
                                paddingTop: '20px',
                            }}>
                            <div style={{ flex: 1, textAlign: 'center' }}>
                                <div style={{ fontSize: '24px', fontWeight: '700', color: '#4A9EFF' }}>
                                    {formatNumber(taskState.totalTokens)}
                                </div>
                                <div style={{ fontSize: '12px', color: 'rgba(255, 255, 255, 0.5)', marginTop: '4px' }}>
                                    Tokens
                                </div>
                            </div>
                            <div style={{ flex: 1, textAlign: 'center' }}>
                                <div style={{ fontSize: '24px', fontWeight: '700', color: '#4A9EFF' }}>
                                    {formatCurrency(taskState.totalCost)}
                                </div>
                                <div style={{ fontSize: '12px', color: 'rgba(255, 255, 255, 0.5)', marginTop: '4px' }}>
                                    Cost
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Examples Card */}
                    <div
                        className="card"
                        style={{
                            background: 'var(--surface-glass)',
                            backdropFilter: 'var(--blur-glass)',
                            WebkitBackdropFilter: 'var(--blur-glass)',
                            border: '1px solid var(--border-glass)',
                            borderRadius: '16px',
                            padding: '24px',
                            boxShadow: 'var(--shadow-glass)',
                        }}>
                        <h2 style={{ marginBottom: '16px', color: 'var(--text)', fontSize: '18px' }}>Examples</h2>
                        <div className="examples-section">
                            {Object.entries(examples).map(([key, example]) => (
                                <button
                                    key={key}
                                    className="glass-button"
                                    onClick={() => {
                                        setSelectedExample('');
                                        setCustomPrompt(example.text);
                                    }}
                                    style={{
                                        width: '100%',
                                        marginBottom: '8px',
                                        justifyContent: 'flex-start',
                                    }}>
                                    <span>
                                        {example.icon} &nbsp; {example.label}
                                    </span>
                                </button>
                            ))}
                        </div>
                    </div>
                </div>

                {/* Main Panel - Full Height */}
                <div
                    style={{
                        flex: 1,
                        height: '100%',
                        display: 'flex',
                        flexDirection: 'column',
                        position: 'relative',
                    }}>
                    <div
                        className="card"
                        style={{
                            height: '100%',
                            display: 'flex',
                            flexDirection: 'column',
                            padding: 0,
                            overflow: 'hidden',
                            background: 'var(--surface-glass)',
                            backdropFilter: 'var(--blur-glass)',
                            WebkitBackdropFilter: 'var(--blur-glass)',
                            border: '1px solid var(--border-glass)',
                            borderRadius: '16px',
                            boxShadow: 'var(--shadow-glass)',
                            margin: '20px 0',
                        }}>
                        {/* Header with Tab Navigation */}
                        <Header
                            tabs={
                                [
                                    { id: 'conversation', label: 'Conversation' },
                                    { id: 'requests', label: 'Requests', count: taskState.llmRequests?.length || 0 },
                                ] as HeaderTab[]
                            }
                            activeTab={activeTab}
                            onTabChange={tab => setActiveTab(tab as TabType)}
                        />

                        {/* Main Content Area */}
                        <div
                            style={{
                                flex: 1,
                                display: 'flex',
                                flexDirection: 'column',
                                position: 'relative',
                                overflow: 'hidden',
                                justifyContent: 'space-between',
                            }}>
                            {showIntro && activeTab === 'conversation' ? (
                                <>
                                    <div
                                        style={{
                                            textAlign: 'left',
                                            maxWidth: '800px',
                                            padding: '60px',
                                        }}>
                                        <p
                                            style={{
                                                fontSize: '16px',
                                                color: 'rgba(255, 255, 255, 0.7)',
                                                lineHeight: '1.6',
                                                marginBottom: '12px',
                                            }}>
                                            <strong>@just-every/ensemble</strong> is a unified interface for multiple AI
                                            providers that enables easy chaining of LLM outputs - you can send the
                                            response from one model directly as input to another model from a different
                                            provider seamlessly.
                                        </p>
                                        <p
                                            style={{
                                                fontSize: '16px',
                                                color: 'rgba(255, 255, 255, 0.7)',
                                                lineHeight: '1.6',
                                                marginBottom: '12px',
                                            }}>
                                            The package includes{' '}
                                            <strong style={{ color: '#fff' }}>automatic model selection</strong>{' '}
                                            capabilities, allowing you to specify task-based model classes (like{' '}
                                            <em>"mini"</em> for simple tasks, <em>"large"</em> for complex reasoning)
                                            and let the system choose the optimal model and provider for each specific
                                            use case. It also provides unified APIs for{' '}
                                            <strong style={{ color: '#fff' }}>voice generation</strong>,{' '}
                                            <strong style={{ color: '#fff' }}>speech-to-text transcription</strong>, and{' '}
                                            <strong style={{ color: '#fff' }}>text embeddings</strong> across different
                                            providers.
                                        </p>
                                    </div>
                                </>
                            ) : (
                                <div
                                    style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column' }}>
                                    {activeTab === 'conversation' && (
                                        <div style={{ flex: 1, overflow: 'auto' }}>
                                            <Conversation
                                                taskState={taskState}
                                                isStreaming={taskStatus === 'running'}
                                                emptyMessage="Starting conversation..."
                                            />
                                        </div>
                                    )}

                                    {activeTab === 'requests' && <LLMRequestLog taskState={taskState} />}
                                </div>
                            )}
                        </div>

                        {/* Input Area at Bottom - only show on conversation tab */}
                        {activeTab === 'conversation' && (
                            <div
                                style={{
                                    margin: '0 auto',
                                    padding: '0 20px 10px 20px',
                                    width: '100%',
                                }}>
                                <ConversationInput
                                    value={customPrompt}
                                    onChange={setCustomPrompt}
                                    onSend={handleRunTask}
                                    onStop={handleStop}
                                    isStreaming={taskStatus === 'running'}
                                    placeholder="Type your message here..."
                                    disabled={!isConnected}
                                    style={{
                                        width: '100%',
                                        resize: 'vertical',
                                        minHeight: '100px',
                                        padding: '20px',
                                        maxHeight: '300px',
                                    }}
                                />
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {showCodeModal && (
                <CodeModal isOpen={showCodeModal} onClose={() => setShowCodeModal(false)} tabs={codeTabs} />
            )}
        </div>
    );
}
