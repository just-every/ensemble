/**
 * Example: Using embeddings for semantic search
 * 
 * This example demonstrates how to use the embed() function
 * to generate embeddings for text and perform similarity search.
 */

import { embed } from '@just-every/ensemble';

// Helper function to calculate cosine similarity between two vectors
function cosineSimilarity(a: number[], b: number[]): number {
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    
    for (let i = 0; i < a.length; i++) {
        dotProduct += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
    }
    
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

async function main() {
    // Sample documents
    const documents = [
        "The cat sat on the mat.",
        "Dogs are loyal companions.",
        "Machine learning is transforming technology.",
        "The weather is sunny today.",
        "Artificial intelligence helps solve complex problems."
    ];
    
    console.log('Generating embeddings for documents...');
    
    // Generate embeddings for all documents
    const embeddings = await Promise.all(
        documents.map(doc => embed(doc))
    );
    
    console.log(`Generated ${embeddings.length} embeddings of dimension ${embeddings[0].length}`);
    
    // Search queries
    const queries = [
        "pets and animals",
        "AI and technology",
        "climate and weather"
    ];
    
    for (const query of queries) {
        console.log(`\nSearching for: "${query}"`);
        
        // Generate embedding for the query
        const queryEmbedding = await embed(query);
        
        // Calculate similarities
        const similarities = embeddings.map((docEmbedding, index) => ({
            document: documents[index],
            similarity: cosineSimilarity(queryEmbedding, docEmbedding)
        }));
        
        // Sort by similarity
        similarities.sort((a, b) => b.similarity - a.similarity);
        
        // Show top 3 results
        console.log('Top 3 results:');
        similarities.slice(0, 3).forEach((result, i) => {
            console.log(`  ${i + 1}. "${result.document}" (similarity: ${result.similarity.toFixed(3)})`);
        });
    }
    
    // Example with specific model
    console.log('\n\nUsing a specific embedding model:');
    const largeEmbedding = await embed("Advanced text processing", {
        model: 'text-embedding-3-large'
    });
    console.log(`Large model embedding dimension: ${largeEmbedding.length}`);
    
    // Example with caching (second call will be instant)
    console.time('First embedding');
    await embed("This will be cached");
    console.timeEnd('First embedding');
    
    console.time('Cached embedding');
    await embed("This will be cached");
    console.timeEnd('Cached embedding');
}

if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch(console.error);
}