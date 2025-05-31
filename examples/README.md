# Ensemble Examples

This directory contains practical examples demonstrating how to use the ensemble module.

## Running Examples

All examples can be run directly with Node.js:

```bash
# From the ensemble directory
npm run build

# Run individual examples
node dist/examples/basic-request.js
node dist/examples/tool-calling.js
node dist/examples/tool-execution.js
node dist/examples/model-rotation.js
node dist/examples/stream-conversion.js
node dist/examples/error-handling.js
node dist/examples/cost-optimization.js
node dist/examples/openai-compatibility.js
```

**Note:** Make sure you have the required API keys set in your environment variables before running the examples.

## Examples Overview

### 1. Basic Request (`basic-request.ts`)
Shows the simplest way to make an LLM request and handle the streaming response.

**Key concepts:**
- Creating request messages
- Handling streaming events
- Basic error handling

### 2. Tool Calling (`tool-calling.ts`)
Demonstrates how to define and use tools (function calling) with LLMs.

**Key concepts:**
- Defining tool functions with TypeScript types
- Tool parameter schemas
- Processing tool calls in the stream
- Manual tool execution vs automatic

### 3. Tool Execution (`tool-execution.ts`)
Showcases automatic tool execution with real-world examples.

**Key concepts:**
- Multiple tools in one request
- Automatic tool execution
- Custom tool handlers
- Disabling tool execution with maxToolCalls

### 4. Model Rotation (`model-rotation.ts`)
Shows ensemble's intelligent model selection and rotation based on scores.

**Key concepts:**
- Model classes (standard, code, reasoning, monologue)
- Score-based selection
- Rate limit fallbacks
- Model information queries

### 5. Stream Conversion (`stream-conversion.ts`)
Advanced example showing how to convert streaming events into conversation history.

**Key concepts:**
- Stream-to-message conversion
- Building conversation threads
- Handling tool calls and results
- Custom callbacks for events

### 6. Error Handling (`error-handling.ts`)
Production-ready error handling patterns.

**Key concepts:**
- Retry logic with exponential backoff
- Rate limit handling
- Fallback chains
- Timeout management
- Graceful degradation

### 7. Cost Optimization (`cost-optimization.ts`)
Strategies for minimizing API costs while maintaining quality.

**Key concepts:**
- Smart model selection based on task complexity
- Response caching
- Batch processing
- Progressive enhancement
- Budget tracking and limits

### 8. OpenAI Compatibility (`openai-compatibility.ts`)
Drop-in replacement for OpenAI SDK with multi-model support.

**Key concepts:**
- OpenAI SDK compatible API
- chat.completions.create method
- Legacy completions.create support
- Streaming and non-streaming modes
- Using any ensemble model with OpenAI's API format

## Common Patterns

### Error Handling
```typescript
import { isRateLimitError, isAuthenticationError } from '@just-every/ensemble';

try {
    for await (const event of request(model, messages)) {
        if (event.type === 'error') {
            throw event.error; // Convert to exception
        }
        // Process events
    }
} catch (error) {
    if (isRateLimitError(error)) {
        // Wait and retry
        await sleep(error.retryAfter * 1000);
    } else if (isAuthenticationError(error)) {
        // Check API keys
        throw error;
    }
}
```

### Tool Definition with Types
```typescript
// Define parameter types
interface WeatherParams {
    city: string;
    unit?: 'celsius' | 'fahrenheit';
}

const weatherTool: ToolFunction = {
    function: async ({ city, unit = 'celsius' }: WeatherParams) => {
        const weather = await fetchWeather(city);
        return formatWeather(weather, unit);
    },
    definition: {
        type: 'function',
        function: {
            name: 'get_weather',
            description: 'Get current weather for a city',
            parameters: {
                type: 'object',
                properties: {
                    city: { 
                        type: 'string',
                        description: 'City name'
                    },
                    unit: {
                        type: 'string',
                        enum: ['celsius', 'fahrenheit'],
                        description: 'Temperature unit'
                    }
                },
                required: ['city']
            }
        }
    }
};
```

### Message Building
```typescript
const messages: ResponseInput = [
    // System/Developer message
    { 
        type: 'message', 
        role: 'developer', 
        content: 'You are a helpful assistant' 
    },
    
    // User message with text
    { 
        type: 'message', 
        role: 'user', 
        content: 'Hello!' 
    },
    
    // Multi-modal message
    {
        type: 'message',
        role: 'user',
        content: [
            { type: 'input_text', text: 'What is this?' },
            { type: 'input_image', image_url: 'data:image/jpeg;base64,...' }
        ]
    },
    
    // Tool interactions (automatically added by request())
    { 
        type: 'function_call',
        id: 'call_123',
        name: 'get_weather',
        arguments: '{"city": "Paris"}'
    },
    { 
        type: 'function_call_output',
        id: 'call_123',
        output: 'Sunny, 22°C'
    }
];
```

### Streaming Patterns
```typescript
// Collect full response
let fullText = '';
for await (const event of request(model, messages)) {
    if (event.type === 'text_delta') {
        fullText += event.delta;
    }
}

// Early termination
for await (const event of request(model, messages)) {
    if (event.type === 'text_delta') {
        fullText += event.delta;
        if (fullText.includes('STOP')) break;
    }
}

// Progress tracking
let tokens = 0;
for await (const event of request(model, messages)) {
    if (event.type === 'text_delta') {
        tokens++;
        updateProgress(tokens);
    }
}
```