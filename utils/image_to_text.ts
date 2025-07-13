/**
 * Image to text conversion utility functions for the ensemble package.
 *
 * This module provides utilities for converting images to textual descriptions
 * using Claude API for models that don't support image input.
 */

// import Anthropic from '@anthropic-ai/sdk';
import { findModel } from '../data/model_data.js';
import { ResponseInput, AgentDefinition, ProviderStreamEvent } from '../types/types.js';

// Type for ensemble request function to avoid circular dependency
type EnsembleRequestFunction = (messages: ResponseInput, agent: AgentDefinition) => AsyncGenerator<ProviderStreamEvent>;

// Global reference to ensemble request function (set by ensemble_request.ts)
let ensembleRequestFunction: EnsembleRequestFunction | null = null;

/**
 * Set the ensemble request function (called by ensemble_request.ts to avoid circular dependency)
 */
export function setEnsembleRequestFunction(fn: EnsembleRequestFunction): void {
    ensembleRequestFunction = fn;
}

// Define the types we need based on the Anthropic SDK structure
// type TextBlock = {
//     type: 'text';
//     text: string;
// };

// type ImageBlock = {
//     type: 'image';
//     source: {
//         type: 'base64';
//         media_type: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
//         data: string;
//     };
// };

// type MessageContent = TextBlock | ImageBlock;

// type Message = {
//     role: 'user' | 'assistant' | 'system';
//     content: MessageContent[];
// };

// Cache for image descriptions
interface ImageDescriptionCache {
    [imageHash: string]: string;
}

// In-memory cache for image descriptions
const imageDescriptionCache: ImageDescriptionCache = {};

/**
 * Generate a hash for an image to use as a cache key
 *
 * @param imageData - Base64 encoded image data
 * @returns A string hash that can be used as a cache key
 */
function generateImageHash(imageData: string): string {
    // Simple hash function for cache key - using first 100 chars + length should be sufficient
    // for our needs while being much faster than a full hash
    const sample = imageData.substring(0, 100);
    const length = imageData.length;
    return `${sample}_${length}`;
}

/**
 * Converts an image to a text description
 * Uses Claude API directly and caches the results
 *
 * @param imageData - Base64 encoded image data
 * @param modelId - ID of the model being used (for logging)
 * @returns The image description
 */
export async function convertImageToText(imageData: string, modelId: string): Promise<string> {
    // Skip if not an image
    if (!imageData.startsWith('data:image/')) {
        return imageData;
    }

    console.log(`Converting image to text description for model ${modelId}`);

    // Generate hash for caching
    const imageHash = generateImageHash(imageData);

    // Check cache
    if (imageDescriptionCache[imageHash]) {
        console.log(`Using cached image description for ${modelId}`);
        return imageDescriptionCache[imageHash];
    }

    if (!ensembleRequestFunction) {
        console.error('Ensemble request function not set for image-to-text conversion');
        return 'Image found, but could not be converted to text (circular dependency issue)';
    }

    // Use Claude to describe the image
    try {
        const stream = ensembleRequestFunction(
            [
                {
                    type: 'message',
                    role: 'system',
                    content:
                        'Please describe the following image in a couple of sentences. Focus on the main visual elements and key details that someone would need to understand what is shown in the image.',
                },
                {
                    type: 'message',
                    role: 'user',
                    content: imageData,
                },
            ],
            {
                modelClass: 'vision_mini',
            }
        );

        for await (const event of stream) {
            if (event.type === 'message_complete' && 'content' in event) {
                imageDescriptionCache[imageHash] = event.content.trim();
                return imageDescriptionCache[imageHash];
            }
        }
    } catch (error) {
        console.error('Error generating image description:', error);
    }
    return 'Image found, but could not be converted to text';
}

/**
 * Converts an image to a text description if the model doesn't support image input
 * Uses the image-to-text API and caches the results
 *
 * @param imageData - Base64 encoded image data
 * @param modelId - ID of the model being used
 * @returns The image description or original image data if model supports images
 */
export async function convertImageToTextIfNeeded(imageData: string, modelId?: string): Promise<string | boolean> {
    // Skip if not an image
    if (!imageData.startsWith('data:image/')) {
        return false;
    }

    // Check if model supports image input (if modelId provided)
    if (modelId && findModel(modelId)?.features?.input_modality?.includes('image')) {
        // Model supports images, return original
        return false;
    }

    // Convert to text description
    return await convertImageToText(imageData, modelId || 'unknown');
}
