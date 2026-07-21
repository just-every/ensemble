import { findModel } from '../data/model_data.js';

export function getGrokImagePricing(model: string, resolution: '1k' | '2k' = '1k') {
    const cost = findModel(model)?.cost;
    return {
        inputImage: cost?.per_input_image ?? 0,
        outputImage: cost?.per_image_by_resolution?.[resolution] ?? cost?.per_image ?? 0,
    };
}

export function getGrokVideoPricing(model: string, resolution: '480p' | '720p' | '1080p') {
    const cost = findModel(model)?.cost;
    const outputSecond = cost?.per_second_by_resolution?.[resolution] ?? cost?.per_second;
    if (typeof outputSecond !== 'number') {
        throw new Error(`${model} does not support ${resolution} output.`);
    }
    return {
        inputImage: cost?.per_input_image ?? 0,
        inputSecond: cost?.per_input_second ?? 0,
        outputSecond,
    };
}
