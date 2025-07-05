export const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

export const formatDuration = (ms: number): string => {
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
};

export const formatCost = (cost: number): string => {
    if (cost === 0) return '$0.00';
    if (cost < 0.01) return `$${cost.toFixed(6)}`;
    return `$${cost.toFixed(4)}`;
};

export const formatNumber = (num: number): string => {
    return new Intl.NumberFormat().format(num);
};
