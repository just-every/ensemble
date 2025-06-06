# Model Scoring and Disabling

This feature allows you to control model selection through weighted randomization and model exclusion.

## Overview

The `@just-every/ensemble` package now supports two new properties on `AgentDefinition`:

- `modelScores`: Define custom scores (0-100) for models to control their selection probability
- `disabledModels`: List models that should never be selected

## Model Scores

Model scores allow you to assign weights to different models within a model class. Higher scores mean higher probability of selection.

### How It Works

- Models are selected using weighted randomization based on their scores
- Scores range from 0 to 100
- A score of 0 means the model will never be selected
- Models without explicit scores receive a default score of 50
- The probability of selection is proportional to the model's score relative to the total weight

### Example

```typescript
import { AgentDefinition } from '@just-every/ensemble';

const agent: AgentDefinition = {
    modelClass: 'standard',
    modelScores: {
        'gpt-4.1': 80,              // High probability
        'claude-3-5-haiku-latest': 60,   // Medium probability
        'gemini-2.5-flash-preview-05-20-low': 20,    // Low probability
        'deepseek-chat': 0,              // Never selected
        // Other models in the class get default score of 50
    },
};
```

In this example, if only these models are available:
- GPT-4.1 has 80/(80+60+20) = 50% chance of selection
- Claude has 60/(80+60+20) = 37.5% chance
- Gemini has 20/(80+60+20) = 12.5% chance
- DeepSeek will never be selected (score of 0)

## Disabled Models

The `disabledModels` property provides a simple way to exclude specific models from selection.

### Example

```typescript
const agent: AgentDefinition = {
    modelClass: 'reasoning',
    disabledModels: [
        'claude-opus-4-20250514',    // Too expensive
        'o3-high',                   // Rate limited
    ],
};
```

## Combining Scores and Disabled Models

You can use both features together for fine-grained control:

```typescript
const agent: AgentDefinition = {
    modelClass: 'standard',
    modelScores: {
        'gpt-4.1': 90,                    // Strongly preferred
        'claude-3-5-haiku-latest': 40,    // Less preferred
        'gemini-2.5-flash-preview-05-20-low': 10,     // Rarely used
    },
    disabledModels: [
        'deepseek-chat',    // Completely disabled
        'grok-3-mini-fast', // Completely disabled
    ],
};
```

## Integration with Model Classes

These features work seamlessly with the existing model class system:

1. First, models are selected from the specified `modelClass`
2. Disabled models are filtered out
3. Remaining models are selected using weighted randomization based on scores
4. If all models are disabled or unavailable, the system falls back to the first available model

## Use Cases

### Performance Optimization
Prefer faster models for low-latency applications:
```typescript
modelScores: {
    'gpt-4.1-mini': 90,    // Fast, preferred
    'gpt-4.1': 10,         // Slower, used rarely
}
```

### Cost Management
Prefer cheaper models while occasionally using premium ones:
```typescript
modelScores: {
    'claude-3-5-haiku-latest': 80,    // Cheap
    'claude-3-7-sonnet-latest': 20,   // More expensive
}
```

### A/B Testing
Test different models with controlled distribution:
```typescript
modelScores: {
    'model-a': 50,    // 50% of requests
    'model-b': 50,    // 50% of requests
}
```

### Gradual Migration
Slowly migrate from one model to another:
```typescript
// Week 1
modelScores: { 'old-model': 90, 'new-model': 10 }
// Week 2
modelScores: { 'old-model': 50, 'new-model': 50 }
// Week 3
modelScores: { 'old-model': 10, 'new-model': 90 }
```

## Notes

- Model scoring only affects models within the same class
- The `random` property in model classes must be true for weighted selection to work
- Scores are ignored when a specific `model` is set on the agent
- Both `modelScores` and `disabledModels` are optional
- These features work with the existing quota and API key validation system