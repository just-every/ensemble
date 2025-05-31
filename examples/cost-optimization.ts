/**
 * Cost Optimization Example
 * 
 * Demonstrates strategies for minimizing API costs while maintaining quality
 */

import { 
    request, 
    getModelFromClass, 
    findModel, 
    costTracker,
    MODEL_REGISTRY 
} from '../index.js';
import type { ResponseInput, ModelClassID } from '../types.js';

/**
 * Example 1: Model selection based on task complexity
 */
async function smartModelSelection() {
    console.log('=== Smart Model Selection ===\n');
    
    // Define tasks with different complexity levels
    const tasks = [
        {
            complexity: 'simple',
            message: 'What is 2 + 2?',
            modelClass: 'standard' as ModelClassID
        },
        {
            complexity: 'medium',
            message: 'Explain the difference between let and const in JavaScript',
            modelClass: 'code' as ModelClassID
        },
        {
            complexity: 'complex',
            message: 'Design a distributed cache system with high availability',
            modelClass: 'reasoning' as ModelClassID
        }
    ];
    
    for (const task of tasks) {
        const model = getModelFromClass(task.modelClass);
        const modelInfo = findModel(model);
        
        console.log(`\nTask (${task.complexity}): "${task.message}"`);
        console.log(`Selected model: ${model}`);
        console.log(`Cost: $${modelInfo?.inputCost}/M input, $${modelInfo?.outputCost}/M output\n`);
        
        let tokenCount = 0;
        for await (const event of request(model, [
            { type: 'message', role: 'user', content: task.message }
        ])) {
            if (event.type === 'text_delta') {
                process.stdout.write(event.delta);
                tokenCount += event.delta.length / 4; // Rough estimate
            } else if (event.type === 'cost_update') {
                console.log(`\n\nActual cost: $${event.usage.total_cost.toFixed(5)}`);
            }
        }
        console.log('\n---');
    }
}

/**
 * Example 2: Response caching for repeated queries
 */
class ResponseCache {
    private cache = new Map<string, { response: string; timestamp: number }>();
    private ttl = 3600000; // 1 hour TTL
    
    private getCacheKey(model: string, messages: ResponseInput): string {
        return `${model}:${JSON.stringify(messages)}`;
    }
    
    async getOrFetch(model: string, messages: ResponseInput): Promise<string> {
        const key = this.getCacheKey(model, messages);
        const cached = this.cache.get(key);
        
        // Check cache validity
        if (cached && Date.now() - cached.timestamp < this.ttl) {
            console.log('💰 Cache hit - saving API call');
            return cached.response;
        }
        
        // Fetch new response
        console.log('📡 Cache miss - making API call');
        let response = '';
        
        for await (const event of request(model, messages)) {
            if (event.type === 'text_delta') {
                response += event.delta;
                process.stdout.write(event.delta);
            }
        }
        
        // Cache the response
        this.cache.set(key, { response, timestamp: Date.now() });
        return response;
    }
}

async function demonstrateCaching() {
    console.log('\n\n=== Response Caching ===\n');
    
    const cache = new ResponseCache();
    const messages: ResponseInput = [
        { type: 'message', role: 'user', content: 'What is the capital of France?' }
    ];
    
    // First call - will hit API
    console.log('First call:');
    await cache.getOrFetch('gpt-3.5-turbo', messages);
    
    // Second call - will use cache
    console.log('\n\nSecond call (cached):');
    const cachedResponse = await cache.getOrFetch('gpt-3.5-turbo', messages);
    console.log(cachedResponse);
}

/**
 * Example 3: Batch processing for efficiency
 */
async function batchProcessing() {
    console.log('\n\n=== Batch Processing ===\n');
    
    // Items to process
    const items = [
        'Apple', 'Banana', 'Cherry', 'Date', 'Elderberry'
    ];
    
    // Option 1: Individual requests (expensive)
    console.log('Option 1: Individual requests\n');
    let individualCost = 0;
    
    for (const item of items.slice(0, 2)) { // Just show 2 for demo
        for await (const event of request('gpt-3.5-turbo', [
            { type: 'message', role: 'user', content: `Define: ${item}` }
        ])) {
            if (event.type === 'cost_update') {
                individualCost += event.usage.total_cost;
            }
        }
    }
    
    console.log(`\nCost for 2 individual requests: $${individualCost.toFixed(5)}`);
    console.log(`Projected cost for all ${items.length}: $${(individualCost * items.length / 2).toFixed(5)}`);
    
    // Option 2: Batched request (cheaper)
    console.log('\n\nOption 2: Batched request\n');
    
    const batchPrompt = `Define each of the following items in one sentence each:\n${items.map((item, i) => `${i + 1}. ${item}`).join('\n')}`;
    
    let batchCost = 0;
    for await (const event of request('gpt-3.5-turbo', [
        { type: 'message', role: 'user', content: batchPrompt }
    ])) {
        if (event.type === 'text_delta') {
            process.stdout.write(event.delta);
        } else if (event.type === 'cost_update') {
            batchCost = event.usage.total_cost;
        }
    }
    
    console.log(`\n\nBatch request cost: $${batchCost.toFixed(5)}`);
    console.log(`Savings: $${((individualCost * items.length / 2) - batchCost).toFixed(5)} (${Math.round(((individualCost * items.length / 2) - batchCost) / (individualCost * items.length / 2) * 100)}%)`);
}

/**
 * Example 4: Progressive enhancement
 */
async function progressiveEnhancement() {
    console.log('\n\n=== Progressive Enhancement ===\n');
    
    const userQuery = 'Write a Python function to calculate fibonacci numbers';
    
    // Step 1: Get basic implementation with cheap model
    console.log('Step 1: Basic implementation (cheap model)\n');
    let basicImplementation = '';
    
    for await (const event of request('gpt-3.5-turbo', [
        { type: 'message', role: 'user', content: userQuery }
    ])) {
        if (event.type === 'text_delta') {
            basicImplementation += event.delta;
            process.stdout.write(event.delta);
        }
    }
    
    // Step 2: Only enhance if user requests it
    console.log('\n\n[User requests optimization...]\n');
    console.log('Step 2: Enhancement (premium model)\n');
    
    for await (const event of request(getModelFromClass('code'), [
        { type: 'message', role: 'user', content: basicImplementation },
        { type: 'message', role: 'user', content: 'Optimize this code for performance and add proper documentation' }
    ])) {
        if (event.type === 'text_delta') {
            process.stdout.write(event.delta);
        }
    }
}

/**
 * Example 5: Cost tracking and budgeting
 */
async function costTrackingExample() {
    console.log('\n\n=== Cost Tracking & Budgeting ===\n');
    
    // Reset tracker for demo
    costTracker.reset();
    
    // Set a budget
    const budget = 0.10; // $0.10 budget
    let totalSpent = 0;
    
    const queries = [
        'Explain quantum computing',
        'Write a haiku about programming',
        'List 10 programming languages',
        'Explain recursion with an example'
    ];
    
    for (const query of queries) {
        // Check budget before making request
        if (totalSpent >= budget) {
            console.log(`\n⚠️ Budget exceeded! Stopping at $${totalSpent.toFixed(5)}`);
            break;
        }
        
        console.log(`\nQuery: "${query}"`);
        console.log(`Budget remaining: $${(budget - totalSpent).toFixed(5)}`);
        
        // Use cheapest model that works
        const model = totalSpent > budget * 0.7 ? 'gpt-3.5-turbo' : 'gpt-4o-mini';
        console.log(`Using model: ${model}\n`);
        
        for await (const event of request(model, [
            { type: 'message', role: 'user', content: query }
        ], {
            modelSettings: { maxTokens: 100 } // Limit response length
        })) {
            if (event.type === 'text_delta') {
                process.stdout.write(event.delta);
            } else if (event.type === 'cost_update') {
                totalSpent += event.usage.total_cost;
                console.log(`\nCost: $${event.usage.total_cost.toFixed(5)}`);
            }
        }
    }
    
    // Final report
    console.log('\n\n=== Cost Report ===');
    const usage = costTracker.getAllUsage();
    
    for (const [model, stats] of Object.entries(usage)) {
        console.log(`\n${model}:`);
        console.log(`  Requests: ${stats.request_count}`);
        console.log(`  Total tokens: ${stats.total_tokens}`);
        console.log(`  Total cost: $${stats.total_cost.toFixed(5)}`);
        console.log(`  Avg cost/request: $${(stats.total_cost / stats.request_count).toFixed(5)}`);
    }
    
    console.log(`\nTotal spent: $${totalSpent.toFixed(5)} of $${budget.toFixed(2)} budget`);
}

// Main execution
async function main() {
    console.log('Ensemble Cost Optimization Examples\n');
    console.log('===================================\n');
    
    try {
        await smartModelSelection();
        await demonstrateCaching();
        await batchProcessing();
        await progressiveEnhancement();
        await costTrackingExample();
    } catch (error) {
        console.error('\nError:', error);
    }
}

if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch(console.error);
}