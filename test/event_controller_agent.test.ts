import { describe, it, expect, beforeEach } from 'vitest';
import type { ProviderStreamEvent, AgentDefinition } from '../types/types.js';
import { setEventHandler, emitEvent } from '../utils/event_controller.js';

describe('EventController with Agent', () => {
    let capturedEvents: ProviderStreamEvent[] = [];

    beforeEach(() => {
        capturedEvents = [];
        // Set up global event handler to capture events
        setEventHandler((event: ProviderStreamEvent) => {
            capturedEvents.push(event);
        });
    });

    it('should add agent to event when provided', async () => {
        const testAgent: AgentDefinition = {
            agent_id: 'test-123',
            name: 'TestAgent',
            model: 'gpt-4',
        };

        const testEvent: ProviderStreamEvent = {
            type: 'message_delta',
            content: 'test',
            timestamp: new Date().toISOString(),
        };

        await emitEvent(testEvent, testAgent);

        expect(capturedEvents).toHaveLength(1);
        expect(capturedEvents[0].agent).toBeDefined();
        expect(capturedEvents[0].agent?.agent_id).toBe('test-123');
        expect(capturedEvents[0].agent?.name).toBe('TestAgent');
        expect(capturedEvents[0].agent?.model).toBe('gpt-4');
    });

    it('should use model parameter when exporting agent', async () => {
        const testAgent: AgentDefinition = {
            agent_id: 'test-456',
            name: 'TestAgent2',
            modelClass: 'standard',
        };

        const testEvent: ProviderStreamEvent = {
            type: 'tool_start',
            tool_call: {
                id: 'tool-1',
                type: 'function',
                function: { name: 'test_tool', arguments: '{}' },
            },
            timestamp: new Date().toISOString(),
        };

        await emitEvent(testEvent, testAgent, 'claude-3-5-haiku-latest');

        expect(capturedEvents).toHaveLength(1);
        expect(capturedEvents[0].agent).toBeDefined();
        expect(capturedEvents[0].agent?.agent_id).toBe('test-456');
        expect(capturedEvents[0].agent?.name).toBe('TestAgent2');
        expect(capturedEvents[0].agent?.model).toBe('claude-3-5-haiku-latest');
    });

    it('should not add agent when not provided', async () => {
        const testEvent: ProviderStreamEvent = {
            type: 'error',
            error: 'test error',
            timestamp: new Date().toISOString(),
        };

        await emitEvent(testEvent);

        expect(capturedEvents).toHaveLength(1);
        expect(capturedEvents[0].agent).toBeUndefined();
    });

    it('should preserve existing agent in event', async () => {
        const existingAgent = {
            agent_id: 'existing-789',
            name: 'ExistingAgent',
            model: 'gpt-3.5-turbo',
        };

        const testEvent: ProviderStreamEvent = {
            type: 'agent_done',
            agent: existingAgent,
            timestamp: new Date().toISOString(),
        };

        const newAgent: AgentDefinition = {
            agent_id: 'new-999',
            name: 'NewAgent',
        };

        // When emitting with a new agent, it should override the existing one
        await emitEvent(testEvent, newAgent);

        expect(capturedEvents).toHaveLength(1);
        expect(capturedEvents[0].agent?.agent_id).toBe('new-999');
        expect(capturedEvents[0].agent?.name).toBe('NewAgent');
    });
});