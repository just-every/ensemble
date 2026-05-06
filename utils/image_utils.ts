/**
 * Image utility functions for the ensemble package.
 *
 * This module provides tools for normalizing and extracting image inputs.
 */

import { Buffer } from 'buffer';
import { v4 as uuidv4 } from 'uuid';
import { detectImageType, isValidBase64 } from './image_validation.js';

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

function normalizeExplicitImageId(value: string): string | null {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const normalized = trimmed.replace(/[^A-Za-z0-9._:-]+/g, '');
    if (!normalized) return null;
    return normalized.slice(0, 128);
}

function resolveImagePlaceholderId(
    explicitIdRaw: string | null,
    images: Record<string, string>,
    imageDataUrl: string
): string {
    const explicitId = explicitIdRaw ? normalizeExplicitImageId(explicitIdRaw) : null;
    if (explicitId) {
        const existing = images[explicitId];
        if (!existing || existing === imageDataUrl) {
            return explicitId;
        }
        let suffix = 2;
        while (true) {
            const candidate = `${explicitId}_${suffix}`;
            const existingCandidate = images[candidate];
            if (!existingCandidate || existingCandidate === imageDataUrl) {
                return candidate;
            }
            suffix += 1;
        }
    }

    let generated = uuidv4();
    while (images[generated] && images[generated] !== imageDataUrl) {
        generated = uuidv4();
    }
    return generated;
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
    // Optional explicit id prefix format:
    //   [image #<id>]data:image/png;base64,...
    // When present, <id> is used directly. We do not infer ids heuristically.
    const imgRegex = /(?:\[image\s*#([A-Za-z0-9._:-]{1,128})\]\s*)?data:(?:image\/)?([a-zA-Z0-9.+-]+);base64,[A-Za-z0-9+/\s]*={0,2}/gi;

    // Replace all instances and build a map of image_id -> image_data
    const images: Record<string, string> = {};

    // Replace all images with placeholders and collect them in the images map
    const replaceContent = content.replace(imgRegex, (match, explicitIdRaw, _mime) => {
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
        const imageDataUrl = `${prefix}${mime};base64,${goodBase64}`;
        const id = resolveImagePlaceholderId(
            typeof explicitIdRaw === 'string' ? explicitIdRaw : null,
            images,
            imageDataUrl
        );
        images[id] = imageDataUrl;
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

function looksLikeBase64(input: string): boolean {
    const trimmed = input.trim();
    if (trimmed.length < 16) return false;
    return /^[A-Za-z0-9+/_-]+={0,2}$/.test(trimmed);
}

function normalizeBase64String(input: string): string | null {
    const cleaned = input.replace(/\s+/g, '');
    if (!cleaned) return '';

    const normalized = cleaned.replace(/-/g, '+').replace(/_/g, '/');
    const mod = normalized.length % 4;
    if (mod === 1) return null;
    const padded = normalized + (mod === 0 ? '' : '='.repeat(4 - mod));
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(padded)) return null;

    try {
        atob(padded);
    } catch {
        return null;
    }

    return isValidBase64(padded) ? padded : null;
}

function looksLikeHex(input: string): boolean {
    const trimmed = input.trim();
    if (trimmed.length < 32 || trimmed.length % 2 !== 0) return false;
    return /^[0-9a-fA-F]+$/.test(trimmed);
}

function normalizeHexToBase64(input: string): string | null {
    if (!looksLikeHex(input)) return null;
    try {
        return Buffer.from(input.trim(), 'hex').toString('base64');
    } catch {
        return null;
    }
}

function getMimeFromMeta(meta: string): { mime?: string; charset?: string; isBase64: boolean } {
    const parts = meta
        .split(';')
        .map(part => part.trim())
        .filter(Boolean);
    const isBase64 = parts.some(part => part.toLowerCase() === 'base64');
    const charset = parts.find(part => part.toLowerCase().startsWith('charset='));
    const mime = parts.find(part => !part.toLowerCase().startsWith('charset=') && part.toLowerCase() !== 'base64');
    return { mime, charset, isBase64 };
}

function appendCharset(mime: string, charset?: string): string {
    return charset ? `${mime};${charset}` : mime;
}

function looksLikeUrl(input: string): boolean {
    const trimmed = input.trim();
    if (trimmed.startsWith('http://') || trimmed.startsWith('https://') || trimmed.startsWith('blob:')) return true;
    if (trimmed.startsWith('//')) return true;
    if (trimmed.includes(' ') || trimmed.includes('\n')) return false;
    if (/^[^\s]+\.[^\s]+\//.test(trimmed)) return true;
    if (/^[^\s]+\.[^\s]+$/.test(trimmed)) return true;
    return false;
}

function normalizeBinaryInput(input: ArrayBuffer | Uint8Array): string {
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
    return Buffer.from(bytes).toString('base64');
}

export function normalizeImageDataUrl(input: {
    data?: string | ArrayBuffer | Uint8Array;
    image_url?: string;
    url?: string;
    mime_type?: string;
}): { dataUrl?: string; url?: string } {
    const raw = input.data ?? input.image_url ?? input.url;
    if (!raw) return {};

    if (raw instanceof Uint8Array || raw instanceof ArrayBuffer) {
        const base64 = normalizeBinaryInput(raw);
        const mimeType = input.mime_type || detectImageType(base64) || 'image/png';
        return { dataUrl: `data:${mimeType};base64,${base64}` };
    }

    if (typeof raw !== 'string') return {};
    const trimmed = raw.trim();
    if (!trimmed) return {};

    if (trimmed.startsWith('data:')) {
        const match = trimmed.match(/^data:([^,]*?),(.*)$/s);
        if (!match) return { dataUrl: trimmed };

        const meta = match[1] || '';
        const payload = match[2] || '';
        const { mime, charset, isBase64 } = getMimeFromMeta(meta);

        const normalizedBase64 =
            isBase64 || looksLikeBase64(payload) ? normalizeBase64String(payload) : null;
        if (normalizedBase64) {
            const detected = detectImageType(normalizedBase64);
            const baseMime = mime || input.mime_type || detected || 'image/png';
            const mimeType = appendCharset(baseMime, charset);
            return { dataUrl: `data:${mimeType};base64,${normalizedBase64}` };
        }

        // Non-base64 payloads (e.g., SVG XML) - encode as UTF-8
        const rawPayload = payload.trim();
        const decoded = (() => {
            try {
                return decodeURIComponent(rawPayload);
            } catch {
                return rawPayload;
            }
        })();
        if (decoded) {
            const svgLike = /^<\?xml|<svg/i.test(decoded);
            const baseMime = mime || input.mime_type || (svgLike ? 'image/svg+xml' : 'image/png');
            const mimeType = appendCharset(baseMime, charset);
            const base64 = Buffer.from(decoded, 'utf8').toString('base64');
            return { dataUrl: `data:${mimeType};base64,${base64}` };
        }

        return {};
    }

    if (trimmed.includes(';base64,')) {
        const match = trimmed.match(/^([^,]*?);base64,(.*)$/s);
        if (match) {
            const meta = match[1] || '';
            const payload = match[2] || '';
            const normalizedBase64 = normalizeBase64String(payload);
            if (normalizedBase64) {
                const { mime, charset } = getMimeFromMeta(meta);
                const detected = detectImageType(normalizedBase64);
                const baseMime = mime || input.mime_type || detected || 'image/png';
                const mimeType = appendCharset(baseMime, charset);
                return { dataUrl: `data:${mimeType};base64,${normalizedBase64}` };
            }
        }
    }

    if (trimmed.startsWith('http://') || trimmed.startsWith('https://') || trimmed.startsWith('blob:')) {
        return { url: trimmed };
    }

    if (trimmed.startsWith('//')) {
        return { url: `https:${trimmed}` };
    }

    const base64Candidate = normalizeBase64String(trimmed);
    if (base64Candidate) {
        const mimeType = input.mime_type || detectImageType(base64Candidate) || 'image/png';
        return { dataUrl: `data:${mimeType};base64,${base64Candidate}` };
    }

    const hexCandidate = normalizeHexToBase64(trimmed);
    if (hexCandidate) {
        const mimeType = input.mime_type || detectImageType(hexCandidate) || 'image/png';
        return { dataUrl: `data:${mimeType};base64,${hexCandidate}` };
    }

    if (looksLikeUrl(trimmed)) {
        return { url: trimmed.startsWith('http') ? trimmed : `https://${trimmed.replace(/^\/\//, '')}` };
    }

    return {};
}
