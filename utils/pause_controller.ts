/**
 * Pause Controller for managing LLM request pausing
 * 
 * This module provides a centralized way to pause and resume all LLM requests
 * across the ensemble system. When paused, requests will wait until resumed.
 */

import { EventEmitter } from 'events';

export interface PauseController {
    /**
     * Check if the system is currently paused
     */
    isPaused(): boolean;
    
    /**
     * Pause all LLM requests
     */
    pause(): void;
    
    /**
     * Resume all LLM requests
     */
    resume(): void;
    
    /**
     * Wait while the system is paused
     * @param checkInterval - How often to check pause status (ms)
     * @param abortSignal - Optional abort signal to cancel waiting
     */
    waitWhilePaused(checkInterval?: number, abortSignal?: AbortSignal): Promise<void>;
    
    /**
     * Subscribe to pause state changes
     * @param event - 'paused' or 'resumed'
     * @param listener - Callback function
     */
    on(event: 'paused' | 'resumed', listener: () => void): void;
    
    /**
     * Unsubscribe from pause state changes
     */
    off(event: 'paused' | 'resumed', listener: () => void): void;
}

class PauseControllerImpl extends EventEmitter implements PauseController {
    private _isPaused = false;
    
    isPaused(): boolean {
        return this._isPaused;
    }
    
    pause(): void {
        if (!this._isPaused) {
            this._isPaused = true;
            this.emit('paused');
            console.log('[PauseController] System paused');
        }
    }
    
    resume(): void {
        if (this._isPaused) {
            this._isPaused = false;
            this.emit('resumed');
            console.log('[PauseController] System resumed');
        }
    }
    
    async waitWhilePaused(checkInterval = 100, abortSignal?: AbortSignal): Promise<void> {
        while (this._isPaused && !abortSignal?.aborted) {
            await new Promise(resolve => setTimeout(resolve, checkInterval));
        }
        
        if (abortSignal?.aborted) {
            const { PauseAbortError } = await import('../types/errors.js');
            throw new PauseAbortError();
        }
    }
}

// Singleton instance
let pauseControllerInstance: PauseController | null = null;

/**
 * Get the singleton PauseController instance
 */
export function getPauseController(): PauseController {
    if (!pauseControllerInstance) {
        pauseControllerInstance = new PauseControllerImpl();
    }
    return pauseControllerInstance;
}

/**
 * Convenience function to check if system is paused
 */
export function isPaused(): boolean {
    return getPauseController().isPaused();
}

/**
 * Convenience function to pause the system
 */
export function pause(): void {
    getPauseController().pause();
}

/**
 * Convenience function to resume the system
 */
export function resume(): void {
    getPauseController().resume();
}

/**
 * Convenience function to wait while paused
 */
export async function waitWhilePaused(checkInterval?: number, abortSignal?: AbortSignal): Promise<void> {
    return getPauseController().waitWhilePaused(checkInterval, abortSignal);
}