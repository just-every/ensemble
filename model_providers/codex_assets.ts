import { access, readdir, readFile, stat, writeFile } from 'fs/promises';
import path from 'path';
import type { ImageGenerationOpts, ResponseContent, ResponseContentImageData } from '../types/types.js';
import { isValidBase64 } from '../utils/image_validation.js';

const DATA_URL_PATTERN = /^data:([^;]+);base64,(.+)$/i;

function isHttpUrl(value: string): boolean {
    return value.startsWith('http://') || value.startsWith('https://');
}

function mimeExtension(mimeType: string | undefined): string {
    if (mimeType === 'image/jpeg' || mimeType === 'image/jpg') return 'jpg';
    if (mimeType === 'image/webp') return 'webp';
    if (mimeType === 'image/gif') return 'gif';
    return 'png';
}

function mimeFromPath(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase();
    if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
    if (ext === '.webp') return 'image/webp';
    if (ext === '.gif') return 'image/gif';
    return 'image/png';
}

async function existingLocalPath(value: string, cwd: string): Promise<string | undefined> {
    const resolved = path.isAbsolute(value) ? value : path.resolve(cwd, value);
    try {
        await access(resolved);
        return resolved;
    } catch {
        return undefined;
    }
}

export class CodexImageAttachmentWriter {
    private index = 0;

    constructor(
        private readonly tempDir: string,
        private readonly cwd: string
    ) {}

    async collectContent(
        content: ResponseContent,
        context: string
    ): Promise<{ text: string; images: string[] }> {
        if (typeof content === 'string') {
            return { text: content, images: [] };
        }

        const textParts: string[] = [];
        const images: string[] = [];

        for (const part of content) {
            if (part.type === 'input_text') {
                textParts.push(part.text);
                continue;
            }

            if (part.type === 'input_image') {
                if (part.file_id) {
                    throw new Error(`Codex provider does not support file_id image inputs; ${context} contains file_id.`);
                }
                if (!part.image_url) {
                    throw new Error(`Codex provider image input is missing image_url; ${context}.`);
                }
                images.push(await this.materializeImageString(part.image_url));
                continue;
            }

            if (part.type === 'image') {
                images.push(await this.materializeImageDataPart(part));
                continue;
            }

            throw new Error(`Codex provider only supports text and image content; ${context} contains ${part.type}.`);
        }

        return { text: textParts.join('\n'), images };
    }

    async materializeSourceImages(sourceImages: ImageGenerationOpts['source_images']): Promise<string[]> {
        if (!sourceImages) {
            return [];
        }

        const images = Array.isArray(sourceImages) ? sourceImages : [sourceImages];
        const paths: string[] = [];

        for (const image of images) {
            if (typeof image === 'string') {
                paths.push(await this.materializeImageString(image));
            } else {
                paths.push(await this.materializeImageString(image.data));
            }
        }

        return paths;
    }

    private async materializeImageDataPart(part: ResponseContentImageData): Promise<string> {
        if (part.file_id) {
            throw new Error('Codex provider does not support file_id image inputs.');
        }
        if (part.url) {
            return this.materializeImageString(part.url, part.mime_type);
        }
        if (part.data === undefined) {
            throw new Error('Codex provider image content requires data or url.');
        }
        if (typeof part.data === 'string') {
            return this.materializeImageString(part.data, part.mime_type);
        }

        const buffer =
            part.data instanceof Uint8Array
                ? Buffer.from(part.data)
                : Buffer.from(new Uint8Array(part.data));
        return this.writeImageBuffer(buffer, part.mime_type || 'image/png');
    }

    private async materializeImageString(value: string, mimeType?: string): Promise<string> {
        const dataUrlMatch = DATA_URL_PATTERN.exec(value);
        if (dataUrlMatch) {
            return this.writeImageBuffer(Buffer.from(dataUrlMatch[2], 'base64'), dataUrlMatch[1]);
        }

        if (isHttpUrl(value)) {
            const response = await fetch(value);
            if (!response.ok) {
                throw new Error(`Codex provider failed to fetch image ${value}: ${response.status} ${response.statusText}`);
            }
            const responseMime = response.headers.get('content-type') || mimeType || 'image/png';
            return this.writeImageBuffer(Buffer.from(await response.arrayBuffer()), responseMime);
        }

        const localPath = await existingLocalPath(value, this.cwd);
        if (localPath) {
            return localPath;
        }

        if (isValidBase64(value)) {
            return this.writeImageBuffer(Buffer.from(value, 'base64'), mimeType || 'image/png');
        }

        throw new Error('Codex provider image input must be a local file path, URL, data URL, or base64 image data.');
    }

    private async writeImageBuffer(buffer: Buffer, mimeType: string): Promise<string> {
        const filePath = path.join(this.tempDir, `image-${this.index++}.${mimeExtension(mimeType)}`);
        await writeFile(filePath, buffer);
        return filePath;
    }
}

export async function listCodexGeneratedImages(codexHome: string): Promise<string[]> {
    const root = path.join(codexHome, 'generated_images');
    const images: string[] = [];

    async function walk(dir: string): Promise<void> {
        let entries;
        try {
            entries = await readdir(dir, { withFileTypes: true });
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
                return;
            }
            throw error;
        }

        for (const entry of entries) {
            const entryPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                await walk(entryPath);
            } else if (entry.isFile() && /\.(png|jpe?g|webp|gif)$/i.test(entry.name)) {
                images.push(entryPath);
            }
        }
    }

    await walk(root);
    return images;
}

export async function readGeneratedCodexImageFiles(generatedImagePaths: string[], expectedCount: number): Promise<string[]> {
    if (generatedImagePaths.length < expectedCount) {
        throw new Error(
            `Codex image generation created ${generatedImagePaths.length} image artifact${
                generatedImagePaths.length === 1 ? '' : 's'
            }, expected ${expectedCount}.`
        );
    }

    const selectedPaths = generatedImagePaths.slice(0, expectedCount);
    return Promise.all(
        selectedPaths.map(async filePath => {
            const data = await readFile(filePath);
            return `data:${mimeFromPath(filePath)};base64,${data.toString('base64')}`;
        })
    );
}

export async function newestFirst(paths: string[]): Promise<string[]> {
    const rows = await Promise.all(
        paths.map(async filePath => ({
            filePath,
            mtimeMs: (await stat(filePath)).mtimeMs,
        }))
    );
    return rows.sort((a, b) => b.mtimeMs - a.mtimeMs).map(row => row.filePath);
}
