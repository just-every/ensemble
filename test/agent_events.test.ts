import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Agent } from '../utils/agent.js';
import { ProviderStreamEvent } from '../types/types.js';

// Mock ensembleRequest to return predictable events
vi.mock('../core/ensemble_request.js', () => ({
    ensembleRequest: vi.fn(async function* () {
        yield {
            type: 'message_delta',
            content: 'Hello ',
            message_id: 'test-msg',
            order: 0,
            timestamp: new Date().toISOString(),
        };
        yield {
            type: 'message_delta',
            content: 'from worker!',
            message_id: 'test-msg',
            order: 1,
            timestamp: new Date().toISOString(),
        };
        yield {
            type: 'message_complete',
            content: 'Hello from worker!',
            message_id: 'test-msg',
            timestamp: new Date().toISOString(),
        };
    }),
}));

describe('Agent Events for Workers', () => {
    let parentAgent: Agent;
    let eventSpy: ReturnType<typeof vi.fn>;
    let capturedEvents: ProviderStreamEvent[];

    beforeEach(() => {
        capturedEvents = [];
        eventSpy = vi.fn((event: ProviderStreamEvent) => {
            capturedEvents.push(event);
        });

        // Create parent agent with workers and event handler
        parentAgent = new Agent({
            agent_id: 'parent-1',
            name: 'ParentAgent',
            description: 'Parent agent with workers',
            workers: [
                () =>
                    new Agent({
                        agent_id: 'worker-1',
                        name: 'TestWorker',
                        description: 'A test worker agent',
                    }),
            ],
            onEvent: eventSpy,
        });
    });

    it('should emit agent_start event when worker begins execution', async () => {
        // Get the worker tool
        const tools = await parentAgent.getTools();
        const workerTool = tools.find(tool =>
            tool.definition.function.name.includes('TestWorker')
        );

        expect(workerTool).toBeDefined();

        // Execute the worker tool
        await workerTool!.function('Test task for worker');

        // Check that agent_start event was emitted
        const startEvent = capturedEvents.find(e => e.type === 'agent_start');
        expect(startEvent).toBeDefined();
        expect(startEvent?.agent?.name).toBe('TestWorker');
        expect(startEvent?.input).toBe('**Task:** Test task for worker');
        expect(startEvent?.parent_id).toBe('parent-1');
    });

    it('should forward all streaming events from worker execution', async () => {
        // Get the worker tool
        const tools = await parentAgent.getTools();
        const workerTool = tools.find(tool =>
            tool.definition.function.name.includes('TestWorker')
        );

        // Execute the worker tool
        await workerTool!.function('Test task');

        // Check that message events were forwarded
        const deltaEvents = capturedEvents.filter(
            e => e.type === 'message_delta'
        );
        expect(deltaEvents.length).toBe(2);
        expect(deltaEvents[0].content).toBe('Hello ');
        expect(deltaEvents[1].content).toBe('from worker!');

        const completeEvent = capturedEvents.find(
            e => e.type === 'message_complete'
        );
        expect(completeEvent).toBeDefined();
        expect(completeEvent?.content).toBe('Hello from worker!');
    });

    it('should emit agent_done event when worker completes successfully', async () => {
        // Get the worker tool
        const tools = await parentAgent.getTools();
        const workerTool = tools.find(tool =>
            tool.definition.function.name.includes('TestWorker')
        );

        // Execute the worker tool
        await workerTool!.function('Test task');

        // Check that agent_done event was emitted
        const doneEvent = capturedEvents.find(e => e.type === 'agent_done');
        expect(doneEvent).toBeDefined();
        expect(doneEvent?.agent?.name).toBe('TestWorker');
        expect(doneEvent?.output).toBe('Hello from worker!');
        expect(doneEvent?.parent_id).toBe('parent-1');
        expect(doneEvent?.status).toBeUndefined(); // Success doesn't have error status
    });

    it('should preserve event order: start -> streaming events -> done', async () => {
        // Get the worker tool
        const tools = await parentAgent.getTools();
        const workerTool = tools.find(tool =>
            tool.definition.function.name.includes('TestWorker')
        );

        // Execute the worker tool
        await workerTool!.function('Test task');

        // Check event order
        const eventTypes = capturedEvents.map(e => e.type);
        expect(eventTypes[0]).toBe('agent_start');
        expect(eventTypes[eventTypes.length - 1]).toBe('agent_done');

        // Streaming events should be in between
        const streamingEvents = eventTypes.slice(1, -1);
        expect(streamingEvents).toContain('message_delta');
        expect(streamingEvents).toContain('message_complete');
    });

    it('should handle multiple workers with separate event streams', async () => {
        // Create a new parent agent with multiple workers
        const multiWorkerAgent = new Agent({
            agent_id: 'multi-parent',
            name: 'MultiParentAgent',
            description: 'Parent agent with multiple workers',
            workers: [
                () =>
                    new Agent({
                        agent_id: 'worker-1',
                        name: 'FirstWorker',
                        description: 'First worker',
                    }),
                () =>
                    new Agent({
                        agent_id: 'worker-2',
                        name: 'SecondWorker',
                        description: 'Second worker',
                    }),
            ],
            onEvent: eventSpy,
        });

        const tools = await multiWorkerAgent.getTools();
        const worker1Tool = tools.find(tool =>
            tool.definition.function.name.includes('FirstWorker')
        );
        const worker2Tool = tools.find(tool =>
            tool.definition.function.name.includes('SecondWorker')
        );

        expect(worker1Tool).toBeDefined();
        expect(worker2Tool).toBeDefined();

        // Execute both workers
        await worker1Tool!.function('Task 1');

        // Clear events and run second worker
        const firstWorkerEventCount = capturedEvents.length;
        await worker2Tool!.function('Task 2');

        // Should have events from both workers
        expect(capturedEvents.length).toBeGreaterThan(firstWorkerEventCount);

        // Check that we have separate agent_start events
        const startEvents = capturedEvents.filter(
            e => e.type === 'agent_start'
        );
        expect(startEvents.length).toBe(2);
        expect(startEvents[0].agent?.name).toBe('FirstWorker');
        expect(startEvents[1].agent?.name).toBe('SecondWorker');
    });

    it('should work without onEvent handler (no events emitted)', async () => {
        // Create agent without onEvent handler
        const agentWithoutEvents = new Agent({
            agent_id: 'no-events',
            name: 'NoEventsAgent',
            workers: [() => new Agent({ name: 'Worker' })],
            // No onEvent handler
        });

        const tools = await agentWithoutEvents.getTools();
        const workerTool = tools[0];

        // This should not throw and should work normally
        const result = await workerTool.function('Test task');
        expect(typeof result).toBe('string');

        // No events should have been captured
        expect(capturedEvents.length).toBe(0);
    });

    it('should handle errors in onEvent handler gracefully', async () => {
        // Create agent with failing onEvent handler
        const failingEventAgent = new Agent({
            agent_id: 'failing-events',
            name: 'FailingEventsAgent',
            workers: [() => new Agent({ name: 'Worker' })],
            onEvent: () => {
                throw new Error('Event handler failed');
            },
        });

        const tools = await failingEventAgent.getTools();
        const workerTool = tools[0];

        // This should not throw despite the failing event handler
        const result = await workerTool.function('Test task');
        expect(typeof result).toBe('string');
    });

    it('should pass complex parameters correctly to worker', async () => {
        // Test with complex parameters
        const tools = await parentAgent.getTools();
        const workerTool = tools.find(tool =>
            tool.definition.function.name.includes('TestWorker')
        );

        // Execute with multiple parameters
        await workerTool!.function({
            task: 'Complex task',
            context: 'Important context',
            warnings: 'Be careful',
            goal: 'Achieve success',
            intelligence: 'high',
        });

        const startEvent = capturedEvents.find(e => e.type === 'agent_start');
        expect(startEvent?.input).toContain('Complex task');
        expect(startEvent?.input).toContain('Important context');
        expect(startEvent?.input).toContain('Be careful');
        expect(startEvent?.input).toContain('Achieve success');
    });
});
