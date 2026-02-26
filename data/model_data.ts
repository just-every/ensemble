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
            // One top pick per provider (prefer stable IDs over dated previews when possible)
            'gpt-5.2-chat-latest', // OpenAI
            'gemini-3-flash-preview', // Google
            'claude-sonnet-4-5-20250929', // Anthropic
            'grok-4', // X.AI
        ],
        random: true,
    },

    // Mini/smaller models - faster but less capable
    mini: {
        models: [
            'gpt-5-nano', // OpenAI
            'gemini-2.5-flash-lite', // Google
            'claude-haiku-4-5-20251001', // Anthropic
            'grok-3-mini', // X.AI
        ],
        random: true,
    },

    // Advanced reasoning models
    reasoning: {
        models: [
            // Strong reasoning at reasonable cost
            'gpt-5.2', // OpenAI
            'gemini-2.5-pro', // Google
            'claude-sonnet-4-5-20250929', // Anthropic
            'grok-4-1-fast-reasoning', // X.AI
        ],
        random: true,
    },

    // Maxed-out reasoning models (highest tier per provider)
    reasoning_high: {
        models: [
            'gpt-5.2-pro', // OpenAI
            'gemini-3.1-pro-preview', // Google
            'claude-opus-4-5-20251101', // Anthropic
            'grok-4', // X.AI
        ],
        random: true,
    },

    // Fast, cheap reasoning models
    reasoning_mini: {
        models: [
            'gpt-5-mini', // OpenAI
            'gemini-3-flash-preview', // Google
            'claude-sonnet-4-5-20250929', // Anthropic
            'grok-3-mini', // X.AI
        ],
        random: true,
    },

    // Monologue models
    monologue: {
        models: [
            'gpt-5.2-chat-latest', // OpenAI
            'gemini-3.1-pro-preview', // Google
            'claude-sonnet-4-5-20250929', // Anthropic
            'grok-4', // X.AI
        ],
        random: true,
    },

    // Metacognition models
    metacognition: {
        models: [
            'gpt-5.2', // OpenAI
            'gemini-3.1-pro-preview', // Google
            'claude-opus-4-5-20251101', // Anthropic
            'grok-4', // X.AI
        ],
        random: true,
    },

    // Programming models
    code: {
        models: [
            'gpt-5.1-codex-max', // OpenAI
            'gemini-3.1-pro-preview', // Google
            'claude-opus-4-5-20251101', // Anthropic
            'grok-4', // X.AI
            'qwen3-coder', // OpenRouter
        ],
        random: true,
    },

    // Writing models - optimized for conversation and text generation
    writing: {
        models: [
            'gpt-5.2-chat-latest', // OpenAI
            'gemini-3-flash-preview', // Google
            'claude-sonnet-4-5-20250929', // Anthropic
            'grok-4', // X.AI
        ],
        random: true,
    },

    // Summary models - optimized for extracting information from text
    // High quality, low cost allows this to be used heavily and reduce token usage for other models
    summary: {
        models: [
            'gpt-5-nano', // OpenAI
            'gemini-2.5-flash-lite', // Google
            'claude-haiku-4-5-20251001', // Anthropic
            'grok-3-mini', // X.AI
        ],
        random: true,
    },

    // Models with vision capabilities
    vision: {
        models: [
            'gpt-5.2', // OpenAI
            'gemini-3.1-pro-preview', // Google
            'claude-opus-4-5-20251101', // Anthropic
            'grok-4', // X.AI
        ],
        random: true,
    },

    // Mini models with vision capabilities
    vision_mini: {
        models: [
            'gpt-5-mini', // OpenAI
            'gemini-3-flash-preview', // Google
            'claude-haiku-4-5-20251001', // Anthropic
            'grok-3-mini', // X.AI
        ],
        random: true,
    },

    // Models with search capabilities
    search: {
        models: [
            'o3-deep-research', // OpenAI
            'perplexity/sonar-deep-research', // Perplexity
        ],
        random: true,
    },

    // Models with very large context windows (near 1M tokens)
    long: {
        models: [
            'gpt-5.2', // OpenAI
            'gemini-3.1-pro-preview', // Google
            'claude-opus-4-5-20251101', // Anthropic
            'grok-4', // X.AI
        ],
        random: true,
        description: 'Models with very large context windows for processing long documents',
    },

    image_generation: {
        models: [
            // One top pick per image provider
            'gpt-image-1.5', // OpenAI
            'gemini-3-pro-image-preview', // Google
            'seedream-4', // ByteDance
            'luma-photon-1', // Luma
            'ideogram-3.0', // Ideogram
            'midjourney-v7', // Midjourney
            'flux-kontext-pro', // Fireworks
            'stability-ultra', // Stability
            'runway-gen4-image', // Runway
            'recraft-v3', // FAL
        ],
    },

    embedding: {
        models: [
            'text-embedding-3-large', // OpenAI (3072d)
            'text-embedding-004', // Google (latest stable)
        ],
        description: 'Vector embedding models for semantic search and RAG',
    },

    voice: {
        models: [
            // One top pick per TTS provider
            'tts-1-hd', // OpenAI
            'eleven_multilingual_v2', // ElevenLabs
            'gemini-2.5-pro-preview-tts', // Gemini
        ],
        description: 'Text-to-Speech models for voice generation',
    },
    transcription: {
        models: [
            'gpt-4o-transcribe', // OpenAI
            'gemini-2.5-flash-native-audio-preview-12-2025', // Gemini (replacement for Live)
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

    // Google Embeddings (stable)
    {
        id: 'text-embedding-004',
        provider: 'google',
        cost: {
            // Pricing varies by region/product tier; leave unset/zeroed unless we have a confirmed source.
            input_per_million: 0,
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
        description: "Google's stable text embedding model (text-embedding-004)",
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
    // XAI models (Grok)
    //

    // Grok-4.1 Fast models with tiered pricing
    {
        id: 'grok-4-1-fast-reasoning',
        aliases: ['grok-4.1-fast-reasoning'],
        provider: 'xai',
        cost: {
            input_per_million: {
                threshold_tokens: 128_000,
                price_below_threshold_per_million: 0.2,
                price_above_threshold_per_million: 0.5,
            },
            output_per_million: {
                threshold_tokens: 128_000,
                price_below_threshold_per_million: 0.5,
                price_above_threshold_per_million: 1.0,
            },
            cached_input_per_million: 0.05,
        },
        features: {
            context_length: 2_000_000,
            input_modality: ['text', 'image'],
            output_modality: ['text'],
            tool_use: true,
            streaming: true,
            json_output: true,
        },
        class: 'reasoning',
        score: 88,
        scores: {
            monologue: 90,
            code: 85,
            reasoning: 88,
        },
        description: 'Grok 4.1 Fast with extended reasoning. 2M context, tiered pricing at 128k threshold.',
    },

    {
        id: 'grok-4-1-fast-non-reasoning',
        aliases: ['grok-4.1-fast-non-reasoning'],
        provider: 'xai',
        cost: {
            input_per_million: {
                threshold_tokens: 128_000,
                price_below_threshold_per_million: 0.2,
                price_above_threshold_per_million: 0.5,
            },
            output_per_million: {
                threshold_tokens: 128_000,
                price_below_threshold_per_million: 0.5,
                price_above_threshold_per_million: 1.0,
            },
            cached_input_per_million: 0.05,
        },
        features: {
            context_length: 2_000_000,
            input_modality: ['text', 'image'],
            output_modality: ['text'],
            tool_use: true,
            streaming: true,
            json_output: true,
        },
        class: 'standard',
        score: 85,
        scores: {
            monologue: 87,
            code: 82,
            reasoning: 80,
        },
        description: 'Grok 4.1 Fast without reasoning. 2M context, tiered pricing at 128k threshold.',
    },

    // Grok-4 Premium model
    {
        id: 'grok-4',
        aliases: ['grok-4-2025-09-01'],
        provider: 'xai',
        cost: {
            input_per_million: 3.0,
            output_per_million: 15.0,
            cached_input_per_million: 0.75,
        },
        features: {
            context_length: 256_000,
            input_modality: ['text', 'image'],
            output_modality: ['text'],
            tool_use: true,
            streaming: true,
            json_output: true,
        },
        class: 'reasoning',
        score: 90,
        scores: {
            monologue: 92,
            code: 88,
            reasoning: 85,
        },
        description: 'Grok-4 premium model with 256k context and vision capabilities.',
    },

    // Grok-4 Fast models (September 2025) with tiered pricing
    {
        id: 'grok-4-fast-reasoning',
        aliases: ['grok-4-fast-reasoning-2025-09-01'],
        provider: 'xai',
        cost: {
            input_per_million: {
                threshold_tokens: 128_000,
                price_below_threshold_per_million: 0.2,
                price_above_threshold_per_million: 0.5,
            },
            output_per_million: {
                threshold_tokens: 128_000,
                price_below_threshold_per_million: 0.5,
                price_above_threshold_per_million: 1.0,
            },
            cached_input_per_million: 0.05,
        },
        features: {
            context_length: 2_000_000,
            input_modality: ['text', 'image'],
            output_modality: ['text'],
            tool_use: true,
            streaming: true,
            json_output: true,
        },
        class: 'reasoning',
        score: 87,
        scores: {
            monologue: 89,
            code: 84,
            reasoning: 86,
        },
        description: 'Grok-4 Fast with reasoning (Sep 2025). 2M context, tiered pricing at 128k threshold.',
    },

    {
        id: 'grok-4-fast-non-reasoning',
        aliases: ['grok-4-fast-non-reasoning-2025-09-01'],
        provider: 'xai',
        cost: {
            input_per_million: {
                threshold_tokens: 128_000,
                price_below_threshold_per_million: 0.2,
                price_above_threshold_per_million: 0.5,
            },
            output_per_million: {
                threshold_tokens: 128_000,
                price_below_threshold_per_million: 0.5,
                price_above_threshold_per_million: 1.0,
            },
            cached_input_per_million: 0.05,
        },
        features: {
            context_length: 2_000_000,
            input_modality: ['text', 'image'],
            output_modality: ['text'],
            tool_use: true,
            streaming: true,
            json_output: true,
        },
        class: 'standard',
        score: 84,
        scores: {
            monologue: 86,
            code: 81,
            reasoning: 79,
        },
        description: 'Grok-4 Fast without reasoning (Sep 2025). 2M context, tiered pricing at 128k threshold.',
    },

    // Grok-3 models
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
        score: 78,
        scores: {
            monologue: 80,
            code: 70,
            reasoning: 65,
        },
        description: 'Grok-3 model with 131k context.',
    },

    // Grok-3 Mini models
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
        description: 'Grok-3 Mini—budget model with 131k context.',
    },

    {
        id: 'grok-3-mini-accelerated',
        aliases: ['grok-3-mini-accelerated-2025-04-11'],
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
        description: 'Grok-3 Mini on accelerated hardware for lower latency.',
    },

    // Legacy Grok-2 models (optional, text-only/vision variants)
    {
        id: 'grok-2',
        aliases: ['grok-2-text'],
        provider: 'xai',
        cost: {
            input_per_million: 2.0,
            output_per_million: 10.0,
        },
        features: {
            context_length: 128_000,
            input_modality: ['text'],
            output_modality: ['text'],
            tool_use: true,
            streaming: true,
            json_output: true,
        },
        class: 'standard',
        score: 70,
        scores: {
            monologue: 72,
            code: 65,
            reasoning: 60,
        },
        description: 'Legacy Grok-2 text-only model.',
    },

    {
        id: 'grok-2-vision',
        aliases: ['grok-2-vision'],
        provider: 'xai',
        cost: {
            input_per_million: 2.0,
            output_per_million: 10.0,
        },
        features: {
            context_length: 128_000,
            input_modality: ['text', 'image'],
            output_modality: ['text'],
            tool_use: true,
            streaming: true,
            json_output: true,
        },
        class: 'vision',
        score: 70,
        scores: {
            monologue: 72,
            code: 65,
            reasoning: 60,
        },
        description: 'Legacy Grok-2 model with vision capabilities.',
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

    // GPT-5.2 models
    {
        id: 'gpt-5.2',
        aliases: ['gpt-5.2-2025-12-11'],
        provider: 'openai',
        cost: {
            input_per_million: 1.75,
            cached_input_per_million: 0.175,
            output_per_million: 14.0,
        },
        features: {
            context_length: 400000,
            max_output_tokens: 128000,
            input_modality: ['text', 'image'],
            output_modality: ['text'],
            tool_use: true,
            streaming: true,
            json_output: true,
        },
        class: 'reasoning',
        score: 96,
        scores: {
            monologue: 97,
            code: 95,
            reasoning: 94,
        },
        description: 'Frontier flagship model for complex, multi-step tasks (400k/128k).',
    },
    {
        id: 'gpt-5.2-pro',
        aliases: ['gpt-5.2-pro-2025-12-11'],
        provider: 'openai',
        cost: {
            input_per_million: 21.0,
            output_per_million: 168.0,
        },
        features: {
            context_length: 400000,
            max_output_tokens: 128000,
            input_modality: ['text', 'image'],
            output_modality: ['text'],
            tool_use: true,
            streaming: true,
            json_output: true,
        },
        class: 'reasoning',
        score: 99,
        description: 'Highest-accuracy GPT-5.2 variant for the hardest problems (400k/128k).',
    },
    {
        id: 'gpt-5.2-chat-latest',
        provider: 'openai',
        cost: {
            input_per_million: 1.75,
            cached_input_per_million: 0.175,
            output_per_million: 14.0,
        },
        features: {
            context_length: 128000,
            max_output_tokens: 16384,
            input_modality: ['text', 'image'],
            output_modality: ['text'],
            tool_use: true,
            streaming: true,
            json_output: true,
        },
        class: 'standard',
        score: 94,
        description: 'ChatGPT-optimized GPT-5.2 chat model (128k/16k).',
    },

    // GPT-5 models
    {
        id: 'gpt-5',
        aliases: ['gpt-5-2025-08-07'],
        provider: 'openai',
        cost: {
            input_per_million: 1.25,
            cached_input_per_million: 0.125,
            output_per_million: 10.0,
        },
        features: {
            context_length: 400000,
            max_output_tokens: 128000,
            input_modality: ['text', 'image'],
            output_modality: ['text'],
            tool_use: true,
            streaming: true,
            json_output: true,
        },
        class: 'reasoning',
        score: 95,
        scores: {
            monologue: 96,
            code: 95,
            reasoning: 92,
        },
        description: 'Frontier flagship model for complex, multi-step tasks (400k/128k).',
    },
    {
        id: 'gpt-5-pro',
        aliases: ['gpt-5-pro-2025-10-06'],
        provider: 'openai',
        cost: {
            input_per_million: 15.0,
            output_per_million: 120.0,
        },
        features: {
            context_length: 400000,
            max_output_tokens: 272000,
            input_modality: ['text', 'image'],
            output_modality: ['text'],
            tool_use: true,
            streaming: true,
            json_output: true,
        },
        class: 'reasoning',
        score: 98,
        description: 'High-accuracy GPT-5 variant for the hardest problems (400k/128k).',
    },
    {
        id: 'gpt-5-chat-latest',
        aliases: ['gpt-5-chat'],
        provider: 'openai',
        cost: {
            input_per_million: 1.25,
            cached_input_per_million: 0.125,
            output_per_million: 10.0,
        },
        features: {
            context_length: 128000,
            max_output_tokens: 16384,
            input_modality: ['text', 'image'],
            output_modality: ['text'],
            tool_use: true,
            streaming: true,
            json_output: true,
        },
        class: 'standard',
        score: 92,
        description: 'ChatGPT-optimized GPT-5 chat model (128k/16k).',
    },
    {
        id: 'gpt-5-mini',
        aliases: ['gpt-5-mini-2025-08-07'],
        provider: 'openai',
        cost: {
            input_per_million: 0.25,
            cached_input_per_million: 0.025,
            output_per_million: 2.0,
        },
        features: {
            context_length: 400000,
            max_output_tokens: 128000,
            input_modality: ['text', 'image'],
            output_modality: ['text'],
            tool_use: true,
            streaming: true,
            json_output: true,
        },
        class: 'standard',
        score: 88,
        scores: {
            monologue: 88,
            code: 87,
            reasoning: 85,
        },
        description: 'A faster, more cost-efficient version of GPT-5 (400k/128k).',
    },
    {
        id: 'gpt-5-nano',
        aliases: ['gpt-5-nano-2025-08-07'],
        provider: 'openai',
        cost: {
            input_per_million: 0.05,
            cached_input_per_million: 0.005,
            output_per_million: 0.4,
        },
        features: {
            context_length: 400000,
            max_output_tokens: 128000,
            input_modality: ['text', 'image'],
            output_modality: ['text'],
            tool_use: true,
            streaming: true,
            json_output: true,
        },
        class: 'mini',
        score: 78,
        scores: {
            monologue: 78,
            code: 76,
            reasoning: 75,
        },
        description: 'Fastest, most cost-efficient GPT-5 model (400k/128k).',
    },

    // GPT-5.1 models
    {
        id: 'gpt-5.1',
        aliases: ['gpt-5.1-2025-11-13'],
        provider: 'openai',
        cost: {
            input_per_million: 1.25,
            cached_input_per_million: 0.125,
            output_per_million: 10.0,
        },
        features: {
            context_length: 400000,
            max_output_tokens: 128000,
            input_modality: ['text', 'image'],
            output_modality: ['text'],
            tool_use: true,
            streaming: true,
            json_output: true,
        },
        class: 'reasoning',
        score: 95,
        description: 'Prior-gen GPT-5.1 flagship model (400k/128k).',
    },
    {
        id: 'gpt-5.1-chat-latest',
        provider: 'openai',
        cost: {
            input_per_million: 1.25,
            cached_input_per_million: 0.125,
            output_per_million: 10.0,
        },
        features: {
            context_length: 128000,
            max_output_tokens: 16384,
            input_modality: ['text', 'image'],
            output_modality: ['text'],
            tool_use: true,
            streaming: true,
            json_output: true,
        },
        class: 'standard',
        score: 91,
        description: 'ChatGPT-optimized GPT-5.1 chat model (128k/16k).',
    },

    // GPT-5 Codex models
    {
        id: 'gpt-5-codex',
        aliases: ['gpt-5-codex-2025-09-15'],
        provider: 'openai',
        cost: {
            input_per_million: 1.25,
            cached_input_per_million: 0.125,
            output_per_million: 10.0,
        },
        features: {
            context_length: 400000,
            max_output_tokens: 128000,
            input_modality: ['text', 'image'],
            output_modality: ['text'],
            tool_use: true,
            streaming: true,
            json_output: true,
        },
        class: 'code',
        score: 90,
        description: 'Prior-gen Codex model for agentic coding (400k/128k).',
    },

    // GPT-5.1 Codex models
    {
        id: 'gpt-5.1-codex',
        provider: 'openai',
        cost: {
            input_per_million: 1.25,
            cached_input_per_million: 0.125,
            output_per_million: 10.0,
        },
        features: {
            context_length: 400000,
            max_output_tokens: 128000,
            input_modality: ['text', 'image'],
            output_modality: ['text'],
            tool_use: true,
            streaming: true,
            json_output: true,
        },
        class: 'code',
        score: 92,
        description: 'GPT-5.1 Codex — optimized for agentic coding tasks (400k/128k).',
    },
    {
        id: 'gpt-5.1-codex-mini',
        provider: 'openai',
        cost: {
            input_per_million: 0.25,
            cached_input_per_million: 0.025,
            output_per_million: 2.0,
        },
        features: {
            context_length: 400000,
            max_output_tokens: 128000,
            input_modality: ['text', 'image'],
            output_modality: ['text'],
            tool_use: true,
            streaming: true,
            json_output: true,
        },
        class: 'code',
        score: 86,
        description: 'GPT-5.1 Codex Mini — lightweight coding model with 400k context.',
    },
    {
        id: 'gpt-5.1-codex-max',
        provider: 'openai',
        cost: {
            input_per_million: 1.25,
            cached_input_per_million: 0.125,
            output_per_million: 10.0,
        },
        features: {
            context_length: 400000,
            max_output_tokens: 128000,
            input_modality: ['text', 'image'],
            output_modality: ['text'],
            tool_use: true,
            streaming: true,
            json_output: true,
        },
        class: 'code',
        score: 95,
        description: 'GPT-5.1 Codex Max — most capable Codex model for coding agents (400k/128k).',
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

    // Claude Sonnet 4.5
    {
        id: 'claude-sonnet-4-5-20250514',
        aliases: ['claude-sonnet-4.5-2025-05-14', 'claude-sonnet-4-5-may-2025'],
        provider: 'anthropic',
        cost: {
            input_per_million: 3.0,
            output_per_million: 15.0,
            cached_input_per_million: 0.3, // 10% of input cost
        },
        features: {
            context_length: 200000, // Standard context
            input_modality: ['text', 'image'],
            output_modality: ['text'],
            tool_use: true,
            streaming: true,
            json_output: true,
            reasoning_output: true,
            max_output_tokens: 64000,
        },
        class: 'reasoning',
        score: 88,
        scores: {
            monologue: 86,
            code: 85,
            reasoning: 84,
        },
        description: 'Claude Sonnet 4.5 - Latest general-purpose model with strong reasoning and text/image support',
    },

    // Claude Sonnet 4.5 (September 2025 refresh)
    {
        id: 'claude-sonnet-4-5-20250929',
        aliases: [
            'claude-sonnet-4-5',
            'claude-sonnet-4.5',
            'claude-sonnet-latest',
            'claude-sonnet-4-5-sep-2025',
            'claude-sonnet-4.5-2025-09-29',
        ],
        provider: 'anthropic',
        cost: {
            input_per_million: {
                threshold_tokens: 200000,
                price_below_threshold_per_million: 3.0,
                price_above_threshold_per_million: 6.0,
            },
            output_per_million: {
                threshold_tokens: 200000,
                price_below_threshold_per_million: 15.0,
                price_above_threshold_per_million: 22.5,
            },
            cached_input_per_million: {
                threshold_tokens: 200000,
                price_below_threshold_per_million: 0.3,
                price_above_threshold_per_million: 0.6,
            },
        },
        features: {
            context_length: 200000,
            input_modality: ['text', 'image'],
            output_modality: ['text'],
            tool_use: true,
            streaming: true,
            json_output: true,
            reasoning_output: true,
            max_output_tokens: 64000,
        },
        class: 'reasoning',
        score: 88,
        description: 'Claude Sonnet 4.5 (Sep 2025 refresh) with tiered pricing at 200k tokens and vision support.',
    },

    {
        id: 'claude-sonnet-4-5-20250514-long-context',
        aliases: ['claude-sonnet-4-5-long', 'claude-sonnet-4.5-long'],
        provider: 'anthropic',
        cost: {
            input_per_million: 6.0,
            output_per_million: 22.5,
            cached_input_per_million: 0.6, // 10% of input cost
        },
        features: {
            context_length: 1_000_000, // 1M token context
            input_modality: ['text', 'image'],
            output_modality: ['text'],
            tool_use: true,
            streaming: true,
            json_output: true,
            reasoning_output: true,
            max_output_tokens: 64000,
        },
        class: 'reasoning',
        score: 88,
        description: 'Claude Sonnet 4.5 with 1M token context window - for long-context processing',
    },

    // Claude Haiku 4.5
    {
        id: 'claude-haiku-4-5-20250514',
        aliases: ['claude-haiku-4.5-2025-05-14', 'claude-haiku-4-5-may-2025'],
        provider: 'anthropic',
        cost: {
            input_per_million: 1.0,
            output_per_million: 5.0,
            cached_input_per_million: 0.1, // 10% of input cost
        },
        features: {
            context_length: 200000,
            input_modality: ['text', 'image'],
            output_modality: ['text'],
            tool_use: true,
            streaming: true,
            json_output: true,
            max_output_tokens: 8192,
        },
        class: 'mini',
        score: 74,
        scores: {
            monologue: 72,
            code: 71,
            reasoning: 70,
        },
        description: 'Claude Haiku 4.5 - Fast, cost-effective model with text and image support',
    },

    // Claude Haiku 4.5 (October 2025 refresh)
    {
        id: 'claude-haiku-4-5-20251001',
        aliases: [
            'claude-haiku-4-5',
            'claude-haiku-4.5',
            'claude-haiku-latest',
            'claude-haiku-4-5-oct-2025',
            'claude-haiku-4.5-2025-10-01',
        ],
        provider: 'anthropic',
        cost: {
            input_per_million: 1.0,
            output_per_million: 5.0,
            cached_input_per_million: 0.1,
        },
        features: {
            context_length: 200000,
            input_modality: ['text', 'image'],
            output_modality: ['text'],
            tool_use: true,
            streaming: true,
            json_output: true,
            max_output_tokens: 8192,
        },
        class: 'mini',
        score: 74,
        description: 'Claude Haiku 4.5 (Oct 2025 refresh) fast tier with vision support.',
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

    // Claude Opus 4.1
    {
        id: 'claude-opus-4-1-20250805',
        aliases: ['claude-opus-4-1', 'claude-opus-4.1', 'claude-4-opus'],
        provider: 'anthropic',
        cost: {
            input_per_million: 15.0,
            output_per_million: 75.0,
            cached_input_per_million: 1.5, // 10% of input cost
        },
        features: {
            context_length: 200000,
            input_modality: ['text', 'image'],
            output_modality: ['text'],
            tool_use: true,
            streaming: true,
            json_output: true,
            reasoning_output: true,
            max_output_tokens: 32000,
        },
        class: 'reasoning',
        score: 95, // Highest tier model
        scores: {
            monologue: 94,
            code: 94,
            reasoning: 93,
        },
        description: 'Claude Opus 4.1 - Highest intelligence and capability with reasoning support',
    },

    // Claude Opus 4.5 (November 2025)
    {
        id: 'claude-opus-4-5-20251101',
        aliases: [
            'claude-opus-4-5',
            'claude-opus-4.5',
            'claude-opus',
            'claude-opus-latest',
            'claude-4.5-opus',
        ],
        provider: 'anthropic',
        cost: {
            input_per_million: 15.0,
            output_per_million: 75.0,
            cached_input_per_million: 1.5,
        },
        features: {
            context_length: 200000,
            input_modality: ['text', 'image'],
            output_modality: ['text'],
            tool_use: true,
            streaming: true,
            json_output: true,
            reasoning_output: true,
            max_output_tokens: 32000,
        },
        class: 'reasoning',
        score: 96,
        description: 'Claude Opus 4.5 - Latest Opus model with strongest reasoning, code, and long-form capabilities.',
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
            input_per_million: 1.25,
            output_per_million: 10.0,
            cached_input_per_million: 0.13,
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
    // Gemini 3 Flash (preview)
    {
        id: 'gemini-3-flash-preview',
        aliases: ['gemini-3-flash'],
        provider: 'google',
        cost: {
            input_per_million: {
                text: 0.5,
                image: 0.5,
                video: 0.5,
                audio: 1.0,
            },
            output_per_million: 3.0,
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
        class: 'standard',
        description: 'Gemini 3 Flash Preview - fast multimodal model with 1M context window.',
    },
    {
        id: 'gemini-2.5-flash',
        aliases: [
            'gemini-2.5-flash-preview-05-20',
            'gemini-2.5-flash-preview-04-17',
        ],
        provider: 'google',
        cost: {
            input_per_million: {
                text: 1.0,
                audio: 0.0375,
            },
            output_per_million: 0.6,
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
        id: 'gemini-2.5-flash-lite',
        aliases: ['gemini-2.5-flash-lite-preview-06-17'],
        provider: 'google',
        cost: {
            input_per_million: 0.05,
            output_per_million: 0.2,
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
        score: 78,
        scores: {
            monologue: 14, // Humanity's Last Exam
            code: 65, // HumanEval
            reasoning: 75, // GPQA Diamond
        },
        description: 'Gemini 2.5 Flash Lite - cost-efficient multimodal model with 1M context.',
    },

    // Gemini 2.0 Flash Experimental
    {
        id: 'gemini-2.0-flash-exp',
        aliases: ['gemini-2.0-flash-experimental'],
        provider: 'google',
        cost: {
            input_per_million: 0.1,
            output_per_million: 0.4,
            cached_input_per_million: 0.025,
        },
        features: {
            context_length: 1_000_000,
            input_modality: ['text', 'image', 'video', 'audio'],
            output_modality: ['text'],
            tool_use: true,
            streaming: true,
            json_output: true,
            max_output_tokens: 8192,
        },
        class: 'standard',
        score: 78,
        description: 'Gemini 2.0 Flash Experimental (v1beta) - experimental multimodal model.',
    },

    // Gemini 3.1 Pro (preview)
    {
        id: 'gemini-3.1-pro-preview',
        aliases: [
            'gemini-3.1-pro-preview-customtools',
            'gemini-3.1-pro',
            'gemini-3-pro-preview',
            'gemini-3-pro',
            'gemini-3-pro-preview-11-2025',
        ],
        provider: 'google',
        cost: {
            input_per_million: {
                threshold_tokens: 200000,
                price_below_threshold_per_million: 2.0,
                price_above_threshold_per_million: 4.0,
            },
            output_per_million: {
                threshold_tokens: 200000,
                price_below_threshold_per_million: 12.0,
                price_above_threshold_per_million: 18.0,
            },
            cached_input_per_million: {
                threshold_tokens: 200000,
                price_below_threshold_per_million: 0.2,
                price_above_threshold_per_million: 0.4,
            },
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
        score: 90,
        description:
            'Gemini 3.1 Pro Preview - multimodal flagship (v1beta, tiered pricing at 200k tokens).',
    },

    // Gemini 3 Pro Image (preview)
    {
        id: 'gemini-3-pro-image-preview',
        aliases: ['gemini-3-pro-image'],
        provider: 'google',
        cost: {
            per_image: 0.134, // AI Studio preview price per image (1K/2K); 4K is $0.24
            input_per_million: 2.0,
            output_per_million: 12.0,
        },
        features: {
            input_modality: ['text', 'image'],
            output_modality: ['image', 'text'],
            streaming: false,
        },
        class: 'image_generation',
        description: 'Gemini 3 Pro Image (preview) for text-to-image generation.',
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
        id: 'gpt-image-1.5',
        aliases: ['gpt-image-1.5-2025-12-16'],
        provider: 'openai',
        cost: {
            // Official pricing varies by quality and output size; see model_providers/openai.ts getImageCost.
            // Keep a representative per-image price here (medium, 1024x1024) for summaries.
            per_image: 0.034,
            // Token pricing (for text/image tokens) as published on OpenAI's model page.
            input_per_million: {
                text: 5.0,
                image: 8.0,
            },
            output_per_million: {
                text: 10.0,
                image: 32.0,
            },
        },
        features: {
            input_modality: ['text', 'image'],
            output_modality: ['image', 'text'],
            streaming: false,
        },
        class: 'image_generation',
        description:
            "OpenAI's GPT Image 1.5 model for text-to-image generation and editing. Pricing varies by quality (low/medium/high) and size (1024x1024, 1024x1536, 1536x1024).",
    },
    {
        id: 'gpt-image-1',
        provider: 'openai',
        cost: {
            per_image: 0.026, // Medium quality, 1024x1024 pricing
        },
        features: {
            input_modality: ['text', 'image'],
            output_modality: ['image'],
            streaming: false,
        },
        class: 'image_generation',
        description:
            "OpenAI's GPT-Image-1 model for text-to-image generation. Supports quality levels (low/medium/high) and sizes (1024x1024, 1024x1536, 1536x1024).",
    },
    {
        id: 'gpt-image-1-mini',
        provider: 'openai',
        cost: {
            per_image: 0.011, // Medium quality, 1024x1024 pricing
        },
        features: {
            input_modality: ['text', 'image'],
            output_modality: ['image'],
            streaming: false,
        },
        class: 'image_generation',
        description:
            "OpenAI's GPT-Image-1 Mini model. Cost-efficient variant with lower per-image pricing (low: $0.005-0.006, medium: $0.011-0.015) across sizes (1024x1024, 1024x1536, 1536x1024).",
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

    {
        id: 'gemini-2.5-flash-native-audio-preview',
        aliases: ['gemini-2.5-flash-native-audio-preview-12-2025'],
        provider: 'google',
        cost: {
            input_per_million: 5.0, // Estimated pricing for native audio
            output_per_million: 0,
        },
        features: {
            input_modality: ['text'],
            output_modality: ['audio'],
            streaming: true,
            context_length: 32000,
        },
        class: 'voice',
        description:
            "Gemini's native audio preview model providing low-latency text-to-speech with built-in audio processing.",
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
        id: 'gemini-3.1-flash-image-preview',
        aliases: ['models/gemini-3.1-flash-image-preview', 'gemini-3.1-flash-image'],
        provider: 'google',
        cost: {
            // Preview pricing from Google AI Studio. Image output is priced per token;
            // representative defaults are captured in per_image and refined in provider-level overrides
            // (0.5K=$0.045, 1K=$0.067, 2K=$0.101, 4K=$0.151).
            per_image: 0.067, // 1K output equivalent
            input_per_million: {
                text: 0.25,
                image: 0.25,
            },
            output_per_million: {
                text: 1.5, // Includes thinking tokens
                image: 60.0,
            },
        },
        features: {
            input_modality: ['text', 'image'],
            output_modality: ['image', 'text'],
            streaming: false,
        },
        class: 'image_generation',
        description:
            'Gemini 3.1 Flash Image Preview: fast multimodal image generation for high-throughput, interactive workflows.',
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

    // If model ends in a known effort/variant suffix, remove suffix and try again
    const suffixes = ['-xhigh', '-minimal', '-low', '-medium', '-high', '-none', '-max'];
    for (const suffix of suffixes) {
        if (modelId.endsWith(suffix)) {
            const baseName = modelId.slice(0, -suffix.length);
            return findModel(baseName);
        }
    }

    return undefined;
}
