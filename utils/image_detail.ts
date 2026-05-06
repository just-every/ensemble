import type { ImageInputDetail, ResponseInput, ResponseContent } from '../types/types.js';

export type OpenAIImageDetail = 'low' | 'high' | 'original' | 'auto';
export type OpenAIChatImageDetail = 'low' | 'high' | 'auto';
export type OpenAIImageInputFidelity = 'low' | 'medium' | 'high';
export type GeminiMediaResolution = 'MEDIA_RESOLUTION_LOW' | 'MEDIA_RESOLUTION_MEDIUM' | 'MEDIA_RESOLUTION_HIGH';

const DETAIL_RANK: Record<Exclude<ImageInputDetail, 'auto'>, number> = {
    low: 1,
    medium: 2,
    high: 3,
    original: 4,
};

export function mapOpenAIImageDetail(detail?: ImageInputDetail): OpenAIImageDetail | undefined {
    if (!detail) return undefined;
    if (detail === 'medium') return 'high';
    return detail;
}

export function mapOpenAIChatImageDetail(detail?: ImageInputDetail): OpenAIChatImageDetail | undefined {
    if (!detail) return undefined;
    if (detail === 'medium' || detail === 'original') return 'high';
    return detail;
}

export function mapOpenAIImageInputFidelity(detail?: ImageInputDetail): OpenAIImageInputFidelity | undefined {
    if (!detail || detail === 'auto') return undefined;
    if (detail === 'original') return 'high';
    return detail;
}

export function mapGeminiMediaResolution(detail?: ImageInputDetail): GeminiMediaResolution | undefined {
    switch (detail) {
        case 'low':
            return 'MEDIA_RESOLUTION_LOW';
        case 'medium':
            return 'MEDIA_RESOLUTION_MEDIUM';
        case 'high':
        case 'original':
            return 'MEDIA_RESOLUTION_HIGH';
        case 'auto':
        default:
            return undefined;
    }
}

export function chooseHighestImageDetail(details: Array<ImageInputDetail | undefined>): ImageInputDetail | undefined {
    let selected: Exclude<ImageInputDetail, 'auto'> | undefined;
    for (const detail of details) {
        if (!detail || detail === 'auto') continue;
        if (!selected || DETAIL_RANK[detail] > DETAIL_RANK[selected]) {
            selected = detail;
        }
    }
    return selected;
}

function collectDetailsFromContent(content: ResponseContent): Array<ImageInputDetail | undefined> {
    if (!Array.isArray(content)) return [];
    return content
        .filter(item => item.type === 'input_image' || item.type === 'image')
        .map(item => item.detail);
}

export function chooseImageDetailFromInput(input: ResponseInput): ImageInputDetail | undefined {
    const details: Array<ImageInputDetail | undefined> = [];
    for (const item of input) {
        if ('content' in item) {
            details.push(...collectDetailsFromContent(item.content));
        }
    }
    return chooseHighestImageDetail(details);
}
