import { describe, it, expect, beforeEach } from 'vitest';
import { ensembleRequest } from '../core/ensemble_request.js';
import { AgentDefinition } from '../types/types.js';
import { setEventHandler } from '../utils/event_controller.js';

describe('Tags Simple Tests', () => {
    let capturedEvents: any[] = [];

    beforeEach(() => {
        capturedEvents = [];

        // Set global event handler to capture events
        setEventHandler(async event => {
            capturedEvents.push(event);
        });
    });

    it('should include tags in agent_start event', async () => {
        const agent: AgentDefinition = {
            agent_id: 'test-agent',
            name: 'Test Agent',
            model: 'test-model',
            tags: ['production', 'api-v2', 'customer-123'],
        };

        const messages = [
            {
                type: 'message' as const,
                role: 'user' as const,
                content: 'Hello',
                id: 'msg-1',
            },
        ];

        // Execute request
        const events: any[] = [];
        for await (const event of ensembleRequest(messages, agent)) {
            events.push(event);
        }

        // Find agent_start event
        const agentStartEvent = events.find(e => e.type === 'agent_start');
        expect(agentStartEvent).toBeDefined();
        expect(agentStartEvent.agent.tags).toEqual(['production', 'api-v2', 'customer-123']);
    });

    it('should handle agents without tags (undefined)', async () => {
        const agent: AgentDefinition = {
            agent_id: 'test-agent',
            name: 'Test Agent',
            model: 'test-model',
            // No tags defined
        };

        const messages = [
            {
                type: 'message' as const,
                role: 'user' as const,
                content: 'Hello',
                id: 'msg-1',
            },
        ];

        // Execute request
        const events: any[] = [];
        for await (const event of ensembleRequest(messages, agent)) {
            events.push(event);
        }

        // Find agent_start event
        const agentStartEvent = events.find(e => e.type === 'agent_start');
        expect(agentStartEvent).toBeDefined();
        expect(agentStartEvent.agent.tags).toBeUndefined();
    });

    it('should handle empty tags array', async () => {
        const agent: AgentDefinition = {
            agent_id: 'test-agent',
            name: 'Test Agent',
            model: 'test-model',
            tags: [], // Empty array
        };

        const messages = [
            {
                type: 'message' as const,
                role: 'user' as const,
                content: 'Hello',
                id: 'msg-1',
            },
        ];

        // Execute request
        const events: any[] = [];
        for await (const event of ensembleRequest(messages, agent)) {
            events.push(event);
        }

        // Find agent_start event
        const agentStartEvent = events.find(e => e.type === 'agent_start');
        expect(agentStartEvent).toBeDefined();
        expect(agentStartEvent.agent.tags).toEqual([]);
    });
});
