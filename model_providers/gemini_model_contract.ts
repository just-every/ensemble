const CURRENT_FLASH_ALIASES = new Set(['gemini-flash-latest', 'gemini-flash-lite-latest']);

function normalizeModelId(model: string): string {
    return model.startsWith('models/') ? model.slice('models/'.length) : model;
}

/**
 * Gemini 3.6 Flash and Gemini 3.5 Flash-Lite introduced the generateContent
 * contract used by subsequent Gemini releases. Sampling parameters are ignored
 * today and rejected by future generations, and prefilled model turns are not
 * accepted.
 */
export function usesCurrentGeminiGenerateContentContract(model: string): boolean {
    const modelId = normalizeModelId(model);

    return modelId === 'gemini-3.6-flash' || modelId === 'gemini-3.5-flash-lite' || CURRENT_FLASH_ALIASES.has(modelId);
}
