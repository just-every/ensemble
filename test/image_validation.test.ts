import { describe, it, expect } from 'vitest';
import { isValidBase64, detectImageType } from '../utils/image_validation.js';

describe('Image Validation', () => {
    describe('isValidBase64', () => {
        it('should return true for valid base64 strings', () => {
            expect(isValidBase64('SGVsbG8gV29ybGQ=')).toBe(true); // "Hello World"
            expect(isValidBase64('YWJjZGVmZw==')).toBe(true); // "abcdefg"
        });

        it('should return false for invalid base64 strings', () => {
            expect(isValidBase64('invalid@base64')).toBe(false);
            expect(isValidBase64('not-base64!')).toBe(false);
            expect(isValidBase64('')).toBe(true); // Empty string is technically valid
        });

        it('should handle edge cases', () => {
            expect(isValidBase64('123')).toBe(false); // Wrong length
            expect(isValidBase64('QQ==')).toBe(true); // Valid padding
        });
    });

    describe('detectImageType', () => {
        it('should detect JPEG images', () => {
            // JPEG magic bytes: FF D8
            const jpegData = btoa('\xFF\xD8\xFF\xE0'); // Mock JPEG header
            expect(detectImageType(jpegData)).toBe('image/jpeg');
        });

        it('should detect PNG images', () => {
            // PNG magic bytes: 89 50 4E 47
            const pngData = btoa('\x89\x50\x4E\x47'); // Mock PNG header
            expect(detectImageType(pngData)).toBe('image/png');
        });

        it('should detect GIF images', () => {
            // GIF magic bytes: 47 49 46 38
            const gifData = btoa('\x47\x49\x46\x38'); // Mock GIF header
            expect(detectImageType(gifData)).toBe('image/gif');
        });

        it('should detect WebP images', () => {
            // WebP magic bytes: 52 49 46 46
            const webpData = btoa('\x52\x49\x46\x46'); // Mock WebP header
            expect(detectImageType(webpData)).toBe('image/webp');
        });

        it('should return null for unknown image types', () => {
            const unknownData = btoa('ABCD1234'); // Unknown format
            expect(detectImageType(unknownData)).toBe(null);
        });

        it('should handle invalid base64 data', () => {
            expect(detectImageType('invalid-base64')).toBe(null);
            expect(detectImageType('')).toBe(null);
        });

        it('should handle short data', () => {
            const shortData = btoa('A'); // Too short to contain magic bytes
            expect(detectImageType(shortData)).toBe(null);
        });
    });
});
