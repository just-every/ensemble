// Global variable to track system pause state
const isSystemPaused = false;

/**
 * Check if the system is currently paused
 * This is used by model providers to determine whether to wait before making API calls
 */
export function isPaused(): boolean {
    return isSystemPaused;
}
