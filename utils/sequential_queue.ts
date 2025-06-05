/**
 * Sequential Execution Queue - Ensures tools execute one at a time per agent
 */

interface QueueItem<T> {
    execute: () => Promise<T>;
    resolve: (value: T) => void;
    reject: (error: any) => void;
}

/**
 * Manages sequential execution of functions per agent
 */
export class SequentialQueue {
    private queues: Map<string, QueueItem<any>[]> = new Map();
    private processing: Map<string, boolean> = new Map();

    /**
     * Execute a function sequentially for a given agent
     */
    async runSequential<T>(agentId: string, fn: () => Promise<T>): Promise<T> {
        return new Promise((resolve, reject) => {
            // Get or create queue for this agent
            if (!this.queues.has(agentId)) {
                this.queues.set(agentId, []);
                this.processing.set(agentId, false);
            }

            const queue = this.queues.get(agentId)!;

            // Add to queue
            queue.push({
                execute: fn,
                resolve,
                reject,
            });

            // Start processing if not already running
            if (!this.processing.get(agentId)) {
                this.processQueue(agentId);
            }
        });
    }

    /**
     * Process items in the queue for a specific agent
     */
    private async processQueue(agentId: string): Promise<void> {
        const queue = this.queues.get(agentId);
        if (!queue || queue.length === 0) {
            this.processing.set(agentId, false);
            return;
        }

        this.processing.set(agentId, true);

        while (queue.length > 0) {
            const item = queue.shift()!;

            try {
                const result = await item.execute();
                item.resolve(result);
            } catch (error) {
                item.reject(error);
            }
        }

        this.processing.set(agentId, false);
    }

    /**
     * Get the queue size for an agent
     */
    getQueueSize(agentId: string): number {
        const queue = this.queues.get(agentId);
        return queue ? queue.length : 0;
    }

    /**
     * Check if an agent's queue is processing
     */
    isProcessing(agentId: string): boolean {
        return this.processing.get(agentId) || false;
    }

    /**
     * Clear the queue for a specific agent
     */
    clearQueue(agentId: string): void {
        const queue = this.queues.get(agentId);
        if (queue) {
            // Reject all pending items
            queue.forEach(item => {
                item.reject(new Error('Queue cleared'));
            });
            queue.length = 0;
        }
    }

    /**
     * Clear all queues
     */
    clearAll(): void {
        this.queues.forEach((queue, agentId) => {
            this.clearQueue(agentId);
        });
        this.queues.clear();
        this.processing.clear();
    }
}

// Export singleton instance
export const sequentialQueue = new SequentialQueue();

/**
 * Helper function to run a function sequentially for an agent
 */
export async function runSequential<T>(
    agentId: string,
    fn: () => Promise<T>
): Promise<T> {
    return sequentialQueue.runSequential(agentId, fn);
}
