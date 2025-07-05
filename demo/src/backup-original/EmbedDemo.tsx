import React, { useState, useEffect } from 'react';
import useWebSocket, { ReadyState } from 'react-use-websocket';
import './components/style.scss';
import ConnectionWarning from './components/ConnectionWarning';

interface Embedding {
    id: string;
    text: string;
    model: string;
    dimensions: number;
    timestamp: number;
    embedding?: number[];
}

interface SearchResult {
    text: string;
    model: string;
    similarity: number;
    timestamp: number;
}

const EmbedDemo: React.FC = () => {
    // State management
    const [texts, setTexts] = useState(['The quick brown fox jumps over the lazy dog']);
    const [selectedModel, setSelectedModel] = useState('text-embedding-3-small');
    const [dimensions, setDimensions] = useState('');
    const [isProcessing, setIsProcessing] = useState(false);
    const [storedEmbeddings, setStoredEmbeddings] = useState<Embedding[]>([]);
    const [selectedEmbeddings, setSelectedEmbeddings] = useState<Set<string>>(new Set());
    const [searchQuery, setSearchQuery] = useState('');
    const [searchModel, setSearchModel] = useState('text-embedding-3-small');
    const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
    const [isSearching, setIsSearching] = useState(false);
    const [analysisText, setAnalysisText] = useState('');
    const [showAnalysis, setShowAnalysis] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [progress, setProgress] = useState(0);
    const [showCodeModal, setShowCodeModal] = useState(false);
    const [activeCodeTab, setActiveCodeTab] = useState<'server' | 'client'>('server');

    // WebSocket configuration
    const socketUrl = 'ws://localhost:3006';
    const { sendMessage, lastMessage, readyState } = useWebSocket(socketUrl, {
        shouldReconnect: () => true,
        reconnectAttempts: 10,
        reconnectInterval: 3000,
    });

    // Example sets
    const exampleSets = {
        similar: [
            'The cat sat on the mat',
            'A feline rested on the rug',
            'The kitty was lying on the carpet',
            'A cat positioned itself on the floor covering',
        ],
        different: [
            'Quantum computing uses qubits for calculations',
            'The recipe requires two cups of flour',
            'Stock markets closed higher today',
            'The mountain peak was covered in snow',
        ],
        languages: ['Hello, how are you?', 'Bonjour, comment allez-vous?', 'Hola, ¿cómo estás?', '你好，你好吗？'],
        semantic: [
            'The bank is by the river',
            'I need to go to the bank to deposit money',
            'The airplane will bank to the left',
            'We sat on the bank watching the sunset',
        ],
    };

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

    // Get store data on connection
    useEffect(() => {
        if (readyState === ReadyState.OPEN) {
            refreshStore();
        }
    }, [readyState]);

    const handleServerMessage = (data: {
        type: string;
        connectionId?: string;
        storeCount?: number;
        current?: number;
        total?: number;
        embeddings?: Embedding[];
        duration?: number;
        averageTime?: number;
        results?: SearchResult[];
        analysis?: string;
        id?: string;
        error?: string;
        usage?: { total_tokens?: number; cost?: number };
    }) => {
        switch (data.type) {
            case 'connected':
                console.log('Connected with ID:', data.connectionId);
                if (data.storeCount && data.storeCount > 0) {
                    console.log(`Server has ${data.storeCount} stored embeddings`);
                }
                break;

            case 'embed_start':
                setIsProcessing(true);
                setProgress(0);
                break;

            case 'embed_progress': {
                const progressValue = ((data.current || 0) / (data.total || 1)) * 100;
                setProgress(progressValue);
                break;
            }

            case 'embed_complete':
                setIsProcessing(false);
                setProgress(100);
                console.log(
                    `Generated ${data.embeddings?.length || 0} embeddings in ${(data.duration || 0).toFixed(2)}s`
                );
                console.log(`Average time: ${(data.averageTime || 0).toFixed(3)}s per embedding`);
                refreshStore();
                clearTextInputs();
                setTimeout(() => setProgress(0), 1000);
                break;

            case 'store_data':
                setStoredEmbeddings(data.embeddings || []);
                break;

            case 'search_start':
                setIsSearching(true);
                break;

            case 'search_complete':
                setIsSearching(false);
                setSearchResults(data.results || []);
                break;

            case 'analyze_complete':
                setAnalysisText(data.analysis || 'No analysis available.');
                setShowAnalysis(true);
                break;

            case 'store_cleared':
                setStoredEmbeddings([]);
                setSelectedEmbeddings(new Set());
                break;

            case 'embedding_deleted':
                setSelectedEmbeddings(prev => {
                    const newSet = new Set(prev);
                    if (data.id) newSet.delete(data.id);
                    return newSet;
                });
                refreshStore();
                break;

            case 'error':
                showError(data.error || 'Unknown error');
                setIsProcessing(false);
                setIsSearching(false);
                setProgress(0);
                break;
        }
    };

    const createEmbeddings = () => {
        if (readyState !== ReadyState.OPEN || isProcessing) return;

        const validTexts = texts.filter(text => text.trim().length > 0);
        if (validTexts.length === 0) {
            showError('Please enter at least one text');
            return;
        }

        const message: {
            type: string;
            texts: string[];
            model: string;
            dimensions?: number;
        } = {
            type: 'embed',
            texts: validTexts,
            model: selectedModel,
        };

        if (dimensions) {
            message.dimensions = parseInt(dimensions);
        }

        sendMessage(JSON.stringify(message));
    };

    const performSearch = () => {
        if (readyState !== ReadyState.OPEN) return;

        const query = searchQuery.trim();
        if (!query) {
            showError('Please enter a search query');
            return;
        }

        sendMessage(
            JSON.stringify({
                type: 'search',
                query,
                model: searchModel,
                topK: 5,
            })
        );
    };

    const analyzeSelected = () => {
        if (readyState !== ReadyState.OPEN || selectedEmbeddings.size < 2) return;

        sendMessage(
            JSON.stringify({
                type: 'analyze',
                ids: Array.from(selectedEmbeddings),
            })
        );
    };

    const refreshStore = () => {
        if (readyState !== ReadyState.OPEN) return;
        sendMessage(JSON.stringify({ type: 'get_store' }));
    };

    const clearStore = () => {
        if (readyState !== ReadyState.OPEN) return;
        if (confirm('Are you sure you want to clear all embeddings?')) {
            sendMessage(JSON.stringify({ type: 'clear' }));
        }
    };

    const deleteEmbedding = (id: string, event: React.MouseEvent) => {
        event.stopPropagation();
        if (readyState !== ReadyState.OPEN) return;

        sendMessage(
            JSON.stringify({
                type: 'delete',
                id,
            })
        );
    };

    const toggleSelection = (id: string) => {
        setSelectedEmbeddings(prev => {
            const newSet = new Set(prev);
            if (newSet.has(id)) {
                newSet.delete(id);
            } else {
                newSet.add(id);
            }
            return newSet;
        });
    };

    const addTextInput = () => {
        setTexts([...texts, '']);
    };

    const removeTextInput = (index: number) => {
        if (texts.length > 1) {
            setTexts(texts.filter((_, i) => i !== index));
        }
    };

    const updateText = (index: number, value: string) => {
        const newTexts = [...texts];
        newTexts[index] = value;
        setTexts(newTexts);
    };

    const clearTextInputs = () => {
        setTexts(['']);
    };

    const loadExampleSet = (setName: keyof typeof exampleSets) => {
        setTexts(exampleSets[setName]);
    };

    const showError = (message: string) => {
        setError(message);
        setTimeout(() => setError(null), 5000);
    };

    const generateServerCode = (): string => {
        const dimensionsLine = dimensions ? `dimensions: ${dimensions},` : '';

        return `import { ensembleEmbed } from '@just-every/ensemble';

const texts = [
    'The quick brown fox jumps over the lazy dog',
    'Machine learning is transforming technology',
    'Embeddings capture semantic meaning in text'
];

const options = {
    model: '${selectedModel}',${dimensionsLine ? '\n    ' + dimensionsLine : ''}
};

// Generate embeddings
try {
    const embeddings = await ensembleEmbed(texts, options);

    console.log('Generated embeddings:');
    embeddings.forEach((embedding, index) => {
        console.log(\`Text \${index + 1}: \${texts[index]}\`);
        console.log(\`Embedding: [\${embedding.slice(0, 5).join(', ')}...] (\${embedding.length}d)\`);
        console.log('---');
    });

    // Calculate similarity between first two embeddings
    const similarity = cosineSimilarity(embeddings[0], embeddings[1]);
    console.log(\`Similarity between first two texts: \${similarity.toFixed(4)}\`);

} catch (error) {
    console.error('Error generating embeddings:', error);
}

// Helper function to calculate cosine similarity
function cosineSimilarity(a, b) {
    const dotProduct = a.reduce((sum, val, i) => sum + val * b[i], 0);
    const magnitudeA = Math.sqrt(a.reduce((sum, val) => sum + val * val, 0));
    const magnitudeB = Math.sqrt(b.reduce((sum, val) => sum + val * val, 0));
    return dotProduct / (magnitudeA * magnitudeB);
}`;
    };

    const generateClientCode = (): string => {
        const dimensionsLine = dimensions ? `dimensions: ${dimensions},` : '';

        return `// Embedding similarity search example
import { ensembleEmbed } from '@just-every/ensemble';

class EmbeddingSearchEngine {
    constructor() {
        this.embeddings = [];
        this.texts = [];
    }

    async addDocument(text) {
        const embedding = await ensembleEmbed([text], {
            model: '${selectedModel}',${dimensionsLine ? '\n            ' + dimensionsLine : ''}
        });

        this.texts.push(text);
        this.embeddings.push(embedding[0]);

        console.log(\`Added document: "\${text.substring(0, 50)}..."\`);
    }

    async search(query, topK = 5) {
        if (this.embeddings.length === 0) {
            throw new Error('No documents indexed');
        }

        // Generate embedding for the query
        const queryEmbedding = await ensembleEmbed([query], {
            model: '${selectedModel}',${dimensionsLine ? '\n            ' + dimensionsLine : ''}
        });

        // Calculate similarities
        const similarities = this.embeddings.map((embedding, index) => ({
            text: this.texts[index],
            similarity: this.cosineSimilarity(queryEmbedding[0], embedding),
            index
        }));

        // Sort by similarity and return top results
        return similarities
            .sort((a, b) => b.similarity - a.similarity)
            .slice(0, topK);
    }

    cosineSimilarity(a, b) {
        const dotProduct = a.reduce((sum, val, i) => sum + val * b[i], 0);
        const magnitudeA = Math.sqrt(a.reduce((sum, val) => sum + val * val, 0));
        const magnitudeB = Math.sqrt(b.reduce((sum, val) => sum + val * val, 0));
        return dotProduct / (magnitudeA * magnitudeB);
    }
}

// Usage example
async function demo() {
    const searchEngine = new EmbeddingSearchEngine();

    // Add some documents
    await searchEngine.addDocument('Machine learning algorithms for data analysis');
    await searchEngine.addDocument('Cooking recipes for Italian cuisine');
    await searchEngine.addDocument('Deep learning neural network architectures');
    await searchEngine.addDocument('Travel guide for European destinations');

    // Search for similar documents
    const results = await searchEngine.search('AI and machine learning');

    console.log('Search results:');
    results.forEach((result, index) => {
        console.log(\`\${index + 1}. Similarity: \${result.similarity.toFixed(4)}\`);
        console.log(\`   Text: \${result.text}\`);
    });
}

// Run the demo
demo().catch(console.error);`;
    };

    return (
        <>
            <div className="container">
                <div className="header-card">
                    <div className="header-row">
                        <h1>
                            <svg width="32" height="32" viewBox="0 0 448 512" fill="currentColor">
                                <path d="M160 64c0-17.7-14.3-32-32-32s-32 14.3-32 32l0 64-64 0c-17.7 0-32 14.3-32 32s14.3 32 32 32l96 0c17.7 0 32-14.3 32-32l0-96zM32 320c-17.7 0-32 14.3-32 32s14.3 32 32 32l64 0 0 64c0 17.7 14.3 32 32 32s32-14.3 32-32l0-96c0-17.7-14.3-32-32-32l-96 0zM352 64c0-17.7-14.3-32-32-32s-32 14.3-32 32l0 96c0 17.7 14.3 32 32 32l96 0c17.7 0 32-14.3 32-32s-14.3-32-32-32l-64 0 0-64zM320 320c-17.7 0-32 14.3-32 32l0 96c0 17.7 14.3 32 32 32s32-14.3 32-32l0-64 64 0c17.7 0 32-14.3 32-32s-14.3-32-32-32l-96 0z" />
                            </svg>
                            Ensemble Embed Demo
                        </h1>
                        <button className="glass-button" onClick={() => setShowCodeModal(true)}>
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                                <path d="M9.4 16.6L4.8 12l4.6-4.6L8 6l-6 6 6 6 1.4-1.4zm5.2 0l4.6-4.6-4.6-4.6L16 6l6 6-6 6-1.4-1.4z" />
                            </svg>
                            <span>Show Code</span>
                        </button>
                    </div>
                </div>

                {/* Connection warning */}
                <ConnectionWarning readyState={readyState} port={3006} />

                <div className="main-grid">
                    {/* Embedding Creation */}
                    <div className="card">
                        <h2>Create Embeddings</h2>

                        <div className="input-section">
                            <div className="settings-grid">
                                <div className="setting-group">
                                    <label className="setting-label">Model</label>
                                    <select
                                        id="modelSelect"
                                        value={selectedModel}
                                        onChange={e => setSelectedModel(e.target.value)}>
                                        <option value="text-embedding-3-small">OpenAI Small (1536d)</option>
                                        <option value="text-embedding-3-large">OpenAI Large (3072d)</option>
                                        <option value="text-embedding-ada-002">OpenAI Ada v2 (1536d)</option>
                                        <option value="gemini-embedding-exp-03-07">Gemini Experimental (768d)</option>
                                    </select>
                                </div>
                                <div className="setting-group">
                                    <label className="setting-label">Dimensions (optional)</label>
                                    <select
                                        id="dimensionsSelect"
                                        value={dimensions}
                                        onChange={e => setDimensions(e.target.value)}>
                                        <option value="">Model Default</option>
                                        <option value="256">256</option>
                                        <option value="512">512</option>
                                        <option value="768">768</option>
                                        <option value="1024">1024</option>
                                        <option value="1536">1536</option>
                                        <option value="3072">3072</option>
                                    </select>
                                </div>
                            </div>

                            <div className="examples-section">
                                <strong>Example Sets:</strong>
                                <button className="glass-button" onClick={() => loadExampleSet('similar')}>
                                    <span>Similar Sentences</span>
                                </button>
                                <button className="glass-button" onClick={() => loadExampleSet('different')}>
                                    <span>Different Topics</span>
                                </button>
                                <button className="glass-button" onClick={() => loadExampleSet('languages')}>
                                    <span>Multiple Languages</span>
                                </button>
                                <button className="glass-button" onClick={() => loadExampleSet('semantic')}>
                                    <span>Semantic Variations</span>
                                </button>
                            </div>

                            <div className="text-inputs" id="textInputs">
                                <h3>Text Inputs</h3>
                                {texts.map((text, index) => (
                                    <div key={index} className="text-input-wrapper">
                                        <input
                                            type="text"
                                            placeholder="Enter text to embed..."
                                            value={text}
                                            onChange={e => updateText(index, e.target.value)}
                                        />
                                        <button className="icon-btn" onClick={() => removeTextInput(index)}>
                                            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                                                <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
                                            </svg>
                                        </button>
                                    </div>
                                ))}

                                <div className="controls">
                                    <button className="glass-button" onClick={addTextInput}>
                                        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                                            <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z" />
                                        </svg>
                                        <span>Add Text</span>
                                    </button>
                                </div>
                            </div>

                            <div className="controls">
                                <button
                                    id="embedBtn"
                                    className="primary-btn"
                                    onClick={createEmbeddings}
                                    disabled={
                                        readyState !== ReadyState.OPEN || isProcessing || texts.every(t => !t.trim())
                                    }>
                                    <svg width="20" height="20" viewBox="0 0 448 512" fill="currentColor">
                                        <path d="M160 64c0-17.7-14.3-32-32-32s-32 14.3-32 32l0 64-64 0c-17.7 0-32 14.3-32 32s14.3 32 32 32l96 0c17.7 0 32-14.3 32-32l0-96zM32 320c-17.7 0-32 14.3-32 32s14.3 32 32 32l64 0 0 64c0 17.7 14.3 32 32 32s32-14.3 32-32l0-96c0-17.7-14.3-32-32-32l-96 0zM352 64c0-17.7-14.3-32-32-32s-32 14.3-32 32l0 96c0 17.7 14.3 32 32 32l96 0c17.7 0 32-14.3 32-32s-14.3-32-32-32l-64 0 0-64zM320 320c-17.7 0-32 14.3-32 32l0 96c0 17.7 14.3 32 32 32s32-14.3 32-32l0-64 64 0c17.7 0 32-14.3 32-32s-14.3-32-32-32l-96 0z" />
                                    </svg>
                                    <span>Generate Embeddings</span>
                                </button>
                            </div>

                            <div className={`progress-bar ${isProcessing ? 'active' : ''}`} id="embedProgress">
                                <div
                                    className="progress-fill"
                                    id="embedProgressFill"
                                    style={{ width: `${progress}%` }}></div>
                            </div>
                        </div>

                        <div id="embedError">
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

                    {/* Stored Embeddings */}
                    <div className="card">
                        <h2>Stored Embeddings</h2>

                        <div className="controls" style={{ marginBottom: '16px', justifyContent: 'space-between' }}>
                            <button className="glass-button" onClick={refreshStore}>
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                                    <path d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z" />
                                </svg>
                                <span>Refresh</span>
                            </button>
                            {storedEmbeddings.length > 0 && (
                                <button className="danger-btn" onClick={clearStore}>
                                    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                                        <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" />
                                    </svg>
                                    <span>Clear All</span>
                                </button>
                            )}
                            <button
                                className="primary-btn"
                                onClick={analyzeSelected}
                                id="analyzeBtn"
                                disabled={selectedEmbeddings.size < 2}>
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                                    <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zM9 17H7v-7h2v7zm4 0h-2V7h2v10zm4 0h-2v-4h2v4z" />
                                </svg>
                                <span>Analyze Selected</span>
                            </button>
                        </div>

                        <div className="embeddings-list" id="embeddingsList">
                            {storedEmbeddings.length === 0 ? (
                                <p style={{ textAlign: 'center', color: 'var(--text-secondary)', padding: '40px' }}>
                                    No embeddings yet. Create some to get started!
                                </p>
                            ) : (
                                storedEmbeddings.map(emb => (
                                    <div
                                        key={emb.id}
                                        className={`embedding-item ${selectedEmbeddings.has(emb.id) ? 'selected' : ''}`}
                                        onClick={() => toggleSelection(emb.id)}
                                        data-id={emb.id}>
                                        <div className="embedding-header">
                                            <div className="embedding-text">{emb.text}</div>
                                            <button className="icon-btn" onClick={e => deleteEmbedding(emb.id, e)}>
                                                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                                                    <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" />
                                                </svg>
                                            </button>
                                        </div>
                                        <div className="embedding-meta">
                                            <span>Model: {emb.model}</span>
                                            <span>Dimensions: {emb.dimensions}</span>
                                            <span>Created: {new Date(emb.timestamp).toLocaleTimeString()}</span>
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>

                        <div className="stats-grid">
                            <div className="stat-card">
                                <div className="stat-value" id="totalEmbeddings">
                                    {storedEmbeddings.length}
                                </div>
                                <div className="stat-label">Total Embeddings</div>
                            </div>
                            <div className="stat-card">
                                <div className="stat-value" id="selectedCount">
                                    {selectedEmbeddings.size}
                                </div>
                                <div className="stat-label">Selected</div>
                            </div>
                        </div>
                    </div>
                    {/* Similarity Search */}
                    <div className="card full-width">
                        <h2>Similarity Search</h2>

                        <div className="search-section">
                            <div className="search-input-wrapper">
                                <input
                                    type="text"
                                    id="searchQuery"
                                    placeholder="Enter text to find similar embeddings..."
                                    value={searchQuery}
                                    onChange={e => setSearchQuery(e.target.value)}
                                    onKeyDown={e => e.key === 'Enter' && performSearch()}
                                />
                                <select
                                    id="searchModel"
                                    value={searchModel}
                                    onChange={e => setSearchModel(e.target.value)}>
                                    <option value="text-embedding-3-small">OpenAI Small</option>
                                    <option value="text-embedding-3-large">OpenAI Large</option>
                                    <option value="text-embedding-ada-002">OpenAI Ada v2</option>
                                    <option value="gemini-embedding-exp-03-07">Gemini</option>
                                </select>
                                <button
                                    className="primary-btn"
                                    onClick={performSearch}
                                    id="searchBtn"
                                    disabled={readyState !== ReadyState.OPEN || isSearching}>
                                    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                                        <path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z" />
                                    </svg>
                                    <span>Search</span>
                                </button>
                            </div>

                            <div className="search-results" id="searchResults">
                                {isSearching ? (
                                    <p style={{ color: 'var(--text-secondary)' }}>Searching...</p>
                                ) : searchResults.length > 0 ? (
                                    searchResults.map((result, index) => (
                                        <div key={index} className="result-item">
                                            <div className="result-header">
                                                <div>
                                                    <div style={{ fontWeight: 500, marginBottom: '4px' }}>
                                                        {result.text}
                                                    </div>
                                                    <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                                                        Model: {result.model} | Created:{' '}
                                                        {new Date(result.timestamp).toLocaleTimeString()}
                                                    </div>
                                                </div>
                                                <div className="similarity-score">
                                                    {(result.similarity * 100).toFixed(1)}%
                                                </div>
                                            </div>
                                            <div className="similarity-bar">
                                                <div
                                                    className="similarity-fill"
                                                    style={{ width: `${result.similarity * 100}%` }}></div>
                                            </div>
                                        </div>
                                    ))
                                ) : null}
                            </div>
                        </div>
                    </div>

                    {/* Analysis Results */}
                    {showAnalysis && (
                        <div className="card full-width" id="analysisCard">
                            <h2>Embedding Analysis</h2>
                            <div className="analysis-section">
                                <div className="analysis-content">{analysisText}</div>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Code Generation Modal */}
            {showCodeModal && (
                <div
                    id="codeModal"
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
                                id="serverCode"
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
                                <pre id="serverCodeContent">{generateServerCode()}</pre>
                            </div>
                            <div
                                id="clientCode"
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
                                <pre id="clientCodeContent">{generateClientCode()}</pre>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
};

export default EmbedDemo;
