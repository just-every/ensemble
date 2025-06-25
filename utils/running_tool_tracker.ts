/**
 * Running Tool Tracker - Manages and tracks active tool executions
 */

import { AgentDefinition } from '../types/types.js';

export interface RunningTool {
    id: string;
    toolName: string;
    agentName: string;
    args: string;
    startTime: number;
    abortController?: AbortController;
    timedOut?: boolean;
    completed?: boolean;
    failed?: boolean;
    result?: string;
    error?: string;
}

export interface ToolCompletionEvent {
    id: string;
    toolName: string;
    agentName: string;
    duration: number;
    timedOut: boolean;
    result?: string;
    error?: string;
}

/**
 * Tracks running tools and manages their lifecycle
 */
export class RunningToolTracker {
    private runningTools: Map<string, RunningTool> = new Map();
    private completionHandlers: ((event: ToolCompletionEvent) => void)[] = [];

    /**
     * Add a new running tool
     */
    addRunningTool(id: string, toolName: string, agentName: string, args: string): RunningTool {
        const abortController = new AbortController();
        const runningTool: RunningTool = {
            id,
            toolName,
            agentName,
            args,
            startTime: Date.now(),
            abortController,
        };

        this.runningTools.set(id, runningTool);
        return runningTool;
    }

    /**
     * Mark a tool as timed out
     */
    markTimedOut(id: string): void {
        const tool = this.runningTools.get(id);
        if (tool) {
            tool.timedOut = true;
        }
    }

    /**
     * Complete a running tool
     */
    async completeRunningTool(
        id: string,
        result: string,
        _agent?: AgentDefinition // eslint-disable-line @typescript-eslint/no-unused-vars
    ): Promise<void> {
        const tool = this.runningTools.get(id);
        if (!tool) return;

        tool.completed = true;
        tool.result = result;

        const duration = Date.now() - tool.startTime;

        // If it was marked as timed out, emit a completion event
        if (tool.timedOut) {
            const event: ToolCompletionEvent = {
                id,
                toolName: tool.toolName,
                agentName: tool.agentName,
                duration,
                timedOut: true,
                result,
            };

            // Notify all completion handlers
            this.completionHandlers.forEach(handler => handler(event));
        }

        // Clean up
        this.runningTools.delete(id);
    }

    /**
     * Mark a tool as failed
     */
    async failRunningTool(
        id: string,
        error: string,
        _agent?: AgentDefinition // eslint-disable-line @typescript-eslint/no-unused-vars
    ): Promise<void> {
        const tool = this.runningTools.get(id);
        if (!tool) return;

        tool.failed = true;
        tool.error = error;

        const duration = Date.now() - tool.startTime;

        // If it was marked as timed out, emit a completion event
        if (tool.timedOut) {
            const event: ToolCompletionEvent = {
                id,
                toolName: tool.toolName,
                agentName: tool.agentName,
                duration,
                timedOut: true,
                error,
            };

            // Notify all completion handlers
            this.completionHandlers.forEach(handler => handler(event));
        }

        // Clean up
        this.runningTools.delete(id);
    }

    /**
     * Get a running tool by ID
     */
    getRunningTool(id: string): RunningTool | undefined {
        return this.runningTools.get(id);
    }

    /**
     * Get all running tools
     */
    getAllRunningTools(): RunningTool[] {
        return Array.from(this.runningTools.values());
    }

    /**
     * Get running tools for a specific agent
     */
    getRunningToolsForAgent(agentName: string): RunningTool[] {
        return this.getAllRunningTools().filter(tool => tool.agentName === agentName);
    }

    /**
     * Abort a running tool
     */
    abortRunningTool(id: string): void {
        const tool = this.runningTools.get(id);
        if (tool && tool.abortController) {
            tool.abortController.abort();
        }
    }

    /**
     * Register a completion handler
     */
    onCompletion(handler: (event: ToolCompletionEvent) => void): void {
        this.completionHandlers.push(handler);
    }

    /**
     * Clear all running tools (for cleanup)
     */
    clear(): void {
        // Abort all running tools
        this.runningTools.forEach(tool => {
            if (tool.abortController) {
                tool.abortController.abort();
            }
        });
        this.runningTools.clear();
        this.completionHandlers = [];
    }

    /**
     * Check if a specific tool type is currently running for an agent
     */
    isToolRunning(agentName: string, toolName: string): boolean {
        return this.getAllRunningTools().some(tool => tool.agentName === agentName && tool.toolName === toolName);
    }

    /**
     * Get the count of running tools
     */
    getRunningToolCount(): number {
        return this.runningTools.size;
    }

    /**
     * Wait for a specific tool to complete
     */
    async waitForTool(id: string, timeout?: number): Promise<ToolCompletionEvent | null> {
        return new Promise((resolve, reject) => {
            const tool = this.runningTools.get(id);
            if (!tool) {
                resolve(null);
                return;
            }

            let timeoutId: NodeJS.Timeout | undefined;

            const cleanup = () => {
                if (timeoutId) clearTimeout(timeoutId);
                const index = this.completionHandlers.indexOf(handler);
                if (index > -1) {
                    this.completionHandlers.splice(index, 1);
                }
            };

            const handler = (event: ToolCompletionEvent) => {
                if (event.id === id) {
                    cleanup();
                    resolve(event);
                }
            };

            this.onCompletion(handler);

            if (timeout) {
                timeoutId = setTimeout(() => {
                    cleanup();
                    reject(new Error(`Timeout waiting for tool ${id}`));
                }, timeout);
            }
        });
    }
}

// Export singleton instance
export const runningToolTracker = new RunningToolTracker();
