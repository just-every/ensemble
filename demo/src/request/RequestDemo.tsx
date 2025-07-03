import React, { useState, useEffect, useRef } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { useWebSocket } from '../hooks/useWebSocket';
import { Header } from '../components/Header';
import { GlassCard } from '../components/GlassCard';
import { GlassButton } from '../components/GlassButton';
import { GlassInput, GlassSelect, GlassTextarea } from '../components/GlassInput';
import { StatusIndicator } from '../components/StatusIndicator';
import { Modal } from '../components/Modal';
import '../components/glassmorphism.css';

// Configure marked for markdown rendering
marked.setOptions({
    breaks: true,
    gfm: true,
});

interface Message {
    role: 'user' | 'assistant' | 'system';
    content: string;
    id: string;
    timestamp: Date;
}

interface ToolCall {
    id: string;
    name: string;
    args: Record<string, unknown>;
    result?: string;
    status: 'pending' | 'completed' | 'error';
}

interface StreamEvent {
    type: string;
    connectionId?: string;
    models?: Array<{ id: string; provider: string }>;
    modelClasses?: Array<{ id: string }>;
    availableTools?: Array<{ name: string; description: string }>;
    content?: string;
    id?: string;
    name?: string;
    args?: Record<string, unknown>;
    result?: string;
    error?: string;
    tokens?: number;
    cost?: number;
}

const RequestDemo: React.FC = () => {
    // Connection state
    const [connectionId, setConnectionId] = useState<string | null>(null);
    const [showConnectionWarning, setShowConnectionWarning] = useState(false);

    // Chat state
    const [messages, setMessages] = useState<Message[]>([]);
    const [currentMessage, setCurrentMessage] = useState('');
    const [isStreaming, setIsStreaming] = useState(false);
    const [toolCalls, setToolCalls] = useState<ToolCall[]>([]);
    const [messageCompleted, setMessageCompleted] = useState(false);

    // Settings state
    const [selectedModel, setSelectedModel] = useState('');
    const [selectedModelClass, setSelectedModelClass] = useState('large');
    const [toolsEnabled, setToolsEnabled] = useState(true);
    const [maxTokens, setMaxTokens] = useState(1000);
    const [temperature, setTemperature] = useState(0.7);
    const [topP, setTopP] = useState(0.9);
    const [frequencyPenalty, setFrequencyPenalty] = useState(0);
    const [presencePenalty, setPresencePenalty] = useState(0);
    const [seed, setSeed] = useState('');

    // UI state
    const [showAdvanced, setShowAdvanced] = useState(false);
    const [showCodeModal, setShowCodeModal] = useState(false);
    const [availableModels, setAvailableModels] = useState<Array<{ id: string; provider: string }>>([]);
    const [availableModelClasses, setAvailableModelClasses] = useState<Array<{ id: string }>>([]);
    const [availableTools, setAvailableTools] = useState<Array<{ name: string; description: string }>>([]);
    const [stats, setStats] = useState({
        tokens: 0,
        cost: 0,
        duration: 0,
    });

    // Refs
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLTextAreaElement>(null);
    const messagesContainerRef = useRef<HTMLDivElement>(null);

    // Introduction text
    const introText = `**@just-every/ensemble** is an LLM provider abstraction layer that provides a unified streaming interface for multiple AI providers. It enables seamless switching between providers and automatic selection of the optimal model for each task. The package also includes voice generation, real-time transcription, and vector embedding capabilities.\n\nTry out the demo below!`;

    // WebSocket connection
    const { status, sendMessage, isConnected } = useWebSocket({
        url: 'ws://localhost:3005',
        onMessage: handleWebSocketMessage,
        onConnect: () => {
            setShowConnectionWarning(false);
        },
        onDisconnect: () => {
            setConnectionId(null);
        },
        autoConnect: true,
    });

    // Show connection warning after 3 seconds if not connected
    useEffect(() => {
        const timer = setTimeout(() => {
            if (status !== 'connected') {
                setShowConnectionWarning(true);
            }
        }, 3000);

        return () => clearTimeout(timer);
    }, [status]);

    function handleWebSocketMessage(message: StreamEvent) {
        switch (message.type) {
            case 'connected':
                setConnectionId(message.connectionId || null);
                setAvailableModels(message.models || []);
                setAvailableModelClasses(message.modelClasses || []);
                setAvailableTools(message.availableTools || []);
                break;

            case 'stream_start':
                setIsStreaming(true);
                setMessageCompleted(false);
                setToolCalls([]);
                break;

            case 'message_delta':
                if (!messageCompleted && message.content) {
                    updateCurrentAssistantMessage(message.content);
                }
                break;

            case 'message_complete':
                setMessageCompleted(true);
                if (message.content) {
                    updateCurrentAssistantMessage(message.content);
                }
                break;

            case 'tool_start': {
                const newToolCall: ToolCall = {
                    id: message.id || Date.now().toString(),
                    name: message.name || 'unknown',
                    args: message.args || {},
                    status: 'pending',
                };
                setToolCalls(prev => [...prev, newToolCall]);
                break;
            }

            case 'tool_complete':
                setToolCalls(prev =>
                    prev.map(tool =>
                        tool.id === message.id ? { ...tool, result: message.result, status: 'completed' } : tool
                    )
                );
                break;

            case 'tool_error':
                setToolCalls(prev =>
                    prev.map(tool =>
                        tool.id === message.id ? { ...tool, result: message.error, status: 'error' } : tool
                    )
                );
                break;

            case 'cost_update': {
                setStats(prev => ({
                    ...prev,
                    tokens: message.tokens || 0,
                    cost: message.cost || 0,
                }));
                break;
            }

            case 'stream_complete':
                setIsStreaming(false);
                break;

            case 'error':
                console.error('WebSocket error:', message.error);
                setIsStreaming(false);
                break;
        }
    }

    function updateCurrentAssistantMessage(content: string) {
        setMessages(prev => {
            const lastMessage = prev[prev.length - 1];
            if (lastMessage && lastMessage.role === 'assistant') {
                return prev.slice(0, -1).concat({
                    ...lastMessage,
                    content,
                });
            } else {
                return prev.concat({
                    role: 'assistant',
                    content,
                    id: Date.now().toString(),
                    timestamp: new Date(),
                });
            }
        });
    }

    function sendChatMessage() {
        if (!currentMessage.trim() || !isConnected || isStreaming) return;

        // Hide intro text on first message
        if (messages.length === 0) {
            // Introduction will be hidden by showing messages
        }

        // Add user message
        const userMessage: Message = {
            role: 'user',
            content: currentMessage.trim(),
            id: Date.now().toString(),
            timestamp: new Date(),
        };

        const newMessages = [...messages, userMessage];
        setMessages(newMessages);

        // Send to server
        sendMessage({
            type: 'chat',
            messages: newMessages.map(msg => ({
                role: msg.role,
                content: msg.content,
            })),
            model: selectedModel || undefined,
            modelClass: selectedModelClass || undefined,
            toolsEnabled,
            maxTokens,
            temperature,
            topP,
            frequencyPenalty,
            presencePenalty,
            seed: seed || undefined,
        });

        setCurrentMessage('');
    }

    function handleKeyPress(e: React.KeyboardEvent) {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendChatMessage();
        }
    }

    function setExampleMessage(text: string) {
        setCurrentMessage(text);
        inputRef.current?.focus();
    }

    function renderContent(content: string) {
        const html = marked.parse(content) as string;
        return DOMPurify.sanitize(html);
    }

    // Scroll to bottom when messages change
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages, toolCalls]);

    const exampleMessages = [
        "What's the weather like in San Francisco?",
        'Calculate 15 * 23 + 45',
        'Search for the latest news about AI',
        'What are some interesting facts about quantum computing?',
        'Help me plan a trip to Japan',
    ];

    return (
        <div
            style={{
                maxWidth: '1400px',
                margin: '0 auto',
                padding: '20px',
            }}>
            <Header title="Request Demo" onShowCode={() => setShowCodeModal(true)} />

            {showConnectionWarning && (
                <div
                    style={{
                        background: 'var(--surface-glass)',
                        backdropFilter: 'var(--blur-glass)',
                        WebkitBackdropFilter: 'var(--blur-glass)',
                        border: '1px solid var(--accent-warning)',
                        color: 'var(--accent-warning)',
                        padding: '12px 16px',
                        borderRadius: '12px',
                        marginBottom: '20px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                    }}>
                    <span>⚠️</span>
                    Unable to connect to server. Please ensure the server is running on port 3005.
                </div>
            )}

            <div style={{ display: 'flex', gap: '20px', alignItems: 'flex-start' }}>
                {/* Sidebar */}
                <div
                    style={{
                        width: '300px',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '20px',
                        position: 'sticky',
                        top: '20px',
                    }}>
                    {/* Settings */}
                    <GlassCard>
                        <h2 style={{ marginBottom: '16px', fontSize: '20px' }}>Settings</h2>

                        <div style={{ marginBottom: '16px' }}>
                            <label
                                style={{
                                    display: 'block',
                                    fontSize: '14px',
                                    fontWeight: '500',
                                    color: 'var(--text)',
                                    marginBottom: '6px',
                                }}>
                                Model
                            </label>
                            <GlassSelect
                                value={selectedModel}
                                onChange={setSelectedModel}
                                options={[
                                    { value: '', label: 'Use Model Class' },
                                    ...availableModels.map(model => ({
                                        value: model.id,
                                        label: `${model.id} (${model.provider})`,
                                    })),
                                ]}
                            />
                        </div>

                        <div style={{ marginBottom: '16px' }}>
                            <label
                                style={{
                                    display: 'block',
                                    fontSize: '14px',
                                    fontWeight: '500',
                                    color: 'var(--text)',
                                    marginBottom: '6px',
                                }}>
                                Model Class
                            </label>
                            <GlassSelect
                                value={selectedModelClass}
                                onChange={setSelectedModelClass}
                                options={availableModelClasses.map(cls => ({
                                    value: cls.id,
                                    label: cls.id,
                                }))}
                            />
                        </div>

                        <div style={{ marginBottom: '16px' }}>
                            <label
                                style={{
                                    display: 'block',
                                    fontSize: '14px',
                                    fontWeight: '500',
                                    color: 'var(--text)',
                                    marginBottom: '6px',
                                }}>
                                Max Tokens
                            </label>
                            <GlassInput
                                type="number"
                                value={maxTokens.toString()}
                                onChange={value => setMaxTokens(parseInt(value) || 1000)}
                            />
                        </div>

                        <div style={{ marginBottom: '16px' }}>
                            <label
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '8px',
                                    fontSize: '14px',
                                    fontWeight: '500',
                                    color: 'var(--text)',
                                    cursor: 'pointer',
                                }}>
                                <input
                                    type="checkbox"
                                    checked={toolsEnabled}
                                    onChange={e => setToolsEnabled(e.target.checked)}
                                    style={{ accentColor: 'var(--accent-primary)' }}
                                />
                                Enable Tools
                            </label>
                        </div>

                        {/* Advanced Settings */}
                        <div
                            style={{
                                margin: '16px 0',
                                padding: '16px 0',
                                borderTop: '1px solid var(--border-glass)',
                                borderBottom: '1px solid var(--border-glass)',
                            }}>
                            <button
                                onClick={() => setShowAdvanced(!showAdvanced)}
                                style={{
                                    width: '100%',
                                    background: 'none',
                                    border: 'none',
                                    padding: '8px 0',
                                    fontSize: '14px',
                                    fontWeight: '500',
                                    color: 'var(--text-secondary)',
                                    cursor: 'pointer',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '8px',
                                    textAlign: 'left',
                                    transition: 'color 0.2s',
                                }}>
                                <span
                                    style={{
                                        transition: 'transform 0.2s',
                                        transform: showAdvanced ? 'rotate(180deg)' : 'rotate(0deg)',
                                    }}>
                                    ⌄
                                </span>
                                Advanced Settings
                            </button>

                            {showAdvanced && (
                                <div style={{ paddingTop: '20px' }}>
                                    <div style={{ marginBottom: '16px' }}>
                                        <label
                                            style={{
                                                display: 'block',
                                                fontSize: '14px',
                                                fontWeight: '500',
                                                color: 'var(--text)',
                                                marginBottom: '6px',
                                            }}>
                                            Temperature
                                        </label>
                                        <GlassInput
                                            type="number"
                                            value={temperature.toString()}
                                            onChange={value => setTemperature(parseFloat(value) || 0.7)}
                                        />
                                    </div>

                                    <div style={{ marginBottom: '16px' }}>
                                        <label
                                            style={{
                                                display: 'block',
                                                fontSize: '14px',
                                                fontWeight: '500',
                                                color: 'var(--text)',
                                                marginBottom: '6px',
                                            }}>
                                            Top P
                                        </label>
                                        <GlassInput
                                            type="number"
                                            value={topP.toString()}
                                            onChange={value => setTopP(parseFloat(value) || 0.9)}
                                        />
                                    </div>

                                    <div style={{ marginBottom: '16px' }}>
                                        <label
                                            style={{
                                                display: 'block',
                                                fontSize: '14px',
                                                fontWeight: '500',
                                                color: 'var(--text)',
                                                marginBottom: '6px',
                                            }}>
                                            Frequency Penalty
                                        </label>
                                        <GlassInput
                                            type="number"
                                            value={frequencyPenalty.toString()}
                                            onChange={value => setFrequencyPenalty(parseFloat(value) || 0)}
                                        />
                                    </div>

                                    <div style={{ marginBottom: '16px' }}>
                                        <label
                                            style={{
                                                display: 'block',
                                                fontSize: '14px',
                                                fontWeight: '500',
                                                color: 'var(--text)',
                                                marginBottom: '6px',
                                            }}>
                                            Presence Penalty
                                        </label>
                                        <GlassInput
                                            type="number"
                                            value={presencePenalty.toString()}
                                            onChange={value => setPresencePenalty(parseFloat(value) || 0)}
                                        />
                                    </div>

                                    <div>
                                        <label
                                            style={{
                                                display: 'block',
                                                fontSize: '14px',
                                                fontWeight: '500',
                                                color: 'var(--text)',
                                                marginBottom: '6px',
                                            }}>
                                            Seed
                                        </label>
                                        <GlassInput value={seed} onChange={setSeed} placeholder="Optional" />
                                    </div>
                                </div>
                            )}
                        </div>
                    </GlassCard>

                    {/* Connection Status */}
                    <GlassCard>
                        <h3 style={{ marginBottom: '12px', fontSize: '16px' }}>Connection</h3>
                        <StatusIndicator status={status} />
                        {connectionId && (
                            <p
                                style={{
                                    fontSize: '12px',
                                    color: 'var(--text-secondary)',
                                    marginTop: '8px',
                                }}>
                                ID: {connectionId}
                            </p>
                        )}
                    </GlassCard>

                    {/* Tools */}
                    {toolsEnabled && availableTools.length > 0 && (
                        <GlassCard>
                            <h3 style={{ marginBottom: '12px', fontSize: '16px' }}>Available Tools</h3>
                            {availableTools.map((tool, index) => (
                                <div key={index} style={{ marginBottom: '12px', fontSize: '14px' }}>
                                    <div
                                        style={{
                                            fontWeight: '600',
                                            color: 'var(--accent-primary)',
                                            textShadow: '0 0 5px var(--accent-primary-glow)',
                                        }}>
                                        {tool.name}
                                    </div>
                                    <div
                                        style={{
                                            fontSize: '12px',
                                            color: 'var(--text-secondary)',
                                            marginTop: '2px',
                                        }}>
                                        {tool.description}
                                    </div>
                                </div>
                            ))}
                        </GlassCard>
                    )}

                    {/* Examples */}
                    <GlassCard>
                        <h3 style={{ marginBottom: '12px', fontSize: '16px' }}>Examples</h3>
                        {exampleMessages.map((example, index) => (
                            <GlassButton
                                key={index}
                                onClick={() => setExampleMessage(example)}
                                variant="primary"
                                className="example-btn"
                                style={{
                                    width: '100%',
                                    padding: '10px',
                                    marginBottom: '8px',
                                    textAlign: 'left',
                                    justifyContent: 'flex-start',
                                }}>
                                {example}
                            </GlassButton>
                        ))}
                    </GlassCard>

                    {/* Stats */}
                    {(stats.tokens > 0 || stats.cost > 0) && (
                        <GlassCard>
                            <h3 style={{ marginBottom: '12px', fontSize: '16px' }}>Stats</h3>
                            <div
                                style={{
                                    display: 'grid',
                                    gridTemplateColumns: '1fr 1fr',
                                    gap: '12px',
                                }}>
                                <div style={{ textAlign: 'center' }}>
                                    <div
                                        style={{
                                            fontSize: '20px',
                                            fontWeight: '600',
                                            color: 'var(--accent-primary)',
                                            marginBottom: '4px',
                                        }}>
                                        {stats.tokens}
                                    </div>
                                    <div
                                        style={{
                                            fontSize: '12px',
                                            color: 'var(--text-secondary)',
                                            textTransform: 'uppercase',
                                            letterSpacing: '0.5px',
                                        }}>
                                        Tokens
                                    </div>
                                </div>
                                <div style={{ textAlign: 'center' }}>
                                    <div
                                        style={{
                                            fontSize: '20px',
                                            fontWeight: '600',
                                            color: 'var(--accent-primary)',
                                            marginBottom: '4px',
                                        }}>
                                        ${stats.cost.toFixed(4)}
                                    </div>
                                    <div
                                        style={{
                                            fontSize: '12px',
                                            color: 'var(--text-secondary)',
                                            textTransform: 'uppercase',
                                            letterSpacing: '0.5px',
                                        }}>
                                        Cost
                                    </div>
                                </div>
                            </div>
                        </GlassCard>
                    )}
                </div>

                {/* Main Chat Area */}
                <div
                    style={{
                        flex: 1,
                        display: 'flex',
                        flexDirection: 'column',
                        minWidth: 0,
                        maxHeight: 'calc(100vh - 200px)',
                        minHeight: '200px',
                    }}>
                    <GlassCard
                        style={{
                            flex: 1,
                            display: 'flex',
                            flexDirection: 'column',
                            minHeight: 0,
                        }}>
                        {/* Messages */}
                        <div
                            ref={messagesContainerRef}
                            style={{
                                flex: 1,
                                overflowY: 'auto',
                                marginBottom: '20px',
                                padding: '20px 0',
                            }}>
                            {/* Introduction text - shown when no messages */}
                            {messages.length === 0 && (
                                <div
                                    style={{
                                        padding: '20px',
                                        textAlign: 'left',
                                        whiteSpace: 'pre-wrap',
                                    }}>
                                    <div
                                        dangerouslySetInnerHTML={{
                                            __html: renderContent(introText),
                                        }}
                                    />
                                </div>
                            )}

                            {/* Messages */}
                            {messages.map(message => (
                                <div
                                    key={message.id}
                                    style={{
                                        marginBottom: '20px',
                                        display: 'flex',
                                        gap: '12px',
                                    }}>
                                    <div
                                        style={{
                                            width: '32px',
                                            height: '32px',
                                            borderRadius: '50%',
                                            background:
                                                message.role === 'user'
                                                    ? 'var(--accent-primary)'
                                                    : 'var(--accent-secondary)',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            color: 'white',
                                            fontSize: '14px',
                                            fontWeight: '600',
                                            flexShrink: 0,
                                        }}>
                                        {message.role === 'user' ? 'U' : 'A'}
                                    </div>
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <div
                                            style={{
                                                fontSize: '12px',
                                                color: 'var(--text-secondary)',
                                                marginBottom: '4px',
                                                textTransform: 'capitalize',
                                            }}>
                                            {message.role === 'user' ? 'You' : 'Assistant'}
                                        </div>
                                        <div
                                            style={{
                                                color: 'var(--text)',
                                                lineHeight: '1.6',
                                                whiteSpace: 'pre-wrap',
                                            }}>
                                            <div
                                                dangerouslySetInnerHTML={{
                                                    __html: renderContent(message.content),
                                                }}
                                            />
                                        </div>
                                    </div>
                                </div>
                            ))}

                            {/* Tool calls */}
                            {toolCalls.length > 0 && (
                                <div style={{ marginBottom: '20px' }}>
                                    <div
                                        style={{
                                            marginBottom: '8px',
                                            fontSize: '14px',
                                            fontWeight: '600',
                                            color: 'var(--accent-primary)',
                                        }}>
                                        Tool Calls
                                    </div>
                                    {toolCalls.map(tool => (
                                        <div
                                            key={tool.id}
                                            style={{
                                                background: 'var(--surface-glass)',
                                                border: '1px solid var(--border-glass)',
                                                borderRadius: '8px',
                                                padding: '12px',
                                                marginBottom: '8px',
                                            }}>
                                            <div
                                                style={{
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: '8px',
                                                    marginBottom: '4px',
                                                }}>
                                                <span
                                                    style={{
                                                        color:
                                                            tool.status === 'completed'
                                                                ? 'var(--accent-secondary)'
                                                                : tool.status === 'error'
                                                                  ? 'var(--accent-danger)'
                                                                  : 'var(--accent-warning)',
                                                    }}>
                                                    {tool.status === 'completed'
                                                        ? '✅'
                                                        : tool.status === 'error'
                                                          ? '❌'
                                                          : '🔧'}
                                                </span>
                                                <span
                                                    style={{
                                                        fontWeight: '600',
                                                        color: 'var(--accent-primary)',
                                                    }}>
                                                    {tool.name}
                                                </span>
                                                <span
                                                    style={{
                                                        fontSize: '12px',
                                                        color: 'var(--text-secondary)',
                                                    }}>
                                                    {JSON.stringify(tool.args)}
                                                </span>
                                            </div>
                                            {tool.result && (
                                                <div
                                                    style={{
                                                        fontSize: '12px',
                                                        color: 'var(--text-secondary)',
                                                        whiteSpace: 'pre-wrap',
                                                    }}>
                                                    Result: {tool.result}
                                                </div>
                                            )}
                                        </div>
                                    ))}

                                    {/* Content separator */}
                                    <div
                                        style={{
                                            borderTop: '1px solid var(--border-glass)',
                                            margin: '15px 0 25px',
                                        }}
                                    />
                                </div>
                            )}

                            <div ref={messagesEndRef} />
                        </div>

                        {/* Input Section */}
                        <div style={{ flexShrink: 0 }}>
                            <div
                                style={{
                                    display: 'flex',
                                    gap: '12px',
                                    alignItems: 'flex-end',
                                }}>
                                <GlassTextarea
                                    ref={inputRef}
                                    value={currentMessage}
                                    onChange={setCurrentMessage}
                                    placeholder="Type your message..."
                                    disabled={!isConnected || isStreaming}
                                    onKeyDown={handleKeyPress}
                                    rows={3}
                                    style={{ flex: 1 }}
                                />
                                <GlassButton
                                    onClick={sendChatMessage}
                                    disabled={!isConnected || isStreaming || !currentMessage.trim()}
                                    variant="primary"
                                    style={{ padding: '12px 24px' }}>
                                    {isStreaming ? 'Sending...' : 'Send'}
                                </GlassButton>
                            </div>
                        </div>
                    </GlassCard>
                </div>
            </div>

            {/* Code Modal */}
            <Modal isOpen={showCodeModal} onClose={() => setShowCodeModal(false)}>
                <div style={{ padding: '24px', maxWidth: '800px' }}>
                    <h2 style={{ marginBottom: '16px' }}>Code Examples</h2>
                    <p>Code examples would go here...</p>
                </div>
            </Modal>
        </div>
    );
};

export default RequestDemo;
