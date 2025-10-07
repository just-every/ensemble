/**
 * model_data.ts
 *
 * Model data for all supported LLM providers.
 * This file consolidates information about all supported models including:
 * - Basic model metadata
 * - Cost information (including tiered pricing)
 * - Grouping by capability
 * - Feature information (context length, modalities, tool use, etc.)
 */

// Import all model-related types from types.ts
import {
    ModelClassID,
    ModelProviderID,
    TieredPrice,
    TimeBasedPrice,
    ModalityPrice,
    ModelCost,
    ModelFeatures,
    ModelEntry,
    ModelUsage,
    ModelClass,
} from '../types/types.js';

// Import external model functions
import { getExternalModel } from '../utils/external_models.js';

// Re-export for backward compatibility
export type {
    ModelClassID,
    ModelProviderID,
    TieredPrice,
    TimeBasedPrice,
    ModalityPrice,
    ModelCost,
    ModelFeatures,
    ModelEntry,
    ModelUsage,
    ModelClass,
};

// --- MODEL_CLASSES remains largely the same, but ensure model IDs match the registry ---
// (Keep your existing MODEL_CLASSES definition here, just ensure IDs are consistent
//  with the updated MODEL_REGISTRY below)
// Define model classes object with a type assertion to avoid TypeScript errors
// This allows us to use a subset of the ModelClassID types
export const MODEL_CLASSES = {
    // Standard models with good all-around capabilities
    standard: {
        models: [
            'gpt-5-mini', // OpenAI
            'gemini-2.5-flash-preview-05-20', // Google
            'claude-3-5-haiku-latest', // Anthropic
            'grok-3-mini', // X.AI
        ],
        random: true,
    },

    // Mini/smaller models - faster but less capable
    mini: {
        models: [
            'gpt-5-nano', // OpenAI
            'gemini-2.5-flash-lite-preview-06-17', // Google
            'claude-3-5-haiku-latest', // Anthropic
            'grok-3-mini', // X.AI
            'mistral/ministral-8b', // Mistral/OpenRouter
            'openai/gpt-oss-20b', // OpenAI OSS/OpenRouter
        ],
        random: true,
    },

    // Advanced reasoning models
    reasoning: {
        models: [
            'gpt-5-max', // OpenAI
            'gemini-2.5-pro-preview-06-05', // Google
            'claude-opus-4-1-20250805-max', // Anthropic
            'grok-4', // X.AI
            'mistralai/magistral-medium-2506:thinking', // Mistral/OpenRouter
            'qwen3-235b-a22b-thinking-2507', // Qwen/OpenRouter
        ],
        random: true,
    },

    // Fast, cheap reasoning models
    reasoning_mini: {
        models: [
            'gemini-2.5-flash-preview-05-20-medium', // Google
            'grok-3-mini', // X.AI
            'o3-low', // OpenAI
            'openai/gpt-oss-120b', // OpenAI OSS/OpenRouter
        ],
        random: true,
    },

    // Monologue models
    monologue: {
        models: [
            'gpt-5-chat-latest', // OpenAI
            'gemini-2.5-pro-preview-06-05', // Google
            'gemini-2.5-flash-preview-05-20-medium', // Google
            'o3-medium', // OpenAI
            'claude-sonnet-4-20250514-medium', // Anthropic
        ],
        random: true,
    },

    // Metacognition models
    metacognition: {
        models: [
            'gpt-5', // OpenAI
            'gpt-5-mini', // OpenAI
            'gemini-2.5-pro-preview-06-05', // Google
            'gemini-2.5-flash-preview-05-20-high', // Google
            'claude-sonnet-4-20250514-medium', // Anthropic
            'grok-3-mini', // X.AI
        ],
        random: true,
    },

    // Programming models
    code: {
        models: [
            'gpt-5', // OpenAI
            'o3-high', // OpenAI
            'gemini-2.5-pro-preview-06-05-medium', // Google
            'gemini-2.5-flash-preview-05-20-max', // Google
            'claude-opus-4-1-20250805-medium', // Anthropic
            'claude-sonnet-4-20250514-max', // Anthropic
            'grok-4-medium', // X.AI
            'qwen3-coder', // Qwen/OpenRouter
        ],
        random: true,
    },

    // Writing models - optimized for conversation and text generation
    writing: {
        models: [
            'gpt-5-mini', // OpenAI
            'gemini-2.5-flash-lite-preview-06-17', // Google
        ],
        random: true,
    },

    // Summary models - optimized for extracting information from text
    // High quality, low cost allows this to be used heavily and reduce token usage for other models
    summary: {
        models: [
            'gpt-5-mini', // OpenAI
            'gemini-2.5-flash-lite-preview-06-17', // Google
        ],
        random: true,
    },

    // Models with vision capabilities
    vision: {
        models: [
            'gpt-5', // OpenAI
            'o3-high', // OpenAI
            'gemini-2.5-pro-preview-06-05', // Google
            'claude-opus-4-1-20250805-low', // Anthropic
            'grok-4', // X.AI
        ],
        random: true,
    },

    // Mini models with vision capabilities
    vision_mini: {
        models: [
            'gpt-5-mini-medium', // OpenAI
            'o3-low', // OpenAI
            'gemini-2.5-flash-lite-preview-06-17', // Google
            'gemini-2.5-flash-preview-05-20', // Google
            'claude-sonnet-4-20250514-low', // Anthropic
        ],
        random: true,
    },

    // Models with search capabilities
    search: {
        models: [
            'gpt-5-mini', // OpenAI
            'o3-deep-research', // OpenAI
            'gemini-2.5-flash-lite-preview-06-17', // Google
            'perplexity/sonar-deep-research', // Perplexity
        ],
        random: true,
    },

    // Models with very large context windows (near 1M tokens)
    long: {
        models: [
            'gpt-4.1', // OpenAI - 1M context
            'gpt-4.1-nano', // OpenAI - 1M context
            'gpt-4.1-mini', // OpenAI - 1M context
            'gemini-2.5-pro-preview-06-05', // Google - 1M context
            'gemini-2.5-flash-preview-05-20-medium', // Google - 1M context
            'gemini-2.5-flash-preview-05-20-low', // Google - 1M context
            'gemini-2.5-flash-lite-preview-06-17', // Google - 1M context
        ],
        random: true,
        description: 'Models with very large context windows (near 1M tokens) for processing long documents',
    },

    image_generation: {
        models: [
            'gpt-image-1', // OpenAI GPT-Image-1 (latest, supports editing)
            'gemini-2.5-flash-image-preview', // Google Gemini image model (Preview)
            'seedream-4', // ByteDance Seedream 4.0 via BytePlus ModelArk
            'luma-photon-1', // Luma Photon 1
            'luma-photon-flash-1', // Luma Photon Flash 1
            'ideogram-3.0', // Ideogram 3.0
            'midjourney-v7', // Midjourney V7 (via third-party API)
            'flux-kontext-pro', // Fireworks: FLUX Kontext Pro
            'stability-ultra', // Stability: Stable Image Ultra
            'runway-gen4-image', // Runway official API
            'runway-gen4-image-turbo', // Runway official API (turbo)
            'flux-pro-1.1', // Fireworks FLUX Pro 1.1
            'flux-schnell', // Fireworks FLUX Schnell (fast)
            'sd3.5-large', // Stability SD3.5 Large
            'sd3.5-large-turbo', // Stability SD3.5 Large Turbo
            'sd3.5-medium', // Stability SD3.5 Medium
            'sd3.5-flash', // Stability SD3.5 Flash (fast)
            'recraft-v3', // Recraft v3 via FAL
        ],
    },

    embedding: {
        models: [
            'text-embedding-3-small', // OpenAI's standard embedding model (1536d)
            'gemini-embedding-exp-03-07', // Google's Gemini embedding model (768d) - FREE
        ],
        description: 'Vector embedding models for semantic search and RAG',
    },

    voice: {
        models: [
            'gpt-4o-mini-tts', // OpenAI's efficient TTS model - default
            'tts-1', // OpenAI's standard TTS model - optimized for real-time
            'tts-1-hd', // OpenAI's high-quality TTS model
            'eleven_multilingual_v2', // ElevenLabs multilingual model
            'eleven_turbo_v2_5', // ElevenLabs turbo model for low latency
            'eleven_flash_v2_5', // ElevenLabs turbo model for low latency
            'gemini-2.5-flash-preview-tts', // Gemini's flash TTS model
            'gemini-2.5-pro-preview-tts', // Gemini's pro TTS model
        ],
        description: 'Text-to-Speech models for voice generation',
    },
    transcription: {
        models: [
            'gemini-2.0-flash-live-001', // Gemini Live API for real-time transcription
        ],
        description: 'Speech-to-Text models for audio transcription with real-time streaming',
    },
};

// Main model registry with all supported models
export const MODEL_REGISTRY: ModelEntry[] = [
    // --- ByteDance / BytePlus ModelArk ---
    {
        id: 'seedream-4',
        aliases: ['seedream-4.0', 'bytedance/seedream-4', 'byteplus/seedream-4'],
        provider: 'bytedance',
        cost: { per_image: 0.03 }, // $0.03 per image (flat)
        features: { input_modality: ['text', 'image'], output_modality: ['image'] },
        class: 'image_generation',
        description: 'Seedream 4.0 text-to-image via BytePlus ModelArk (OpenAI-compatible Images API).',
    },
    // --- Image Providers (New) ---
    {
        id: 'flux-kontext-pro',
        provider: 'fireworks',
        cost: { per_image: 0.04 }, // Fireworks pricing varies; default placeholder
        features: { input_modality: ['text', 'image'], output_modality: ['image'] },
        class: 'image_generation',
        description: 'FLUX.1 Kontext Pro via Fireworks (async workflow with polling).',
    },
    {
        id: 'stability-ultra',
        aliases: ['stability-ultra-1', 'stable-image-ultra'],
        provider: 'stability',
        // Stability docs list pricing in credits; "8 credits" per image is not $8.
        // Convert to dollars for unified cost display. Assuming ~$0.01/credit → ~$0.08 per image.
        cost: { per_image: 0.08 },
        features: { input_modality: ['text', 'image'], output_modality: ['image'] },
        class: 'image_generation',
        description: 'Stable Image Ultra (v2beta) – photorealistic, 1MP default.',
    },
    {
        id: 'runway-gen4-image',
        provider: 'runway',
        // Pricing: 5 credits (720p) = $0.05, 8 credits (1080p) = $0.08.
        // Default conservatively to 1080p tier unless overridden.
        cost: { per_image: 0.08 },
        features: { input_modality: ['text', 'image'], output_modality: ['image'] },
        class: 'image_generation',
        description: 'Runway Gen‑4 Image via official Runway API.',
    },
    {
        id: 'runway-gen4-image-turbo',
        provider: 'runway',
        // Pricing: 2 credits per image, any resolution → $0.02
        cost: { per_image: 0.02 },
        features: { input_modality: ['text', 'image'], output_modality: ['image'] },
        class: 'image_generation',
        description: 'Runway Gen‑4 Image Turbo via official Runway API.',
    },
    {
        id: 'flux-pro-1.1',
        provider: 'fireworks',
        cost: { per_image: 0.04 },
        features: { input_modality: ['text'], output_modality: ['image'] },
        class: 'image_generation',
        description: 'FLUX Pro 1.1 (fast, high quality). Uses Fireworks or FAL fallback.',
    },
    {
        id: 'flux-schnell',
        provider: 'fireworks',
        cost: { per_image: 0.02 },
        features: { input_modality: ['text'], output_modality: ['image'] },
        class: 'image_generation',
        description: 'FLUX Schnell (very fast). Uses Fireworks or FAL fallback.',
    },
    // Stability SD3.5 family (explicit variants)
    {
        id: 'sd3.5-large',
        provider: 'stability',
        cost: { per_image: 0.08 },
        features: { input_modality: ['text', 'image'], output_modality: ['image'] },
        class: 'image_generation',
        description: 'Stability SD3.5 Large.',
    },
    {
        id: 'sd3.5-large-turbo',
        provider: 'stability',
        cost: { per_image: 0.10 },
        features: { input_modality: ['text', 'image'], output_modality: ['image'] },
        class: 'image_generation',
        description: 'Stability SD3.5 Large Turbo.',
    },
    {
        id: 'sd3.5-medium',
        provider: 'stability',
        cost: { per_image: 0.05 },
        features: { input_modality: ['text', 'image'], output_modality: ['image'] },
        class: 'image_generation',
        description: 'Stability SD3.5 Medium.',
    },
    {
        id: 'sd3.5-flash',
        provider: 'stability',
        cost: { per_image: 0.02 },
        features: { input_modality: ['text', 'image'], output_modality: ['image'] },
        class: 'image_generation',
        description: 'Stability SD3.5 Flash (fast).',
    },
    {
        id: 'recraft-v3',
        provider: 'fal',
        cost: { per_image: 0.04 }, // $0.04 per image (vector styles 2x)
        features: { input_modality: ['text'], output_modality: ['image'] },
        class: 'image_generation',
        description: 'Recraft V3 via FAL.ai (text‑to‑image / vector styles).',
    },
    // Embedding models
    {
        id: 'text-embedding-3-small',
        provider: 'openai',
        cost: {
            input_per_million: 0.02, // $0.02 per million tokens
            output_per_million: 0, // No output tokens for embeddings
        },
        features: {
            input_modality: ['text'],
            output_modality: ['embedding'],
            input_token_limit: 8191,
        },
        embedding: true,
        dim: 1536,
        class: 'embedding',
        description: "OpenAI's small embedding model, good balance of performance and cost",
    },
    {
        id: 'text-embedding-3-large',
        provider: 'openai',
        cost: {
            input_per_million: 0.13, // $0.13 per million tokens
            output_per_million: 0, // No output tokens for embeddings
        },
        features: {
            input_modality: ['text'],
            output_modality: ['embedding'],
            input_token_limit: 8191,
        },
        embedding: true,
        dim: 3072,
        class: 'embedding',
        description: "OpenAI's large embedding model, good balance of performance and cost",
    },
    {
        id: 'gemini-embedding-exp-03-07',
        provider: 'google',
        cost: {
            input_per_million: 0, // Free during experimental period
            output_per_million: 0,
        },
        features: {
            input_modality: ['text'],
            output_modality: ['embedding'],
            input_token_limit: 8191,
        },
        embedding: true,
        dim: 768,
        class: 'embedding',
        description: "Google's experimental embedding model optimized for semantic similarity",
    },
    // Models used via OpenRouter
    // Note: Specific pricing/features via OpenRouter can fluctuate. Validation based on general model info & provider docs.
    {
        id: 'meta-llama/llama-4-maverick',
        provider: 'openrouter',
        cost: {
            input_per_million: 0.18,
            output_per_million: 0.6,
        },
        features: {
            context_length: 1048576,
            input_modality: ['text', 'image'],
            output_modality: ['text'],
            tool_use: true,
            streaming: true,
            json_output: true,
        },
        class: 'standard',
        score: 78, // Legacy overall score
        scores: {
            monologue: 72, // Humanity's Last Exam
            code: 64, // HumanEval
            reasoning: 56, // GPQA Diamond
        },
        description:
            'Llama 4 Maverick 17B Instruct (128E) is a high-capacity multimodal language model from Meta, built on a mixture-of-experts (MoE) architecture with 128 experts and 17 billion active parameters per forward pass (400B total).',
    },
    {
        id: 'meta-llama/llama-4-scout',
        provider: 'openrouter',
        cost: {
            input_per_million: 0.08,
            output_per_million: 0.3,
        },
        features: {
            context_length: 327680,
            input_modality: ['text'], // Assuming text-only based on description, verify if image needed
            output_modality: ['text'],
            tool_use: true,
            streaming: true,
            json_output: true,
        },
        class: 'mini',
        score: 65, // Smaller model with decent performance
        description:
            'Llama 4 Scout 17B Instruct (16E) is a mixture-of-experts (MoE) language model developed by Meta, activating 17 billion parameters out of a total of 109B.',
    },
    {
        id: 'qwen/qwen3-235b-a22b',
        provider: 'openrouter',
        cost: {
            input_per_million: 0.1,
            output_per_million: 0.1,
        },
        features: {
            context_length: 40960,
            input_modality: ['text'],
            output_modality: ['text'],
            tool_use: true,
            streaming: true,
            json_output: true,
        },
        class: 'reasoning', // High-capability model suitable for complex tasks.
        score: 83, // Legacy overall score
        scores: {
            monologue: 73, // Humanity's Last Exam
            code: 62, // HumanEval
            reasoning: 57, // GPQA Diamond
        },
        description:
            'Qwen3-235B-A22B is a 235B parameter mixture-of-experts (MoE) model developed by Qwen, activating 22B parameters per forward pass.',
    },
    {
        id: 'qwen/qwen-max',
        provider: 'openrouter',
        cost: {
            input_per_million: 1.6,
            output_per_million: 6.4,
        },
        features: {
            context_length: 131072, // Updated context length; Note: Actual context on OpenRouter can vary.
            input_modality: ['text', 'image'],
            output_modality: ['text'],
            tool_use: true,
            streaming: true,
            json_output: true,
        },
        class: 'reasoning', // High-capability model suitable for complex tasks.
        score: 80, // Legacy overall score
        scores: {
            monologue: 73, // Humanity's Last Exam
            code: 61, // HumanEval
            reasoning: 57, // GPQA Diamond
        },
        description:
            'Qwen-Max, based on Qwen2.5, provides the best inference performance among Qwen models, especially for complex multi-step tasks.',
    },
    {
        id: 'mistral/ministral-8b',
        provider: 'openrouter',
        cost: {
            input_per_million: 0.1,
            output_per_million: 0.1,
        },
        features: {
            context_length: 131072,
            input_modality: ['text'],
            output_modality: ['text'],
            tool_use: true,
            streaming: true,
            json_output: true,
        },
        class: 'standard', // Efficient standard model.
        score: 55, // Lower score due to smaller size, but still useful
        description:
            'Ministral 8B is a state-of-the-art language model optimized for on-device and edge computing. Designed for efficiency in knowledge-intensive tasks, commonsense reasoning, and function-calling.',
    },

    //
    // XAI models
    //

    {
        id: 'grok-3',
        aliases: ['grok-3-2025-02-11'],
        provider: 'xai',
        cost: {
            input_per_million: 3.0,
            output_per_million: 15.0,
        },
        features: {
            context_length: 131_072,
            input_modality: ['text', 'image'],
            output_modality: ['text'],
            tool_use: true,
            streaming: true,
            json_output: true,
        },
        class: 'standard',
        score: 78, // Aggregate (MMLU ≈ 0.80)
        scores: {
            monologue: 80, // Humanity’s Last Exam ≈ correlates with MMLU
            code: 70, // HumanEval – xAI hasn’t published; estimate from AA
            reasoning: 65, // GPQA Diamond – estimate
        },
        description: 'Flagship Grok-3 model for complex reasoning and generation',
    },

    {
        id: 'grok-3',
        aliases: ['grok-3-2025-04-11'],
        provider: 'xai',
        cost: {
            input_per_million: 5.0,
            output_per_million: 25.0,
        },
        features: {
            context_length: 131_072,
            input_modality: ['text', 'image'],
            output_modality: ['text'],
            tool_use: true,
            streaming: true,
            json_output: true,
        },
        class: 'standard',
        score: 78,
        scores: {
            monologue: 80,
            code: 70,
            reasoning: 65,
        },
        description: 'Same Grok-3 weights on premium infra for lower latency',
    },

    {
        id: 'grok-3-mini',
        aliases: ['grok-3-mini-2025-04-11'],
        provider: 'xai',
        cost: {
            input_per_million: 0.3,
            output_per_million: 0.5,
        },
        features: {
            context_length: 131_072,
            input_modality: ['text', 'image'],
            output_modality: ['text'],
            tool_use: true,
            streaming: true,
            json_output: true,
        },
        class: 'mini',
        score: 60,
        scores: {
            monologue: 62,
            code: 55,
            reasoning: 50,
        },
        description: 'Lightweight Grok-3 Mini—budget model for logic tasks',
    },

    {
        id: 'grok-3-mini',
        aliases: ['grok-3-mini-2025-04-11'],
        provider: 'xai',
        cost: {
            input_per_million: 0.6,
            output_per_million: 4.0,
        },
        features: {
            context_length: 131_072,
            input_modality: ['text', 'image'],
            output_modality: ['text'],
            tool_use: true,
            streaming: true,
            json_output: true,
        },
        class: 'mini',
        score: 60,
        scores: {
            monologue: 62,
            code: 55,
            reasoning: 50,
        },
        description: 'Grok-3 Mini on accelerated hardware for latency-critical use',
    },

    {
        id: 'grok-4',
        aliases: ['grok-4-2025-07-09'],
        provider: 'xai',
        cost: {
            input_per_million: 10.0,
            output_per_million: 30.0,
        },
        features: {
            context_length: 131072,
            input_modality: ['text', 'image'],
            output_modality: ['text'],
            tool_use: true,
            streaming: true,
            json_output: true,
        },
        scores: {
            monologue: 85,
            code: 75,
            reasoning: 70,
        },
        description: 'Most advanced Grok model with vision capabilities and complex reasoning',
    },

    //
    // OpenAI models
    //

    // GPT-4.1 models
    {
        id: 'gpt-4.1',
        aliases: ['gpt-4.1-2025-04-14'],
        provider: 'openai',
        cost: {
            input_per_million: 2.0,
            cached_input_per_million: 0.5,
            output_per_million: 8.0,
        },
        features: {
            context_length: 1048576, // Confirmed ~1M token context
            input_modality: ['text', 'image'],
            output_modality: ['text'],
            tool_use: true,
            streaming: true,
            json_output: true,
        },
        class: 'standard',
        score: 82, // Legacy overall score
        scores: {
            monologue: 86, // Humanity's Last Exam
            code: 83, // HumanEval
            reasoning: 71, // GPQA Diamond
        },
        description: 'Flagship GPT model for complex tasks',
    },
    {
        id: 'gpt-4.1-mini',
        aliases: ['gpt-4.1-mini-2025-04-14'],
        provider: 'openai',
        cost: {
            input_per_million: 0.4,
            cached_input_per_million: 0.1,
            output_per_million: 1.6,
        },
        features: {
            context_length: 1048576, // Confirmed ~1M token context
            input_modality: ['text', 'image'],
            output_modality: ['text'],
            tool_use: true,
            streaming: true,
            json_output: true,
        },
        class: 'mini',
        score: 75, // Good balance of capability and cost
        description: 'Balanced for intelligence, speed, and cost',
    },
    {
        id: 'gpt-4.1-nano',
        aliases: ['gpt-4.1-nano-2025-04-14'],
        provider: 'openai',
        cost: {
            input_per_million: 0.1,
            cached_input_per_million: 0.025,
            output_per_million: 0.4,
        },
        features: {
            context_length: 1048576, // Confirmed ~1M token context
            input_modality: ['text', 'image'],
            output_modality: ['text'],
            tool_use: true,
            streaming: true,
            json_output: true,
        },
        class: 'mini',
        score: 60, // Lower score due to smaller size
        description: 'Fastest, most cost-effective GPT-4.1 model',
    },

    // GPT-4.5 models
    {
        id: 'gpt-4.5-preview',
        aliases: ['gpt-4.5-preview-2025-02-27'],
        provider: 'openai',
        cost: {
            input_per_million: 75.0,
            cached_input_per_million: 37.5,
            output_per_million: 150.0,
        },
        features: {
            context_length: 128000, // Confirmed
            input_modality: ['text', 'image'],
            output_modality: ['text'],
            tool_use: true,
            streaming: true,
            json_output: true,
        },
        class: 'standard', // High-end standard model
        description: 'Latest premium GPT model from OpenAI',
    },

    // GPT-5 models
    {
        id: 'gpt-5',
        aliases: ['gpt-5-2025-08-07'],
        provider: 'openai',
        cost: {
            input_per_million: 1.25,
            cached_input_per_million: 0.13,
            output_per_million: 10.0,
        },
        features: {
            context_length: 400000,
            input_modality: ['text', 'image', 'audio'],
            output_modality: ['text', 'image', 'audio'],
            tool_use: true,
            streaming: true,
            json_output: true,
        },
        class: 'reasoning',
        score: 95,
        scores: {
            monologue: 98,
            code: 95,
            reasoning: 92,
        },
        description: 'The best model for coding and agentic tasks across domains',
    },
    {
        id: 'gpt-5-mini',
        aliases: ['gpt-5-mini-2025-08-07'],
        provider: 'openai',
        cost: {
            input_per_million: 0.25,
            cached_input_per_million: 0.03,
            output_per_million: 2.0,
        },
        features: {
            context_length: 400000,
            input_modality: ['text', 'image', 'audio'],
            output_modality: ['text', 'image', 'audio'],
            tool_use: true,
            streaming: true,
            json_output: true,
        },
        class: 'standard',
        score: 88,
        scores: {
            monologue: 90,
            code: 87,
            reasoning: 85,
        },
        description: 'A faster, more cost-efficient version of GPT-5 for well-defined tasks',
    },
    {
        id: 'gpt-5-nano',
        aliases: ['gpt-5-nano-2025-08-07'],
        provider: 'openai',
        cost: {
            input_per_million: 0.05,
            cached_input_per_million: 0.01,
            output_per_million: 0.4,
        },
        features: {
            context_length: 400000,
            input_modality: ['text', 'image', 'audio'],
            output_modality: ['text', 'image', 'audio'],
            tool_use: true,
            streaming: true,
            json_output: true,
        },
        class: 'mini',
        score: 78,
        scores: {
            monologue: 80,
            code: 76,
            reasoning: 75,
        },
        description: 'Fastest, most cost-efficient version of GPT-5',
    },
    {
        id: 'gpt-5-chat-latest',
        aliases: ['gpt-5-chat'],
        provider: 'openai',
        cost: {
            input_per_million: 1.25,
            cached_input_per_million: 0.13,
            output_per_million: 10.0,
        },
        features: {
            context_length: 400000,
            input_modality: ['text', 'image', 'audio'],
            output_modality: ['text', 'image', 'audio'],
            tool_use: true,
            streaming: true,
            json_output: true,
        },
        class: 'reasoning',
        score: 95,
        scores: {
            monologue: 98,
            code: 95,
            reasoning: 92,
        },
        description: 'GPT-5 model used in ChatGPT',
    },

    // GPT-4o models
    {
        id: 'gpt-4o',
        aliases: ['gpt-4o-2024-08-06'],
        provider: 'openai',
        cost: {
            input_per_million: 2.5, // Base text cost
            cached_input_per_million: 1.25,
            output_per_million: 10.0,
        },
        features: {
            context_length: 128000, // Confirmed
            input_modality: ['text', 'image', 'audio'],
            output_modality: ['text', 'audio'],
            tool_use: true,
            streaming: true,
            json_output: true,
        },
        class: 'standard',
        score: 80, // Strong score for all-around capabilities
        description: 'OpenAI standard model with multimodal capabilities',
    },
    {
        id: 'gpt-4o-mini',
        aliases: ['gpt-4o-mini-2024-07-18'],
        provider: 'openai',
        cost: {
            input_per_million: 0.15,
            cached_input_per_million: 0.075,
            output_per_million: 0.6,
        },
        features: {
            context_length: 128000, // Confirmed
            input_modality: ['text', 'image', 'audio'],
            output_modality: ['text', 'audio'],
            tool_use: true,
            streaming: true,
            json_output: true,
        },
        class: 'mini',
        score: 65, // Legacy overall score
        scores: {
            monologue: 70, // Humanity's Last Exam
            code: 63, // HumanEval
            reasoning: 60, // GPQA Diamond
        },
        description: 'Smaller, faster version of GPT-4o',
    },

    // O series models
    {
        id: 'o4-mini',
        aliases: ['o4-mini-2025-04-16', 'o4-mini-low', 'o4-mini-medium', 'o4-mini-high'],
        provider: 'openai',
        cost: {
            input_per_million: 1.1,
            cached_input_per_million: 0.275,
            output_per_million: 4.4,
        },
        features: {
            context_length: 200000, // Confirmed
            input_modality: ['text', 'image'],
            output_modality: ['text'],
            tool_use: true,
            streaming: true,
            json_output: true,
        },
        class: 'reasoning',
        score: 80, // Legacy overall score
        scores: {
            monologue: 85, // Humanity's Last Exam
            code: 82, // HumanEval
            reasoning: 76, // GPQA Diamond
        },
        description: 'Faster, more affordable reasoning model',
    },
    {
        id: 'o3',
        aliases: ['o3-2025-04-16'],
        provider: 'openai',
        cost: {
            input_per_million: 2,
            cached_input_per_million: 0.5,
            output_per_million: 8,
        },
        features: {
            context_length: 200000, // Confirmed
            input_modality: ['text', 'image'],
            output_modality: ['text'],
            tool_use: true,
            streaming: true,
            json_output: true,
        },
        class: 'reasoning',
        score: 85, // Legacy overall score
        scores: {
            monologue: 87, // Humanity's Last Exam
            code: 84, // HumanEval
            reasoning: 79, // GPQA Diamond
        },
        description: 'Powerful reasoning model',
    },
    {
        id: 'o3-pro',
        aliases: ['o3-pro-2025-06-10'],
        provider: 'openai',
        cost: {
            input_per_million: 20,
            output_per_million: 80,
        },
        features: {
            context_length: 200000, // Confirmed
            input_modality: ['text', 'image'],
            output_modality: ['text'],
            tool_use: true,
            json_output: true,
        },
        class: 'reasoning',
        score: 85, // Legacy overall score
        scores: {
            monologue: 87, // Humanity's Last Exam
            code: 84, // HumanEval
            reasoning: 79, // GPQA Diamond
        },
        description: 'Most powerful reasoning model',
    },
    {
        id: 'o3-deep-research',
        aliases: ['o3-deep-research-2025-06-26'],
        provider: 'openai',
        cost: {
            input_per_million: 10.0,
            cached_input_per_million: 2.5,
            output_per_million: 40.0,
        },
        features: {
            context_length: 200000,
            input_modality: ['text', 'image', 'audio'],
            output_modality: ['text', 'image', 'audio'],
            tool_use: true,
            streaming: true,
            json_output: true,
        },
        class: 'reasoning',
        score: 90,
        scores: {
            monologue: 92,
            code: 89,
            reasoning: 88,
        },
        description: 'Our most powerful deep research model',
    },
    {
        id: 'o1',
        aliases: ['o1-2024-12-17'],
        provider: 'openai',
        cost: {
            input_per_million: 15.0,
            cached_input_per_million: 7.5,
            output_per_million: 60.0,
        },
        features: {
            context_length: 200000, // Confirmed
            input_modality: ['text', 'image'],
            output_modality: ['text'],
            tool_use: true,
            streaming: true,
            json_output: true,
        },
        class: 'reasoning',
        description: 'Advanced reasoning model from OpenAI',
    },
    {
        id: 'o1-pro',
        aliases: ['o1-pro-2025-03-19'],
        provider: 'openai',
        cost: {
            input_per_million: 150.0,
            // "cached_input_per_million": null, // Cached input not listed
            output_per_million: 600.0,
        },
        features: {
            context_length: 200000, // Confirmed
            input_modality: ['text', 'image'],
            output_modality: ['text'],
            tool_use: true,
            streaming: false, // Explicitly does not support streaming
            json_output: true,
        },
        class: 'reasoning',
        score: 90, // Very high score for premium model
        description: 'Premium O-series model from OpenAI, highest reasoning capability',
    },
    {
        id: 'o4-mini',
        aliases: ['o4-mini-2025-01-31', 'o1-mini', 'o1-mini-2024-09-12'],
        provider: 'openai',
        cost: {
            input_per_million: 1.1,
            cached_input_per_million: 0.55,
            output_per_million: 4.4,
        },
        features: {
            context_length: 200000, // Confirmed
            input_modality: ['text', 'image'],
            output_modality: ['text'],
            tool_use: true,
            streaming: true,
            json_output: true,
        },
        class: 'reasoning',
        score: 70, // Good score for smaller reasoning model
        description: 'Smaller O-series model with reasoning capabilities',
    },

    // Computer-use models
    {
        id: 'computer-use-preview',
        aliases: ['computer-use-preview-2025-03-11'],
        provider: 'openai',
        cost: {
            input_per_million: 3.0,
            // "cached_input_per_million": null, // Not listed
            output_per_million: 12.0,
            // Note: Also has Code Interpreter session cost if used
        },
        features: {
            // "context_length": Unknown,
            input_modality: ['text', 'image'],
            output_modality: ['text'], // Outputs actions/text
            tool_use: true, // Specialized for computer control
            streaming: true, // Assumed
            json_output: true, // Assumed
        },
        class: 'vision', // Changed class to 'agent' as it's more descriptive
        description: 'Model that can understand and control computer interfaces',
    },

    //
    // Anthropic (Claude) models
    //

    // Claude 3.7 Sonnet
    {
        id: 'claude-3-7-sonnet-latest', // Maps to claude-3-7-sonnet-20250219
        aliases: ['claude-3-7-sonnet'],
        provider: 'anthropic',
        cost: {
            input_per_million: 3.0,
            output_per_million: 15.0,
            cached_input_per_million: 0.3, // Check Anthropic docs for specifics
        },
        features: {
            context_length: 200000, // Confirmed
            input_modality: ['text', 'image'],
            output_modality: ['text'],
            tool_use: true,
            streaming: true,
            json_output: true,
            max_output_tokens: 64000, // Default, higher possible
        },
        class: 'reasoning',
        score: 85, // Legacy overall score
        scores: {
            monologue: 83, // Humanity's Last Exam
            code: 77, // HumanEval
            reasoning: 69, // GPQA Diamond
        },
        description: 'Latest Claude model with strong reasoning capabilities (extended thinking internal)',
    },

    // Claude 3.5 Haiku
    {
        id: 'claude-3-5-haiku-latest', // Maps to claude-3-5-haiku-20241022
        aliases: ['claude-3-5-haiku'],
        provider: 'anthropic',
        cost: {
            input_per_million: 0.8,
            output_per_million: 4.0,
            cached_input_per_million: 0.08, // Check Anthropic docs for specifics
        },
        features: {
            context_length: 200000, // Confirmed
            input_modality: ['text', 'image'],
            output_modality: ['text'],
            tool_use: true,
            streaming: true,
            json_output: true,
            max_output_tokens: 8192, // Confirmed
        },
        class: 'mini',
        score: 70, // Legacy overall score
        scores: {
            monologue: 66, // Humanity's Last Exam
            code: 63, // HumanEval
            reasoning: 55, // GPQA Diamond
        },
        description: 'Fast, cost-effective Claude model',
    },

    // Claude CLI (Access Method)
    {
        id: 'claude-cli',
        provider: 'anthropic',
        cost: {
            // Assumes use of Claude 3.7 Sonnet
            input_per_million: 3.0,
            output_per_million: 15.0,
            cached_input_per_million: 0.3,
        },
        features: {
            // Assumes use of Claude 3.7 Sonnet
            context_length: 200000,
            input_modality: ['text', 'image'],
            output_modality: ['text'],
            tool_use: true,
            streaming: true,
            json_output: true,
        },
        class: 'reasoning', // Assuming Sonnet backend
        description: 'Claude accessed via CLI (likely uses latest Sonnet or Haiku model)',
    },

    // Claude Opus 4
    {
        id: 'claude-opus-4-1-20250805',
        aliases: ['claude-opus-4', 'claude-opus-4-1', 'claude-4-opus', 'claude-opus-4-20250514'],
        provider: 'anthropic',
        cost: {
            input_per_million: 15.0,
            output_per_million: 75.0,
            cached_input_per_million: 1.5, // Estimated at 10% of input cost
        },
        features: {
            context_length: 200000,
            input_modality: ['text', 'image'],
            output_modality: ['text'],
            tool_use: true,
            streaming: true,
            json_output: true,
            max_output_tokens: 32000,
            reasoning_output: true,
        },
        class: 'reasoning',
        score: 95, // Highest tier model
        description: 'Claude Opus 4 - Highest level of intelligence and capability with extended thinking',
    },

    // Claude Sonnet 4
    {
        id: 'claude-sonnet-4-20250514',
        aliases: ['claude-sonnet-4', 'claude-4-sonnet'],
        provider: 'anthropic',
        cost: {
            input_per_million: 3.0,
            output_per_million: 15.0,
            cached_input_per_million: 0.3, // Estimated at 10% of input cost
        },
        features: {
            context_length: 200000,
            input_modality: ['text', 'image'],
            output_modality: ['text'],
            tool_use: true,
            streaming: true,
            json_output: true,
            max_output_tokens: 64000,
            reasoning_output: true,
        },
        class: 'reasoning',
        score: 90, // High tier model
        description: 'Claude Sonnet 4 - High intelligence and balanced performance with extended thinking',
    },

    //
    // Google (Gemini) models
    //

    // Gemini 2.5 Pro
    {
        id: 'gemini-2.5-pro-preview-06-05',
        aliases: ['gemini-2.5-pro', 'gemini-2.5-pro-exp-03-25', 'gemini-2.5-pro-preview-05-06'],
        provider: 'google',
        cost: {
            // Tiered pricing
            input_per_million: {
                threshold_tokens: 200000,
                price_below_threshold_per_million: 1.25,
                price_above_threshold_per_million: 2.5,
            },
            output_per_million: {
                threshold_tokens: 200000,
                price_below_threshold_per_million: 10.0,
                price_above_threshold_per_million: 15.0,
            },
        },
        features: {
            context_length: 1048576, // Confirmed
            input_modality: ['text', 'image', 'video', 'audio'],
            output_modality: ['text'],
            tool_use: true, // Function calling
            streaming: true,
            json_output: true,
            max_output_tokens: 65536, // Confirmed
        },
        class: 'reasoning',
        score: 80, // High score for paid preview version
        description: 'Paid preview of Gemini 2.5 Pro. State-of-the-art multipurpose model.',
    },
    {
        id: 'gemini-2.5-flash-preview-05-20',
        aliases: ['gemini-2.5-flash', 'gemini-2.5-flash-preview-04-17'],
        provider: 'google',
        cost: {
            input_per_million: 0.3,
            output_per_million: 2.5,
        },
        features: {
            context_length: 1048576,
            input_modality: ['text', 'image', 'video', 'audio'],
            output_modality: ['text'],
            tool_use: true,
            streaming: true,
            json_output: true,
            max_output_tokens: 65536,
        },
        class: 'reasoning',
        score: 75, // Legacy overall score
        scores: {
            monologue: 12, // Humanity's Last Exam
            code: 63, // HumanEval
            reasoning: 78, // GPQA Diamond
        },
        description: 'Balanced multimodal model with large context, built for Agents.',
    },
    {
        id: 'gemini-2.5-flash-lite-preview-06-17',
        aliases: ['gemini-2.5-flash-lite'],
        provider: 'google',
        cost: {
            input_per_million: 0.1,
            output_per_million: 0.4,
        },
        features: {
            context_length: 1000000,
            input_modality: ['text', 'image', 'video', 'audio'],
            output_modality: ['text'],
            tool_use: true,
            streaming: true,
            json_output: true,
            max_output_tokens: 64000,
        },
        class: 'reasoning_mini',
        score: 75, // Legacy overall score
        scores: {
            monologue: 12, // Humanity's Last Exam
            code: 63, // HumanEval
            reasoning: 78, // GPQA Diamond
        },
        description: 'Balanced multimodal model with large context, built for Agents.',
    },

    // Gemini 2.0 Flash Lite
    {
        id: 'gemini-2.0-flash-lite',
        provider: 'google',
        cost: {
            input_per_million: 0.075,
            output_per_million: 0.3,
        },
        features: {
            context_length: 1048576,
            input_modality: ['text', 'image', 'video', 'audio'],
            output_modality: ['text'],
            tool_use: true,
            streaming: true,
            json_output: true,
            max_output_tokens: 8192,
        },
        class: 'standard',
        score: 75, // Legacy overall score
        scores: {
            monologue: 70, // Humanity's Last Exam
            code: 55, // HumanEval
            reasoning: 56, // GPQA Diamond
        },
        description: 'Lite multimodal model with large context, built for Agents.',
    },

    // Gemini 2.0 Flash
    {
        id: 'gemini-2.0-flash',
        provider: 'google',
        cost: {
            input_per_million: 0.1,
            output_per_million: 0.4,
            cached_input_per_million: 0.025,
        },
        features: {
            context_length: 1048576,
            input_modality: ['text', 'image', 'video', 'audio'],
            output_modality: ['text'],
            tool_use: true,
            streaming: true,
            json_output: true,
            max_output_tokens: 8192,
        },
        class: 'standard',
        score: 75, // Legacy overall score
        scores: {
            monologue: 70, // Humanity's Last Exam
            code: 55, // HumanEval
            reasoning: 56, // GPQA Diamond
        },
        description: 'Balanced multimodal model with large context, built for Agents.',
    },

    // Image generation models
    {
        id: 'gpt-image-1',
        provider: 'openai',
        cost: {
            per_image: 0.042, // Medium quality, 1024x1024 pricing
        },
        features: {
            input_modality: ['text', 'image'],
            output_modality: ['image'],
            streaming: false,
        },
        class: 'image_generation',
        description:
            "OpenAI's GPT-Image-1 model for text-to-image generation. Supports quality levels (low: $0.011-0.016, medium: $0.042-0.063, high: $0.167-0.25) and sizes (1024x1024, 1024x1536, 1536x1024).",
    },

    // Voice/TTS models
    {
        id: 'gpt-4o-mini-tts',
        provider: 'openai',
        cost: {
            input_per_million: 0.6, // $0.60 per million input characters
            output_per_million: 12.0, // $12 per million audio tokens
        },
        features: {
            input_modality: ['text'],
            output_modality: ['audio'],
            streaming: true,
        },
        class: 'voice',
        description:
            "OpenAI's advanced text-to-speech model with natural-sounding output. Supports customizable tone, style, and emotion through instructions. 85% cheaper than ElevenLabs with estimated $0.015/minute of audio.",
    },
    {
        id: 'tts-1',
        provider: 'openai',
        cost: {
            input_per_million: 15.0, // $15 per million input characters (not tokens)
            output_per_million: 0, // No output tokens for TTS
        },
        features: {
            input_modality: ['text'],
            output_modality: ['audio'],
            streaming: true,
        },
        class: 'voice',
        description:
            "OpenAI's standard text-to-speech model, optimized for real-time use. Supports 6 voices and multiple audio formats.",
    },
    {
        id: 'tts-1-hd',
        provider: 'openai',
        cost: {
            input_per_million: 30.0, // $30 per million input characters (not tokens)
            output_per_million: 0, // No output tokens for TTS
        },
        features: {
            input_modality: ['text'],
            output_modality: ['audio'],
            streaming: true,
        },
        class: 'voice',
        description:
            "OpenAI's high-definition text-to-speech model for superior audio quality. Supports 6 voices and multiple audio formats.",
    },
    {
        id: 'eleven_multilingual_v2',
        provider: 'elevenlabs',
        cost: {
            input_per_million: 55, // Average $0.22 per 1000 characters = $220 per million characters = $55 per million tokens
            output_per_million: 0, // No output tokens for TTS
        },
        features: {
            input_modality: ['text'],
            output_modality: ['audio'],
            streaming: true,
        },
        class: 'voice',
        description:
            "ElevenLabs' multilingual high quality text-to-speech model supporting 29 languages with natural voice capabilities.",
    },
    {
        id: 'eleven_turbo_v2_5',
        provider: 'elevenlabs',
        cost: {
            input_per_million: 27.5, // Average $0.11 per 1000 characters = $110 per million characters = $27.5 per million tokens
            output_per_million: 0, // No output tokens for TTS
        },
        features: {
            input_modality: ['text'],
            output_modality: ['audio'],
            streaming: true,
        },
        class: 'voice',
        description: "ElevenLabs' turbo model optimized for low-latency text-to-speech with high quality output.",
    },
    {
        id: 'eleven_flash_v2_5',
        provider: 'elevenlabs',
        cost: {
            input_per_million: 27.5, // Average $0.11 per 1000 characters = $110 per million characters = $27.5 per million tokens
            output_per_million: 0, // No output tokens for TTS
        },
        features: {
            input_modality: ['text'],
            output_modality: ['audio'],
            streaming: true,
        },
        class: 'voice',
        description: "ElevenLabs' fastest model optimized for ultra low-latency text-to-speech.",
    },
    {
        id: 'gemini-2.5-flash-preview-tts',
        provider: 'google',
        cost: {
            input_per_million: 10.0, // Estimated at $10 per million characters
            output_per_million: 0, // No output tokens for TTS
        },
        features: {
            input_modality: ['text'],
            output_modality: ['audio'],
            streaming: true,
            context_length: 32000, // 32k token context window
        },
        class: 'voice',
        description:
            "Gemini's fast text-to-speech model with support for 24 languages and 30 distinct voices. Optimized for low-latency applications.",
    },
    {
        id: 'gemini-2.5-pro-preview-tts',
        provider: 'google',
        cost: {
            input_per_million: 20.0, // Estimated at $20 per million characters
            output_per_million: 0, // No output tokens for TTS
        },
        features: {
            input_modality: ['text'],
            output_modality: ['audio'],
            streaming: true,
            context_length: 32000, // 32k token context window
        },
        class: 'voice',
        description:
            "Gemini's advanced text-to-speech model with superior voice quality, expression control, and multi-speaker support for creating dynamic conversations.",
    },

    // Code-specific models (removed claude-code and codex as they're now external)
    {
        id: 'codex-mini-latest',
        provider: 'openai',
        cost: {
            input_per_million: 1.5,
            cached_input_per_million: 0.375,
            output_per_million: 6.0,
        },
        features: {
            context_length: 200000,
            max_output_tokens: 100000,
            input_modality: ['text', 'image'],
            output_modality: ['text'],
            tool_use: false,
            streaming: true,
            json_output: true,
            reasoning_output: true,
        },
        class: 'code',
        description: 'Fine-tuned o4-mini model for Codex CLI with reasoning token support',
    },
    // Perplexity Sonar models
    {
        id: 'perplexity/sonar',
        provider: 'openrouter',
        cost: {
            input_per_million: 1.0,
            output_per_million: 1.0,
        },
        features: {
            context_length: 32768,
            input_modality: ['text'],
            output_modality: ['text'],
            tool_use: true,
            streaming: true,
            json_output: true,
        },
        class: 'standard',
        description: 'Lightweight, cost-effective search model designed for quick, grounded answers.',
    },
    {
        id: 'perplexity/sonar-pro',
        provider: 'openrouter',
        cost: {
            input_per_million: 3.0,
            output_per_million: 15.0,
        },
        features: {
            context_length: 32768,
            input_modality: ['text'],
            output_modality: ['text'],
            tool_use: true,
            streaming: true,
            json_output: true,
        },
        class: 'standard',
        description: 'Advanced search model optimized for complex queries and deeper content understanding.',
    },
    {
        id: 'perplexity/sonar-reasoning',
        provider: 'openrouter',
        cost: {
            input_per_million: 1.0,
            output_per_million: 5.0,
        },
        features: {
            context_length: 32768,
            input_modality: ['text'],
            output_modality: ['text'],
            tool_use: true,
            streaming: true,
            json_output: true,
        },
        class: 'reasoning_mini',
        description: 'Quick problem-solving and reasoning model, ideal for evaluating complex queries.',
    },
    {
        id: 'perplexity/sonar-reasoning-pro',
        provider: 'openrouter',
        cost: {
            input_per_million: 2.0,
            output_per_million: 8.0,
        },
        features: {
            context_length: 32768,
            input_modality: ['text'],
            output_modality: ['text'],
            tool_use: true,
            streaming: true,
            json_output: true,
        },
        class: 'reasoning',
        description: 'Enhanced reasoning model with multi-step problem-solving capabilities and real-time search.',
    },
    {
        id: 'perplexity/sonar-deep-research',
        provider: 'openrouter',
        cost: {
            input_per_million: 2.0,
            output_per_million: 8.0,
        },
        features: {
            context_length: 32768,
            input_modality: ['text'],
            output_modality: ['text'],
            tool_use: true,
            streaming: true,
            json_output: true,
        },
        class: 'standard',
        description: 'Best suited for exhaustive research, generating detailed reports and in-depth insights.',
    },
    // Mistral models (via OpenRouter)
    {
        id: 'mistralai/magistral-small-2506',
        provider: 'openrouter',
        cost: {
            input_per_million: 0.5,
            output_per_million: 1.5,
        },
        features: {
            context_length: 40000,
            input_modality: ['text'],
            output_modality: ['text'],
            tool_use: true,
            streaming: true,
            json_output: true,
        },
        class: 'reasoning_mini',
        score: 72,
        description:
            'Magistral Small is a 24B parameter instruction-tuned model based on Mistral-Small-3.1 (2503), enhanced through supervised fine-tuning on traces from Magistral Medium and further refined via reinforcement learning. It is optimized for reasoning and supports a wide multilingual range, including over 20 languages.',
    },
    {
        id: 'mistralai/magistral-medium-2506:thinking',
        provider: 'openrouter',
        cost: {
            input_per_million: 2.0,
            output_per_million: 5.0,
        },
        features: {
            context_length: 40960,
            input_modality: ['text'],
            output_modality: ['text'],
            tool_use: true,
            streaming: true,
            json_output: true,
            reasoning_output: true,
        },
        class: 'reasoning',
        score: 80,
        description:
            "Magistral is Mistral's first reasoning model. It is ideal for general purpose use requiring longer thought processing and better accuracy than with non-reasoning LLMs. From legal research and financial forecasting to software development and creative storytelling — this model solves multi-step challenges where transparency and precision are critical.",
    },

    // Test model for unit tests
    {
        id: 'test-model',
        provider: 'test',
        cost: {
            input_per_million: 0,
            output_per_million: 0,
        },
        features: {
            context_length: 8192,
            input_modality: ['text'],
            output_modality: ['text'],
            tool_use: true,
            streaming: true,
            json_output: true,
        },
        class: 'standard',
        scores: {
            monologue: 50,
            code: 50,
            reasoning: 50,
        },
        description: 'Test model for unit testing purposes',
    },

    // Image generation models
    {
        id: 'dall-e-3',
        provider: 'openai',
        cost: {
            per_image: 0.04, // Standard quality 1024x1024
        },
        features: {
            input_modality: ['text'],
            output_modality: ['image'],
        },
        class: 'image_generation',
        description: "OpenAI's DALL-E 3 model for high-quality image generation",
    },
    {
        id: 'dall-e-2',
        provider: 'openai',
        cost: {
            per_image: 0.02, // 1024x1024
        },
        features: {
            input_modality: ['text', 'image'], // Supports image editing
            output_modality: ['image'],
        },
        class: 'image_generation',
        description: "OpenAI's DALL-E 2 model, supports image editing and variations",
    },
    {
        id: 'gemini-2.5-flash-image-preview',
        aliases: ['models/gemini-2.5-flash-image-preview', 'gemini-2.5-flash-image'],
        provider: 'google',
        cost: {
            // Pricing from Google (Preview): $0.039 per image (up to 1024x1024)
            per_image: 0.039,
            // Input priced at $0.30 per 1M tokens for prompts (text/image)
            input_per_million: 0.3,
        },
        features: {
            input_modality: ['text'],
            output_modality: ['image', 'text'],
            streaming: false,
        },
        class: 'image_generation',
        description:
            "Gemini 2.5 Flash Image Preview: fast, natively multimodal image generation and editing.",
    },
    {
        id: 'imagen-3.0-generate-002',
        aliases: ['imagen-3'],
        provider: 'google',
        cost: {
            per_image: 0.04,
        },
        features: {
            input_modality: ['text'],
            output_modality: ['image'],
        },
        class: 'image_generation',
        description: "Google's Imagen 3 model for high-quality image generation",
    },
    {
        id: 'luma-photon-1',
        provider: 'luma',
        cost: {
            // Luma Photon charges by pixels: $0.0073 per million pixels
            // At 1080p ~2.07MP this is ~ $0.0151 per image.
            per_image: 0.0151,
        },
        features: {
            input_modality: ['text'],
            output_modality: ['image'],
        },
        class: 'image_generation',
        description:
            'Luma Photon 1 text-to-image (official Luma API). Pricing basis: $0.0073 per million pixels; ~1.51¢ per 1080p image.',
    },
    {
        id: 'luma-photon-flash-1',
        provider: 'luma',
        cost: {
            // Luma Photon Flash: $0.0019 per million pixels
            // At 1080p ~2.07MP this is ~ $0.0039 per image.
            per_image: 0.0039,
        },
        features: {
            input_modality: ['text'],
            output_modality: ['image'],
        },
        class: 'image_generation',
        description:
            'Luma Photon Flash 1 (faster, lower cost). Pricing basis: $0.0019 per million pixels; ~0.39¢ per 1080p image.',
    },
    {
        id: 'ideogram-3.0',
        aliases: ['ideogram-v3', 'V_3', 'ideogram'],
        provider: 'ideogram',
        cost: {
            // Public reports indicate ~$0.04 per output image for API standard tier
            // (Turbo tiers can be lower). Adjust if you have a contracted rate.
            per_image: 0.04,
        },
        features: {
            // NOTE: The edit endpoint currently requires a mask; without a mask
            // it returns 400. Treat as text-only for smoke tests to avoid
            // false-negative i2i runs.
            input_modality: ['text'],
            output_modality: ['image'],
        },
        class: 'image_generation',
        description:
            'Ideogram 3.0 text-to-image via official Ideogram API. Pricing shown is a typical per-image API rate; confirm with your Ideogram account for exact contracted pricing.',
    },
    {
        id: 'midjourney-v7',
        aliases: ['midjourney', 'mj-v7', 'mj'],
        provider: 'midjourney',
        cost: {
            // KIE API credit pricing (Fast: ~8 credits per call, about $0.036/call on entry plan), 4 images/call
            // Approximate per-image: $0.036 / 4 = $0.009
            per_image: 0.009,
        },
        features: {
            input_modality: ['text'],
            output_modality: ['image'],
        },
        class: 'image_generation',
        description: 'Midjourney v7 text-to-image (via KIE API; requires third-party API key).',
    },
    {
        id: 'imagen-2',
        provider: 'google',
        cost: {
            per_image: 0.02,
        },
        features: {
            input_modality: ['text'],
            output_modality: ['image'],
        },
        class: 'image_generation',
        description: "Google's Imagen 2 model for image generation",
    },

    //
    // Transcription models
    //

    {
        id: 'gemini-live-2.5-flash-preview',
        provider: 'google',
        cost: {
            input_per_million: {
                text: 0.5, // $0.50 per 1M input text tokens
                audio: 3.0, // $3.00 per 1M input audio tokens
                video: 3.0, // $3.00 per 1M input video tokens
            },
            output_per_million: {
                text: 2.0, // $2.00 per 1M output text tokens
                audio: 12.0, // $12.00 per 1M output audio tokens
            },
        },
        features: {
            context_length: 32000,
            input_modality: ['text', 'audio', 'video'],
            output_modality: ['text', 'audio'],
            streaming: true,
        },
        class: 'transcription',
        description: 'Gemini Live API for real-time multimodal interaction with modality-specific pricing',
    },
    {
        id: 'gemini-2.0-flash-live-001',
        provider: 'google',
        cost: {
            input_per_million: {
                text: 0.35,
                audio: 2.1,
                video: 2.1,
            },
            output_per_million: {
                text: 1.5,
                audio: 8.5,
            },
        },
        features: {
            context_length: 32000,
            input_modality: ['text', 'audio', 'video'],
            output_modality: ['text', 'audio'],
            streaming: true,
        },
        class: 'transcription',
        description: 'Gemini 2.0 Flash Live API for real-time multimodal interaction',
    },
    {
        id: 'gpt-4o-transcribe',
        provider: 'openai',
        cost: {
            input_per_million: {
                audio: 6.0, // $0.06 per minute (converted to per million tokens estimate)
            },
            output_per_million: {
                text: 0, // No separate output charge for transcription
            },
        },
        features: {
            context_length: 128000,
            input_modality: ['audio'],
            output_modality: ['text'],
            streaming: true,
        },
        class: 'transcription',
        description: 'GPT-4o transcription with incremental streaming output',
    },
    {
        id: 'gpt-4o-mini-transcribe',
        provider: 'openai',
        cost: {
            input_per_million: {
                audio: 6.0, // $0.06 per minute (converted to per million tokens estimate)
            },
            output_per_million: {
                text: 0, // No separate output charge for transcription
            },
        },
        features: {
            context_length: 128000,
            input_modality: ['audio'],
            output_modality: ['text'],
            streaming: true,
        },
        class: 'transcription',
        description: 'GPT-4o Mini transcription with incremental streaming output',
    },
    {
        id: 'whisper-1',
        provider: 'openai',
        cost: {
            input_per_million: {
                audio: 6.0, // $6.00 per 1M input audio tokens (estimated based on $0.006/minute)
            },
            output_per_million: {
                text: 0, // No separate charge for output
            },
        },
        features: {
            context_length: 25600, // ~25MB file size limit
            input_modality: ['audio'],
            output_modality: ['text'],
            streaming: true,
        },
        class: 'transcription',
        description: 'OpenAI Whisper transcription with full-turn output',
    },

    //
    // DeepSeek models
    //

    {
        id: 'deepseek-chat',
        aliases: ['deepseek-v3-0324'],
        provider: 'deepseek',
        cost: {
            input_per_million: {
                peak_utc_start_hour: 0,
                peak_utc_start_minute: 30,
                peak_utc_end_hour: 16,
                peak_utc_end_minute: 30,
                peak_price_per_million: 0.27, // Cache miss during peak hours
                off_peak_price_per_million: 0.135, // 50% off during off-peak
            },
            cached_input_per_million: {
                peak_utc_start_hour: 0,
                peak_utc_start_minute: 30,
                peak_utc_end_hour: 16,
                peak_utc_end_minute: 30,
                peak_price_per_million: 0.07, // Cache hit during peak hours
                off_peak_price_per_million: 0.035, // 50% off during off-peak
            },
            output_per_million: {
                peak_utc_start_hour: 0,
                peak_utc_start_minute: 30,
                peak_utc_end_hour: 16,
                peak_utc_end_minute: 30,
                peak_price_per_million: 1.1,
                off_peak_price_per_million: 0.55, // 50% off during off-peak
            },
        },
        features: {
            context_length: 64000,
            max_output_tokens: 8192, // Default 4K, max 8K
            input_modality: ['text'],
            output_modality: ['text'],
            tool_use: true, // Supports function calling
            streaming: true,
            json_output: true, // Supports JSON output
        },
        class: 'standard',
        score: 75, // Estimated score for a capable chat model
        description: 'DeepSeek-V3 chat model with FIM completion support and time-based pricing',
    },
    {
        id: 'deepseek-reasoner',
        aliases: ['deepseek-r1-0528'],
        provider: 'deepseek',
        cost: {
            input_per_million: {
                peak_utc_start_hour: 0,
                peak_utc_start_minute: 30,
                peak_utc_end_hour: 16,
                peak_utc_end_minute: 30,
                peak_price_per_million: 0.55, // Cache miss during peak hours
                off_peak_price_per_million: 0.1375, // 75% off during off-peak
            },
            cached_input_per_million: {
                peak_utc_start_hour: 0,
                peak_utc_start_minute: 30,
                peak_utc_end_hour: 16,
                peak_utc_end_minute: 30,
                peak_price_per_million: 0.14, // Cache hit during peak hours
                off_peak_price_per_million: 0.035, // 75% off during off-peak
            },
            output_per_million: {
                peak_utc_start_hour: 0,
                peak_utc_start_minute: 30,
                peak_utc_end_hour: 16,
                peak_utc_end_minute: 30,
                peak_price_per_million: 2.19,
                off_peak_price_per_million: 0.5475, // 75% off during off-peak
            },
        },
        features: {
            context_length: 64000,
            max_output_tokens: 64000, // Default 32K, max 64K
            input_modality: ['text'],
            output_modality: ['text'],
            tool_use: true, // Supports function calling via simulation
            simulate_tools: true, // Uses simulated tool calls instead of native ones
            streaming: true,
            json_output: true, // Supports JSON output
            reasoning_output: true, // Advanced reasoning capabilities
        },
        class: 'reasoning',
        score: 85, // Higher score for reasoning model
        description: 'DeepSeek-R1 advanced reasoning model with extended output and time-based pricing',
    },

    // GPT OSS 120B - Open source model via OpenRouter
    {
        id: 'gpt-oss-120b',
        aliases: ['openai/gpt-oss-120b'],
        provider: 'openrouter',
        openrouter_id: 'openai/gpt-oss-120b',
        cost: {
            input_per_million: 0.1,
            output_per_million: 0.5,
        },
        features: {
            context_length: 131072,
            input_modality: ['text'],
            output_modality: ['text'],
            tool_use: true,
            streaming: true,
            json_output: true,
            max_output_tokens: 100000,
            reasoning_output: true,
        },
        class: 'reasoning',
        score: 88,
        description: 'GPT OSS 120B - MoE model with 5.1B active params, optimized for single H100 GPU',
    },

    // GPT OSS 20B - Open source model via OpenRouter
    {
        id: 'gpt-oss-20b',
        aliases: ['openai/gpt-oss-20b'],
        provider: 'openrouter',
        openrouter_id: 'openai/gpt-oss-20b',
        cost: {
            input_per_million: 0.05,
            output_per_million: 0.2,
        },
        features: {
            context_length: 131072,
            input_modality: ['text'],
            output_modality: ['text'],
            tool_use: true,
            streaming: true,
            json_output: true,
            max_output_tokens: 100000,
        },
        class: 'standard',
        score: 82,
        description: 'GPT OSS 20B - MoE model with 3.6B active params, optimized for consumer hardware',
    },

    // Qwen3 235B A22B Thinking
    {
        id: 'qwen3-235b-a22b-thinking-2507',
        aliases: ['qwen/qwen3-235b-a22b-thinking-2507', 'qwen3'],
        provider: 'openrouter',
        openrouter_id: 'qwen/qwen3-235b-a22b-thinking-2507',
        cost: {
            input_per_million: 0.078,
            output_per_million: 0.312,
        },
        features: {
            context_length: 262144,
            input_modality: ['text'],
            output_modality: ['text'],
            tool_use: true,
            streaming: true,
            json_output: true,
            max_output_tokens: 81920,
            reasoning_output: true,
        },
        class: 'reasoning',
        score: 92,
        description: 'Qwen3 235B Thinking - MoE model with 22B active params, specialized for complex reasoning',
    },

    // Qwen3 Coder
    {
        id: 'qwen3-coder',
        aliases: ['qwen/qwen3-coder'],
        provider: 'openrouter',
        openrouter_id: 'qwen/qwen3-coder',
        cost: {
            input_per_million: 0.2,
            output_per_million: 0.8,
        },
        features: {
            context_length: 262144,
            input_modality: ['text'],
            output_modality: ['text'],
            tool_use: true,
            streaming: true,
            json_output: true,
            max_output_tokens: 100000,
        },
        class: 'code',
        score: 90,
        description: 'Qwen3 Coder - 480B MoE model with 35B active params, optimized for agentic coding tasks',
    },
];

/**
 * Find a model entry by ID or alias
 *
 * @param modelId The model ID or alias to search for
 * @returns The model entry or undefined if not found
 */
export function findModel(modelId: string): ModelEntry | undefined {
    // First check external models
    const externalModel = getExternalModel(modelId);
    if (externalModel) return externalModel;

    // Direct match on ID
    const directMatch = MODEL_REGISTRY.find(model => model.id === modelId);
    if (directMatch) return directMatch;

    // Check for alias match
    const aliasMatch = MODEL_REGISTRY.find(model => model.aliases?.includes(modelId));
    if (aliasMatch) return aliasMatch;

    // If model ends in -low, -medium, -high or -max, remove suffix and try again
    const suffixes = ['-low', '-medium', '-high', '-max'];
    for (const suffix of suffixes) {
        if (modelId.endsWith(suffix)) {
            const baseName = modelId.slice(0, -suffix.length);
            return findModel(baseName);
        }
    }

    return undefined;
}
