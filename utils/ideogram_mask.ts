import { Buffer } from 'buffer';
import { deflateSync, inflateSync } from 'zlib';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

type PngInfo = {
    width: number;
    height: number;
    bitDepth: number;
    colorType: number;
    data: Buffer;
};

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

function parsePng(buf: Buffer): PngInfo | null {
    if (buf.length < 33 || !buf.subarray(0, 8).equals(PNG_SIGNATURE)) return null;

    let offset = 8;
    let width = 0;
    let height = 0;
    let bitDepth = 0;
    let colorType = 0;
    const idat: Buffer[] = [];

    while (offset + 12 <= buf.length) {
        const length = buf.readUInt32BE(offset);
        const type = buf.subarray(offset + 4, offset + 8).toString('ascii');
        const dataStart = offset + 8;
        const dataEnd = dataStart + length;
        if (dataEnd + 4 > buf.length) return null;
        const data = buf.subarray(dataStart, dataEnd);

        if (type === 'IHDR') {
            width = data.readUInt32BE(0);
            height = data.readUInt32BE(4);
            bitDepth = data[8];
            colorType = data[9];
            if (data[10] !== 0 || data[11] !== 0 || data[12] !== 0) return null;
        } else if (type === 'IDAT') {
            idat.push(Buffer.from(data));
        } else if (type === 'IEND') {
            break;
        }

        offset = dataEnd + 4;
    }

    if (!width || !height || bitDepth !== 8 || !idat.length) return null;
    return { width, height, bitDepth, colorType, data: inflateSync(Buffer.concat(idat)) };
}

function unfilterPngRows(info: PngInfo, bytesPerPixel: number): Buffer | null {
    const stride = info.width * bytesPerPixel;
    const expected = (stride + 1) * info.height;
    if (info.data.length < expected) return null;

    const out = Buffer.alloc(stride * info.height);
    let inputOffset = 0;

    for (let y = 0; y < info.height; y += 1) {
        const filter = info.data[inputOffset];
        inputOffset += 1;
        const rowStart = y * stride;

        for (let x = 0; x < stride; x += 1) {
            const raw = info.data[inputOffset + x];
            const left = x >= bytesPerPixel ? out[rowStart + x - bytesPerPixel] : 0;
            const up = y > 0 ? out[rowStart + x - stride] : 0;
            const upLeft = y > 0 && x >= bytesPerPixel ? out[rowStart + x - stride - bytesPerPixel] : 0;

            let value: number;
            if (filter === 0) value = raw;
            else if (filter === 1) value = raw + left;
            else if (filter === 2) value = raw + up;
            else if (filter === 3) value = raw + Math.floor((left + up) / 2);
            else if (filter === 4) {
                const p = left + up - upLeft;
                const pa = Math.abs(p - left);
                const pb = Math.abs(p - up);
                const pc = Math.abs(p - upLeft);
                const predictor = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
                value = raw + predictor;
            } else {
                return null;
            }

            out[rowStart + x] = value & 0xff;
        }

        inputOffset += stride;
    }

    return out;
}

function encodeGrayscalePng(width: number, height: number, pixels: Buffer): Buffer {
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(width, 0);
    ihdr.writeUInt32BE(height, 4);
    ihdr[8] = 8;
    ihdr[9] = 0;
    ihdr[10] = 0;
    ihdr[11] = 0;
    ihdr[12] = 0;

    const rows = Buffer.alloc((width + 1) * height);
    for (let y = 0; y < height; y += 1) {
        const rowOffset = y * (width + 1);
        rows[rowOffset] = 0;
        pixels.copy(rows, rowOffset + 1, y * width, (y + 1) * width);
    }

    return Buffer.concat([
        PNG_SIGNATURE,
        pngChunk('IHDR', ihdr),
        pngChunk('IDAT', deflateSync(rows)),
        pngChunk('IEND'),
    ]);
}

function alphaMaskToWhiteEditPng(buf: Buffer): Buffer | null {
    const png = parsePng(buf);
    if (!png) return null;

    const bytesPerPixel = png.colorType === 6 ? 4 : png.colorType === 4 ? 2 : 0;
    if (!bytesPerPixel) return null;

    const rgba = unfilterPngRows(png, bytesPerPixel);
    if (!rgba) return null;

    const alphaOffset = bytesPerPixel - 1;
    const maskPixels = Buffer.alloc(png.width * png.height);
    for (let pixel = 0; pixel < maskPixels.length; pixel += 1) {
        maskPixels[pixel] = 255 - rgba[pixel * bytesPerPixel + alphaOffset];
    }

    return encodeGrayscalePng(png.width, png.height, maskPixels);
}

export function mapTransparentEditMaskForFalIdeogram(maskUrl: string): string {
    const match = /^data:image\/png(?:;[^,]*)?;base64,(.+)$/i.exec(maskUrl);
    if (!match) return maskUrl;

    const source = Buffer.from(match[1], 'base64');
    const mapped = alphaMaskToWhiteEditPng(source);
    if (!mapped) return maskUrl;

    return `data:image/png;base64,${mapped.toString('base64')}`;
}
