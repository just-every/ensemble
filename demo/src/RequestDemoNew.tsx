import { useState, useCallback, useEffect, useRef } from 'react';
import { REQUEST_WS_URL } from './config/websocket';
import {
    Card,
    ShowCodeButton,
    formatNumber,
    formatCurrency,
    Conversation,
    ConversationInput,
    DemoHeader,
    CodeModal,
    generateRequestCode,
    generateHTMLDemo,
    MessageData,
    ModelSelector,
    Header,
    HeaderTab,
    useTaskState,
} from '@just-every/demo-ui';
import './RequestDemo.scss';

type TabType = 'conversation' | 'research' | 'inspiration' | 'design' | 'requests' | 'cognition' | 'memory';

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

export default function RequestDemoNew() {
    const [selectedExample, setSelectedExample] = useState<string>('');
    const [customPrompt, setCustomPrompt] = useState(
        'Please write a short story about an ensemble playing in the current weather in New York.'
    );
    const [activeTab, setActiveTab] = useState<TabType>('conversation');
    const [showCodeModal, setShowCodeModal] = useState(false);
    const [showIntro] = useState(true);
    const [showAdvanced, setShowAdvanced] = useState(false);

    // Settings
    const [selectedModel, setSelectedModel] = useState('');
    const [selectedModelClass, setSelectedModelClass] = useState('standard');
    const [enableTools, setEnableTools] = useState(true);
    const [temperature, setTemperature] = useState(1.0);
    const [availableModels] = useState<string[]>([]);
    const [availableModelClasses] = useState<string[]>([]);

    const [isConnected, setIsConnected] = useState(false);
    const [taskStatus, setTaskStatus] = useState<'idle' | 'running' | 'completed' | 'error'>('idle');
    const [, setTaskError] = useState<string | undefined>();
    const wsRef = useRef<WebSocket | null>(null);

    const { state: taskState, processEvent } = useTaskState();

    // Process WebSocket event
    /*
    const processRequestEvent = useCallback((data: any) => {
        switch (data.type) {
            case 'connected':
                console.log('Connected with ID:', data.connectionId)
                if (data.models) {
                    const modelNames = Array.isArray(data.models)
                        ? data.models.map((m: any) => typeof m === 'object' ? (m.id || m.name || m) : m)
                        : data.models
                    setAvailableModels(Array.from(new Set(modelNames)) as string[])
                }
                if (data.modelClasses) {
                    const classes = Array.isArray(data.modelClasses)
                        ? data.modelClasses.map((cls: any) => typeof cls === 'object' ? (cls.id || cls.name || cls) : cls)
                        : data.modelClasses
                    setAvailableModelClasses(Array.from(new Set(classes)) as string[])
                    if (!selectedModelClass && classes.includes('standard')) {
                        setSelectedModelClass('standard')
                    }
                }
                break

            case 'stream_start':
                setTaskStatus('running')
                setShowIntro(false)
                const newMessage: MessageData = {
                    role: 'assistant',
                    content: '',
                    model: data.model,
                    streaming: true,
                    tools: [],
                }
                setTaskState(prev => ({
                    ...prev,
                    isStreaming: true,
                    currentMessage: newMessage,
                    messages: [...prev.messages, newMessage],
                }))
                break

            case 'message_delta':
                setTaskState(prev => {
                    if (!prev.currentMessage) return prev
                    const updatedMessage = { ...prev.currentMessage }

                    if (data.thinking_content) {
                        updatedMessage.thinking_content = (updatedMessage.thinking_content || '') + data.thinking_content
                    }
                    if (data.content) {
                        updatedMessage.content = (updatedMessage.content || '') + data.content
                    }

                    const messages = [...prev.messages]
                    messages[messages.length - 1] = updatedMessage

                    return {
                        ...prev,
                        currentMessage: updatedMessage,
                        messages,
                    }
                })
                break

            case 'tool_start':
                if (data.tool_call) {
                    setTaskState(prev => {
                        if (!prev.currentMessage) return prev
                        const updatedMessage = { ...prev.currentMessage }
                        updatedMessage.tools = [...(updatedMessage.tools || []), {
                            id: data.tool_call.id,
                            function: {
                                name: data.tool_call.function.name,
                                arguments: data.tool_call.function.arguments || '{}',
                            },
                            result: undefined,
                        }]

                        const messages = [...prev.messages]
                        messages[messages.length - 1] = updatedMessage

                        return {
                            ...prev,
                            currentMessage: updatedMessage,
                            messages,
                        }
                    })
                }
                break

            case 'tool_done':
                if (data.tool_call && data.result) {
                    setTaskState(prev => {
                        if (!prev.currentMessage) return prev
                        const updatedMessage = { ...prev.currentMessage }
                        const toolIndex = updatedMessage.tools?.findIndex(t => t.id === data.tool_call.id)

                        if (toolIndex !== undefined && toolIndex >= 0 && updatedMessage.tools) {
                            updatedMessage.tools[toolIndex] = {
                                ...updatedMessage.tools[toolIndex],
                                result: {
                                    output: data.result.output || data.result.error || 'No output',
                                },
                            }
                        }

                        const messages = [...prev.messages]
                        messages[messages.length - 1] = updatedMessage

                        return {
                            ...prev,
                            currentMessage: updatedMessage,
                            messages,
                        }
                    })
                }
                break

            case 'follow_up_suggestion':
                if (data.suggestion && taskState.currentMessage) {
                    setTaskState(prev => {
                        if (!prev.currentMessage) return prev
                        const updatedMessage = { ...prev.currentMessage }
                        updatedMessage.followUpSuggestions = [
                            ...(updatedMessage.followUpSuggestions || []),
                            data.suggestion,
                        ]

                        const messages = [...prev.messages]
                        messages[messages.length - 1] = updatedMessage

                        return {
                            ...prev,
                            currentMessage: updatedMessage,
                            messages,
                        }
                    })
                }
                break

            case 'stream_end':
            case 'stream_complete':
                setTaskState(prev => ({
                    ...prev,
                    isStreaming: false,
                    currentMessage: null,
                }))
                setTaskStatus('completed')
                break

            case 'cost_update':
                if (data.usage) {
                    setTaskState(prev => {
                        // Update total stats
                        const newState = {
                            ...prev,
                            totalTokens: prev.totalTokens + (data.usage.total_tokens || 0),
                            totalCost: prev.totalCost + (data.usage.cost || 0),
                        }

                        // Update the latest request's stats if it exists
                        if (data.request_id && newState.llmRequests.length > 0) {
                            const requestIndex = newState.llmRequests.findIndex(r => r.id === data.request_id)
                            if (requestIndex >= 0) {
                                newState.llmRequests[requestIndex] = {
                                    ...newState.llmRequests[requestIndex],
                                    tokens: (newState.llmRequests[requestIndex].tokens || 0) + (data.usage.total_tokens || 0),
                                    cost: (newState.llmRequests[requestIndex].cost || 0) + (data.usage.cost || 0),
                                }
                            }
                        }

                        return newState
                    })
                }
                break

            case 'agent_start':
                // Track LLM request and update current message model info
                if (data.agent && taskState.currentMessage) {
                    setTaskState(prev => {
                        const updatedMessage = prev.currentMessage ? {
                            ...prev.currentMessage,
                            model: data.agent.model,
                            modelClass: data.agent.modelClass,
                        } : null

                        const messages = updatedMessage ? [...prev.messages] : prev.messages
                        if (updatedMessage && messages.length > 0) {
                            messages[messages.length - 1] = updatedMessage
                        }

                        return {
                            ...prev,
                            currentMessage: updatedMessage,
                            messages,
                            llmRequests: [...prev.llmRequests, {
                                id: data.request_id,
                                model: data.agent?.model,
                                modelClass: data.agent?.modelClass,
                                timestamp: new Date().toISOString(),
                                input: data.input,
                                tokens: 0,
                                cost: 0,
                            }],
                        }
                    })
                } else {
                    setTaskState(prev => ({
                        ...prev,
                        llmRequests: [...prev.llmRequests, {
                            id: data.request_id,
                            model: data.agent?.model,
                            modelClass: data.agent?.modelClass,
                            timestamp: new Date().toISOString(),
                            input: data.input,
                            tokens: 0,
                            cost: 0,
                        }],
                    }))
                }
                break

            case 'error':
                setTaskStatus('error')
                setTaskError(data.error || 'Unknown error occurred')
                setTaskState(prev => ({
                    ...prev,
                    isStreaming: false,
                    currentMessage: null,
                }))
                break
        }
    }, [selectedModelClass])
    */

    // WebSocket connection management
    const connectWebSocket = useCallback(() => {
        // Close existing connection if any
        if (wsRef.current) {
            wsRef.current.close();
            wsRef.current = null;
        }

        try {
            const ws = new WebSocket(REQUEST_WS_URL);

            ws.onopen = () => {
                console.log('WebSocket connected');
                setIsConnected(true);
                setTaskError(undefined);
            };

            ws.onmessage = event => {
                try {
                    const data = JSON.parse(event.data);
                    processEvent(data);
                    //processRequestEvent(data)
                } catch (error) {
                    console.error('Error processing WebSocket message:', error);
                }
            };

            ws.onerror = error => {
                console.error('WebSocket error:', error);
                setIsConnected(false);
                setTaskStatus('error');
                setTaskError('WebSocket connection error');
            };

            ws.onclose = () => {
                console.log('WebSocket disconnected');
                setIsConnected(false);
                wsRef.current = null;
            };

            wsRef.current = ws;
        } catch (error) {
            console.error('Failed to connect WebSocket:', error);
            setIsConnected(false);
            setTaskStatus('error');
            setTaskError('Failed to connect to server');
        }
    }, [processEvent]);

    const sendMessage = useCallback(
        (message: string) => {
            if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
                console.error('WebSocket not connected');
                return;
            }

            // Add user message to conversation
            const userMessage: MessageData = {
                role: 'user',
                content: message,
            };
            setTaskState(prev => ({
                ...prev,
                messages: [...prev.messages, userMessage],
            }));

            // Send request to WebSocket
            const request = {
                type: 'request',
                prompt: message,
                model: selectedModel || undefined,
                modelClass: !selectedModel ? selectedModelClass : undefined,
                enableTools,
                temperature,
            };

            wsRef.current.send(JSON.stringify(request));
            setTaskStatus('running');
        },
        [selectedModel, selectedModelClass, enableTools, temperature]
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
            if (wsRef.current) {
                wsRef.current.close();
                wsRef.current = null;
            }
        };
    }, [connectWebSocket]);

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
        const validTabs: TabType[] = [
            'conversation',
            'research',
            'inspiration',
            'design',
            'requests',
            'cognition',
            'memory',
        ];
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
                model: selectedModel || selectedModelClass,
                messages: taskState.messages.map(m => ({ role: m.role, content: m.content || '' })),
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
                                Model
                            </label>
                            <ModelSelector
                                value={selectedModel}
                                onChange={setSelectedModel}
                                models={availableModels.map(model => ({ value: model, label: model }))}
                                placeholder="Use Model Class"
                            />
                        </div>

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
                                style={{
                                    fontSize: '14px',
                                    cursor: 'pointer',
                                    maxWidth: '100%',
                                }}>
                                {availableModelClasses.map((cls, index) => (
                                    <option key={`${cls}-${index}`} value={cls} style={{ background: '#1a1a2e' }}>
                                        {String(cls)}
                                    </option>
                                ))}
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
                                        Temperature: {temperature.toFixed(1)}
                                    </label>
                                    <input
                                        type="range"
                                        min="0"
                                        max="2"
                                        step="0.1"
                                        value={temperature}
                                        onChange={e => setTemperature(parseFloat(e.target.value))}
                                        style={{ width: '100%' }}
                                    />
                                </div>
                            </div>
                        )}

                        {/* Stats Row */}
                        <div
                            style={{
                                display: 'flex',
                                gap: '16px',
                                marginTop: '20px',
                                paddingTop: '20px',
                                borderTop: '1px solid rgba(255, 255, 255, 0.1)',
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

                        {/* Show Code Button - moved from header */}
                        <div style={{ marginTop: '20px' }}>
                            <ShowCodeButton onClick={() => setShowCodeModal(true)} style={{ width: '100%' }} />
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
                                    {
                                        id: 'memory',
                                        label: 'Memory',
                                        count: taskState.memoryData?.stats?.totalTopics || 0,
                                    },
                                    {
                                        id: 'cognition',
                                        label: 'Cognition',
                                        count: taskState.cognitionData?.stats?.totalAnalyses || 0,
                                    },
                                ] as HeaderTab[]
                            }
                            activeTab={activeTab}
                            onTabChange={tab => setActiveTab(tab as TabType)}
                        />

                        {/* Main Content Area */}
                        <div
                            style={{
                                flex: 1,
                                padding: '0 24px 20px',
                                display: 'flex',
                                flexDirection: 'column',
                                position: 'relative',
                                overflow: 'hidden',
                                justifyContent: 'space-between',
                            }}>
                            {showIntro ? (
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
                                                messages={taskState.messages}
                                                isStreaming={taskState.isStreaming}
                                                emptyMessage="No messages yet. Send a message to start the conversation."
                                            />
                                        </div>
                                    )}

                                    {activeTab === 'requests' && (
                                        <div style={{ padding: '20px' }}>
                                            {taskState.llmRequests.length === 0 ? (
                                                <div
                                                    style={{
                                                        textAlign: 'center',
                                                        color: 'rgba(255, 255, 255, 0.5)',
                                                        padding: '40px',
                                                    }}>
                                                    No requests yet. Start a conversation to see LLM requests here.
                                                </div>
                                            ) : (
                                                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                                                    {taskState.llmRequests.map((request, index) => (
                                                        <Card
                                                            key={request.id || index}
                                                            style={{
                                                                padding: '16px',
                                                                background: 'rgba(255, 255, 255, 0.05)',
                                                                border: '1px solid rgba(255, 255, 255, 0.1)',
                                                            }}>
                                                            <div
                                                                style={{
                                                                    display: 'flex',
                                                                    justifyContent: 'space-between',
                                                                    marginBottom: '8px',
                                                                }}>
                                                                <span style={{ fontWeight: '600', color: '#fff' }}>
                                                                    Request #{index + 1}
                                                                </span>
                                                                <span
                                                                    style={{
                                                                        fontSize: '14px',
                                                                        color: 'rgba(255, 255, 255, 0.5)',
                                                                    }}>
                                                                    {new Date(request.timestamp).toLocaleTimeString()}
                                                                </span>
                                                            </div>
                                                            <div
                                                                style={{
                                                                    display: 'grid',
                                                                    gridTemplateColumns: 'repeat(3, 1fr)',
                                                                    gap: '12px',
                                                                }}>
                                                                <div>
                                                                    <div
                                                                        style={{
                                                                            fontSize: '12px',
                                                                            color: 'rgba(255, 255, 255, 0.5)',
                                                                            marginBottom: '4px',
                                                                        }}>
                                                                        Model
                                                                    </div>
                                                                    <div
                                                                        style={{
                                                                            fontSize: '14px',
                                                                            fontWeight: '500',
                                                                            color: '#fff',
                                                                        }}>
                                                                        {request.model || request.modelClass || 'auto'}
                                                                    </div>
                                                                </div>
                                                                <div>
                                                                    <div
                                                                        style={{
                                                                            fontSize: '12px',
                                                                            color: 'rgba(255, 255, 255, 0.5)',
                                                                            marginBottom: '4px',
                                                                        }}>
                                                                        Tokens
                                                                    </div>
                                                                    <div
                                                                        style={{
                                                                            fontSize: '14px',
                                                                            fontWeight: '500',
                                                                            color: '#fff',
                                                                        }}>
                                                                        {formatNumber(request.tokens || 0)}
                                                                    </div>
                                                                </div>
                                                                <div>
                                                                    <div
                                                                        style={{
                                                                            fontSize: '12px',
                                                                            color: 'rgba(255, 255, 255, 0.5)',
                                                                            marginBottom: '4px',
                                                                        }}>
                                                                        Cost
                                                                    </div>
                                                                    <div
                                                                        style={{
                                                                            fontSize: '14px',
                                                                            fontWeight: '500',
                                                                            color: '#fff',
                                                                        }}>
                                                                        {formatCurrency(request.cost || 0)}
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        </Card>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    )}

                                    {activeTab === 'research' && (
                                        <div
                                            style={{
                                                padding: '20px',
                                                textAlign: 'center',
                                                color: 'rgba(255, 255, 255, 0.5)',
                                            }}>
                                            Research features coming soon...
                                        </div>
                                    )}

                                    {activeTab === 'inspiration' && (
                                        <div
                                            style={{
                                                padding: '20px',
                                                textAlign: 'center',
                                                color: 'rgba(255, 255, 255, 0.5)',
                                            }}>
                                            Inspiration features coming soon...
                                        </div>
                                    )}

                                    {activeTab === 'design' && (
                                        <div
                                            style={{
                                                padding: '20px',
                                                textAlign: 'center',
                                                color: 'rgba(255, 255, 255, 0.5)',
                                            }}>
                                            Design features coming soon...
                                        </div>
                                    )}

                                    {activeTab === 'cognition' && (
                                        <div
                                            style={{
                                                padding: '20px',
                                                textAlign: 'center',
                                                color: 'rgba(255, 255, 255, 0.5)',
                                            }}>
                                            Cognition features coming soon...
                                        </div>
                                    )}

                                    {activeTab === 'memory' && (
                                        <div
                                            style={{
                                                padding: '20px',
                                                textAlign: 'center',
                                                color: 'rgba(255, 255, 255, 0.5)',
                                            }}>
                                            Memory features coming soon...
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* Input Area at Bottom */}
                            <div
                                style={{
                                    margin: '0 auto',
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
                                />
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {showCodeModal && (
                <CodeModal isOpen={showCodeModal} onClose={() => setShowCodeModal(false)} tabs={codeTabs} />
            )}
        </div>
    );
}
