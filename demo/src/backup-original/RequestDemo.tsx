import { useState, useEffect, useRef, useCallback } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import useWebSocket, { ReadyState } from 'react-use-websocket';
import './components/style.scss';
import ConnectionWarning from './components/ConnectionWarning';

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
    thinking_content?: string;
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

export default function RequestDemo() {
    const [messages, setMessages] = useState<Message[]>([]);
    const [inputValue, setInputValue] = useState(
        'Please write a short story about an ensemble playing in the current weather in New York.'
    );
    const [isStreaming, setIsStreaming] = useState(false);
    const [showAdvanced, setShowAdvanced] = useState(false);
    const [showCodeModal, setShowCodeModal] = useState(false);
    const [activeCodeTab, setActiveCodeTab] = useState<'server' | 'client'>('server');

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
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const messagesContainerRef = useRef<HTMLDivElement>(null);
    const currentMessageRef = useRef<Message | null>(null);
    const userHasScrolledRef = useRef(false);
    const [showIntro, setShowIntro] = useState(true);
    const [isGeneratingFollowUp, setIsGeneratingFollowUp] = useState(false);

    const {
        sendMessage: wsSend,
        lastMessage,
        readyState,
    } = useWebSocket('ws://localhost:3005', {
        shouldReconnect: () => true,
        reconnectAttempts: 10,
        reconnectInterval: 3000,
        onOpen: () => console.log('🟢 WebSocket connected to port 3005'),
        onClose: () => console.log('🔴 WebSocket disconnected from port 3005'),
        onError: event => console.error('❌ WebSocket error:', event),
    });

    // Handle WebSocket messages
    useEffect(() => {
        if (!lastMessage) return;

        try {
            const data = JSON.parse(lastMessage.data);
            console.log('🔍 WebSocket message received:', data);

            // Log stream_start events specifically
            if (data.type === 'stream_start') {
                console.error('⚠️ STREAM_START EVENT RECEIVED - This should NOT happen for follow-up requests!', data);
                console.trace('Stack trace for stream_start');
            }

            switch (data.type) {
                case 'connected':
                    console.log('Connected with ID:', data.connectionId);
                    if (data.models) {
                        // Extract model names if models is an array of objects
                        const modelNames =
                            Array.isArray(data.models) && data.models.length > 0 && typeof data.models[0] === 'object'
                                ? data.models.map((m: { id?: string; name?: string }) => m.id || m.name || m)
                                : data.models;
                        setAvailableModels(modelNames);
                    }
                    if (data.modelClasses) {
                        // Extract class names if modelClasses is an array of objects
                        const classNames =
                            Array.isArray(data.modelClasses) &&
                            data.modelClasses.length > 0 &&
                            typeof data.modelClasses[0] === 'object'
                                ? data.modelClasses.map((c: { id?: string; name?: string }) => c.id || c.name || c)
                                : data.modelClasses;
                        setAvailableModelClasses(classNames);
                        // Set 'standard' as default if available and no model class is selected
                        if (!selectedModelClass && classNames.includes('standard')) {
                            setSelectedModelClass('standard');
                        }
                    }
                    break;

                case 'agent_start':
                    if (data.agent && !isGeneratingFollowUp && currentMessageRef.current) {
                        // Only update model info for regular messages, not follow-up suggestions
                        currentMessageRef.current.model = data.agent.model;
                        currentMessageRef.current.modelClass = data.agent.modelClass;
                        updateCurrentMessage();
                    }
                    break;

                case 'stream_start': {
                    // Normal message handling
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
                    if (currentMessageRef.current) {
                        // Update regular message content and thinking
                        if (data.thinking_content) {
                            if (!currentMessageRef.current.thinking_content) {
                                currentMessageRef.current.thinking_content = '';
                            }
                            currentMessageRef.current.thinking_content += data.thinking_content;
                        }
                        if (data.content) {
                            currentMessageRef.current.content += data.content;
                        }
                        updateCurrentMessage();
                        scrollToBottom();
                    }
                    break;
                }

                case 'message_complete':
                    if (currentMessageRef.current) {
                        // Only update content/thinking if they're provided and we don't have them from deltas
                        if (data.content !== undefined && data.content !== '' && data.content !== null) {
                            if (!currentMessageRef.current.content || currentMessageRef.current.content === '') {
                                currentMessageRef.current.content = data.content;
                            }
                        }
                        if (
                            data.thinking_content !== undefined &&
                            data.thinking_content !== '' &&
                            data.thinking_content !== null
                        ) {
                            if (
                                !currentMessageRef.current.thinking_content ||
                                currentMessageRef.current.thinking_content === ''
                            ) {
                                currentMessageRef.current.thinking_content = data.thinking_content;
                            }
                        }
                        currentMessageRef.current.streaming = false;
                        updateCurrentMessage();
                    }
                    break;

                case 'follow_up_suggestion':
                    if (data.content) {
                        console.log('✨ Received follow-up suggestion:', data.content);
                        setInputValue(data.content.trim());
                        setIsGeneratingFollowUp(false);
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
                    if (currentMessageRef.current && !isGeneratingFollowUp) {
                        const tools = currentMessageRef.current.tools || [];
                        // The tool_done event contains the tool_call object with the ID
                        const toolCallId = data.tool_call?.id || data.result?.call_id;
                        const toolCall = tools.find(t => t.id === toolCallId);
                        if (toolCall && data.result) {
                            toolCall.result = data.result;
                            updateCurrentMessage();
                            scrollToBottom();
                        }
                    }
                    break;

                case 'stream_end':
                case 'stream_complete':
                    if (!isGeneratingFollowUp) {
                        if (currentMessageRef.current) {
                            currentMessageRef.current.streaming = false;
                            updateCurrentMessage();

                            // Only generate follow-up if we have actual content (not empty) or tools/thinking
                            const hasContent =
                                (currentMessageRef.current.content &&
                                    currentMessageRef.current.content.trim().length > 0) ||
                                (currentMessageRef.current.tools && currentMessageRef.current.tools.length > 0) ||
                                !!currentMessageRef.current.thinking_content;

                            // Clear the ref after updating
                            currentMessageRef.current = null;

                            // Generate follow-up suggestion if input is empty and we have actual content
                            if (!inputValue.trim() && hasContent) {
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
    }, [lastMessage, showIntro, isGeneratingFollowUp]);

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
        if (!userHasScrolledRef.current && messagesContainerRef.current) {
            messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight;
        }
    }, []);

    // Scroll to bottom when messages change
    useEffect(() => {
        scrollToBottom();
    }, [messages, scrollToBottom]);

    const handleScroll = () => {
        if (messagesContainerRef.current) {
            const { scrollTop, scrollHeight, clientHeight } = messagesContainerRef.current;
            const isAtBottom = scrollHeight - scrollTop - clientHeight < 50;
            userHasScrolledRef.current = !isAtBottom;
        }
    };

    const sendMessage = () => {
        if (!inputValue.trim() || readyState !== ReadyState.OPEN) return;

        console.log('🚀 Sending message:', inputValue.trim());
        console.log('📡 WebSocket readyState:', readyState);

        const userMessage: Message = {
            role: 'user',
            content: inputValue.trim(),
        };

        setMessages(prev => [...prev, userMessage]);
        console.log('📝 Updated messages with user message');
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

        console.log('📤 Sending WebSocket data:', requestData);
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

    const generateServerCode = (
        model: string,
        modelClass: string,
        maxTokens: number,
        temperature: number,
        topP: number,
        frequencyPenalty: number,
        presencePenalty: number,
        seed: string,
        toolsEnabled: boolean
    ) => {
        const modelLine = model ? `model: '${model}',` : `modelClass: '${modelClass}',`;

        let advancedParams = '';
        if (temperature !== 1.0) advancedParams += `\n                temperature: ${temperature},`;
        if (topP !== 1.0) advancedParams += `\n                topP: ${topP},`;
        if (frequencyPenalty !== 0) advancedParams += `\n                frequencyPenalty: ${frequencyPenalty},`;
        if (presencePenalty !== 0) advancedParams += `\n                presencePenalty: ${presencePenalty},`;
        if (seed) advancedParams += `\n                seed: ${seed},`;

        const toolsParam = toolsEnabled ? ', { tools }' : '';

        const toolsCode = toolsEnabled
            ? `
// Example tools
const tools = [
    {
        function: async ({ location }) => {
            // Mock weather API
            return \`Weather in \${location}: 22°C, partly cloudy\`;
        },
        definition: {
            type: 'function',
            function: {
                name: 'get_weather',
                description: 'Get weather for a location',
                parameters: {
                    type: 'object',
                    properties: {
                        location: { type: 'string', description: 'City name' }
                    },
                    required: ['location']
                }
            }
        }
    }
];`
            : '';

        return `import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import express from 'express';
import { ensembleRequest } from '@just-every/ensemble';

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });
${toolsCode}

wss.on('connection', (ws) => {
    console.log('Client connected');

    ws.on('message', async (data) => {
        const message = JSON.parse(data.toString());

        if (message.type === 'chat') {
            const { messages } = message;

            const agent = {
                ${modelLine}
                maxTokens: ${maxTokens},${advancedParams}
            };

            try {
                for await (const event of ensembleRequest(messages, agent${toolsParam})) {
                    ws.send(JSON.stringify(event));
                }

                ws.send(JSON.stringify({ type: 'stream_complete' }));
            } catch (error) {
                ws.send(JSON.stringify({
                    type: 'error',
                    error: error.message
                }));
            }
        }
    });

    ws.on('close', () => console.log('Client disconnected'));
});

server.listen(3005, () => {
    console.log('WebSocket server running on ws://localhost:3005');
});`;
    };

    const generateClientCode = (model: string, modelClass: string, maxTokens: number, toolsEnabled: boolean) => {
        return `<!DOCTYPE html>
<html>
<head>
    <title>Ensemble Chat Client</title>
    <style>
        body { font-family: Arial, sans-serif; padding: 20px; }
        #messages {
            border: 1px solid #ccc;
            height: 400px;
            overflow-y: scroll;
            padding: 10px;
            margin-bottom: 10px;
        }
        .message { margin: 10px 0; padding: 8px; border-radius: 5px; }
        .user { background: #e3f2fd; }
        .assistant { background: #f5f5f5; }
        input { width: 70%; padding: 8px; }
        button { padding: 8px 16px; }
    </style>
</head>
<body>
    <h1>Ensemble Chat Demo</h1>
    <div id="messages"></div>
    <input type="text" id="input" placeholder="Type a message...">
    <button onclick="sendMessage()">Send</button>

    <script>
        const ws = new WebSocket('ws://localhost:3005');
        const messages = [];
        let currentMessage = null;

        ws.onmessage = (event) => {
            const data = JSON.parse(event.data);
            // Handle WebSocket events
            // Implementation here...
        };

        function sendMessage() {
            const input = document.getElementById('input');
            const content = input.value.trim();
            if (!content) return;

            const requestData = {
                type: 'chat',
                messages: messages,
                ${model ? `model: '${model}',` : `modelClass: '${modelClass}',`}
                maxTokens: ${maxTokens},
                toolsEnabled: ${toolsEnabled}
            };

            ws.send(JSON.stringify(requestData));
            input.value = '';
        }
    </script>
</body>
</html>`;
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
                {/* Metadata above the message row */}
                <div
                    className="message-metadata"
                    style={{
                        fontSize: '12px',
                        color: 'var(--text-secondary)',
                        fontWeight: 400,
                        padding: 0,
                        margin: '0 0 0 48px', // Offset by avatar width + gap
                    }}>
                    {isUser
                        ? 'User'
                        : message.streaming && !message.model && !message.modelClass
                          ? 'Responding...'
                          : message.modelClass && message.model
                            ? `Class: ${message.modelClass} • Model: ${message.model}`
                            : message.modelClass
                              ? `Class: ${message.modelClass}`
                              : message.model
                                ? `Model: ${message.model}`
                                : ''}
                </div>

                <div className="message-row">
                    <div
                        className="message-avatar"
                        style={{
                            width: '36px',
                            height: '36px',
                            borderRadius: '50%',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontWeight: 'bold',
                            color: 'white',
                            flexShrink: 0,
                            marginTop: '2px', // Slightly offset to align with first line of text
                            background: isUser ? 'var(--accent-primary)' : 'var(--accent-success)',
                            boxShadow: isUser
                                ? '0 0 10px var(--accent-primary-glow)'
                                : '0 0 10px rgba(16, 185, 129, 0.4)',
                        }}>
                        {isUser ? 'U' : 'A'}
                    </div>

                    <div className="message-content" style={{ flex: 1, wordWrap: 'break-word', position: 'relative' }}>
                        <div
                            className="message-body"
                            style={{
                                background: 'var(--surface-glass)',
                                backdropFilter: 'var(--blur-glass)',
                                WebkitBackdropFilter: 'var(--blur-glass)',
                                border: '1px solid var(--border-glass)',
                                borderRadius: '12px',
                                padding: '12px 16px',
                            }}>
                            {/* Thinking content */}
                            {!isUser && message.thinking_content && (
                                <div
                                    className="thinking-container"
                                    style={{
                                        padding: '12px',
                                        fontStyle: 'italic',
                                        color: 'var(--text-secondary)',
                                    }}>
                                    <div
                                        style={{
                                            whiteSpace: 'pre-wrap',
                                            fontSize: '14px',
                                            lineHeight: '1.6',
                                        }}
                                        dangerouslySetInnerHTML={{
                                            __html: DOMPurify.sanitize(
                                                marked.parse(message.thinking_content) as string
                                            ),
                                        }}
                                    />
                                </div>
                            )}

                            {/* Tool calls and results */}
                            {!isUser && message.tools && message.tools.length > 0 && (
                                <div className="tools-container" style={{ marginBottom: '8px' }}>
                                    {message.tools.map((tool, i) => (
                                        <div key={i}>
                                            <div
                                                className="tool-call"
                                                style={{
                                                    borderRadius: '12px',
                                                    padding: '12px',
                                                    margin: '8px 0',
                                                    fontFamily: 'monospace',
                                                    fontSize: '14px',
                                                }}>
                                                <strong>🔧 Calling {tool.function.name}:</strong>
                                                <br />
                                                <pre
                                                    style={{
                                                        background: 'rgba(74, 158, 255, 0.1)',
                                                        border: '1px solid rgba(74, 158, 255, 0.3)',
                                                        borderRadius: '8px',
                                                        padding: '12px',
                                                        overflowX: 'auto',
                                                        margin: '8px 0',
                                                        backdropFilter: 'var(--blur-glass)',
                                                        WebkitBackdropFilter: 'var(--blur-glass)',
                                                    }}>
                                                    {JSON.stringify(JSON.parse(tool.function.arguments), null, 2)}
                                                </pre>
                                            </div>
                                            {tool.result && (
                                                <div
                                                    className="tool-result"
                                                    style={{
                                                        borderRadius: '12px',
                                                        padding: '12px',
                                                        margin: '8px 0',
                                                    }}>
                                                    <strong>✅ Result:</strong>
                                                    <br />
                                                    <pre
                                                        style={{
                                                            background: 'rgba(16, 185, 129, 0.1)',
                                                            border: '1px solid rgba(16, 185, 129, 0.3)',
                                                            borderRadius: '8px',
                                                            padding: '12px',
                                                            overflowX: 'auto',
                                                            margin: '8px 0',
                                                            backdropFilter: 'var(--blur-glass)',
                                                            WebkitBackdropFilter: 'var(--blur-glass)',
                                                            whiteSpace: 'pre-wrap',
                                                        }}>
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
                                    {!isUser &&
                                        ((message.tools && message.tools.length > 0) || message.thinking_content) && (
                                            <div
                                                className="content-separator"
                                                style={{
                                                    borderTop: '1px solid var(--border-glass)',
                                                    margin: '15px 0 15px',
                                                    opacity: 0.5,
                                                }}
                                            />
                                        )}
                                    <div className="content-container">
                                        <div
                                            className="content"
                                            style={{
                                                whiteSpace: 'pre-wrap',
                                                wordWrap: 'break-word',
                                                lineHeight: '1.6',
                                            }}
                                            dangerouslySetInnerHTML={{
                                                __html: isUser
                                                    ? DOMPurify.sanitize(message.content)
                                                    : DOMPurify.sanitize(marked.parse(message.content) as string),
                                            }}
                                        />
                                    </div>
                                </>
                            )}

                            {message.streaming &&
                                !message.content &&
                                (!message.tools || !message.tools.length) &&
                                !message.thinking_content && (
                                    <div
                                        className="typing-indicator-modern"
                                        style={{
                                            display: 'inline-flex',
                                            alignItems: 'center',
                                            gap: '4px',
                                            color: 'var(--text-secondary)',
                                            fontStyle: 'italic',
                                        }}>
                                        <div className="typing-dots" style={{ display: 'flex', gap: '2px' }}>
                                            <span
                                                style={{
                                                    width: '4px',
                                                    height: '4px',
                                                    background: 'var(--text-secondary)',
                                                    borderRadius: '50%',
                                                    animation: 'typing 1.4s infinite',
                                                }}></span>
                                            <span
                                                style={{
                                                    width: '4px',
                                                    height: '4px',
                                                    background: 'var(--text-secondary)',
                                                    borderRadius: '50%',
                                                    animation: 'typing 1.4s infinite',
                                                    animationDelay: '0.2s',
                                                }}></span>
                                            <span
                                                style={{
                                                    width: '4px',
                                                    height: '4px',
                                                    background: 'var(--text-secondary)',
                                                    borderRadius: '50%',
                                                    animation: 'typing 1.4s infinite',
                                                    animationDelay: '0.4s',
                                                }}></span>
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
        <div>
            <div className="container">
                <div className="header-card">
                    <div className="header-row">
                        <h1>
                            <svg width="32" height="32" viewBox="0 0 512 512" fill="currentColor">
                                <path d="M288 64l0 96-64 0c-35.3 0-64 28.7-64 64l0 64-96 0L64 64l224 0zM64 352l96 0 0 96c0 35.3 28.7 64 64 64l224 0c35.3 0 64-28.7 64-64l0-224c0-35.3-28.7-64-64-64l-96 0 0-96c0-35.3-28.7-64-64-64L64 0C28.7 0 0 28.7 0 64L0 288c0 35.3 28.7 64 64 64zM448 224l0 224-224 0 0-96 64 0c35.3 0 64-28.7 64-64l0-64 96 0z" />
                            </svg>
                            Request Demo
                        </h1>
                        <button className="glass-button" onClick={() => setShowCodeModal(true)}>
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                                <path d="M9.4 16.6L4.8 12l4.6-4.6L8 6l-6 6 6 6 1.4-1.4zm5.2 0l4.6-4.6-4.6-4.6L16 6l6 6-6 6-1.4-1.4z" />
                            </svg>
                            <span>Show Code</span>
                        </button>
                    </div>
                </div>

                <ConnectionWarning readyState={readyState} port={3005} />

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
                                        }}>
                                        <option value="">Use Model Class</option>
                                        {availableModels.map((model, index) => (
                                            <option key={`${model}-${index}`} value={model}>
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
                                        }}>
                                        {availableModelClasses.map(cls => (
                                            <option
                                                key={
                                                    typeof cls === 'object'
                                                        ? (cls as { id?: string; name?: string }).id ||
                                                          (cls as { id?: string; name?: string }).name
                                                        : cls
                                                }
                                                value={
                                                    typeof cls === 'object'
                                                        ? (cls as { id?: string; name?: string }).id ||
                                                          (cls as { id?: string; name?: string }).name
                                                        : cls
                                                }>
                                                {typeof cls === 'object'
                                                    ? (cls as { id?: string; name?: string }).id ||
                                                      (cls as { id?: string; name?: string }).name ||
                                                      cls
                                                    : cls}
                                            </option>
                                        ))}
                                    </select>
                                </div>

                                <div
                                    className="advanced-section"
                                    style={{
                                        margin: '10px 0',
                                        padding: '16px 0',
                                        borderTop: '1px solid var(--border)',
                                        borderBottom: '1px solid var(--border)',
                                    }}>
                                    <button
                                        type="button"
                                        className={`advanced-toggle ${showAdvanced ? 'expanded' : ''}`}
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
                                        <svg
                                            width="16"
                                            height="16"
                                            viewBox="0 0 24 24"
                                            fill="currentColor"
                                            className="chevron"
                                            style={{
                                                transition: 'transform 0.2s',
                                                transform: showAdvanced ? 'rotate(180deg)' : 'rotate(0deg)',
                                            }}>
                                            <path d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z" />
                                        </svg>
                                        Advanced Settings
                                    </button>

                                    <div
                                        className={`advanced-content ${showAdvanced ? 'expanded' : ''}`}
                                        style={{
                                            maxHeight: showAdvanced ? '600px' : '0',
                                            overflow: 'hidden',
                                            transition: 'max-height 0.3s ease-out',
                                            padding: showAdvanced ? '20px 0' : '0',
                                        }}>
                                        <div
                                            className="checkbox-group"
                                            style={{
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: '8px',
                                                marginBottom: '20px',
                                            }}>
                                            <input
                                                type="checkbox"
                                                id="enableTools"
                                                checked={enableTools}
                                                onChange={e => setEnableTools(e.target.checked)}
                                                style={{ width: '18px', height: '18px', cursor: 'pointer' }}
                                            />
                                            <label
                                                htmlFor="enableTools"
                                                className="setting-label"
                                                style={{
                                                    fontWeight: '500',
                                                    fontSize: '14px',
                                                    color: 'var(--text-secondary)',
                                                    cursor: 'pointer',
                                                }}>
                                                Enable Tool Calling
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
                                                min="1"
                                                max="8192"
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
                                </div>
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
                                        style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px' }}>
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
                                        style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px' }}>
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
                        className="main-content"
                        style={{
                            flex: 1,
                            display: 'flex',
                            flexDirection: 'column',
                            minWidth: 0,
                            height: 'calc(100vh - 280px)',
                            minHeight: '200px',
                        }}>
                        <div
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
                                onScroll={handleScroll}
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
                                {messages.map((message, index) => renderMessage(message, index))}
                                <div ref={messagesEndRef} />
                            </div>

                            <div style={{ flexShrink: 0, paddingTop: '20px' }}>
                                <div
                                    className="input-wrapper"
                                    style={{ display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
                                    <textarea
                                        value={inputValue}
                                        onChange={e => setInputValue(e.target.value)}
                                        onKeyDown={handleKeyPress}
                                        placeholder="Type your message..."
                                        disabled={readyState !== ReadyState.OPEN}
                                        className="glass-textarea"
                                        style={{
                                            flex: 1,
                                            minHeight: '80px',
                                            maxHeight: '200px',
                                            resize: 'vertical',
                                        }}
                                    />
                                    {isStreaming ? (
                                        <button className="danger-btn" onClick={stopStreaming}>
                                            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                                                <path d="M6 6h12v12H6z" />
                                            </svg>
                                            <span>Stop</span>
                                        </button>
                                    ) : (
                                        <button
                                            className="primary-btn"
                                            onClick={sendMessage}
                                            disabled={readyState !== ReadyState.OPEN}>
                                            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                                                <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
                                            </svg>
                                            <span>Send</span>
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
                    }}
                    style={{
                        position: 'fixed',
                        top: 0,
                        left: 0,
                        right: 0,
                        bottom: 0,
                        background: 'rgba(0, 0, 0, 0.5)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        zIndex: 1000,
                    }}>
                    <div
                        className="modal"
                        style={{
                            background: 'var(--surface-glass)',
                            backdropFilter: 'var(--blur-heavy)',
                            WebkitBackdropFilter: 'var(--blur-heavy)',
                            border: '1px solid var(--border-glass)',
                            borderRadius: '16px',
                            maxWidth: '800px',
                            width: '90%',
                            maxHeight: '80vh',
                            overflow: 'hidden',
                            boxShadow: '0 20px 60px rgba(0,0,0,0.6)',
                            display: 'flex',
                            flexDirection: 'column',
                        }}>
                        <div
                            className="modal-header"
                            style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                                padding: '20px 24px',
                                borderBottom: '1px solid var(--border-glass)',
                            }}>
                            <h2 className="modal-title" style={{ margin: 0, fontSize: '20px', color: 'var(--text)' }}>
                                Generated Code
                            </h2>
                            <button
                                className="modal-close"
                                onClick={() => setShowCodeModal(false)}
                                style={{
                                    background: 'none',
                                    border: 'none',
                                    fontSize: '24px',
                                    cursor: 'pointer',
                                    color: 'var(--text-secondary)',
                                    padding: '4px',
                                    borderRadius: '4px',
                                    transition: 'all 0.2s',
                                }}>
                                <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                                    <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
                                </svg>
                            </button>
                        </div>
                        <div
                            className="modal-tabs-section"
                            style={{ borderBottom: '1px solid var(--border-glass)', background: 'var(--surface)' }}>
                            <div className="code-tabs" style={{ display: 'flex', gap: '8px', padding: '0 24px' }}>
                                <button
                                    className={`code-tab ${activeCodeTab === 'server' ? 'active' : ''}`}
                                    onClick={() => setActiveCodeTab('server')}
                                    style={{
                                        background: 'none',
                                        border: 'none',
                                        padding: '12px 16px',
                                        cursor: 'pointer',
                                        borderBottom:
                                            activeCodeTab === 'server'
                                                ? '2px solid var(--primary)'
                                                : '2px solid transparent',
                                        borderRadius: 0,
                                        fontSize: '16px',
                                        fontWeight: '500',
                                        color: activeCodeTab === 'server' ? 'var(--primary)' : 'var(--text-secondary)',
                                        transition: 'all 0.2s',
                                    }}>
                                    Server Code
                                </button>
                                <button
                                    className={`code-tab ${activeCodeTab === 'client' ? 'active' : ''}`}
                                    onClick={() => setActiveCodeTab('client')}
                                    style={{
                                        background: 'none',
                                        border: 'none',
                                        padding: '12px 16px',
                                        cursor: 'pointer',
                                        borderBottom:
                                            activeCodeTab === 'client'
                                                ? '2px solid var(--primary)'
                                                : '2px solid transparent',
                                        borderRadius: 0,
                                        fontSize: '16px',
                                        fontWeight: '500',
                                        color: activeCodeTab === 'client' ? 'var(--primary)' : 'var(--text-secondary)',
                                        transition: 'all 0.2s',
                                    }}>
                                    Client Code
                                </button>
                            </div>
                        </div>
                        <div className="modal-body" style={{ padding: '24px', overflowY: 'auto', flex: 1 }}>
                            {activeCodeTab === 'server' ? (
                                <div
                                    className="code-container"
                                    style={{
                                        position: 'relative',
                                        background: 'var(--surface-glass)',
                                        backdropFilter: 'var(--blur-glass)',
                                        WebkitBackdropFilter: 'var(--blur-glass)',
                                        border: '1px solid var(--border-glass)',
                                        borderRadius: '12px',
                                        padding: '20px',
                                        fontFamily: "'Consolas', 'Monaco', 'Courier New', monospace",
                                        fontSize: '14px',
                                        lineHeight: '1.5',
                                        overflowX: 'auto',
                                    }}>
                                    <button
                                        className="glass-button"
                                        onClick={e => {
                                            const code = generateServerCode(
                                                selectedModel,
                                                selectedModelClass,
                                                maxTokens,
                                                temperature,
                                                topP,
                                                frequencyPenalty,
                                                presencePenalty,
                                                seed,
                                                enableTools
                                            );
                                            navigator.clipboard.writeText(code);
                                            const btn = e.currentTarget;
                                            const span = btn.querySelector('span');
                                            if (span) {
                                                span.textContent = 'Copied!';
                                                btn.classList.add('copied');
                                                setTimeout(() => {
                                                    span.textContent = 'Copy';
                                                    btn.classList.remove('copied');
                                                }, 2000);
                                            }
                                        }}
                                        style={{
                                            position: 'absolute',
                                            top: '12px',
                                            right: '12px',
                                            padding: '6px 12px',
                                            fontSize: '12px',
                                        }}>
                                        <span>Copy</span>
                                    </button>
                                    <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordWrap: 'break-word' }}>
                                        {generateServerCode(
                                            selectedModel,
                                            selectedModelClass,
                                            maxTokens,
                                            temperature,
                                            topP,
                                            frequencyPenalty,
                                            presencePenalty,
                                            seed,
                                            enableTools
                                        )}
                                    </pre>
                                </div>
                            ) : (
                                <div
                                    className="code-container"
                                    style={{
                                        position: 'relative',
                                        background: 'var(--surface-glass)',
                                        backdropFilter: 'var(--blur-glass)',
                                        WebkitBackdropFilter: 'var(--blur-glass)',
                                        border: '1px solid var(--border-glass)',
                                        borderRadius: '12px',
                                        padding: '20px',
                                        fontFamily: "'Consolas', 'Monaco', 'Courier New', monospace",
                                        fontSize: '14px',
                                        lineHeight: '1.5',
                                        overflowX: 'auto',
                                    }}>
                                    <button
                                        className="glass-button"
                                        onClick={e => {
                                            const code = generateClientCode(
                                                selectedModel,
                                                selectedModelClass,
                                                maxTokens,
                                                enableTools
                                            );
                                            navigator.clipboard.writeText(code);
                                            const btn = e.currentTarget;
                                            const span = btn.querySelector('span');
                                            if (span) {
                                                span.textContent = 'Copied!';
                                                btn.classList.add('copied');
                                                setTimeout(() => {
                                                    span.textContent = 'Copy';
                                                    btn.classList.remove('copied');
                                                }, 2000);
                                            }
                                        }}
                                        style={{
                                            position: 'absolute',
                                            top: '12px',
                                            right: '12px',
                                            padding: '6px 12px',
                                            fontSize: '12px',
                                        }}>
                                        <span>Copy</span>
                                    </button>
                                    <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordWrap: 'break-word' }}>
                                        {generateClientCode(selectedModel, selectedModelClass, maxTokens, enableTools)}
                                    </pre>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}
            <style>{`
                /* Custom slider styles */
                input[type="range"]::-webkit-slider-thumb {
                    -webkit-appearance: none;
                    width: 18px;
                    height: 18px;
                    background: var(--accent-primary);
                    border-radius: 50%;
                    cursor: pointer;
                    box-shadow: 0 0 10px var(--accent-primary-glow);
                }

                input[type="range"]::-moz-range-thumb {
                    width: 18px;
                    height: 18px;
                    background: var(--accent-primary);
                    border-radius: 50%;
                    cursor: pointer;
                    box-shadow: 0 0 10px var(--accent-primary-glow);
                    border: none;
                }

                /* Message styling */
                .message {
                    display: flex;
                    flex-direction: column;
                    gap: 4px;
                    animation: fadeIn 0.3s ease;
                }

                .message-row {
                    display: flex;
                    gap: 12px;
                    align-items: flex-start;
                }

                .message-content .content {
                    white-space: pre-wrap;
                    word-wrap: break-word;
                    line-height: 1.2rem;
                }

                .message-content .content h1,
                .message-content .content h2,
                .message-content .content h3,
                .message-content .content h4,
                .message-content .content h5,
                .message-content .content h6 {
                    margin: 16px 0 8px 0;
                    color: var(--text);
                    font-weight: 600;
                    white-space: normal;
                }

                .message-content .content h1 { font-size: 1.5em; }
                .message-content .content h2 { font-size: 1.3em; }
                .message-content .content h3 { font-size: 1.1em; }

                .message-content .content p {
                    margin: 0;
                    line-height: 1.6;
                    white-space: pre-wrap;
                }

                .message-content .content ul,
                .message-content .content ol {
                    margin: 0;
                    padding-left: 20px;
                }

                .message-content .content li {
                    margin: 0;
                }

                .message-content .content blockquote {
                    border-left: 4px solid var(--primary);
                    padding-left: 16px;
                    margin: 10px 0;
                    color: var(--text-secondary);
                    font-style: italic;
                }

                .message-content .content table {
                    border-collapse: collapse;
                    width: 100%;
                    margin: 10px 0;
                }

                .message-content .content th,
                .message-content .content td {
                    border: 1px solid var(--border);
                    padding: 8px 12px;
                    text-align: left;
                }

                .message-content .content th {
                    background: #f0f0f0;
                    font-weight: 600;
                }

                .message-content pre {
                    background: var(--surface-glass);
                    border: 1px solid var(--border-glass);
                    border-radius: 8px;
                    padding: 12px;
                    overflow-x: auto;
                    margin: 8px 0;
                    backdrop-filter: var(--blur-glass);
                    -webkit-backdrop-filter: var(--blur-glass);
                }

                .message-content code {
                    background: rgba(74, 158, 255, 0.1);
                    padding: 2px 6px;
                    border-radius: 4px;
                    font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
                    font-size: 14px;
                    border: 1px solid rgba(74, 158, 255, 0.2);
                }

                @keyframes fadeIn {
                    from { opacity: 0; transform: translateY(10px); }
                    to { opacity: 1; transform: translateY(0); }
                }

                @keyframes typing {
                    0%, 60%, 100% { opacity: 0.3; transform: scale(0.8); }
                    30% { opacity: 1; transform: scale(1); }
                }

                /* Mobile responsive */
                @media (max-width: 768px) {
                    .page-wrapper {
                        height: auto;
                    }

                    .container {
                        flex-direction: column;
                        height: auto;
                    }

                    .sidebar {
                        width: 100%;
                        height: auto;
                    }

                    .messages-container {
                        min-height: 400px;
                    }
                }
            `}</style>
        </div>
    );
}
