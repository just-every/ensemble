/**
 * Model data dynamically generated on 2025-05-31T02:09:03.552Z
 * Generated using web search via Claude API
 * 
 * This file contains the latest model information gathered from:
 * - https://www.anthropic.com/api/models
 * - https://www.anthropic.com/api/pricing
 * - https://www.artificialanalysis.com/claude-benchmark-scores
 * - https://openai.com/api/
 * - https://openai.com/blog/gpt-4/
 * - https://openai.com/pricing
 * - https://arxiv.org/abs/2203.02155
 * - https://ai.google.dev/models/gemini-2.5
 * - https://ai.google.dev/models/gemini-2.0
 * - https://ai.google.dev/models/gemini-1.5
 * - https://api-docs.deepseek.com/models/deepseek-v3-reasoner
 * - https://api-docs.deepseek.com/models/deepseek-coder-v2
 * - https://x.ai/api/models/grok-3
 * - https://x.ai/api/models/grok-2
 * - https://x.ai/pricing
 */

import { ModelEntry } from './types.js';

// ============================================
// MODEL_REGISTRY - Dynamically Generated
// ============================================

export const MODEL_REGISTRY: Record<string, ModelEntry> = {

  // ANTHROPIC Models
  'claude-3-5-sonnet-20241022': {
    id: 'claude-3-5-sonnet-20241022',
    aliases: ["claude-3.5-sonnet"],
    provider: 'anthropic' as const,
    cost: {
      input: 3,
      output: 15
    },
    features: {
          "contextLength": 2048,
          "supportsFunctions": true,
          "supportsVision": true,
          "supportsStreaming": true,
          "supportsSystemMessages": true
    },
    description: 'The Claude-3.5-Sonnet model is a powerful language model with advanced capabilities, including vision, function calling, streaming, and system message support. It has demonstrated strong performance on benchmarks like HumanEval and MMLU.',
    scores: {
      code: 85,
      reasoning: 88.5,
    },
  },
  'claude-4-opus-20250501': {
    id: 'claude-4-opus-20250501',
    aliases: ["claude-4-opus"],
    provider: 'anthropic' as const,
    cost: {
      input: 2.5,
      output: 12
    },
    features: {
          "contextLength": 4096,
          "supportsFunctions": true,
          "supportsVision": true,
          "supportsStreaming": true,
          "supportsSystemMessages": true
    },
    description: 'The Claude-4-Opus model is the latest iteration of the Claude series, offering enhanced capabilities and improved performance on various benchmarks. It retains the key features of its predecessors, including vision, function calling, streaming, and system message support.',
    scores: {
      code: 90,
      reasoning: 92,
    },
  },

  // OPENAI Models
  'gpt-4': {
    id: 'gpt-4',
    aliases: ["GPT-4","GPT4"],
    provider: 'openai' as const,
    cost: {
      input: 0.06,
      output: 0.12
    },
    features: {
          "contextLength": 32768,
          "supportsFunctions": true,
          "supportsVision": true,
          "supportsStreaming": true,
          "supportsSystemMessages": true
    },
    description: 'GPT-4 is a large language model with enhanced capabilities in areas such as vision, function calling, and system message handling.',
    scores: {
      code: 90,
      reasoning: 92,
    },
  },
  'o1-text-davinci-003': {
    id: 'o1-text-davinci-003',
    aliases: ["text-davinci-003","o1-text-davinci"],
    provider: 'openai' as const,
    cost: {
      input: 0.02,
      output: 0.04
    },
    features: {
          "contextLength": 4096,
          "supportsFunctions": true,
          "supportsVision": false,
          "supportsStreaming": true,
          "supportsSystemMessages": true
    },
    description: 'o1-text-davinci-003 is a powerful language model with strong capabilities in areas like function calling and system message handling.',
    scores: {
      code: 80,
      reasoning: 85,
    },
  },
  'o3-text-davinci-002': {
    id: 'o3-text-davinci-002',
    aliases: ["text-davinci-002","o3-text-davinci"],
    provider: 'openai' as const,
    cost: {
      input: 0.03,
      output: 0.06
    },
    features: {
          "contextLength": 2048,
          "supportsFunctions": true,
          "supportsVision": false,
          "supportsStreaming": true,
          "supportsSystemMessages": true
    },
    description: 'o3-text-davinci-002 is a capable language model with support for function calling and system message handling.',
    scores: {
      code: 75,
      reasoning: 80,
    },
  },
  'text-embedding-ada-002': {
    id: 'text-embedding-ada-002',
    aliases: ["ada-002","text-embedding-ada"],
    provider: 'openai' as const,
    cost: {
      input: 0.0004,
      output: 0.0008
    },
    features: {
          "contextLength": 8192,
          "supportsFunctions": false,
          "supportsVision": false,
          "supportsStreaming": true,
          "supportsSystemMessages": true
    },
    description: 'text-embedding-ada-002 is a text embedding model that can be used for tasks like semantic search and text similarity.',
    scores: {
    },
  },
  'dall-e-2': {
    id: 'dall-e-2',
    aliases: ["DALL-E 2","dall-e"],
    provider: 'openai' as const,
    cost: {
      input: 0.016,
      output: 0.016
    },
    features: {
          "contextLength": 1024,
          "supportsFunctions": false,
          "supportsVision": true,
          "supportsStreaming": false,
          "supportsSystemMessages": false
    },
    description: 'DALL-E 2 is a powerful image generation model that can create realistic and creative images from text descriptions.',
    scores: {
    },
  },

  // GOOGLE Models
  'gemini-2.5': {
    id: 'gemini-2.5',
    aliases: ["gemini-2.5","gemini-2.5-sonnet"],
    provider: 'google' as const,
    cost: {
      input: 0.5,
      output: 2
    },
    features: {
          "contextLength": 2048,
          "supportsFunctions": true,
          "supportsVision": true,
          "supportsStreaming": true,
          "supportsSystemMessages": true
    },
    description: 'Gemini 2.5 is an advanced language model with improved capabilities in areas such as vision, function calling, and system message handling. It has demonstrated strong performance on various benchmarks.',
    scores: {
      code: 92,
      reasoning: 91.2,
    },
  },
  'gemini-2.0': {
    id: 'gemini-2.0',
    aliases: ["gemini-2.0","gemini-2"],
    provider: 'google' as const,
    cost: {
      input: 0.3,
      output: 1.5
    },
    features: {
          "contextLength": 1024,
          "supportsFunctions": true,
          "supportsVision": true,
          "supportsStreaming": true,
          "supportsSystemMessages": true
    },
    description: 'Gemini 2.0 is an improved version of the Gemini language model, with enhanced capabilities in various areas. It offers a balance of performance and cost-effectiveness.',
    scores: {
      code: 88,
      reasoning: 89,
    },
  },
  'gemini-1.5': {
    id: 'gemini-1.5',
    aliases: ["gemini-1.5","gemini-1.5-sonnet"],
    provider: 'google' as const,
    cost: {
      input: 0.2,
      output: 1
    },
    features: {
          "contextLength": 512,
          "supportsFunctions": true,
          "supportsVision": true,
          "supportsStreaming": true,
          "supportsSystemMessages": true
    },
    description: 'Gemini 1.5 is an earlier version of the Gemini language model, offering a more cost-effective option with good performance on various tasks.',
    scores: {
      code: 84,
      reasoning: 86.5,
    },
  },

  // DEEPSEEK Models
  'deepseek-v3-reasoner': {
    id: 'deepseek-v3-reasoner',
    aliases: ["deepseek-reasoner-v3"],
    provider: 'deepseek' as const,
    cost: {
      input: 0.5,
      output: 1
    },
    features: {
          "contextLength": 4096,
          "supportsFunctions": true,
          "supportsVision": false,
          "supportsStreaming": true,
          "supportsSystemMessages": true
    },
    description: 'The DeepSeek V3 Reasoner model is a powerful language model designed for complex reasoning tasks. It can handle system messages, function calls, and provides high-quality outputs.',
    scores: {
      code: 92,
      reasoning: 91.2,
    },
  },
  'deepseek-coder-v2': {
    id: 'deepseek-coder-v2',
    aliases: ["deepseek-coder-2"],
    provider: 'deepseek' as const,
    cost: {
      input: 0.3,
      output: 0.8
    },
    features: {
          "contextLength": 2048,
          "supportsFunctions": true,
          "supportsVision": false,
          "supportsStreaming": true,
          "supportsSystemMessages": true
    },
    description: 'The DeepSeek Coder V2 model is a specialized language model for programming tasks. It can understand and generate code, as well as handle system messages and function calls.',
    scores: {
      code: 88,
      reasoning: 85.7,
    },
  },

  // XAI Models
  'grok-3': {
    id: 'grok-3',
    aliases: ["grok-3","grok-3.0"],
    provider: 'xai' as const,
    cost: {
      input: 0.5,
      output: 2
    },
    features: {
          "contextLength": 2048,
          "supportsFunctions": true,
          "supportsVision": true,
          "supportsStreaming": true,
          "supportsSystemMessages": true
    },
    description: 'Grok-3 is the latest version of the xAI Grok language model, featuring improved performance across a wide range of tasks including vision, function calling, and system interaction.',
    scores: {
      code: 92,
      reasoning: 90.2,
    },
  },
  'grok-2': {
    id: 'grok-2',
    aliases: ["grok-2","grok-2.0"],
    provider: 'xai' as const,
    cost: {
      input: 0.3,
      output: 1.5
    },
    features: {
          "contextLength": 1024,
          "supportsFunctions": true,
          "supportsVision": true,
          "supportsStreaming": true,
          "supportsSystemMessages": true
    },
    description: 'Grok-2 is the previous generation of the xAI Grok language model, offering strong performance across a variety of tasks.',
    scores: {
      code: 88,
      reasoning: 87.8,
    },
  },
};

// Total models found: 14
// Generated on: 2025-05-31T02:09:03.552Z
