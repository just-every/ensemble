import { useState, useEffect, useRef, useCallback } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import useWebSocket, { ReadyState } from 'react-use-websocket';
import './components/glassmorphism.css';
import { Link, useLocation } from 'react-router-dom';

// Configure marked
marked.setOptions({
    breaks: true,
    gfm: true,
    pedantic: false,
});

// Example prompts
const examples = {
    weather: "What's the weather like in Tokyo, London, and New York? Compare the temperatures.",
    math: 'Calculate the following: (15 * 23) + (sqrt(144) / 3) - 78. Show your work step by step.',
    search: 'Search for information about quantum computing and its potential applications in medicine.',
    code: 'Write a Python function that implements binary search on a sorted array. Include comments and example usage.',
    creative: 'Write a short story about a robot who discovers it can dream. Make it philosophical and touching.',
};

interface Message {
    role: 'user' | 'assistant';
    content: string;
    model?: string;
    modelClass?: string;
    tools?: ToolCall[];
    streaming?: boolean;
}

interface ToolCall {
    id: string;
    function: {
        name: string;
        arguments: string;
    };
    result?: {
        output?: string;
        error?: string;
    };
}

export default function SimpleRequestDemo() {
    const location = useLocation();
    const [messages, setMessages] = useState<Message[]>([]);
    const [inputValue, setInputValue] = useState('');
    const [isStreaming, setIsStreaming] = useState(false);
    const [showAdvanced, setShowAdvanced] = useState(false);
    const [showCodeModal, setShowCodeModal] = useState(false);
    const [activeCodeTab, setActiveCodeTab] = useState<'server' | 'client'>('server');

    // Settings
    const [selectedModel, setSelectedModel] = useState('');
    const [selectedModelClass, setSelectedModelClass] = useState('');
    const [enableTools, setEnableTools] = useState(true);
    const [maxTokens, setMaxTokens] = useState(1000);
    const [temperature, setTemperature] = useState(1.0);
    const [topP, setTopP] = useState(1.0);
    const [frequencyPenalty, setFrequencyPenalty] = useState(0);
    const [presencePenalty, setPresencePenalty] = useState(0);
    const [seed, setSeed] = useState('');

    // Available models and classes
    const [availableModels, setAvailableModels] = useState<string[]>([]);
    const [availableModelClasses, setAvailableModelClasses] = useState<string[]>([]);

    // Stats
    const [totalTokens, setTotalTokens] = useState(0);
    const [totalCost, setTotalCost] = useState(0);

    // Refs
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const messagesContainerRef = useRef<HTMLDivElement>(null);
    const currentMessageRef = useRef<Message | null>(null);
    const userHasScrolledRef = useRef(false);
    const [showIntro, setShowIntro] = useState(true);

    const {
        sendMessage: wsSend,
        lastMessage,
        readyState,
    } = useWebSocket('ws://localhost:3005', {
        shouldReconnect: () => true,
        reconnectAttempts: 10,
        reconnectInterval: 3000,
    });

    // Handle WebSocket messages
    useEffect(() => {
        if (!lastMessage) return;

        try {
            const data = JSON.parse(lastMessage.data);

            switch (data.type) {
                case 'connected':
                    console.log('Connected with ID:', data.connectionId);
                    if (data.models) setAvailableModels(data.models);
                    if (data.modelClasses) setAvailableModelClasses(data.modelClasses);
                    break;

                case 'agent_start':
                    if (data.agent && currentMessageRef.current) {
                        currentMessageRef.current.model = data.agent.model;
                        currentMessageRef.current.modelClass = data.agent.modelClass;
                        updateCurrentMessage();
                    }
                    break;

                case 'stream_start': {
                    setIsStreaming(true);
                    if (showIntro) setShowIntro(false);
                    const newMessage: Message = {
                        role: 'assistant',
                        content: '',
                        model: data.model,
                        streaming: true,
                        tools: [],
                    };
                    currentMessageRef.current = newMessage;
                    setMessages(prev => [...prev, newMessage]);
                    break;
                }

                case 'message_delta': {
                    if (currentMessageRef.current && data.content) {
                        currentMessageRef.current.content += data.content;
                        updateCurrentMessage();
                        scrollToBottom();
                    }
                    break;
                }

                case 'message_complete':
                    if (currentMessageRef.current && data.content) {
                        currentMessageRef.current.content = data.content;
                        currentMessageRef.current.streaming = false;
                        updateCurrentMessage();
                        currentMessageRef.current = null;
                    }
                    break;

                case 'tool_start':
                    if (currentMessageRef.current && data.tool_call) {
                        const toolCall: ToolCall = {
                            id: data.tool_call.id,
                            function: data.tool_call.function,
                        };
                        if (!currentMessageRef.current.tools) {
                            currentMessageRef.current.tools = [];
                        }
                        currentMessageRef.current.tools.push(toolCall);
                        updateCurrentMessage();
                    }
                    break;

                case 'tool_done':
                    if (currentMessageRef.current && data.result) {
                        const tools = currentMessageRef.current.tools || [];
                        const toolCall = tools.find(t => t.id === data.tool_call_id);
                        if (toolCall) {
                            toolCall.result = data.result;
                            updateCurrentMessage();
                        }
                    }
                    break;

                case 'stream_end':
                    setIsStreaming(false);
                    break;

                case 'cost_update':
                    if (data.cost) {
                        setTotalCost(prev => prev + data.cost.total);
                        setTotalTokens(prev => prev + (data.cost.inputTokens || 0) + (data.cost.outputTokens || 0));
                    }
                    break;

                case 'error':
                    console.error('Server error:', data.error);
                    setIsStreaming(false);
                    break;
            }
        } catch (error) {
            console.error('Error parsing WebSocket message:', error);
        }
    }, [lastMessage, showIntro]);

    const updateCurrentMessage = () => {
        setMessages(prev => {
            const newMessages = [...prev];
            const lastIndex = newMessages.length - 1;
            if (lastIndex >= 0 && currentMessageRef.current) {
                newMessages[lastIndex] = { ...currentMessageRef.current };
            }
            return newMessages;
        });
    };

    const scrollToBottom = useCallback(() => {
        if (!userHasScrolledRef.current && messagesEndRef.current) {
            messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
        }
    }, []);

    const handleScroll = () => {
        if (messagesContainerRef.current) {
            const { scrollTop, scrollHeight, clientHeight } = messagesContainerRef.current;
            const isAtBottom = scrollHeight - scrollTop - clientHeight < 50;
            userHasScrolledRef.current = !isAtBottom;
        }
    };

    const sendMessage = () => {
        if (!inputValue.trim() || readyState !== ReadyState.OPEN) return;

        const userMessage: Message = {
            role: 'user',
            content: inputValue.trim(),
        };

        setMessages(prev => [...prev, userMessage]);
        if (showIntro) setShowIntro(false);

        const requestData = {
            type: 'request',
            message: inputValue.trim(),
            model: selectedModel || undefined,
            modelClass: selectedModelClass || undefined,
            enableTools,
            maxTokens,
            temperature,
            topP,
            frequencyPenalty,
            presencePenalty,
            seed: seed || undefined,
        };

        wsSend(JSON.stringify(requestData));
        setInputValue('');
        userHasScrolledRef.current = false;
        setTimeout(scrollToBottom, 100);
    };

    const stopStreaming = () => {
        if (readyState === ReadyState.OPEN) {
            wsSend(JSON.stringify({ type: 'stop' }));
            setIsStreaming(false);
        }
    };

    const sendExample = (type: keyof typeof examples) => {
        setInputValue(examples[type]);
    };

    const handleKeyPress = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    };

    const renderMessage = (message: Message, index: number) => {
        const isUser = message.role === 'user';

        return (
            <div key={index} className={`message ${isUser ? 'user' : 'assistant'}`}>
                <div className="message-row">
                    <div className="message-content">
                        {!isUser && (message.model || message.modelClass) && (
                            <div className="message-metadata">
                                {message.modelClass && message.model
                                    ? `Class: ${message.modelClass} • Model: ${message.model}`
                                    : message.modelClass
                                      ? `Class: ${message.modelClass}`
                                      : `Model: ${message.model}`}
                            </div>
                        )}

                        <div className="message-body">
                            {!isUser && message.tools && message.tools.length > 0 && (
                                <div className="tools-container">
                                    {message.tools.map((tool, i) => (
                                        <div key={i}>
                                            <div className="tool-call">
                                                <strong>🔧 Calling {tool.function.name}:</strong>
                                                <br />
                                                <pre>
                                                    {JSON.stringify(JSON.parse(tool.function.arguments), null, 2)}
                                                </pre>
                                            </div>
                                            {tool.result && (
                                                <div className="tool-result">
                                                    <strong>✅ Result:</strong>
                                                    <br />
                                                    <pre style={{ whiteSpace: 'pre-wrap' }}>
                                                        {tool.result.output || tool.result.error || 'No result'}
                                                    </pre>
                                                </div>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            )}

                            {message.content && (
                                <>
                                    {!isUser && message.tools && message.tools.length > 0 && (
                                        <div className="content-separator" />
                                    )}
                                    <div className="content-container">
                                        <div
                                            className="content"
                                            dangerouslySetInnerHTML={{
                                                __html: isUser
                                                    ? message.content
                                                    : DOMPurify.sanitize(marked.parse(message.content) as string),
                                            }}
                                        />
                                    </div>
                                </>
                            )}

                            {message.streaming && !message.content && (
                                <div className="typing-indicator-modern">
                                    <span>Thinking</span>
                                    <div className="typing-dots">
                                        <span></span>
                                        <span></span>
                                        <span></span>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        );
    };

    return (
        <div className="min-h-screen" style={{ background: 'var(--bg-primary)' }}>
            <nav className="glass-nav sticky top-0 z-50">
                <div className="container mx-auto px-4 py-4 flex justify-between items-center">
                    <div className="flex items-center gap-2">
                        <div className="w-8 h-8 bg-gradient-to-br from-blue-400 to-purple-600 rounded-lg"></div>
                        <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>
                            Ensemble Demo
                        </h1>
                    </div>
                    <div className="flex gap-2">
                        <Link to="/" className="glass-button">
                            <span className="mr-2">🏠</span> Home
                        </Link>
                        <Link
                            to="/request"
                            className={location.pathname === '/request' ? 'glass-button-active' : 'glass-button'}>
                            <span className="mr-2">💬</span> Request
                        </Link>
                        <Link to="/embed" className="glass-button">
                            <span className="mr-2">🧮</span> Embed
                        </Link>
                        <Link to="/voice" className="glass-button">
                            <span className="mr-2">🎵</span> Voice
                        </Link>
                        <Link to="/listen" className="glass-button">
                            <span className="mr-2">🎤</span> Listen
                        </Link>
                    </div>
                </div>
            </nav>

            <div className="page-wrapper">
                <div className="header-card">
                    <div className="header-row">
                        <h1>
                            <svg width="32" height="32" viewBox="0 0 640 512" fill="currentColor">
                                <path d="M64 0C28.7 0 0 28.7 0 64L0 256c0 35.3 28.7 64 64 64l32 0 0 48c0 6.1 3.4 11.6 8.8 14.3s11.9 2.1 16.8-1.5L202.7 320 352 320c35.3 0 64-28.7 64-64l0-192c0-35.3-28.7-64-64-64L64 0zM352 352l-96 0 0 32c0 35.3 28.7 64 64 64l117.3 0 81.1 60.8c4.8 3.6 11.3 4.2 16.8 1.5s8.8-8.2 8.8-14.3l0-48 32 0c35.3 0 64-28.7 64-64l0-192c0-35.3-28.7-64-64-64l-128 0 0 128c0 53-43 96-96 96z" />
                            </svg>
                            Request Demo
                        </h1>
                        <button className="generate-code-btn" onClick={() => setShowCodeModal(true)}>
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                                <path d="M9.4 16.6L4.8 12l4.6-4.6L8 6l-6 6 6 6 1.4-1.4zm5.2 0l4.6-4.6-4.6-4.6L16 6l6 6-6 6-1.4-1.4z" />
                            </svg>
                            Show Code
                        </button>
                    </div>
                </div>

                {readyState !== ReadyState.OPEN && (
                    <div className="connection-warning">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z" />
                        </svg>
                        Unable to connect to server. Please ensure the server is running on port 3005.
                    </div>
                )}

                <div className="container">
                    <div className="sidebar">
                        <div className="card">
                            <h2>Settings</h2>
                            <div className="settings-section">
                                <div className="setting-group">
                                    <label className="setting-label">Model</label>
                                    <select
                                        className="glass-select"
                                        value={selectedModel}
                                        onChange={e => {
                                            setSelectedModel(e.target.value);
                                            if (e.target.value) setSelectedModelClass('');
                                        }}>
                                        <option value="">Use Model Class</option>
                                        {availableModels.map(model => (
                                            <option key={model} value={model}>
                                                {model}
                                            </option>
                                        ))}
                                    </select>
                                </div>

                                <div className="setting-group">
                                    <label className="setting-label">Model Class</label>
                                    <select
                                        className="glass-select"
                                        value={selectedModelClass}
                                        onChange={e => {
                                            setSelectedModelClass(e.target.value);
                                            if (e.target.value) setSelectedModel('');
                                        }}>
                                        <option value="">Select a class</option>
                                        {availableModelClasses.map(cls => (
                                            <option key={cls} value={cls}>
                                                {cls}
                                            </option>
                                        ))}
                                    </select>
                                </div>

                                <div className="advanced-section">
                                    <button
                                        type="button"
                                        className="advanced-toggle"
                                        onClick={() => setShowAdvanced(!showAdvanced)}>
                                        <svg
                                            width="16"
                                            height="16"
                                            viewBox="0 0 24 24"
                                            fill="currentColor"
                                            className={`chevron ${showAdvanced ? 'rotate-180' : ''}`}
                                            style={{ transition: 'transform 0.2s' }}>
                                            <path d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z" />
                                        </svg>
                                        Advanced Settings
                                    </button>

                                    {showAdvanced && (
                                        <div className="advanced-content">
                                            <div className="checkbox-group">
                                                <input
                                                    type="checkbox"
                                                    id="enableTools"
                                                    checked={enableTools}
                                                    onChange={e => setEnableTools(e.target.checked)}
                                                />
                                                <label htmlFor="enableTools" className="setting-label">
                                                    Enable Tool Calling
                                                </label>
                                            </div>

                                            <div className="setting-group">
                                                <label className="setting-label">Max Tokens</label>
                                                <input
                                                    type="number"
                                                    className="glass-input"
                                                    value={maxTokens}
                                                    onChange={e => setMaxTokens(Number(e.target.value))}
                                                    min="1"
                                                    max="8192"
                                                />
                                            </div>

                                            <div className="setting-group">
                                                <label className="setting-label">Temperature</label>
                                                <div className="slider-container">
                                                    <input
                                                        type="range"
                                                        min="0"
                                                        max="2"
                                                        step="0.1"
                                                        value={temperature}
                                                        onChange={e => setTemperature(Number(e.target.value))}
                                                    />
                                                    <span className="slider-value">{temperature.toFixed(1)}</span>
                                                </div>
                                            </div>

                                            <div className="setting-group">
                                                <label className="setting-label">Top P</label>
                                                <div className="slider-container">
                                                    <input
                                                        type="range"
                                                        min="0"
                                                        max="1"
                                                        step="0.01"
                                                        value={topP}
                                                        onChange={e => setTopP(Number(e.target.value))}
                                                    />
                                                    <span className="slider-value">{topP.toFixed(2)}</span>
                                                </div>
                                            </div>

                                            <div className="setting-group">
                                                <label className="setting-label">Frequency Penalty</label>
                                                <div className="slider-container">
                                                    <input
                                                        type="range"
                                                        min="-2"
                                                        max="2"
                                                        step="0.1"
                                                        value={frequencyPenalty}
                                                        onChange={e => setFrequencyPenalty(Number(e.target.value))}
                                                    />
                                                    <span className="slider-value">{frequencyPenalty.toFixed(1)}</span>
                                                </div>
                                            </div>

                                            <div className="setting-group">
                                                <label className="setting-label">Presence Penalty</label>
                                                <div className="slider-container">
                                                    <input
                                                        type="range"
                                                        min="-2"
                                                        max="2"
                                                        step="0.1"
                                                        value={presencePenalty}
                                                        onChange={e => setPresencePenalty(Number(e.target.value))}
                                                    />
                                                    <span className="slider-value">{presencePenalty.toFixed(1)}</span>
                                                </div>
                                            </div>

                                            <div className="setting-group">
                                                <label className="setting-label">Seed (for reproducible outputs)</label>
                                                <input
                                                    type="number"
                                                    className="glass-input"
                                                    value={seed}
                                                    onChange={e => setSeed(e.target.value)}
                                                    placeholder="Leave empty for random"
                                                />
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>

                            <div className="stats-section">
                                <div className="stat-card">
                                    <div className="stat-value">{totalTokens.toLocaleString()}</div>
                                    <div className="stat-label">Tokens</div>
                                </div>
                                <div className="stat-card">
                                    <div className="stat-value">${totalCost.toFixed(2)}</div>
                                    <div className="stat-label">Cost</div>
                                </div>
                            </div>
                        </div>

                        <div className="card">
                            <h2>Examples</h2>
                            <div className="examples-section">
                                <button className="example-btn" onClick={() => sendExample('weather')}>
                                    ☀️ &nbsp; Ask about weather
                                </button>
                                <button className="example-btn" onClick={() => sendExample('math')}>
                                    🧮 &nbsp; Solve math problem
                                </button>
                                <button className="example-btn" onClick={() => sendExample('search')}>
                                    🔍 &nbsp; Search for information
                                </button>
                                <button className="example-btn" onClick={() => sendExample('code')}>
                                    💻 &nbsp; Write some code
                                </button>
                                <button className="example-btn" onClick={() => sendExample('creative')}>
                                    ✨ &nbsp; Creative writing
                                </button>
                            </div>
                        </div>
                    </div>

                    <div className="main-content">
                        <div className="card chat-container">
                            <div className="messages-container" ref={messagesContainerRef} onScroll={handleScroll}>
                                {showIntro && (
                                    <div
                                        style={{
                                            padding: '20px',
                                            color: 'var(--text-secondary)',
                                            lineHeight: '1.6',
                                            textAlign: 'left',
                                            borderBottom: '1px solid var(--border-glass)',
                                            marginBottom: '20px',
                                            opacity: 0.8,
                                        }}>
                                        <p>
                                            <strong>@just-every/ensemble</strong> is a unified interface for multiple AI
                                            providers that enables easy chaining of LLM outputs - you can send the
                                            response from one model directly as input to another model from a different
                                            provider seamlessly.
                                        </p>
                                        <p>&nbsp;</p>
                                        <p>
                                            The package includes <strong>automatic model selection</strong>{' '}
                                            capabilities, allowing you to specify task-based model classes (like{' '}
                                            <em>"mini"</em> for simple tasks, <em>"large"</em> for complex reasoning)
                                            and let the system choose the optimal model and provider for each specific
                                            use case. It also provides unified APIs for{' '}
                                            <strong>voice generation</strong>,{' '}
                                            <strong>speech-to-text transcription</strong>, and{' '}
                                            <strong>text embeddings</strong> across different providers.
                                        </p>
                                        <p>&nbsp;</p>
                                        <p>
                                            <strong>Try out the demo below!</strong>
                                        </p>
                                    </div>
                                )}
                                {messages.map((message, index) => renderMessage(message, index))}
                                <div ref={messagesEndRef} />
                            </div>

                            <div className="input-section">
                                <div className="input-wrapper">
                                    <textarea
                                        className="glass-textarea"
                                        value={inputValue}
                                        onChange={e => setInputValue(e.target.value)}
                                        onKeyDown={handleKeyPress}
                                        placeholder="Type your message..."
                                        disabled={readyState !== ReadyState.OPEN}
                                    />
                                    {isStreaming ? (
                                        <button className="danger-btn" onClick={stopStreaming}>
                                            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                                                <path d="M6 6h12v12H6z" />
                                            </svg>
                                            Stop
                                        </button>
                                    ) : (
                                        <button
                                            className="primary-btn"
                                            onClick={sendMessage}
                                            disabled={readyState !== ReadyState.OPEN || !inputValue.trim()}>
                                            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                                                <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
                                            </svg>
                                            Send
                                        </button>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {showCodeModal && (
                <div
                    className="modal-overlay"
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
                            {activeCodeTab === 'server' ? (
                                <div className="code-container">
                                    <button
                                        className="copy-button"
                                        onClick={() => {
                                            navigator.clipboard.writeText('// Server code here');
                                        }}>
                                        Copy
                                    </button>
                                    <pre>// Server code implementation</pre>
                                </div>
                            ) : (
                                <div className="code-container">
                                    <button
                                        className="copy-button"
                                        onClick={() => {
                                            navigator.clipboard.writeText('// Client code here');
                                        }}>
                                        Copy
                                    </button>
                                    <pre>// Client code implementation</pre>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
