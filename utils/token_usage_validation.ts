export function optionalTokenCount(value: unknown, field: string): number {
    if (value === undefined || value === null) return 0;
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
        throw new Error(`${field} must be a non-negative safe integer`);
    }
    return value;
}

export function requiredTokenCount(value: unknown, field: string): number {
    if (value === undefined || value === null) {
        throw new Error(`${field} is required`);
    }
    return optionalTokenCount(value, field);
}

export function assertTokenTotal(field: string, reported: number, components: number[]): void {
    const canonical = components.reduce((total, value) => total + value, 0);
    if (reported !== canonical) {
        throw new Error(`${field} (${reported}) does not equal its billed components (${canonical})`);
    }
}

export function assertTokenSubset(field: string, subset: number, totalField: string, total: number): void {
    if (subset > total) {
        throw new Error(`${field} (${subset}) exceeds ${totalField} (${total})`);
    }
}
