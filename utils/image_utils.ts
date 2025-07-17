/**
 * Image utility functions for the ensemble package.
 *
 * This module provides tools for processing and optimizing images.
 */

import { Buffer } from 'buffer';
import { v4 as uuidv4 } from 'uuid';

// Lazy-load sharp only when needed
let sharpModule: any = null;

async function getSharp() {
    if (!sharpModule) {
        try {
            const module = await import('sharp');
            sharpModule = module.default || module;
        } catch {
            throw new Error(
                'Sharp is required for image processing but not installed. Please install it with: npm install sharp'
            );
        }
    }
    return sharpModule;
}

// Constants for image processing
export const MAX_IMAGE_HEIGHT = 2000;
export const DEFAULT_QUALITY = 80;
export const OPENAI_MAX_WIDTH = 1024;
export const OPENAI_MAX_HEIGHT = 768;
export const CLAUDE_MAX_WIDTH = 1024;
export const CLAUDE_MAX_HEIGHT = 1120;
export const GEMINI_MAX_WIDTH = 1024;
export const GEMINI_MAX_HEIGHT = 1536;

import { ExtractBase64ImageResult } from '../types/types.js';
import { convertImageToTextIfNeeded } from './image_to_text.js';

/**
 * Extract base64 images from a message and appends formatted images
 *
 * @param message - String that may contain base64 encoded images
 * @returns Object with extraction results including image mapping
 */
export async function appendMessageWithImage(
    model: string,
    input: any[],
    message: any,
    param:
        | string
        | {
              read: () => string;
              write: (value: string) => any;
          },
    addImagesToInput: (input: any[], images: Record<string, string>, source: string) => Promise<any[]>,
    source?: string
): Promise<any> {
    const content =
        typeof param === 'string'
            ? typeof message[param] === 'string'
                ? message[param]
                : JSON.stringify(message[param])
            : param.read();

    // Extract any images from the content
    const extracted = extractBase64Image(content);
    if (!extracted.found) {
        // Nothing found - just append
        input.push(message);
        return input;
    }

    let imagesConverted = false;
    for (const [image_id, imageData] of Object.entries(extracted.images)) {
        const imageToText = await convertImageToTextIfNeeded(imageData, model);
        if (imageToText && typeof imageToText === 'string') {
            extracted.replaceContent.replaceAll(`[image #${image_id}]`, `[image #${image_id}: ${imageToText}]`);
            imagesConverted = true;
        }
    }

    // Add modified message with placeholder
    if (typeof param === 'string') {
        const newMessage = { ...message };
        newMessage[param] = extracted.replaceContent;
        input.push(newMessage);
    } else {
        input.push(param.write(extracted.replaceContent));
    }

    if (!imagesConverted) {
        // Process the images and wait for the result
        input = await addImagesToInput(input, extracted.images, source || `${message.role} message`);
    }

    return input;
}

/**
 * Extract base64 images from a string, preserving non-image content
 * Replaces images with placeholder text [image <id>] and returns mapping
 *
 * @param content - String that may contain base64 encoded images
 * @returns Object with extraction results including image mapping
 */
export function extractBase64Image(content: string): ExtractBase64ImageResult {
    // Default result
    const result: ExtractBase64ImageResult = {
        found: false,
        originalContent: content,
        replaceContent: content,
        image_id: null,
        images: {},
    };

    if (typeof content !== 'string') return result;

    // Quick check if there's any image data
    if (!content.includes('data:') || !content.includes('base64,')) return result;

    // Find all image data using regex
    // This pattern matches data URIs for images with proper base64 termination
    // Supports both "data:image/png;base64," and "data:png;base64," formats
    const imgRegex = /data:(?:image\/)?([a-zA-Z0-9.+-]+);base64,[A-Za-z0-9+/\s]*={0,2}/g;

    // Replace all instances and build a map of image_id -> image_data
    const images: Record<string, string> = {};

    // Replace all images with placeholders and collect them in the images map
    const replaceContent = content.replace(imgRegex, match => {
        const id = uuidv4();

        // Extract the mime type
        const mimeMatch = match.match(/data:(?:image\/)?([a-zA-Z0-9.+-]+);base64,/);
        const mime = mimeMatch ? mimeMatch[1] : '';

        // Extract the actual base64 data
        const base64Start = match.indexOf('base64,') + 7;
        let base64Data = match.substring(base64Start);

        // Remove all whitespace from base64Data
        base64Data = base64Data.replace(/\s+/g, '');

        // Define magic headers and footers based on mime
        let startBinary = '';
        let endBinary = '';
        if (mime === 'png') {
            startBinary = '\x89PNG\r\n\x1A\n';
            endBinary = '\x00\x00\x00\x00IEND\xAE\x42\x60\x82';
        } else if (mime === 'jpeg' || mime === 'jpg') {
            startBinary = '\xFF\xD8\xFF';
            endBinary = '\xFF\xD9';
        } else if (mime === 'gif') {
            startBinary = 'GIF87a';
            if (base64Data.startsWith('R0lGODlh') || base64Data.startsWith('R0lGODdh')) {
                // base64 of GIF89a or GIF87a
                startBinary = 'GIF89a';
            }
            endBinary = '\x3B';
        } // Add more if needed

        let goodBase64 = base64Data;

        if (startBinary && endBinary) {
            let l = Math.floor(base64Data.length / 4) * 4;
            let found = false;
            while (l >= ((startBinary.length + endBinary.length) * 4) / 3) {
                // Rough minimal size estimate
                try {
                    const bin = atob(base64Data.substr(0, l));
                    if (bin.startsWith(startBinary) && bin.endsWith(endBinary)) {
                        goodBase64 = base64Data.substr(0, l);
                        found = true;
                        break;
                    }
                } catch {
                    // Invalid base64, continue
                }
                l -= 4;
            }
            if (!found) {
                // Fallback to original cleaning if validation fails
                const cleanedMatch = base64Data.match(/^([A-Za-z0-9+/]*)(={0,2})$/);
                if (cleanedMatch) {
                    goodBase64 = cleanedMatch[1] + cleanedMatch[2];
                }
            }
        } else {
            // Original cleaning for unsupported types
            const cleanedMatch = base64Data.match(/^([A-Za-z0-9+/]*)(={0,2})$/);
            if (cleanedMatch) {
                goodBase64 = cleanedMatch[1] + cleanedMatch[2];
            }
        }

        // Store the complete data URI with cleaned base64
        // Ensure we always have the "image/" prefix for consistency
        const prefix = mime.includes('/') ? 'data:' : 'data:image/';
        images[id] = `${prefix}${mime};base64,${goodBase64}`;
        return `[image #${id}]`;
    });

    // If no images were found, return original content
    if (Object.keys(images).length === 0) {
        return result;
    }

    // Get the first image ID for backward compatibility
    const firstImageId = Object.keys(images)[0];

    return {
        found: true,
        originalContent: content,
        replaceContent: replaceContent,
        image_id: firstImageId,
        images: images,
    };
}

/**
 * Resizes and splits an image to meet OpenAI's size requirements:
 * - Maximum width of 1024px
 * - Maximum height of 768px per segment
 *
 * @param imageData - Base64 encoded image data (with data URL prefix)
 * @returns Array of base64 image strings, split into sections if needed
 */
export async function resizeAndSplitForOpenAI(imageData: string): Promise<string[]> {
    const MAX_WIDTH = 1024;
    const MAX_HEIGHT = 768;

    // Strip the data-URL prefix and grab format
    const base64Image = imageData.replace(/^data:image\/\w+;base64,/, '');
    const imageFormat = imageData.match(/data:image\/(\w+);/)?.[1] || 'png';

    // Convert to a Buffer
    const imageBuffer = Buffer.from(base64Image, 'base64');

    // Quick-exit if already small enough
    const sharp = await getSharp();
    const { width: origW = 0, height: origH = 0 } = await sharp(imageBuffer).metadata();
    if (origW <= MAX_WIDTH && origH <= MAX_HEIGHT) {
        return [imageData];
    }

    // 1) Resize *with* flatten so no transparency becomes grey
    const newWidth = Math.min(origW, MAX_WIDTH);
    const resizedBuffer = await sharp(imageBuffer)
        .resize({ width: newWidth })
        .flatten({ background: '#fff' }) // white background
        .toFormat(imageFormat as any)
        .toBuffer();

    // 2) Read the real resized height
    const { height: resizedH = 0 } = await sharp(resizedBuffer).metadata();

    const result: string[] = [];

    // 3) If still too tall, slice it
    if (resizedH > MAX_HEIGHT) {
        const segments = Math.ceil(resizedH / MAX_HEIGHT);
        for (let i = 0; i < segments; i++) {
            const top = i * MAX_HEIGHT;
            const height = Math.min(MAX_HEIGHT, resizedH - top);
            if (height <= 0) continue;

            const segmentBuf = await sharp(resizedBuffer)
                .extract({ left: 0, top, width: newWidth, height })
                .toFormat(imageFormat as any)
                .toBuffer();

            const segmentDataUrl = `data:image/${imageFormat};base64,${segmentBuf.toString('base64')}`;
            result.push(segmentDataUrl);
        }
    } else {
        // single slice fits
        const singleUrl = `data:image/${imageFormat};base64,${resizedBuffer.toString('base64')}`;
        result.push(singleUrl);
    }

    return result;
}

// Utility to strip and re-prefix data-URLs
function stripDataUrl(dataUrl: string) {
    const match = dataUrl.match(/^data:image\/([^;]+);base64,(.+)$/);
    if (!match) throw new Error('Invalid data-URL');
    return { format: match[1], base64: match[2] };
}

async function processAndTruncate(imageBuffer: Buffer, format: string, maxW: number, maxH: number): Promise<Buffer> {
    const sharp = await getSharp();
    // 1) Auto-orient, resize to max width, flatten transparency
    const resized = await sharp(imageBuffer)
        .rotate()
        .resize({ width: maxW, withoutEnlargement: true })
        .flatten({ background: '#fff' })
        .toFormat(format as any)
        .toBuffer();

    // 2) Pull actual size
    const { width, height } = await sharp(resized).metadata();

    // 3) If too tall, crop bottom off
    if (height! > maxH) {
        return await sharp(resized)
            .extract({ left: 0, top: 0, width: width!, height: maxH })
            .toFormat(format as any)
            .toBuffer();
    }

    return resized;
}

/**
 * Claude: resize to ≤1024px wide, then truncate at 1120px tall.
 */
export async function resizeAndTruncateForClaude(imageData: string): Promise<string> {
    const { format, base64 } = stripDataUrl(imageData);
    const buf = Buffer.from(base64, 'base64');

    // early-exit if already fits
    const sharp = await getSharp();
    const meta = await sharp(buf).metadata();
    if (meta.width! <= CLAUDE_MAX_WIDTH && meta.height! <= CLAUDE_MAX_HEIGHT) {
        return imageData;
    }

    const outBuf = await processAndTruncate(buf, format, CLAUDE_MAX_WIDTH, CLAUDE_MAX_HEIGHT);
    return `data:image/${format};base64,${outBuf.toString('base64')}`;
}

/**
 * Gemini: resize to ≤1024px wide, then truncate at 1536px tall.
 */
export async function resizeAndTruncateForGemini(imageData: string): Promise<string> {
    const { format, base64 } = stripDataUrl(imageData);
    const buf = Buffer.from(base64, 'base64');

    // early-exit if already fits
    const sharp = await getSharp();
    const meta = await sharp(buf).metadata();
    if (meta.width! <= GEMINI_MAX_WIDTH && meta.height! <= GEMINI_MAX_HEIGHT) {
        return imageData;
    }

    const outBuf = await processAndTruncate(buf, format, GEMINI_MAX_WIDTH, GEMINI_MAX_HEIGHT);
    return `data:image/${format};base64,${outBuf.toString('base64')}`;
}
