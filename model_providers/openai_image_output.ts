import type { ImageGenerationOpts } from '../types/types.js';
import { isGptImage26 } from './openai_image_pricing.js';

export type OpenAIImageOutputFormat = 'png' | 'jpeg' | 'webp' | 'gif';

/** The output-shaping fields of one OpenAI Images API request. */
export interface OpenAIImageOutputRequest {
    output_format: OpenAIImageOutputFormat;
    complexity?: NonNullable<ImageGenerationOpts['complexity']>;
    frame_count?: number;
    frame_duration_ms?: number;
}

const OUTPUT_MIME: Record<OpenAIImageOutputFormat, string> = {
    png: 'image/png',
    jpeg: 'image/jpeg',
    webp: 'image/webp',
    gif: 'image/gif',
};

export const openAIImageOutputMime = (format: OpenAIImageOutputFormat): string => OUTPUT_MIME[format];

/**
 * Resolves the output fields an OpenAI image request sends.
 *
 * Models before GPT Image 2.6 keep their fixed PNG contract. GPT Image 2.6 adds
 * `complexity` and animated GIF output (`frame_count`, `frame_duration_ms`, on
 * generations and edits), and honours `output_format`. A field a model cannot
 * take is refused here rather than dropped, so a caller never receives a PNG it
 * did not ask for.
 */
export function resolveOpenAIImageOutputRequest(
    model: string,
    opts: ImageGenerationOpts | undefined
): OpenAIImageOutputRequest {
    const format = opts?.output_format;
    const hasFrames = opts?.frame_count !== undefined || opts?.frame_duration_ms !== undefined;
    if (!isGptImage26(model)) {
        if (opts?.complexity !== undefined || hasFrames || format === 'gif' || format === 'svg') {
            throw new Error(
                `OpenAI image model ${model} does not support complexity, animated GIF or SVG output; use GPT Image 2.6.`
            );
        }
        return { output_format: 'png' };
    }
    if (format === 'svg') {
        // The live API requires an SVG authoring text model (`svg.model`) and bills it
        // separately (`svg_usage`); ensemble neither sends nor prices that yet.
        throw new Error(`OpenAI SVG output for ${model} needs an authoring model that ensemble does not send yet.`);
    }
    const outputFormat: OpenAIImageOutputFormat =
        format === 'jpg' || format === 'jpeg' ? 'jpeg' : format === 'webp' || format === 'gif' ? format : 'png';
    if (hasFrames && outputFormat !== 'gif') {
        throw new Error(`OpenAI image frame_count and frame_duration_ms require output_format 'gif' (${model}).`);
    }
    return {
        output_format: outputFormat,
        ...(opts?.complexity !== undefined ? { complexity: opts.complexity } : {}),
        ...(opts?.frame_count !== undefined ? { frame_count: opts.frame_count } : {}),
        ...(opts?.frame_duration_ms !== undefined ? { frame_duration_ms: opts.frame_duration_ms } : {}),
    };
}
