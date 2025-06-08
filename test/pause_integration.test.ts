import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ensembleRequest } from '../core/ensemble_request.js';
import { pause, resume, isPaused } from '../utils/pause_controller.js';
import { AgentDefinition, ProviderStreamEvent } from '../types/types.js';

// Import waitWhilePaused for the mock
import { waitWhilePaused } from '../utils/pause_controller.js';

// Mock the model provider to simulate streaming
vi.mock('../model_providers/model_provider.js', () => ({
    getModelProvider: vi.fn(() => ({
        createResponseStream: async function* mockStream(messages: any, model: any, agent: any) {
            // Wait while paused before starting (simulating real provider behavior)
            await waitWhilePaused(100, agent?.abortSignal);
            
            // Simulate a streaming response with multiple chunks
            for (let i = 0; i < 5; i++) {
                // Check pause state during streaming
                if (isPaused()) {
                    await waitWhilePaused(100, agent?.abortSignal);
                }
                
                yield {
                    type: 'message_delta',
                    content: `Chunk ${i} `,
                    message_id: 'test-message',
                    order: i,
                } as ProviderStreamEvent;
                
                // Small delay between chunks
                await new Promise(resolve => setTimeout(resolve, 10));
            }
            
            yield {
                type: 'message_complete',
                content: 'Chunk 0 Chunk 1 Chunk 2 Chunk 3 Chunk 4 ',
                message_id: 'test-message',
            } as ProviderStreamEvent;
        }
    })),
    getModelFromAgent: vi.fn(async () => 'test-model'),
}));

describe('Pause Integration Tests', () => {
    beforeEach(() => {
        resume(); // Ensure we start unpaused
        vi.clearAllMocks();
    });

    afterEach(() => {
        resume(); // Clean up
    });

    it('should pause and resume during streaming', async () => {
        const messages = [
            { type: 'message' as const, role: 'user' as const, content: 'Hello' }
        ];
        
        const agent: AgentDefinition = {};
        const events: ProviderStreamEvent[] = [];
        
        // Start the request
        const streamPromise = (async () => {
            for await (const event of ensembleRequest(messages, agent)) {
                events.push(event);
            }
        })();
        
        // Wait for first couple chunks
        await new Promise(resolve => setTimeout(resolve, 50));
        
        // Pause the system
        pause();
        expect(isPaused()).toBe(true);
        
        // Record how many events we had when paused
        const eventCountAtPause = events.length;
        
        // Wait a bit - no new events should arrive
        await new Promise(resolve => setTimeout(resolve, 200));
        expect(events.length).toBe(eventCountAtPause);
        
        // Resume
        resume();
        expect(isPaused()).toBe(false);
        
        // Wait for stream to complete
        await streamPromise;
        
        // Should have received all events
        const deltaEvents = events.filter(e => e.type === 'message_delta');
        expect(deltaEvents.length).toBe(5);
        
        const completeEvent = events.find(e => e.type === 'message_complete');
        expect(completeEvent).toBeDefined();
        expect(completeEvent?.content).toBe('Chunk 0 Chunk 1 Chunk 2 Chunk 3 Chunk 4 ');
    });

    it('should handle pause before request starts', async () => {
        // Pause before starting
        pause();
        
        const messages = [
            { type: 'message' as const, role: 'user' as const, content: 'Hello' }
        ];
        
        const agent: AgentDefinition = {};
        const events: ProviderStreamEvent[] = [];
        
        // Start the request - it should wait
        const streamPromise = (async () => {
            for await (const event of ensembleRequest(messages, agent)) {
                events.push(event);
            }
        })();
        
        // Wait a bit - no events should arrive
        await new Promise(resolve => setTimeout(resolve, 100));
        expect(events.length).toBe(0);
        
        // Resume
        resume();
        
        // Now events should flow
        await streamPromise;
        expect(events.length).toBeGreaterThan(0);
    });

    it('should handle abort during pause', async () => {
        const messages = [
            { type: 'message' as const, role: 'user' as const, content: 'Hello' }
        ];
        
        const abortController = new AbortController();
        const agent: AgentDefinition = {
            abortSignal: abortController.signal,
        };
        
        // Pause before starting
        pause();
        
        // Start the request
        const streamPromise = (async () => {
            const events: ProviderStreamEvent[] = [];
            for await (const event of ensembleRequest(messages, agent)) {
                events.push(event);
                // Check if we got an error event due to abort
                if (event.type === 'error' && event.error?.includes('aborted')) {
                    return events;
                }
            }
            return events;
        })();
        
        // Abort while paused
        await new Promise(resolve => setTimeout(resolve, 50));
        abortController.abort();
        
        // Should return events including error
        const result = await streamPromise;
        const errorEvent = result.find(e => e.type === 'error');
        expect(errorEvent).toBeDefined();
        expect(errorEvent?.error).toContain('aborted');
        
        // Clean up
        resume();
    });

    it('should handle multiple pause/resume cycles', async () => {
        const messages = [
            { type: 'message' as const, role: 'user' as const, content: 'Hello' }
        ];
        
        const agent: AgentDefinition = {};
        const events: ProviderStreamEvent[] = [];
        
        // Start the request
        const streamPromise = (async () => {
            for await (const event of ensembleRequest(messages, agent)) {
                events.push(event);
            }
        })();
        
        // Multiple pause/resume cycles
        for (let i = 0; i < 3; i++) {
            await new Promise(resolve => setTimeout(resolve, 30));
            pause();
            
            const countBefore = events.length;
            await new Promise(resolve => setTimeout(resolve, 50));
            expect(events.length).toBe(countBefore); // No progress while paused
            
            resume();
        }
        
        // Complete the stream
        await streamPromise;
        expect(events.length).toBeGreaterThan(0);
    });
});