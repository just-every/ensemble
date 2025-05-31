# Model Selection and Management

## Available Models

Ensemble supports models from multiple providers:
- **OpenAI**: GPT-4o, GPT-4o-mini, GPT-3.5-turbo
- **Anthropic**: Claude 3.5 Sonnet, Claude 3.5 Haiku, Claude 3 Opus
- **Google**: Gemini 2.0 Flash, Gemini 1.5 Pro, Gemini 1.5 Flash
- **DeepSeek**: DeepSeek Chat, DeepSeek Coder
- **xAI**: Grok 2, Grok Beta
- **OpenRouter**: Access to 100+ models

## Model Classes

Models are organized into classes based on their capabilities:

- **standard**: General-purpose models for everyday tasks
- **code**: Optimized for programming and technical tasks
- **reasoning**: Advanced models for complex logical reasoning
- **monologue**: Models supporting extended thinking/reasoning traces
- **embedding**: Models for generating text embeddings

## Using Model Classes

```typescript
import { getModelFromClass } from '@just-every/ensemble';

// Get the best available model for a task type
const codeModel = await getModelFromClass('code');
const reasoningModel = await getModelFromClass('reasoning');
```

## Model Registry

```typescript
import { MODEL_REGISTRY, findModel } from '@just-every/ensemble';

// Check if a model exists and get its info
const modelInfo = findModel('gpt-4o');
if (modelInfo) {
  console.log(`Provider: ${modelInfo.provider}`);
  console.log(`Input cost: $${modelInfo.cost.input_per_million}/M tokens`);
  console.log(`Context length: ${modelInfo.features.context_length}`);
}

// List all available models
for (const [modelName, info] of Object.entries(MODEL_REGISTRY)) {
  console.log(`${modelName}: ${info.provider}`);
}
```

## Custom Model Registration

```typescript
import { registerExternalModel } from '@just-every/ensemble';

// Register a custom model
registerExternalModel({
  id: 'my-custom-model',
  provider: 'custom',
  inputCost: 0.001,
  outputCost: 0.002,
  contextWindow: 8192,
  maxOutput: 4096,
  supportsTools: true,
  supportsVision: false,
  supportsStreaming: true
});
```