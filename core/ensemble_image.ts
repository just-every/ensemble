import type { AgentDefinition, ImageGenerationOpts } from '../types/types.js';
import {
    getModelFromAgent,
    getModelProvider,
} from '../model_providers/model_provider.js';

/**
 * Generate images from text prompts
 *
 * @param prompt - Text description of the image to generate
 * @param options - Optional configuration for image generation
 * @returns Promise that resolves to an array of generated image data (base64 or URLs)
 *
 * @example
 * ```typescript
 * // Simple image generation
 * const result = await ensembleImage('A beautiful sunset over mountains');
 * console.log(`Generated ${result.images.length} image(s)`);
 *
 * // Using Google Imagen
 * const result = await ensembleImage('A serene lake at dawn', {
 *   model: 'imagen-3.0-generate-002',
 * }, {
 *   size: 'portrait'
 * }});
 * ```
 */
export async function ensembleImage(
    prompt: string,
    agent: AgentDefinition,
    options: ImageGenerationOpts = {}
): Promise<string[]> {
    const model = await getModelFromAgent(agent, 'image_generation');
    const provider = getModelProvider(model);

    if (!provider.createImage) {
        throw new Error(
            `Provider for model ${model} does not support image generation`
        );
    }

    return provider.createImage(prompt, model, options);
}
