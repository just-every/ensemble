import { describe, it, expect } from 'vitest';
import { 
    extractBase64Image,
    createImageFromBase64,
    createBase64FromImage,
    resizeAndSplitForOpenAI,
    resizeAndTruncateForClaude,
    resizeAndTruncateForGemini
} from '../utils/image_utils.js';
import { Buffer } from 'buffer';

// Helper functions that could be implemented
function isValidImageUrl(url: string): boolean {
    try {
        const urlObj = new URL(url);
        const pathname = urlObj.pathname.toLowerCase();
        return /\.(jpg|jpeg|png|gif|webp)$/i.test(pathname);
    } catch {
        return false;
    }
}

function detectImageType(input: string): string | null {
    // Check data URL
    const dataUrlMatch = input.match(/^data:image\/(\w+);/);
    if (dataUrlMatch) {
        const type = dataUrlMatch[1].toLowerCase();
        return type === 'jpeg' ? 'jpeg' : type;
    }
    
    // Check URL extension
    const extMatch = input.match(/\.(jpg|jpeg|png|gif|webp)(\?|#|$)/i);
    if (extMatch) {
        const ext = extMatch[1].toLowerCase();
        return ext === 'jpg' ? 'jpeg' : ext;
    }
    
    return null;
}

function validateBase64Image(input: string): boolean {
    // Check if it's a valid data URL
    if (input.startsWith('data:')) {
        const match = input.match(/^data:image\/\w+;base64,([A-Za-z0-9+/=]+)$/);
        return match !== null && match[1].length > 0;
    }
    
    // Check if it's valid base64
    try {
        const base64Regex = /^[A-Za-z0-9+/=]+$/;
        return base64Regex.test(input) && input.length > 0;
    } catch {
        return false;
    }
}

function estimateImageTokens(width: number, height: number): number {
    // OpenAI's token estimation formula (approximation)
    // Base tokens + additional tokens based on size
    const pixels = width * height;
    const tileSize = 512 * 512;
    const tiles = Math.max(1, Math.ceil(pixels / tileSize));
    const baseTokens = 85;
    const tokensPerTile = 170;
    
    return Math.min(baseTokens + (tiles - 1) * tokensPerTile, 2805);
}

describe('Image Utils', () => {
    describe('extractBase64Image', () => {
        it('should extract base64 images from content', () => {
            const content = 'Here is an image: data:image/png;base64,iVBORw0KGgo and some text';
            const result = extractBase64Image(content);
            
            expect(result.found).toBe(true);
            expect(result.replaceContent).toContain('[image #');
            expect(Object.keys(result.images).length).toBe(1);
        });

        it('should handle multiple images', () => {
            const content = 'Image 1: data:image/png;base64,ABC123 and Image 2: data:image/jpeg;base64,XYZ789';
            const result = extractBase64Image(content);
            
            expect(result.found).toBe(true);
            expect(Object.keys(result.images).length).toBe(2);
            expect(result.replaceContent).toMatch(/\[image #[^\]]+\].*\[image #[^\]]+\]/);
        });

        it('should return original content when no images found', () => {
            const content = 'Just plain text without images';
            const result = extractBase64Image(content);
            
            expect(result.found).toBe(false);
            expect(result.replaceContent).toBe(content);
            expect(Object.keys(result.images).length).toBe(0);
        });
    });

    describe('createImageFromBase64 and createBase64FromImage', () => {
        it('should convert between base64 and buffer', async () => {
            const base64Data = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
            
            // Convert to buffer
            const buffer = await createImageFromBase64(base64Data);
            expect(buffer).toBeInstanceOf(Buffer);
            expect(buffer.length).toBeGreaterThan(0);
            
            // Convert back to base64
            const base64Again = createBase64FromImage(buffer);
            expect(base64Again).toMatch(/^data:image\/png;base64,/);
        });
    });

    describe('Helper Functions', () => {
        describe('isValidImageUrl', () => {
            it('should validate correct image URLs', () => {
                expect(isValidImageUrl('https://example.com/image.jpg')).toBe(true);
                expect(isValidImageUrl('https://example.com/image.png')).toBe(true);
                expect(isValidImageUrl('https://example.com/image.gif')).toBe(true);
                expect(isValidImageUrl('https://example.com/image.webp')).toBe(true);
                expect(isValidImageUrl('https://example.com/path/to/image.jpeg')).toBe(true);
            });

            it('should reject invalid image URLs', () => {
                expect(isValidImageUrl('https://example.com/document.pdf')).toBe(false);
                expect(isValidImageUrl('https://example.com/script.js')).toBe(false);
                expect(isValidImageUrl('not-a-url')).toBe(false);
                expect(isValidImageUrl('')).toBe(false);
                expect(isValidImageUrl('https://example.com/')).toBe(false);
            });

            it('should handle URLs with query parameters', () => {
                expect(isValidImageUrl('https://example.com/image.jpg?size=large')).toBe(true);
                expect(isValidImageUrl('https://example.com/image.png?v=123&format=webp')).toBe(true);
            });

            it('should handle URLs with fragments', () => {
                expect(isValidImageUrl('https://example.com/image.jpg#section')).toBe(true);
            });

            it('should be case insensitive for extensions', () => {
                expect(isValidImageUrl('https://example.com/image.JPG')).toBe(true);
                expect(isValidImageUrl('https://example.com/image.PNG')).toBe(true);
                expect(isValidImageUrl('https://example.com/image.GiF')).toBe(true);
            });
        });

        describe('detectImageType', () => {
            it('should detect image type from data URL', () => {
                expect(detectImageType('data:image/jpeg;base64,/9j/4AAQ...')).toBe('jpeg');
                expect(detectImageType('data:image/png;base64,iVBORw0...')).toBe('png');
                expect(detectImageType('data:image/gif;base64,R0lGOD...')).toBe('gif');
                expect(detectImageType('data:image/webp;base64,UklGR...')).toBe('webp');
            });

            it('should detect image type from URL', () => {
                expect(detectImageType('https://example.com/photo.jpg')).toBe('jpeg');
                expect(detectImageType('https://example.com/photo.jpeg')).toBe('jpeg');
                expect(detectImageType('https://example.com/graphic.png')).toBe('png');
                expect(detectImageType('https://example.com/animation.gif')).toBe('gif');
                expect(detectImageType('https://example.com/modern.webp')).toBe('webp');
            });

            it('should handle URLs with query parameters', () => {
                expect(detectImageType('https://example.com/photo.jpg?size=large')).toBe('jpeg');
                expect(detectImageType('https://example.com/image.png?v=123')).toBe('png');
            });

            it('should return null for unknown types', () => {
                expect(detectImageType('https://example.com/file.txt')).toBe(null);
                expect(detectImageType('data:application/pdf;base64,...')).toBe(null);
                expect(detectImageType('invalid-string')).toBe(null);
            });

            it('should be case insensitive', () => {
                expect(detectImageType('https://example.com/photo.JPG')).toBe('jpeg');
                expect(detectImageType('https://example.com/photo.PNG')).toBe('png');
                expect(detectImageType('data:image/JPEG;base64,...')).toBe('jpeg');
            });
        });

        describe('validateBase64Image', () => {
            it('should validate correct base64 image strings', () => {
                // Valid base64 data URLs
                expect(validateBase64Image('data:image/jpeg;base64,/9j/4AAQSkZJRg==')).toBe(true);
                expect(validateBase64Image('data:image/png;base64,iVBORw0KGgoAAAANSU=')).toBe(true);
                
                // Valid plain base64
                expect(validateBase64Image('/9j/4AAQSkZJRg==')).toBe(true);
                expect(validateBase64Image('iVBORw0KGgoAAAANSU=')).toBe(true);
            });

            it('should reject invalid base64 strings', () => {
                expect(validateBase64Image('')).toBe(false);
                expect(validateBase64Image('not-base64')).toBe(false);
                expect(validateBase64Image('data:image/jpeg;base64,')).toBe(false); // No data
                expect(validateBase64Image('data:text/plain;base64,SGVsbG8=')).toBe(false); // Not image
            });

            it('should handle malformed data URLs', () => {
                expect(validateBase64Image('data:image/jpeg')).toBe(false); // Missing base64
                expect(validateBase64Image('image/jpeg;base64,/9j/4AAQ')).toBe(false); // Missing data:
            });
        });

        describe('estimateImageTokens', () => {
            it('should estimate tokens for different image sizes', () => {
                // Small image (1 tile)
                expect(estimateImageTokens(512, 512)).toBe(85);
                
                // Medium image (3 tiles)
                expect(estimateImageTokens(1024, 768)).toBe(425);
                
                // Large image (12 tiles)
                expect(estimateImageTokens(2048, 1536)).toBe(1955);
                
                // Very large image (48 tiles, but capped at 2805)
                expect(estimateImageTokens(4096, 3072)).toBe(2805);
            });

            it('should handle portrait vs landscape', () => {
                const portrait = estimateImageTokens(768, 1024);
                const landscape = estimateImageTokens(1024, 768);
                expect(portrait).toBe(landscape); // Should be same for same pixel count
            });

            it('should handle edge cases', () => {
                expect(estimateImageTokens(0, 0)).toBe(85); // Minimum
                expect(estimateImageTokens(1, 1)).toBe(85); // Minimum
                expect(estimateImageTokens(100, 100)).toBe(85); // Still small
            });

            it('should scale appropriately', () => {
                const small = estimateImageTokens(512, 512);
                const medium = estimateImageTokens(1024, 1024);
                const large = estimateImageTokens(2048, 2048);
                
                expect(medium).toBeGreaterThan(small);
                expect(large).toBeGreaterThan(medium);
            });
        });
    });
});