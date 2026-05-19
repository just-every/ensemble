# Changelog

## Unreleased
- Added Gemini 3.5 Flash (`gemini-3.5-flash`) provider metadata, pricing, and native Gemini thinking-level suffix handling.
- Mapped Gemini native thinking suffixes `-none`, `-disabled`, `-minimal`, `-low`, `-medium`, `-high`, `-max`, and `-xhigh` to provider `thinkingLevel` values where supported.

## 2026-05-19
- Added explicit OpenRouter support for Tencent Hy3 Preview (`tencent/hy3-preview`) with current pricing, cache pricing, context, tool/reasoning metadata, aliases, and reasoning suffix handling including `-none`, `-disabled`, `-low`, and `-high`.

## 2026-05-15
- Added explicit FAL FLUX.2 Pro outpaint support (`fal-ai/flux-2-pro/outpaint`) with image-to-image request shaping, `auto_crop` support, directional expansion options, and stepped megapixel cost tracking.
- Added explicit FAL Recraft Crisp Upscale support (`fal-ai/recraft/upscale/crisp`) with one-source-image request shaping, safety checker forwarding, and $0.004 per-image pricing.

## 2026-05-08
- Added FAL Ideogram V3 support (`fal-ai/ideogram/v3` and `fal-ai/ideogram/v3/edit`) with source-image plus mask request shaping, transparent-mask to white-edit mask mapping, `quality` to `rendering_speed` mapping, and tier-aware image cost tracking.
- Added FAL slash-path endpoint mapping and explicit `fal-ai/image2svg` support with one-source-image request handling, SVG output extraction, and $0.005 per-image pricing metadata.
- Added explicit OpenRouter support for `qwen/qwen3.6-flash` and `qwen/qwen3.6-max-preview` with current pricing, aliases, context, and modality metadata.

## 2026-05-03
- Added current OpenRouter model entries for GLM-5.1, Kimi K2.6, DeepSeek V4 Pro/Flash, and Qwen3.6 Plus/35B/27B with pricing, context, modality, and alias metadata.
- Updated legacy GLM-5 aliases to resolve to the current GLM-5.1 OpenRouter model.

## 2026-04-06
- Refreshed direct package dependencies and lockfile to current compatible releases, including `openai`, `@anthropic-ai/sdk`, `@google/genai`, `vitest`, and lint/build tooling.
- Added full xAI Grok Imagine image support for `grok-imagine-image` and `grok-imagine-image-pro`, including JSON-based image editing via `/images/edits`.
- Added xAI image option mapping for aspect ratio, explicit `resolution` tiers (`1k` / `2k`), URL vs. base64 responses, and edit-cost accounting for billable input plus output images.

## 2026-03-18
- Added first-class OpenAI support for `gpt-5.4-mini` and `gpt-5.4-nano`, including current dated aliases, pricing, and capability metadata.
- Refreshed existing `gpt-5.4` / `gpt-5.4-pro` snapshot aliases and pricing to match current OpenAI docs.
- Updated mini-capability OpenAI model classes to prefer `gpt-5.4-mini` / `gpt-5.4-nano` where appropriate.
- Restored `gemini-3.1-pro-preview` as the canonical Gemini Pro preview model id.
- Kept `gemini-3-pro-preview` and related legacy names as backward-compatible aliases.
- Updated Gemini model class defaults back to `gemini-3.1-pro-preview`.

## 2026-03-06
- Added first-class OpenAI support for `gpt-5.4` and `gpt-5.4-pro`, including canonical dated aliases, pricing, and capability metadata.
- Updated reasoning-heavy OpenAI model classes to prefer GPT-5.4 / GPT-5.4 Pro.
- Taught the OpenAI provider to apply GPT-5.4 reasoning defaults correctly and to keep sampling params when `gpt-5.4` runs with its default `reasoning.effort=none` behavior.

## 2026-03-03
- Temporarily switched Gemini Pro preview canonical mapping back to `gemini-3-pro-preview`.
- Kept compatibility aliases so `gemini-3.1-pro-preview`, `gemini-3.1-pro-preview-customtools`, and `gemini-3.1-pro` resolve to `gemini-3-pro-preview`.
- Updated model class defaults that previously pointed at `gemini-3.1-pro-preview` to use `gemini-3-pro-preview`.

## 2026-02-27
- Added Gemini 3.1 Pro Preview support (`gemini-3.1-pro-preview`) with alias support for `gemini-3.1-pro-preview-customtools`.
- Preserved backward compatibility by mapping legacy Gemini 3 Pro Preview IDs to Gemini 3.1 Pro Preview.
- Added Gemini 3.1 Flash Image Preview support (`gemini-3.1-flash-image-preview`) with token and per-image pricing metadata.
- Updated Gemini image provider logic to route `gemini-3.1-flash-image-preview` through streaming image generation and size-aware per-image pricing.
- Added 0.5K image-tier support for Gemini 3.1 Flash Image pricing (e.g., explicit `512x512` requests and `low` quality mapping).
- Added 0.5K aspect-ratio-aware resizing for Gemini 3.1 Flash Image outputs (512px short side with requested AR).
- Added Gemini 3.1 Flash Image aspect-ratio keys (`1:4`, `1:8`, `4:1`, `8:1`, `21:9`, etc.) and table-based 0.5K output dimensions.
- Verified Gemini 3.1 Flash Image pricing tiers in provider logic/tests: 0.5K=$0.045, 1K=$0.067, 2K=$0.101, 4K=$0.151.
- Added Gemini 3 Pro Image explicit table-resolution support (1K/2K/4K presets map to correct aspect ratio, tier, and pricing).
- Added Gemini image grounding controls (`grounding.web_search` / `grounding.image_search`) with `searchTypes` support for Gemini 3.1 Flash Image.
- Added Gemini image thinking controls (`thinking.level`, `thinking.include_thoughts`) and image metadata callback support (`on_metadata`) exposing grounding metadata, citations, thoughts, and thought signatures.

## 2025-12-30
- Documented the new `image` content part and added a full example for image input + JSON output.

## 2025-12-29
- Promoted Gemini 3 Flash Preview to a first-class model entry and set it as the default Flash choice in model classes.
- Updated Gemini 3 Pro Preview metadata (cached pricing + output modality) and aligned context/max output tokens with docs.
- Refreshed tests to use gemini-3-flash-preview where applicable.

## 2025-12-14
- Added OpenAI GPT-5.2 lineup (gpt-5.2, gpt-5.2-chat-latest, gpt-5.2-pro) with verified pricing.
- Fixed OpenAI GPT-5 / GPT-5.1 / Codex pricing and capabilities (context limits, modalities, cached input rates).
- Removed invalid OpenAI model IDs from default classes and updated class defaults to use valid GPT-5.2/Codex entries.

## 2025-11-22
- Added OpenAI GPT-5.1 lineup (base + Codex, Codex-Mini, Codex-Max) with pricing; Codex-Max pricing set to currently published rates and may change.
- Refreshed Anthropic to Claude 4.5 (Sonnet/Haiku, incl. 1M long-context) and Claude Opus 4.1 with updated pricing/features.
- Added Google Gemini 3 (Pro/Flash/Ultra) and refreshed Gemini 2.5 (Pro/Flash/Flash-Lite) pricing, including image/TTS/native-audio entries.
- Expanded xAI Grok models with 4.1 Fast and 4 Fast (tiered pricing, 2M context) plus updated Grok 4/3/mini variants.
- Updated model classes and tests to cover all new models and pricing structures.
