import { Buffer } from 'buffer';
import { deflateSync, inflateSync } from 'zlib';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { findModel } from '../data/model_data.js';
import { FALProvider } from '../model_providers/fal.js';
import { getModelProvider, getProviderFromModel } from '../model_providers/model_provider.js';
import { costTracker } from '../utils/cost_tracker.js';

const originalFalKey = process.env.FAL_KEY;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    CRC_TABLE[n] = c >>> 0;
}

function crc32(buf: Buffer): number {
    let c = 0xffffffff;
    for (const byte of buf) {
        c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
    }
    return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data = Buffer.alloc(0)): Buffer {
    const typeBuffer = Buffer.from(type, 'ascii');
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length, 0);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
    return Buffer.concat([length, typeBuffer, data, crc]);
}

function makeRgbaPngDataUrl(width: number, height: number, alphaPixels: number[]): string {
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(width, 0);
    ihdr.writeUInt32BE(height, 4);
    ihdr[8] = 8;
    ihdr[9] = 6;

    const rows = Buffer.alloc((width * 4 + 1) * height);
    for (let y = 0; y < height; y += 1) {
        const rowOffset = y * (width * 4 + 1);
        rows[rowOffset] = 0;
        for (let x = 0; x < width; x += 1) {
            const pixelOffset = rowOffset + 1 + x * 4;
            rows[pixelOffset] = 255;
            rows[pixelOffset + 1] = 255;
            rows[pixelOffset + 2] = 255;
            rows[pixelOffset + 3] = alphaPixels[y * width + x] ?? 255;
        }
    }

    const png = Buffer.concat([
        PNG_SIGNATURE,
        pngChunk('IHDR', ihdr),
        pngChunk('IDAT', deflateSync(rows)),
        pngChunk('IEND'),
    ]);
    return `data:image/png;base64,${png.toString('base64')}`;
}

function readGrayscalePixels(dataUrl: string): number[] {
    const match = /^data:image\/png;base64,(.+)$/i.exec(dataUrl);
    if (!match) throw new Error('Expected PNG data URL');
    const buf = Buffer.from(match[1], 'base64');
    let offset = 8;
    let width = 0;
    let height = 0;
    const idat: Buffer[] = [];
    while (offset + 12 <= buf.length) {
        const length = buf.readUInt32BE(offset);
        const type = buf.subarray(offset + 4, offset + 8).toString('ascii');
        const data = buf.subarray(offset + 8, offset + 8 + length);
        if (type === 'IHDR') {
            width = data.readUInt32BE(0);
            height = data.readUInt32BE(4);
            expect(data[8]).toBe(8);
            expect(data[9]).toBe(0);
        } else if (type === 'IDAT') {
            idat.push(Buffer.from(data));
        } else if (type === 'IEND') {
            break;
        }
        offset += length + 12;
    }

    const rows = inflateSync(Buffer.concat(idat));
    const pixels: number[] = [];
    for (let y = 0; y < height; y += 1) {
        const rowOffset = y * (width + 1);
        expect(rows[rowOffset]).toBe(0);
        for (let x = 0; x < width; x += 1) {
            pixels.push(rows[rowOffset + 1 + x]);
        }
    }
    return pixels;
}

describe('FAL Ideogram V3 support', () => {
    beforeEach(() => {
        process.env.FAL_KEY = 'fal-test';
        costTracker.reset();
    });

    afterEach(() => {
        process.env.FAL_KEY = originalFalKey;
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it('registers Ideogram V3 create and edit models with FAL routing', () => {
        expect(findModel('fal-ai/ideogram/v3')).toMatchObject({
            id: 'fal-ai/ideogram/v3',
            aliases: ['fal-ideogram-v3', 'fal-ai-ideogram-v3'],
            provider: 'fal',
            cost: { per_image: 0.06 },
            features: { input_modality: ['text', 'image'], output_modality: ['image'] },
            class: 'image_generation',
        });
        expect(findModel('fal-ai/ideogram/v3/edit')).toMatchObject({
            id: 'fal-ai/ideogram/v3/edit',
            aliases: ['ideogram-v3-edit', 'fal-ideogram-v3-edit', 'fal-ai-ideogram-v3-edit'],
            provider: 'fal',
            cost: { per_image: 0.06 },
            features: { input_modality: ['text', 'image'], output_modality: ['image'] },
            class: 'image_generation',
        });
        expect(getProviderFromModel('fal-ai/ideogram/v3')).toBe('fal');
        expect(getProviderFromModel('ideogram-v3-edit')).toBe('fal');
        expect(getModelProvider('fal-ai/ideogram/v3/edit')).toBeInstanceOf(FALProvider);
    });

    it('calls the Ideogram V3 create endpoint with generation options and style references', async () => {
        const provider = new FALProvider();
        const fetchMock = vi.fn().mockResolvedValue(
            new Response(
                JSON.stringify({
                    images: [{ url: 'https://example.com/one.png' }, { url: 'https://example.com/two.png' }],
                }),
                { status: 200, headers: { 'Content-Type': 'application/json' } }
            )
        );
        vi.stubGlobal('fetch', fetchMock);

        const images = await provider.createImage(
            'poster with crisp typography',
            'fal-ai/ideogram/v3',
            { agent_id: 'test-fal-ideogram-v3' } as any,
            {
                n: 2,
                size: 'portrait',
                quality: 'high',
                source_images: ['https://example.com/style.png'],
                seed: 12.8,
                response_format: 'b64_json',
                request_id: 'ideogram-create-request',
            }
        );

        expect(images).toEqual(['https://example.com/one.png', 'https://example.com/two.png']);
        expect(fetchMock).toHaveBeenCalledWith('https://fal.run/fal-ai/ideogram/v3', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: 'Key fal-test',
            },
            body: JSON.stringify({
                prompt: 'poster with crisp typography',
                rendering_speed: 'QUALITY',
                num_images: 2,
                image_size: 'portrait_16_9',
                sync_mode: true,
                seed: 12,
                image_urls: ['https://example.com/style.png'],
            }),
        });
        expect(costTracker.getTotalCost()).toBeCloseTo(0.18);
    });

    it('defaults Ideogram V3 create quality to BALANCED speed and medium-tier cost', async () => {
        const provider = new FALProvider();
        const fetchMock = vi.fn().mockResolvedValue(
            new Response(JSON.stringify({ images: [{ url: 'https://example.com/default.png' }] }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            })
        );
        vi.stubGlobal('fetch', fetchMock);

        await provider.createImage('poster with balanced default quality', 'fal-ai/ideogram/v3', {
            agent_id: 'test-fal-ideogram-v3',
        } as any);

        const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
        expect(body.rendering_speed).toBe('BALANCED');
        expect(costTracker.getTotalCost()).toBeCloseTo(0.06);
    });

    it('calls the Ideogram V3 edit endpoint with image_url and mapped white-edit mask_url', async () => {
        const provider = new FALProvider();
        const fetchMock = vi.fn().mockResolvedValue(
            new Response(JSON.stringify({ images: [{ url: 'https://example.com/edited.png' }] }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            })
        );
        vi.stubGlobal('fetch', fetchMock);

        const sourceMask = makeRgbaPngDataUrl(1, 2, [0, 255]);
        const images = await provider.createImage(
            'replace the empty region with a black bag',
            'fal-ai/ideogram/v3/edit',
            { agent_id: 'test-fal-ideogram-v3-edit' } as any,
            {
                source_images: ['https://example.com/source.png'],
                mask: sourceMask,
                quality: 'low',
                request_id: 'ideogram-edit-request',
            }
        );

        expect(images).toEqual(['https://example.com/edited.png']);
        const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
        expect(fetchMock.mock.calls[0][0]).toBe('https://fal.run/fal-ai/ideogram/v3/edit');
        expect(body).toMatchObject({
            prompt: 'replace the empty region with a black bag',
            image_url: 'https://example.com/source.png',
            rendering_speed: 'TURBO',
            num_images: 1,
        });
        expect(body.mask_url).not.toBe(sourceMask);
        expect(readGrayscalePixels(body.mask_url)).toEqual([255, 0]);
        expect(costTracker.getTotalCost()).toBeCloseTo(0.03);
    });

    it('maps medium Ideogram V3 edit quality to BALANCED speed and medium-tier cost', async () => {
        const provider = new FALProvider();
        const fetchMock = vi.fn().mockResolvedValue(
            new Response(JSON.stringify({ images: [{ url: 'https://example.com/medium-edit.png' }] }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            })
        );
        vi.stubGlobal('fetch', fetchMock);

        await provider.createImage(
            'replace the empty region with a black bag',
            'fal-ai/ideogram/v3/edit',
            { agent_id: 'test-fal-ideogram-v3-edit' } as any,
            {
                source_images: ['https://example.com/source.png'],
                mask: makeRgbaPngDataUrl(1, 1, [0]),
                quality: 'medium',
                request_id: 'ideogram-edit-medium-request',
            }
        );

        const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
        expect(body.rendering_speed).toBe('BALANCED');
        expect(costTracker.getTotalCost()).toBeCloseTo(0.06);
    });

    it('requires a source image and mask for Ideogram V3 editing', async () => {
        const provider = new FALProvider();

        await expect(
            provider.createImage('edit', 'fal-ai/ideogram/v3/edit', { agent_id: 'test-fal-ideogram-v3-edit' } as any, {
                mask: makeRgbaPngDataUrl(1, 1, [0]),
            })
        ).rejects.toThrow('requires exactly one source image');

        await expect(
            provider.createImage('edit', 'fal-ai/ideogram/v3/edit', { agent_id: 'test-fal-ideogram-v3-edit' } as any, {
                source_images: ['https://example.com/source.png'],
            })
        ).rejects.toThrow('requires a mask image');
    });
});
