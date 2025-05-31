/**
 * Example: Text Embeddings and Semantic Search
 * 
 * This example demonstrates how to use the embed() function for:
 * - Generating embeddings for text
 * - Building a simple semantic search system
 * - Finding similar documents
 * - Implementing RAG (Retrieval Augmented Generation)
 */

import { embed, request } from '@just-every/ensemble';

// Helper function to calculate cosine similarity between two vectors
function cosineSimilarity(a: number[], b: number[]): number {
    const dotProduct = a.reduce((sum, val, i) => sum + val * b[i], 0);
    const normA = Math.sqrt(a.reduce((sum, val) => sum + val * val, 0));
    const normB = Math.sqrt(b.reduce((sum, val) => sum + val * val, 0));
    return dotProduct / (normA * normB);
}

// Simple document store with embeddings
class EmbeddingStore {
    private documents: Array<{
        id: string;
        content: string;
        embedding: number[];
        metadata?: any;
    }> = [];

    async addDocument(id: string, content: string, metadata?: any) {
        const embedding = await embed(content);
        this.documents.push({ id, content, embedding, metadata });
    }

    async search(query: string, topK: number = 5) {
        const queryEmbedding = await embed(query);
        
        // Calculate similarities
        const results = this.documents.map(doc => ({
            ...doc,
            similarity: cosineSimilarity(queryEmbedding, doc.embedding)
        }));
        
        // Sort by similarity and return top K
        return results
            .sort((a, b) => b.similarity - a.similarity)
            .slice(0, topK);
    }
}

async function main() {
    console.log('=== Basic Embedding Example ===\n');
    
    // Generate a simple embedding
    const embedding = await embed('The future of artificial intelligence');
    console.log(`Embedding dimension: ${embedding.length}`);
    console.log(`First 5 values: [${embedding.slice(0, 5).map(v => v.toFixed(4)).join(', ')}]`);
    
    console.log('\n=== Semantic Search Example ===\n');
    
    // Create a document store
    const store = new EmbeddingStore();
    
    // Add some documents
    const documents = [
        {
            id: 'doc1',
            content: 'Machine learning is a subset of artificial intelligence that enables systems to learn from data.',
            metadata: { category: 'AI', source: 'textbook' }
        },
        {
            id: 'doc2',
            content: 'Neural networks are computing systems inspired by biological neural networks in animal brains.',
            metadata: { category: 'AI', source: 'research' }
        },
        {
            id: 'doc3',
            content: 'Quantum computing uses quantum mechanics principles to process information in fundamentally new ways.',
            metadata: { category: 'Computing', source: 'article' }
        },
        {
            id: 'doc4',
            content: 'Renewable energy sources like solar and wind power are becoming increasingly cost-effective.',
            metadata: { category: 'Energy', source: 'report' }
        },
        {
            id: 'doc5',
            content: 'Deep learning has revolutionized computer vision, enabling machines to understand images like never before.',
            metadata: { category: 'AI', source: 'blog' }
        }
    ];
    
    console.log('Adding documents to store...');
    for (const doc of documents) {
        await store.addDocument(doc.id, doc.content, doc.metadata);
    }
    
    // Search for similar documents
    const queries = [
        'How do neural networks work?',
        'What is sustainable energy?',
        'Tell me about AI and machine learning'
    ];
    
    for (const query of queries) {
        console.log(`\nQuery: "${query}"`);
        const results = await store.search(query, 3);
        
        results.forEach((result, index) => {
            console.log(`${index + 1}. [${result.similarity.toFixed(3)}] ${result.id}: ${result.content.substring(0, 60)}...`);
        });
    }
    
    console.log('\n=== RAG (Retrieval Augmented Generation) Example ===\n');
    
    // User question
    const userQuestion = 'What are the main types of AI technologies?';
    console.log(`User Question: ${userQuestion}\n`);
    
    // 1. Retrieve relevant documents
    console.log('Retrieving relevant documents...');
    const relevantDocs = await store.search(userQuestion, 3);
    
    // 2. Build context from retrieved documents
    const context = relevantDocs
        .map(doc => doc.content)
        .join('\n\n');
    
    console.log('Found relevant context:');
    relevantDocs.forEach(doc => {
        console.log(`- [${doc.similarity.toFixed(3)}] ${doc.content.substring(0, 60)}...`);
    });
    
    // 3. Generate answer using LLM with retrieved context
    console.log('\nGenerating answer with context...\n');
    
    const messages = [
        {
            type: 'message' as const,
            role: 'developer' as const,
            content: 'You are a helpful AI assistant. Use the provided context to answer questions accurately.'
        },
        {
            type: 'message' as const,
            role: 'user' as const,
            content: `Context:\n${context}\n\nQuestion: ${userQuestion}`
        }
    ];
    
    let answer = '';
    for await (const event of request('gpt-4o-mini', messages)) {
        if (event.type === 'text_delta') {
            process.stdout.write(event.delta);
            answer += event.delta;
        }
    }
    console.log('\n');
    
    console.log('\n=== Model-Specific Embeddings ===\n');
    
    // Compare different embedding models
    const text = 'The quick brown fox jumps over the lazy dog';
    
    const models = [
        'text-embedding-3-small',
        'text-embedding-3-large',
        'text-embedding-ada-002'
    ];
    
    console.log(`Text: "${text}"\n`);
    
    for (const model of models) {
        try {
            const embedding = await embed(text, { model });
            console.log(`${model}:`);
            console.log(`  Dimension: ${embedding.length}`);
            console.log(`  First 3 values: [${embedding.slice(0, 3).map(v => v.toFixed(4)).join(', ')}]`);
        } catch (error) {
            console.log(`${model}: Error - ${error.message}`);
        }
    }
    
    console.log('\n=== Embedding Caching ===\n');
    
    // Demonstrate caching behavior
    const testText = 'Caching test: This text will be embedded twice';
    
    console.time('First embedding (not cached)');
    await embed(testText);
    console.timeEnd('First embedding (not cached)');
    
    console.time('Second embedding (cached)');
    await embed(testText);
    console.timeEnd('Second embedding (cached)');
    
    console.log('\nNote: The second embedding should be much faster due to caching!');
}

if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch(console.error);
}