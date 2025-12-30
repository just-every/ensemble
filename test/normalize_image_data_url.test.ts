import { describe, it, expect } from 'vitest';
import { normalizeImageDataUrl } from '../utils/image_utils.js';

const pngBase64 =
    'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAAKElEQVR4nO3NMQEAAAjDMMC/ZzDBvlRA01vZJvwHAAAAAAAAAAAAbx2jxAE/i2AjOgAAAABJRU5ErkJggg==';

describe('normalizeImageDataUrl', () => {
    it('handles raw base64 missing padding', () => {
        const noPadding = pngBase64.replace(/=+$/, '');
        const result = normalizeImageDataUrl({ data: noPadding });
        expect(result.dataUrl?.startsWith('data:image/png;base64,')).toBe(true);
    });

    it('handles data URLs without mime type', () => {
        const result = normalizeImageDataUrl({ data: `data:;base64,${pngBase64}` });
        expect(result.dataUrl?.startsWith('data:image/png;base64,')).toBe(true);
    });

    it('handles SVG data URLs without base64 flag', () => {
        const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>';
        const result = normalizeImageDataUrl({ data: `data:image/svg+xml,${encodeURIComponent(svg)}` });
        expect(result.dataUrl?.startsWith('data:image/svg+xml;base64,')).toBe(true);
    });

    it('prefixes scheme-less URLs', () => {
        const result = normalizeImageDataUrl({ data: 'example.com/image.png' });
        expect(result.url).toBe('https://example.com/image.png');
    });

    it('accepts binary input', () => {
        const bytes = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
        const result = normalizeImageDataUrl({ data: bytes, mime_type: 'image/png' });
        expect(result.dataUrl?.startsWith('data:image/png;base64,')).toBe(true);
    });
});
