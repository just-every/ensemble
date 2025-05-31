/**
 * OpenAI Compatibility Example
 * 
 * Demonstrates how to use ensemble as a drop-in replacement for the OpenAI SDK.
 * This allows easy migration from OpenAI to ensemble's multi-provider support.
 */

import OpenAICompat from '../openai-compat.js';
// Or if you're replacing OpenAI SDK:
// import OpenAI from '@just-every/ensemble/openai-compat';

/**
 * Example 1: Direct replacement for OpenAI client
 */
async function dropInReplacement() {
    console.log('=== Drop-in Replacement Example ===\n');
    
    // Instead of:
    // const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    
    // Use:
    const openai = OpenAICompat;
    
    // Now use exactly like OpenAI SDK
    const completion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',  // Works with any ensemble-supported model
        messages: [
            { role: 'system', content: 'You are a helpful assistant.' },
            { role: 'user', content: 'What is TypeScript?' }
        ],
        temperature: 0.7,
        max_tokens: 150
    });
    
    console.log('Response:', completion.choices[0].message.content);
    console.log('Tokens used:', completion.usage?.total_tokens);
}

/**
 * Example 2: Streaming chat completions
 */
async function streamingExample() {
    console.log('\n\n=== Streaming Example ===\n');
    
    const openai = OpenAICompat;
    
    const stream = await openai.chat.completions.create({
        model: 'claude-3.5-sonnet',  // Use any model!
        messages: [
            { role: 'user', content: 'Write a haiku about programming' }
        ],
        stream: true
    });
    
    console.log('Streaming response: ');
    for await (const chunk of stream) {
        const content = chunk.choices[0].delta.content;
        if (content) {
            process.stdout.write(content);
        }
    }
    console.log('\n');
}

/**
 * Example 3: Function calling (tools)
 */
async function functionCallingExample() {
    console.log('\n\n=== Function Calling Example ===\n');
    
    const openai = OpenAICompat;
    
    const response = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [
            { role: 'user', content: "What's the weather like in San Francisco?" }
        ],
        tools: [{
            type: 'function',
            function: {
                name: 'get_weather',
                description: 'Get the current weather in a given location',
                parameters: {
                    type: 'object',
                    properties: {
                        location: {
                            type: 'string',
                            description: 'The city and state, e.g. San Francisco, CA',
                        },
                        unit: {
                            type: 'string',
                            enum: ['celsius', 'fahrenheit'],
                        },
                    },
                    required: ['location'],
                },
            },
        }],
        tool_choice: 'auto',
    });
    
    console.log('Response:', response.choices[0].message);
    
    // Check if the model wants to use a tool
    if (response.choices[0].message.tool_calls) {
        console.log('Tool calls requested:', response.choices[0].message.tool_calls);
    }
}

/**
 * Example 4: Legacy completions API
 */
async function legacyCompletionsExample() {
    console.log('\n\n=== Legacy Completions API ===\n');
    
    const openai = OpenAICompat;
    
    // Non-streaming completion
    const completion = await openai.completions.create({
        model: 'gpt-3.5-turbo',  // Any model works
        prompt: 'Once upon a time in a land far away,',
        max_tokens: 50,
        temperature: 0.8,
        stop: ['.']
    });
    
    console.log('Completion:', completion.choices[0].text);
    
    // Streaming completion
    console.log('\n\nStreaming completion:');
    const stream = await openai.completions.create({
        model: 'claude-3.5-haiku',
        prompt: 'The best programming language is',
        max_tokens: 100,
        stream: true
    });
    
    for await (const chunk of stream) {
        process.stdout.write(chunk.choices[0].text);
    }
    console.log('\n');
}

/**
 * Example 5: Using different models seamlessly
 */
async function multiModelExample() {
    console.log('\n\n=== Multi-Model Example ===\n');
    
    const openai = OpenAICompat;
    
    const models = [
        'gpt-4o-mini',
        'claude-3.5-sonnet',
        'gemini-2.0-flash',
        'deepseek-chat'
    ];
    
    const prompt = 'Explain quantum computing in one sentence.';
    
    for (const model of models) {
        try {
            console.log(`\n${model}:`);
            const response = await openai.chat.completions.create({
                model,
                messages: [{ role: 'user', content: prompt }],
                max_tokens: 100
            });
            
            console.log(response.choices[0].message.content);
        } catch (error) {
            console.log(`Error with ${model}: ${error.message}`);
        }
    }
}

/**
 * Example 6: Advanced features
 */
async function advancedExample() {
    console.log('\n\n=== Advanced Features ===\n');
    
    const openai = OpenAICompat;
    
    // JSON mode
    console.log('JSON mode response:');
    const jsonResponse = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [
            { role: 'user', content: 'List 3 programming languages with their year of creation as JSON' }
        ],
        response_format: { type: 'json_object' }
    });
    
    const jsonContent = jsonResponse.choices[0].message.content;
    console.log(JSON.parse(jsonContent!));
    
    // With seed for reproducibility
    console.log('\n\nWith seed (reproducible):');
    const seededResponse = await openai.chat.completions.create({
        model: 'gpt-3.5-turbo',
        messages: [
            { role: 'user', content: 'Generate a random number between 1 and 10' }
        ],
        seed: 12345,
        temperature: 1
    });
    
    console.log(seededResponse.choices[0].message.content);
}

// Main execution
async function main() {
    console.log('OpenAI Compatibility Examples\n');
    console.log('=============================\n');
    console.log('These examples show how to use ensemble as a drop-in replacement for OpenAI SDK.\n');
    
    try {
        await dropInReplacement();
        await streamingExample();
        await functionCallingExample();
        await legacyCompletionsExample();
        await multiModelExample();
        await advancedExample();
        
        console.log('\n\nAll examples completed!');
        console.log('\nNote: You can use any model supported by ensemble, not just OpenAI models!');
    } catch (error) {
        console.error('\nError:', error);
    }
}

if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch(console.error);
}