/**
 * Image validation utilities for model providers
 */

/**
 * Validate base64 string
 */
export function isValidBase64(str: string): boolean {
    try {
        return btoa(atob(str)) === str;
    } catch {
        return false;
    }
}

/**
 * Detect image type from base64 data
 */
export function detectImageType(base64Data: string): string | null {
    try {
        const decoded = atob(base64Data.slice(0, 16));
        const bytes = new Uint8Array(
            decoded.split('').map(char => char.charCodeAt(0))
        );

        // Check magic numbers
        if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'image/jpeg';
        if (bytes[0] === 0x89 && bytes[1] === 0x50) return 'image/png';
        if (bytes[0] === 0x47 && bytes[1] === 0x49) return 'image/gif';
        if (bytes[0] === 0x52 && bytes[1] === 0x49) return 'image/webp';

        return null;
    } catch {
        return null;
    }
}
