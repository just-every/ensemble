import React, { useState, useEffect } from 'react';
import useWebSocket, { ReadyState } from 'react-use-websocket';
import './components/style.scss';
import ConnectionWarning from './components/ConnectionWarning';
import { EMBED_WS_URL } from './config/websocket';
import {
    DemoHeader,
    Card,
    GlassButton,
    GlassInput,
    StatsGrid,
    ModelSelector,
    ShowCodeButton,
    CodeModal,
    EmbeddingsList,
    SearchInput,
    SearchResults,
    type EmbeddingData,
    type SearchResult,
    formatNumber,
} from '@just-every/demo-ui';

const EmbedDemo: React.FC = () => {
    // State management
    const [texts, setTexts] = useState(['The quick brown fox jumps over the lazy dog']);
    const [selectedModel, setSelectedModel] = useState('text-embedding-3-small');
    const [dimensions, setDimensions] = useState('');
    const [isProcessing, setIsProcessing] = useState(false);
    const [storedEmbeddings, setStoredEmbeddings] = useState<EmbeddingData[]>([]);
    const [selectedEmbeddings, setSelectedEmbeddings] = useState<Set<string>>(new Set());
    const [searchQuery, setSearchQuery] = useState('');
    const [searchModel, setSearchModel] = useState('text-embedding-3-small');
    const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
    const [isSearching, setIsSearching] = useState(false);
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [analysisText, setAnalysisText] = useState('');
    const [showAnalysis, setShowAnalysis] = useState(false);
    const [showAnalysisModal, setShowAnalysisModal] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [progress, setProgress] = useState(0);
    const [showCodeModal, setShowCodeModal] = useState(false);

    // WebSocket configuration
    const { sendMessage, lastMessage, readyState } = useWebSocket(EMBED_WS_URL, {
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

    // Model options
    const modelGroups = [
        {
            label: 'OpenAI Models',
            options: [
                { value: 'text-embedding-3-small', label: 'OpenAI Small (1536d)' },
                { value: 'text-embedding-3-large', label: 'OpenAI Large (3072d)' },
                { value: 'text-embedding-ada-002', label: 'OpenAI Ada v2 (1536d)' },
            ],
        },
        {
            label: 'Gemini Models',
            options: [{ value: 'gemini-embedding-exp-03-07', label: 'Gemini Experimental (768d)' }],
        },
    ];

    const dimensionOptions = [
        { value: '', label: 'Model Default' },
        { value: '256', label: '256' },
        { value: '512', label: '512' },
        { value: '768', label: '768' },
        { value: '1024', label: '1024' },
        { value: '1536', label: '1536' },
        { value: '3072', label: '3072' },
    ];

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
        embeddings?: Array<{
            id: string;
            text: string;
            model: string;
            dimensions: number;
            embedding: number[];
            timestamp: number;
        }>;
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

            case 'store_data': {
                // Convert server embeddings to EmbeddingData format
                const embeddings =
                    data.embeddings?.map(emb => ({
                        id: emb.id,
                        text: emb.text,
                        model: emb.model,
                        dimensions: emb.dimensions,
                        embedding: emb.embedding,
                        timestamp: emb.timestamp,
                    })) || [];
                setStoredEmbeddings(embeddings);
                // Clean up selectedEmbeddings to remove any IDs that no longer exist
                setSelectedEmbeddings(prev => {
                    const validIds = new Set(embeddings.map(emb => emb.id));
                    const newSet = new Set<string>();
                    prev.forEach(id => {
                        if (validIds.has(id)) {
                            newSet.add(id);
                        }
                    });
                    return newSet;
                });
                break;
            }

            case 'search_start':
                setIsSearching(true);
                break;

            case 'search_complete':
                setIsSearching(false);
                setSearchResults(data.results || []);
                break;

            case 'analyze_start':
                console.log('Received analyze_start message');
                setIsAnalyzing(true);
                setShowAnalysisModal(true);
                break;

            case 'analyze_complete':
                console.log('Received analyze_complete message', data.analysis);
                setIsAnalyzing(false);
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
                setIsAnalyzing(false);
                setShowAnalysisModal(false);
                setShowAnalysis(false);
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
        console.log('analyzeSelected called', {
            readyState,
            isOpen: readyState === ReadyState.OPEN,
            selectedCount: selectedEmbeddings.size,
            selectedIds: Array.from(selectedEmbeddings),
        });

        if (readyState !== ReadyState.OPEN) {
            console.log('WebSocket not open');
            showError('WebSocket connection not established');
            return;
        }

        if (selectedEmbeddings.size < 2) {
            console.log('Not enough embeddings selected');
            showError('Please select at least 2 embeddings to analyze');
            return;
        }

        console.log('Sending analyze request with IDs:', Array.from(selectedEmbeddings));
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

    const handleEmbeddingSelect = (id: string) => {
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

    const handleEmbeddingDelete = (id: string) => {
        if (readyState !== ReadyState.OPEN) return;

        sendMessage(
            JSON.stringify({
                type: 'delete',
                id,
            })
        );
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
                <DemoHeader
                    title="Embed Demo"
                    icon={
                        <svg width="32" height="32" viewBox="0 0 448 512" fill="currentColor">
                            <path d="M160 64c0-17.7-14.3-32-32-32s-32 14.3-32 32l0 64-64 0c-17.7 0-32 14.3-32 32s14.3 32 32 32l96 0c17.7 0 32-14.3 32-32l0-96zM32 320c-17.7 0-32 14.3-32 32s14.3 32 32 32l64 0 0 64c0 17.7 14.3 32 32 32s32-14.3 32-32l0-96c0-17.7-14.3-32-32-32l-96 0zM352 64c0-17.7-14.3-32-32-32s-32 14.3-32 32l0 96c0 17.7 14.3 32 32 32l96 0c17.7 0 32-14.3 32-32s-14.3-32-32-32l-64 0 0-64zM320 320c-17.7 0-32 14.3-32 32l0 96c0 17.7 14.3 32 32 32s32-14.3 32-32l0-64 64 0c17.7 0 32-14.3 32-32s-14.3-32-32-32l-96 0z" />
                        </svg>
                    }>
                    <ShowCodeButton onClick={() => setShowCodeModal(true)} />
                </DemoHeader>

                {/* Connection warning */}
                <ConnectionWarning readyState={readyState} port={3006} />

                <div className="main-grid">
                    {/* Embedding Creation */}
                    <Card>
                        <h2>Create Embeddings</h2>

                        <div className="input-section">
                            <div className="settings-grid">
                                <div className="setting-group">
                                    <label className="setting-label">Model</label>
                                    <ModelSelector
                                        groups={modelGroups}
                                        selectedValue={selectedModel}
                                        onChange={setSelectedModel}
                                    />
                                </div>
                                <div className="setting-group">
                                    <label className="setting-label">Dimensions (optional)</label>
                                    <ModelSelector
                                        groups={[{ label: 'Dimensions', options: dimensionOptions }]}
                                        selectedValue={dimensions}
                                        onChange={setDimensions}
                                    />
                                </div>
                            </div>

                            <div className="examples-section">
                                <strong>Example Sets:</strong>
                                <GlassButton onClick={() => loadExampleSet('similar')}>
                                    <span>Similar Sentences</span>
                                </GlassButton>
                                <GlassButton onClick={() => loadExampleSet('different')}>
                                    <span>Different Topics</span>
                                </GlassButton>
                                <GlassButton onClick={() => loadExampleSet('languages')}>
                                    <span>Multiple Languages</span>
                                </GlassButton>
                                <GlassButton onClick={() => loadExampleSet('semantic')}>
                                    <span>Semantic Variations</span>
                                </GlassButton>
                            </div>

                            <div className="text-inputs">
                                <h3>Text Inputs</h3>
                                {texts.map((text, index) => (
                                    <div key={index} className="text-input-wrapper">
                                        <GlassInput
                                            type="text"
                                            placeholder="Enter text to embed..."
                                            value={text}
                                            onChange={(value: string) => updateText(index, value)}
                                        />
                                        <button className="icon-btn" onClick={() => removeTextInput(index)}>
                                            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                                                <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
                                            </svg>
                                        </button>
                                    </div>
                                ))}

                                <div className="controls">
                                    <GlassButton onClick={addTextInput}>
                                        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                                            <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z" />
                                        </svg>
                                        <span>Add Text</span>
                                    </GlassButton>
                                </div>
                            </div>

                            <div className="controls">
                                <GlassButton
                                    variant="primary"
                                    onClick={createEmbeddings}
                                    disabled={
                                        readyState !== ReadyState.OPEN || isProcessing || texts.every(t => !t.trim())
                                    }>
                                    <svg width="20" height="20" viewBox="0 0 448 512" fill="currentColor">
                                        <path d="M160 64c0-17.7-14.3-32-32-32s-32 14.3-32 32l0 64-64 0c-17.7 0-32 14.3-32 32s14.3 32 32 32l96 0c17.7 0 32-14.3 32-32l0-96zM32 320c-17.7 0-32 14.3-32 32s14.3 32 32 32l64 0 0 64c0 17.7 14.3 32 32 32s32-14.3 32-32l0-96c0-17.7-14.3-32-32-32l-96 0zM352 64c0-17.7-14.3-32-32-32s-32 14.3-32 32l0 96c0 17.7 14.3 32 32 32l96 0c17.7 0 32-14.3 32-32s-14.3-32-32-32l-64 0 0-64zM320 320c-17.7 0-32 14.3-32 32l0 96c0 17.7 14.3 32 32 32s32-14.3 32-32l0-64 64 0c17.7 0 32-14.3 32-32s-14.3-32-32-32l-96 0z" />
                                    </svg>
                                    <span>Generate Embeddings</span>
                                </GlassButton>
                            </div>

                            <div className={`progress-bar ${isProcessing ? 'active' : ''}`}>
                                <div className="progress-fill" style={{ width: `${progress}%` }}></div>
                            </div>
                        </div>

                        {error && (
                            <div className="error-message" style={{ marginTop: '16px' }}>
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                                    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z" />
                                </svg>
                                {error}
                            </div>
                        )}
                    </Card>

                    {/* Stored Embeddings */}
                    <Card>
                        <h2>Stored Embeddings</h2>

                        <div className="controls" style={{ marginBottom: '16px', justifyContent: 'space-between' }}>
                            <GlassButton onClick={refreshStore}>
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                                    <path d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z" />
                                </svg>
                                <span>Refresh</span>
                            </GlassButton>
                            {storedEmbeddings.length > 0 && (
                                <GlassButton variant="danger" onClick={clearStore}>
                                    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                                        <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" />
                                    </svg>
                                    <span>Clear All</span>
                                </GlassButton>
                            )}
                            <GlassButton
                                variant="primary"
                                onClick={analyzeSelected}
                                disabled={selectedEmbeddings.size < 2 || isAnalyzing}>
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                                    <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zM9 17H7v-7h2v7zm4 0h-2V7h2v10zm4 0h-2v-4h2v4z" />
                                </svg>
                                <span>Analyze Selected</span>
                            </GlassButton>
                        </div>

                        <EmbeddingsList
                            embeddings={storedEmbeddings}
                            selectedIds={selectedEmbeddings}
                            onItemClick={handleEmbeddingSelect}
                            onItemDelete={handleEmbeddingDelete}
                        />

                        <StatsGrid
                            stats={[
                                { label: 'Total Embeddings', value: formatNumber(storedEmbeddings.length), icon: '📊' },
                                { label: 'Selected', value: formatNumber(selectedEmbeddings.size), icon: '✓' },
                            ]}
                            columns={2}
                        />
                    </Card>

                    {/* Similarity Search */}
                    <Card className="full-width">
                        <h2>Similarity Search</h2>

                        <SearchInput
                            query={searchQuery}
                            onQueryChange={setSearchQuery}
                            onSearch={performSearch}
                            placeholder="Enter text to find similar embeddings..."
                            disabled={readyState !== ReadyState.OPEN || isSearching}
                            models={modelGroups.flatMap(group => group.options)}
                            selectedModel={searchModel}
                            onModelChange={setSearchModel}
                        />

                        <SearchResults results={searchResults} isSearching={isSearching} />
                    </Card>
                </div>
            </div>

            {showCodeModal && (
                <CodeModal
                    isOpen={showCodeModal}
                    onClose={() => setShowCodeModal(false)}
                    title="Generated Code"
                    tabs={[
                        { id: 'server', label: 'Server Code', code: generateServerCode() },
                        { id: 'client', label: 'Client Code', code: generateClientCode() },
                    ]}
                />
            )}

            {/* Analysis Modal */}
            {showAnalysisModal && (
                <div
                    className="modal-overlay active"
                    onClick={e => {
                        if (e.target === e.currentTarget && !isAnalyzing) {
                            setShowAnalysisModal(false);
                            setShowAnalysis(false);
                        }
                    }}>
                    <div className="modal">
                        <div className="modal-header">
                            <h2 className="modal-title">Embedding Analysis</h2>
                            {!isAnalyzing && (
                                <button
                                    className="modal-close"
                                    onClick={() => {
                                        setShowAnalysisModal(false);
                                        setShowAnalysis(false);
                                    }}>
                                    <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                                        <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
                                    </svg>
                                </button>
                            )}
                        </div>
                        <div className="modal-body">
                            {isAnalyzing ? (
                                <div style={{ textAlign: 'center', padding: '40px 20px' }}>
                                    <div style={{ marginBottom: '20px' }}>
                                        <svg
                                            width="48"
                                            height="48"
                                            viewBox="0 0 24 24"
                                            fill="currentColor"
                                            style={{ animation: 'spin 1s linear infinite' }}>
                                            <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zM9 17H7v-7h2v7zm4 0h-2V7h2v10zm4 0h-2v-4h2v4z" />
                                        </svg>
                                    </div>
                                    <h3 style={{ marginBottom: '16px', color: 'var(--text-primary)' }}>
                                        Analyzing Embeddings...
                                    </h3>
                                    <p style={{ color: 'var(--text-secondary)', marginBottom: '24px' }}>
                                        Computing similarity metrics and generating insights for your selected
                                        embeddings.
                                    </p>
                                    <div className="progress-bar active" style={{ width: '80%', margin: '0 auto' }}>
                                        <div
                                            className="progress-fill"
                                            style={{
                                                width: '100%',
                                                animation: 'pulse 2s ease-in-out infinite',
                                            }}></div>
                                    </div>
                                </div>
                            ) : showAnalysis ? (
                                <div className="analysis-section">
                                    <div
                                        className="analysis-content"
                                        style={{
                                            background: 'var(--surface-glass)',
                                            backdropFilter: 'var(--blur-glass)',
                                            border: '1px solid var(--border-glass)',
                                            borderRadius: '12px',
                                            padding: '20px',
                                            maxHeight: '400px',
                                            overflowY: 'auto',
                                            whiteSpace: 'pre-wrap',
                                            lineHeight: '1.6',
                                        }}>
                                        {analysisText}
                                    </div>
                                </div>
                            ) : null}
                        </div>
                    </div>
                </div>
            )}
        </>
    );
};

export default EmbedDemo;
