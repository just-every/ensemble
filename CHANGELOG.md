# Changelog

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
