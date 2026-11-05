import { toFile } from 'openai';
import type { ImageGenerationOpts } from '../types/types.js';
import type { OpenAIImageOutputRequest } from './openai_image_output.js';

type SourceImage =
    | string
    | {
          data: string;
          metadata?: { category?: string; title?: string; id?: string | number };
      };

type PrepareOpenAIImageEditInput = {
    model: string;
    prompt: string;
    sourceImages: NonNullable<ImageGenerationOpts['source_images']>;
    mask?: string;
    numberOfImages: number;
    background: 'transparent' | 'opaque' | 'auto';
    quality: string;
    size: string;
    inputFidelity?: 'low' | 'medium' | 'high';
    outputRequest: OpenAIImageOutputRequest;
    signal: AbortSignal;
};

const sourceFilename = (source: SourceImage, index: number): string => {
    if (typeof source === 'string' || !source.metadata) return `image_${index}.png`;
    const parts = [
        source.metadata.category,
        source.metadata.title?.replace(/[^a-zA-Z0-9-_]/g, '_'),
        source.metadata.id === undefined ? undefined : `id${source.metadata.id}`,
    ].filter((part): part is string => Boolean(part));
    return parts.length > 0 ? `${parts.join('_')}.png` : `image_${index}.png`;
};

const sourceData = (source: SourceImage): string => (typeof source === 'string' ? source : source.data);

const base64Image = (value: string): { bytes: Uint8Array; mime: string } => {
    if (!value.startsWith('data:')) {
        return { bytes: new Uint8Array(Buffer.from(value, 'base64')), mime: 'image/png' };
    }
    const match = /^data:([^;]+);base64,(.+)$/i.exec(value);
    if (!match?.[2]) throw new TypeError('OpenAI source image data URL must contain base64 image bytes.');
    return {
        bytes: new Uint8Array(Buffer.from(match[2], 'base64')),
        mime: match[1] || 'image/png',
    };
};

const prepareSourceFile = async (source: SourceImage, index: number, signal: AbortSignal) => {
    const data = sourceData(source);
    const filename = sourceFilename(source, index);
    if (data.startsWith('http://') || data.startsWith('https://')) {
        const response = await fetch(data, { signal });
        if (!response.ok) {
            throw Object.assign(new Error(`OpenAI source image download failed with HTTP ${response.status}.`), {
                status: response.status,
            });
        }
        return await toFile(new Uint8Array(await response.arrayBuffer()), filename, {
            type: response.headers.get('content-type') || 'image/png',
        });
    }
    const decoded = base64Image(data);
    return await toFile(decoded.bytes, filename, { type: decoded.mime });
};

const prepareMaskFile = async (mask: string | undefined) => {
    if (!mask) return undefined;
    const decoded = base64Image(mask);
    return await toFile(decoded.bytes, 'mask.png', { type: decoded.mime });
};

export const prepareOpenAIImageEditInput = async (args: PrepareOpenAIImageEditInput) => {
    const imageArray: SourceImage[] = Array.isArray(args.sourceImages) ? args.sourceImages : [args.sourceImages];
    const [imageFiles, maskFile] = await Promise.all([
        Promise.all(imageArray.map(async (source, index) => await prepareSourceFile(source, index, args.signal))),
        prepareMaskFile(args.mask),
    ]);
    const editParams: any = {
        model: args.model,
        prompt: args.prompt,
        image: imageFiles,
        n: args.numberOfImages,
        background: args.background,
        quality: args.quality,
        size: args.size,
        moderation: 'low',
        ...args.outputRequest,
        ...(args.inputFidelity ? { input_fidelity: args.inputFidelity } : {}),
        ...(maskFile ? { mask: maskFile } : {}),
    };
    const uploadMetadata = (file: File) => ({
        filename: file.name,
        content_type: file.type,
        byte_count: file.size,
    });
    const requestLogData = {
        model: args.model,
        prompt: args.prompt,
        n: args.numberOfImages,
        background: args.background,
        quality: args.quality,
        size: args.size,
        moderation: 'low',
        ...args.outputRequest,
        ...(args.inputFidelity ? { input_fidelity: args.inputFidelity } : {}),
        source_images: imageFiles.map(uploadMetadata),
        ...(maskFile ? { mask: uploadMetadata(maskFile) } : {}),
    };
    return { editParams, requestLogData };
};
