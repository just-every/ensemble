export type FalFluxOutpaintDimensions = {
    width: number;
    height: number;
};

export type FalFluxOutpaintCost = {
    cost: number;
    billableMegapixels: number;
    pricedImages: number;
};

export const FAL_FLUX_2_PRO_OUTPAINT_BASE_COST = 0.03;
export const FAL_FLUX_2_PRO_OUTPAINT_EXTRA_MEGAPIXEL_COST = 0.015;

export function calculateFalFlux2ProOutpaintImageCost(dimensions: FalFluxOutpaintDimensions): {
    cost: number;
    billableMegapixels: number;
} {
    const megapixels = (dimensions.width * dimensions.height) / 1_000_000;
    const billableMegapixels = Math.max(1, Math.round(megapixels));
    return {
        billableMegapixels,
        cost:
            FAL_FLUX_2_PRO_OUTPAINT_BASE_COST +
            Math.max(0, billableMegapixels - 1) * FAL_FLUX_2_PRO_OUTPAINT_EXTRA_MEGAPIXEL_COST,
    };
}

export function calculateFalFlux2ProOutpaintCostFromImages(images: unknown): FalFluxOutpaintCost | null {
    if (!Array.isArray(images) || images.length === 0) {
        return null;
    }

    let cost = 0;
    let billableMegapixels = 0;
    for (const image of images) {
        if (!image || typeof image !== 'object') {
            return null;
        }

        const width = (image as { width?: unknown }).width;
        const height = (image as { height?: unknown }).height;
        if (
            typeof width !== 'number' ||
            typeof height !== 'number' ||
            !Number.isFinite(width) ||
            !Number.isFinite(height) ||
            width <= 0 ||
            height <= 0
        ) {
            return null;
        }

        const pricedImage = calculateFalFlux2ProOutpaintImageCost({ width, height });
        cost += pricedImage.cost;
        billableMegapixels += pricedImage.billableMegapixels;
    }

    return { cost, billableMegapixels, pricedImages: images.length };
}
