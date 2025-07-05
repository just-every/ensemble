import { useState, useEffect, useRef, useCallback } from 'react';
import useWebSocket, { ReadyState } from 'react-use-websocket';
import '@just-every/demo-ui/dist/styles.css';
import { REQUEST_WS_URL } from './config/websocket';
import {
    DemoHeader,
    Card,
    Message,
    MessageData,
    ConversationInput,
    CodeModal,
    ShowCodeButton,
    generateRequestCode,
    generateHTMLDemo,
} from '@just-every/demo-ui';

// Example prompts
const examples = {
    weather: "What's the weather like in Tokyo, London, and New York? Compare the temperatures.",
    math: 'Calculate the following: (15 * 23) + (sqrt(144) / 3) - 78. Show your work step by step.',
    search: 'Search for information about quantum computing and its potential applications in medicine.',
    code: 'Write a Python function that implements binary search on a sorted array. Include comments and example usage.',
    creative: 'Write a short story about a robot who discovers it can dream. Make it philosophical and touching.',
};

export default function RequestDemo() {
    const [messages, setMessages] = useState<MessageData[]>([]);
    const [inputValue, setInputValue] = useState(
        'Please write a short story about an ensemble playing in the current weather in New York.'
    );
    const [isStreaming, setIsStreaming] = useState(false);
    const [showIntro, setShowIntro] = useState(true);
    const [showAdvanced, setShowAdvanced] = useState(false);
    const [showCodeModal, setShowCodeModal] = useState(false);
    const [isGeneratingFollowUp, setIsGeneratingFollowUp] = useState(false);

    // Settings
    const [selectedModel, setSelectedModel] = useState('');
    const [selectedModelClass, setSelectedModelClass] = useState('standard');
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
    const messagesContainerRef = useRef<HTMLDivElement>(null);
    const currentMessageRef = useRef<MessageData | null>(null);
    const mainContentRef = useRef<HTMLDivElement>(null);
    const isGeneratingFollowUpRef = useRef(false);
    const showIntroRef = useRef(showIntro);
    const inputValueRef = useRef(inputValue);

    // Keep refs updated
    useEffect(() => {
        isGeneratingFollowUpRef.current = isGeneratingFollowUp;
    }, [isGeneratingFollowUp]);

    useEffect(() => {
        showIntroRef.current = showIntro;
    }, [showIntro]);

    useEffect(() => {
        inputValueRef.current = inputValue;
    }, [inputValue]);

    // Scroll state for dynamic sizing
    const [conversationHeight, setConversationHeight] = useState('calc(100vh - 280px)');

    const {
        sendMessage: wsSend,
        lastMessage,
        readyState,
    } = useWebSocket(REQUEST_WS_URL, {
        shouldReconnect: () => true,
        reconnectAttempts: 10,
        reconnectInterval: 3000,
        onOpen: () => console.log('🟢 WebSocket connected'),
        onClose: () => console.log('🔴 WebSocket disconnected'),
        onError: event => console.error('❌ WebSocket error:', event),
    });

    // Auto-scroll hook
    const scrollToBottom = useCallback(() => {
        if (messagesContainerRef.current) {
            messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight;
        }
    }, []);

    // Handle scroll for dynamic conversation height
    useEffect(() => {
        const handleScroll = () => {
            if (!mainContentRef.current) return;

            const scrollTop = window.scrollY;
            const viewportHeight = window.innerHeight;

            // When scrolled, make conversation pane fill from top to bottom with margins
            if (scrollTop > 0) {
                const newHeight = `${viewportHeight - 40}px`; // 20px top + 20px bottom margins
                setConversationHeight(newHeight);
            } else {
                // Reset to original height when at top
                setConversationHeight('calc(100vh - 280px)');
            }
        };

        window.addEventListener('scroll', handleScroll, { passive: true });
        return () => window.removeEventListener('scroll', handleScroll);
    }, []);

    // Auto-scroll when messages change
    useEffect(() => {
        scrollToBottom();
    }, [messages, scrollToBottom]);

    // Handle WebSocket messages
    useEffect(() => {
        if (!lastMessage) return;

        try {
            const data = JSON.parse(lastMessage.data);

            switch (data.type) {
                case 'connected':
                    console.log('Connected with ID:', data.connectionId);
                    if (data.models) {
                        const modelNames =
                            Array.isArray(data.models) && data.models.length > 0 && typeof data.models[0] === 'object'
                                ? data.models.map((m: { id?: string; name?: string }) => m.id || m.name || m)
                                : data.models;
                        // Ensure unique models to avoid duplicate key warnings
                        const uniqueModels = Array.from(new Set(modelNames)) as string[];
                        setAvailableModels(uniqueModels);
                    }
                    if (data.modelClasses) {
                        const classNames =
                            Array.isArray(data.modelClasses) &&
                            data.modelClasses.length > 0 &&
                            typeof data.modelClasses[0] === 'object'
                                ? data.modelClasses.map((c: { id?: string; name?: string }) => c.id || c.name || c)
                                : data.modelClasses;
                        setAvailableModelClasses(classNames);
                        if (!selectedModelClass && classNames.includes('standard')) {
                            setSelectedModelClass('standard');
                        }
                    }
                    break;

                case 'agent_start':
                    if (data.agent && !isGeneratingFollowUpRef.current && currentMessageRef.current) {
                        // Only update model info for regular messages, not follow-up suggestions
                        currentMessageRef.current.model = data.agent.model;
                        currentMessageRef.current.modelClass = data.agent.modelClass;
                        // Update messages directly to avoid infinite loop
                        setMessages(prev => {
                            const newMessages = [...prev];
                            const lastIndex = newMessages.length - 1;
                            if (lastIndex >= 0 && currentMessageRef.current) {
                                newMessages[lastIndex] = { ...currentMessageRef.current };
                            }
                            return newMessages;
                        });
                    }
                    break;

                case 'stream_start': {
                    setIsStreaming(true);
                    if (showIntroRef.current) setShowIntro(false);

                    const newMessage: MessageData = {
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

                case 'message_delta':
                    if (currentMessageRef.current) {
                        if (data.thinking_content) {
                            currentMessageRef.current.thinking_content =
                                (currentMessageRef.current.thinking_content || '') + data.thinking_content;
                        }
                        if (data.content) {
                            currentMessageRef.current.content += data.content;
                        }
                        // Update messages directly to avoid infinite loop
                        setMessages(prev => {
                            const newMessages = [...prev];
                            const lastIndex = newMessages.length - 1;
                            if (lastIndex >= 0 && currentMessageRef.current) {
                                newMessages[lastIndex] = { ...currentMessageRef.current };
                            }
                            return newMessages;
                        });
                        scrollToBottom();
                    }
                    break;

                case 'tool_start':
                    if (currentMessageRef.current && data.tool_call) {
                        if (!currentMessageRef.current.tools) {
                            currentMessageRef.current.tools = [];
                        }
                        currentMessageRef.current.tools.push({
                            id: data.tool_call.id,
                            function: data.tool_call.function,
                        });
                        // Update messages directly to avoid infinite loop
                        setMessages(prev => {
                            const newMessages = [...prev];
                            const lastIndex = newMessages.length - 1;
                            if (lastIndex >= 0 && currentMessageRef.current) {
                                newMessages[lastIndex] = { ...currentMessageRef.current };
                            }
                            return newMessages;
                        });
                    }
                    break;

                case 'tool_done':
                    if (currentMessageRef.current) {
                        const tools = currentMessageRef.current.tools || [];
                        const toolCallId = data.tool_call?.id || data.result?.call_id;
                        const toolCall = tools.find(t => t.id === toolCallId);
                        if (toolCall && data.result) {
                            toolCall.result = data.result;
                            // Update messages directly to avoid infinite loop
                            setMessages(prev => {
                                const newMessages = [...prev];
                                const lastIndex = newMessages.length - 1;
                                if (lastIndex >= 0 && currentMessageRef.current) {
                                    newMessages[lastIndex] = { ...currentMessageRef.current };
                                }
                                return newMessages;
                            });
                            scrollToBottom();
                        }
                    }
                    break;

                case 'follow_up_suggestion':
                    if (data.content) {
                        console.log('✨ Received follow-up suggestion:', data.content);
                        setInputValue(data.content.trim());
                        setIsGeneratingFollowUp(false);
                    }
                    break;

                case 'stream_end':
                case 'stream_complete':
                    if (!isGeneratingFollowUpRef.current) {
                        if (currentMessageRef.current) {
                            currentMessageRef.current.streaming = false;
                            // Update messages directly to avoid infinite loop
                            setMessages(prev => {
                                const newMessages = [...prev];
                                const lastIndex = newMessages.length - 1;
                                if (lastIndex >= 0 && currentMessageRef.current) {
                                    newMessages[lastIndex] = { ...currentMessageRef.current };
                                }
                                return newMessages;
                            });

                            // Only generate follow-up if we have actual content (not empty) or tools/thinking
                            const hasContent =
                                (currentMessageRef.current.content &&
                                    currentMessageRef.current.content.trim().length > 0) ||
                                (currentMessageRef.current.tools && currentMessageRef.current.tools.length > 0) ||
                                !!currentMessageRef.current.thinking_content;

                            // Clear the ref after updating
                            currentMessageRef.current = null;

                            // Generate follow-up suggestion if input is empty and we have actual content
                            if (!inputValueRef.current.trim() && hasContent) {
                                setTimeout(() => generateFollowUpSuggestion(), 1000); // Small delay for better UX
                            }
                        }
                        setIsStreaming(false);
                    }
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
    }, [lastMessage?.data]); // Only depend on the actual message data

    // Removed updateCurrentMessage function to prevent infinite loops
    // Now updating messages directly in each case to avoid dependency issues

    const sendMessage = () => {
        if (!inputValue.trim() || readyState !== ReadyState.OPEN) return;

        const userMessage: MessageData = {
            role: 'user',
            content: inputValue.trim(),
        };

        setMessages(prev => [...prev, userMessage]);
        if (showIntro) setShowIntro(false);

        const requestData = {
            type: 'chat',
            messages: [...messages, userMessage],
            model: selectedModel || undefined,
            modelClass: selectedModelClass || undefined,
            toolsEnabled: enableTools,
            maxTokens,
            temperature,
            topP,
            frequencyPenalty,
            presencePenalty,
            seed: seed || undefined,
        };

        wsSend(JSON.stringify(requestData));
        setInputValue('');
        scrollToBottom();
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

    const generateFollowUpSuggestion = async () => {
        if (readyState !== ReadyState.OPEN || messages.length === 0) return;

        try {
            console.log('🤖 Generating follow-up suggestion...');

            // Get the last assistant message for context
            const lastAssistantMessage = messages
                .slice()
                .reverse()
                .find(m => m.role === 'assistant');
            if (!lastAssistantMessage?.content) return;

            // Create a prompt for the mini model to generate a follow-up
            const followUpPrompt = `Based on the assistant's recent response, generate ONE short follow-up question that asks for more details about something specific mentioned in the output. The question should be directly related to what was just said. Respond with ONLY the question, no explanations.

Recent assistant response: "${lastAssistantMessage.content.slice(0, 500)}..."

Follow-up question about this output:`;

            const followUpRequest = {
                type: 'chat',
                messages: [{ role: 'user', content: followUpPrompt }],
                modelClass: 'mini', // Use mini model for quick follow-up generation
                toolsEnabled: false,
                maxTokens: 100,
                temperature: 0.8,
                isFollowUp: true,
            };

            console.log('📤 Requesting follow-up suggestion');
            setIsGeneratingFollowUp(true);
            wsSend(JSON.stringify(followUpRequest));
        } catch (error) {
            console.error('Error generating follow-up suggestion:', error);
        }
    };

    // const handleKeyPress = (e: React.KeyboardEvent) => {
    //     if (e.key === 'Enter' && !e.shiftKey) {
    //         e.preventDefault();
    //         sendMessage();
    //     }
    // };

    const generateCode = () => ({
        server: generateRequestCode({
            model: selectedModel || selectedModelClass,
            messages: messages.map(m => ({ role: m.role, content: m.content })),
            temperature,
            maxTokens,
            tools: enableTools,
            stream: true,
            language: 'typescript',
        }),
        client: generateHTMLDemo({
            title: 'Ensemble Chat Demo',
            wsUrl: 'ws://localhost:3005',
            features: enableTools ? ['tools'] : [],
        }),
    });

    return (
        <div>
            <div className="container">
                <DemoHeader
                    title="Request Demo"
                    icon={
                        <svg width="32" height="32" viewBox="0 0 512 512" fill="currentColor">
                            <path d="M288 64l0 96-64 0c-35.3 0-64 28.7-64 64l0 64-96 0L64 64l224 0zM64 352l96 0 0 96c0 35.3 28.7 64 64 64l224 0c35.3 0 64-28.7 64-64l0-224c0-35.3-28.7-64-64-64l-96 0 0-96c0-35.3-28.7-64-64-64L64 0C28.7 0 0 28.7 0 64L0 288c0 35.3 28.7 64 64 64zM448 224l0 224-224 0 0-96 64 0c35.3 0 64-28.7 64-64l0-64 96 0z" />
                        </svg>
                    }>
                    <ShowCodeButton onClick={() => setShowCodeModal(true)} />
                </DemoHeader>

                <div className="container" style={{ display: 'flex', gap: '20px', alignItems: 'flex-start' }}>
                    <div
                        className="sidebar"
                        style={{
                            width: '300px',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '20px',
                            position: 'sticky',
                            top: '20px',
                        }}>
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
                            <div
                                className="settings-section"
                                style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                                <div
                                    className="setting-group"
                                    style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                    <label
                                        className="setting-label"
                                        style={{ fontWeight: '500', fontSize: '14px', color: 'var(--text-secondary)' }}>
                                        Model
                                    </label>
                                    <select
                                        className="glass-select"
                                        value={selectedModel}
                                        onChange={e => {
                                            setSelectedModel(e.target.value);
                                            if (e.target.value) setSelectedModelClass('');
                                        }}
                                        style={{
                                            fontSize: '14px',
                                            cursor: 'pointer',
                                        }}>
                                        <option value="">Use Model Class</option>
                                        {availableModels.map(model => (
                                            <option key={`model-${model}`} value={model}>
                                                {model}
                                            </option>
                                        ))}
                                    </select>
                                </div>

                                <div
                                    className="setting-group"
                                    style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                    <label
                                        className="setting-label"
                                        style={{ fontWeight: '500', fontSize: '14px', color: 'var(--text-secondary)' }}>
                                        Model Class
                                    </label>
                                    <select
                                        className="glass-select"
                                        value={selectedModelClass}
                                        onChange={e => {
                                            setSelectedModelClass(e.target.value);
                                            if (e.target.value) setSelectedModel('');
                                        }}
                                        style={{
                                            fontSize: '14px',
                                            cursor: 'pointer',
                                        }}>
                                        {availableModelClasses.map(cls => (
                                            <option key={cls} value={cls}>
                                                {cls}
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
                                                className="setting-label"
                                                style={{
                                                    fontWeight: '500',
                                                    fontSize: '14px',
                                                    color: 'var(--text-secondary)',
                                                }}>
                                                <input
                                                    type="checkbox"
                                                    checked={enableTools}
                                                    onChange={e => setEnableTools(e.target.checked)}
                                                    className="toggle-checkbox"
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
                                                Max Tokens
                                            </label>
                                            <input
                                                type="number"
                                                value={maxTokens}
                                                onChange={e => setMaxTokens(Number(e.target.value))}
                                                className="glass-input"
                                                style={{
                                                    fontSize: '14px',
                                                    cursor: 'pointer',
                                                }}
                                            />
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
                                            <div
                                                className="slider-container"
                                                style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                                <input
                                                    type="range"
                                                    min="0"
                                                    max="2"
                                                    step="0.1"
                                                    value={temperature}
                                                    onChange={e => setTemperature(Number(e.target.value))}
                                                    style={{
                                                        flex: 1,
                                                        WebkitAppearance: 'none',
                                                        height: '6px',
                                                        background: 'rgba(255, 255, 255, 0.1)',
                                                        borderRadius: '3px',
                                                        outline: 'none',
                                                    }}
                                                />
                                                <span
                                                    className="slider-value"
                                                    style={{
                                                        minWidth: '50px',
                                                        textAlign: 'right',
                                                        fontWeight: '500',
                                                    }}>
                                                    {temperature.toFixed(1)}
                                                </span>
                                            </div>
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
                                                Top P
                                            </label>
                                            <div
                                                className="slider-container"
                                                style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                                <input
                                                    type="range"
                                                    min="0"
                                                    max="1"
                                                    step="0.01"
                                                    value={topP}
                                                    onChange={e => setTopP(Number(e.target.value))}
                                                    style={{
                                                        flex: 1,
                                                        WebkitAppearance: 'none',
                                                        height: '6px',
                                                        background: 'rgba(255, 255, 255, 0.1)',
                                                        borderRadius: '3px',
                                                        outline: 'none',
                                                    }}
                                                />
                                                <span
                                                    className="slider-value"
                                                    style={{
                                                        minWidth: '50px',
                                                        textAlign: 'right',
                                                        fontWeight: '500',
                                                    }}>
                                                    {topP.toFixed(2)}
                                                </span>
                                            </div>
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
                                                Frequency Penalty
                                            </label>
                                            <div
                                                className="slider-container"
                                                style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                                <input
                                                    type="range"
                                                    min="-2"
                                                    max="2"
                                                    step="0.1"
                                                    value={frequencyPenalty}
                                                    onChange={e => setFrequencyPenalty(Number(e.target.value))}
                                                    style={{
                                                        flex: 1,
                                                        WebkitAppearance: 'none',
                                                        height: '6px',
                                                        background: 'rgba(255, 255, 255, 0.1)',
                                                        borderRadius: '3px',
                                                        outline: 'none',
                                                    }}
                                                />
                                                <span
                                                    className="slider-value"
                                                    style={{
                                                        minWidth: '50px',
                                                        textAlign: 'right',
                                                        fontWeight: '500',
                                                    }}>
                                                    {frequencyPenalty.toFixed(1)}
                                                </span>
                                            </div>
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
                                                Presence Penalty
                                            </label>
                                            <div
                                                className="slider-container"
                                                style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                                <input
                                                    type="range"
                                                    min="-2"
                                                    max="2"
                                                    step="0.1"
                                                    value={presencePenalty}
                                                    onChange={e => setPresencePenalty(Number(e.target.value))}
                                                    style={{
                                                        flex: 1,
                                                        WebkitAppearance: 'none',
                                                        height: '6px',
                                                        background: 'rgba(255, 255, 255, 0.1)',
                                                        borderRadius: '3px',
                                                        outline: 'none',
                                                    }}
                                                />
                                                <span
                                                    className="slider-value"
                                                    style={{
                                                        minWidth: '50px',
                                                        textAlign: 'right',
                                                        fontWeight: '500',
                                                    }}>
                                                    {presencePenalty.toFixed(1)}
                                                </span>
                                            </div>
                                        </div>

                                        <div
                                            className="setting-group"
                                            style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                            <label
                                                className="setting-label"
                                                style={{
                                                    fontWeight: '500',
                                                    fontSize: '14px',
                                                    color: 'var(--text-secondary)',
                                                }}>
                                                Seed (for reproducible outputs)
                                            </label>
                                            <input
                                                type="number"
                                                value={seed}
                                                onChange={e => setSeed(e.target.value)}
                                                placeholder="Leave empty for random"
                                                className="glass-input"
                                                style={{
                                                    fontSize: '14px',
                                                    cursor: 'pointer',
                                                }}
                                            />
                                        </div>
                                    </div>
                                )}
                            </div>

                            <div
                                className="stats-section"
                                style={{
                                    display: 'grid',
                                    gridTemplateColumns: '1fr 1fr',
                                    gap: '12px',
                                    marginTop: '16px',
                                }}>
                                <div
                                    className="stat-card"
                                    style={{
                                        background: 'var(--surface-glass)',
                                        backdropFilter: 'var(--blur-glass)',
                                        WebkitBackdropFilter: 'var(--blur-glass)',
                                        border: '1px solid var(--border-glass)',
                                        borderRadius: '12px',
                                        padding: '12px',
                                        textAlign: 'center',
                                    }}>
                                    <div
                                        className="stat-value"
                                        style={{
                                            fontSize: '20px',
                                            fontWeight: 'bold',
                                            color: 'var(--accent-primary)',
                                            textShadow: '0 0 10px var(--accent-primary-glow)',
                                        }}>
                                        {totalTokens.toLocaleString()}
                                    </div>
                                    <div
                                        className="stat-label"
                                        style={{
                                            fontSize: '12px',
                                            color: 'var(--text-secondary)',
                                            marginTop: '4px',
                                        }}>
                                        Tokens
                                    </div>
                                </div>
                                <div
                                    className="stat-card"
                                    style={{
                                        background: 'var(--surface-glass)',
                                        backdropFilter: 'var(--blur-glass)',
                                        WebkitBackdropFilter: 'var(--blur-glass)',
                                        border: '1px solid var(--border-glass)',
                                        borderRadius: '12px',
                                        padding: '12px',
                                        textAlign: 'center',
                                    }}>
                                    <div
                                        className="stat-value"
                                        style={{
                                            fontSize: '20px',
                                            fontWeight: 'bold',
                                            color: 'var(--accent-primary)',
                                            textShadow: '0 0 10px var(--accent-primary-glow)',
                                        }}>
                                        ${totalCost.toFixed(2)}
                                    </div>
                                    <div
                                        className="stat-label"
                                        style={{
                                            fontSize: '12px',
                                            color: 'var(--text-secondary)',
                                            marginTop: '4px',
                                        }}>
                                        Cost
                                    </div>
                                </div>
                            </div>
                        </div>

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
                                <button
                                    className="glass-button"
                                    onClick={() => sendExample('weather')}
                                    style={{
                                        width: '100%',
                                        marginBottom: '8px',
                                        justifyContent: 'flex-start',
                                    }}>
                                    <span>☀️ &nbsp; Ask about weather</span>
                                </button>
                                <button
                                    className="glass-button"
                                    onClick={() => sendExample('math')}
                                    style={{
                                        width: '100%',
                                        marginBottom: '8px',
                                        justifyContent: 'flex-start',
                                    }}>
                                    <span>🧮 &nbsp; Solve math problem</span>
                                </button>
                                <button
                                    className="glass-button"
                                    onClick={() => sendExample('search')}
                                    style={{
                                        width: '100%',
                                        marginBottom: '8px',
                                        justifyContent: 'flex-start',
                                    }}>
                                    <span>🔍 &nbsp; Search for information</span>
                                </button>
                                <button
                                    className="glass-button"
                                    onClick={() => sendExample('code')}
                                    style={{
                                        width: '100%',
                                        marginBottom: '8px',
                                        justifyContent: 'flex-start',
                                    }}>
                                    <span>💻 &nbsp; Write some code</span>
                                </button>
                                <button
                                    className="glass-button"
                                    onClick={() => sendExample('creative')}
                                    style={{
                                        width: '100%',
                                        justifyContent: 'flex-start',
                                    }}>
                                    <span>✨ &nbsp; Creative writing</span>
                                </button>
                            </div>
                        </div>
                    </div>

                    <div
                        ref={mainContentRef}
                        className="main-content"
                        style={{
                            flex: 1,
                            display: 'flex',
                            flexDirection: 'column',
                            minWidth: 0,
                            position: 'sticky',
                            top: '20px',
                            height: conversationHeight,
                            minHeight: '200px',
                            transition: 'height 0.2s ease-out',
                        }}>
                        <Card
                            className="card chat-container"
                            style={{
                                background: 'var(--surface-glass)',
                                backdropFilter: 'var(--blur-glass)',
                                WebkitBackdropFilter: 'var(--blur-glass)',
                                border: '1px solid var(--border-glass)',
                                borderRadius: '16px',
                                padding: '0 20px 20px',
                                boxShadow: 'var(--shadow-glass)',
                                flex: 1,
                                display: 'flex',
                                flexDirection: 'column',
                                minHeight: 0,
                            }}>
                            <div
                                className="messages-container"
                                ref={messagesContainerRef}
                                style={{
                                    flex: 1,
                                    overflowY: 'auto',
                                    display: 'flex',
                                    flexDirection: 'column',
                                    gap: '16px',
                                    minHeight: 0,
                                    padding: '35px 5px 20px',
                                }}>
                                {showIntro && (
                                    <div
                                        style={{
                                            padding: '20px',
                                            color: 'white',
                                            lineHeight: '1.6',
                                            textAlign: 'left',
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
                                {messages.map((message, index) => (
                                    <Message key={index} message={message} />
                                ))}
                            </div>

                            <ConversationInput
                                value={inputValue}
                                onChange={setInputValue}
                                onSend={sendMessage}
                                onStop={stopStreaming}
                                isStreaming={isStreaming}
                                disabled={readyState !== ReadyState.OPEN}
                                placeholder="Type your message..."
                            />
                        </Card>
                    </div>
                </div>
            </div>

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
}
