# Perplexity Integration

Perplexity models are available through the OpenRouter provider in the ensemble package.

## Prerequisites

1. Get an OpenRouter API key from [openrouter.ai](https://openrouter.ai)
2. Add it to your `.env` file:
   ```bash
   OPENROUTER_API_KEY=sk-or-your-api-key-here
   ```

## Available Models

- `perplexity/sonar` - Fast, efficient model for general queries
- `perplexity/sonar-pro` - Enhanced model with better performance
- `perplexity/sonar-reasoning` - Optimized for reasoning tasks
- `perplexity/sonar-reasoning-pro` - Advanced reasoning capabilities
- `perplexity/sonar-deep-research` - Deep research with web search

## Usage Example

```typescript
import * as dotenv from 'dotenv';
import { ensembleRequest } from '@just-every/ensemble';

// Load environment variables
dotenv.config();

const messages = [
    {
        type: 'message',
        role: 'user',
        content: 'What are the latest AI developments?',
    },
];

const agent = {
    model: 'perplexity/sonar',
};

for await (const event of ensembleRequest(messages, agent)) {
    if (event.type === 'message_delta') {
        process.stdout.write(event.content);
    }
}
```

## Features

- Real-time web search integration
- Up-to-date information retrieval
- Citation support
- Tool calling capabilities
- Streaming responses

## Troubleshooting

### Authentication Error (401)

If you get a 401 error, check:

1. Your API key is correctly set in the `.env` file
2. The API key starts with `sk-or-`
3. You've loaded the environment variables with `dotenv.config()`
4. The API key has sufficient credits/quota

### Test Environment

Note: In the test environment (vitest), API keys are mocked. To test with real API keys, run the example scripts directly:

```bash
npx tsx examples/perplexity-example.ts
```

## Pricing

Perplexity models are priced per million tokens through OpenRouter:

- `perplexity/sonar`: $1.00 input / $1.00 output
- `perplexity/sonar-pro`: $3.00 input / $15.00 output
- `perplexity/sonar-reasoning`: $1.00 input / $5.00 output

Check [OpenRouter pricing](https://openrouter.ai/models) for current rates.