import { describe, it, expect } from 'vitest';
import type { ProviderStreamEvent, AgentDefinition } from '../types/types.js';

describe('runAgentTool Event Context', () => {
    it('should add agent context to all streamed events', async () => {
        const capturedEvents: ProviderStreamEvent[] = [];

        // Create a mock agent with onEvent handler
        const mockAgent: AgentDefinition = {
            agent_id: 'test-agent-123',
            name: 'TestAgent',
            model: 'test-model',
            modelClass: 'mini',
            parent_id: 'parent-agent-456',
            onEvent: async (event: ProviderStreamEvent) => {
                capturedEvents.push(event);
            },
        };

        // Import runAgentTool (it's not exported, so we need to test indirectly)
        const { Agent } = await import('../utils/agent.js');

        // Create an Agent instance to get access to its tool
        const agent = new Agent({
            name: 'TestAgent',
            modelClass: 'mini',
            model: 'test-model',
        });

        // Manually set the properties we need
        (agent as any).agent_id = mockAgent.agent_id;
        (agent as any).parent_id = mockAgent.parent_id;
        (agent as any).onEvent = mockAgent.onEvent;

        // Get the agent's tool representation
        const agentTool = agent.asTool();

        // Execute the tool (which internally calls runAgentTool)
        await agentTool.function({
            prompt: 'Test prompt',
            goal: 'Test goal',
        });

        // Verify we captured events
        expect(capturedEvents.length).toBeGreaterThan(0);

        // Find different event types
        const agentStartEvent = capturedEvents.find(
            e => e.type === 'agent_start'
        );
        const messageDeltas = capturedEvents.filter(
            e => e.type === 'message_delta'
        );
        const messageComplete = capturedEvents.find(
            e => e.type === 'message_complete'
        );
        const agentDoneEvent = capturedEvents.find(
            e => e.type === 'agent_done'
        );

        // Verify agent_start has correct context
        expect(agentStartEvent).toBeDefined();
        expect(agentStartEvent?.agent).toBeDefined();
        // The agent_id will be a new UUID, not the original one
        expect(agentStartEvent?.agent?.agent_id).toBeTruthy();
        expect(agentStartEvent?.agent?.name).toBe(mockAgent.name);
        // parent_id should be in the agent object
        expect(agentStartEvent?.agent?.parent_id).toBe(mockAgent.parent_id);

        // Get the actual agent_id from agent_start event
        const actualAgentId = agentStartEvent?.agent?.agent_id;

        // Verify streaming events have agent context
        if (messageDeltas.length > 0) {
            const firstDelta = messageDeltas[0];
            expect(firstDelta.agent).toBeDefined();
            expect(firstDelta.agent?.agent_id).toBe(actualAgentId);
            expect(firstDelta.agent?.name).toBe(mockAgent.name);
            expect(firstDelta.agent?.parent_id).toBe(mockAgent.parent_id);
        }

        // Verify message_complete has agent context
        if (messageComplete) {
            expect(messageComplete.agent).toBeDefined();
            expect(messageComplete.agent?.agent_id).toBe(actualAgentId);
            expect(messageComplete.agent?.parent_id).toBe(mockAgent.parent_id);
        }

        // Verify agent_done has correct context
        expect(agentDoneEvent).toBeDefined();
        expect(agentDoneEvent?.agent).toBeDefined();
        expect(agentDoneEvent?.agent?.agent_id).toBe(actualAgentId);
        expect(agentDoneEvent?.agent?.parent_id).toBe(mockAgent.parent_id);
    });

    it('should preserve original event properties when adding context', async () => {
        const capturedEvents: ProviderStreamEvent[] = [];

        // Create a mock agent
        const mockAgent: AgentDefinition = {
            agent_id: 'test-agent-789',
            name: 'TestAgent2',
            model: 'test-model',
            modelClass: 'mini',
            parent_id: 'parent-agent-999',
            onEvent: async (event: ProviderStreamEvent) => {
                capturedEvents.push(event);
            },
        };

        const { Agent } = await import('../utils/agent.js');

        const agent = new Agent({
            name: 'TestAgent2',
            modelClass: 'mini',
            model: 'test-model',
        });

        (agent as any).agent_id = mockAgent.agent_id;
        (agent as any).parent_id = mockAgent.parent_id;
        (agent as any).onEvent = mockAgent.onEvent;

        const agentTool = agent.asTool();

        await agentTool.function({
            prompt: 'Another test',
            goal: 'Verify event properties',
        });

        // Find a message delta event
        const messageDelta = capturedEvents.find(
            e => e.type === 'message_delta'
        );

        if (messageDelta) {
            // Verify original properties are preserved
            expect(messageDelta.type).toBe('message_delta');
            expect(messageDelta).toHaveProperty('content');
            expect(messageDelta).toHaveProperty('message_id');

            // Verify added context doesn't override existing properties
            expect(messageDelta.agent).toBeDefined();
            expect(messageDelta.agent?.parent_id).toBe(mockAgent.parent_id);
        }
    });
});
