/**
 * Utility functions for truncating large values in logs
 */

/**
 * Check if a string looks like base64 data
 */
function isBase64Like(str: string): boolean {
    // Check if string contains mostly base64 characters
    const base64Regex = /^[A-Za-z0-9+/]+={0,2}$/;
    // Sample first 100 chars to check if it looks like base64
    const sample = str.substring(0, 100);
    return base64Regex.test(sample.replace(/\s/g, ''));
}

/**
 * Format bytes to human readable string
 */
function formatBytes(bytes: number): string {
    if (bytes < 1024) return bytes + ' bytes';
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1048576).toFixed(1) + ' MB';
}

/**
 * Truncate large values in objects (like base64 images)
 */
export const truncateLargeValues = (obj: unknown, maxLength: number = 1000): unknown => {
    if (typeof obj === 'string') {
        // Handle data URLs with explicit prefixes
        if (obj.length > maxLength && (obj.startsWith('data:image/') || isBase64Like(obj))) {
            // Keep 50 chars from start and end for images
            const start = obj.substring(0, 50);
            const end = obj.substring(obj.length - 50);
            return `${start}...[truncated ${formatBytes(obj.length)}]...${end}`;
        }

        // Handle other long strings - truncate in the middle
        if (obj.length > maxLength) {
            const halfLength = Math.floor(maxLength / 2);
            const start = obj.substring(0, halfLength);
            const end = obj.substring(obj.length - halfLength);
            return `${start}...[truncated ${obj.length - maxLength} chars]...${end}`;
        }
        return obj;
    }

    if (Array.isArray(obj)) {
        return obj.map(item => truncateLargeValues(item, maxLength));
    }

    if (obj && typeof obj === 'object') {
        const result: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(obj)) {
            result[key] = truncateLargeValues(value, maxLength);
        }
        return result;
    }

    return obj;
};
