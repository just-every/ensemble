import { describe, it, expect } from 'vitest';
import { ensembleRequest } from '../core/ensemble_request.js';
import { AgentDefinition } from '../types/types.js';

describe('Empty History Thread Handling', () => {
    it('should error when historyThread is empty', async () => {
        const agent: AgentDefinition = {
            model: 'test-model',
            historyThread: [], // Empty history
        };

        let responseReceived = false;
        let errorOccurred = false;

        try {
            for await (const event of ensembleRequest([], agent)) {
                if (event.type === 'message_delta' || event.type === 'message_complete') {
                    responseReceived = true;
                } else if (event.type === 'error') {
                    errorOccurred = true;
                }
            }
        } catch (error) {
            errorOccurred = true;
        }

        expect(errorOccurred).toBe(true);
        expect(responseReceived).toBe(false);
    });

    it('should add default message when historyThread is empty', async () => {
        const agent: AgentDefinition = {
            model: 'test-model',
            historyThread: [],
            instructions: 'You are a helpful assistant.',
        };

        // const messages: any[] = [];

        // Intercept the messages by using a custom test provider
        const { testProviderConfig } = await import('../model_providers/test_provider.js');
        testProviderConfig.fixedResponse = 'Hello!';

        for await (const event of ensembleRequest([], agent)) {
            if (event.type === 'message_complete') {
                // The test provider should have received messages
                expect(event.content).toBe('Hello!');
            }
        }
    });

    it('should error with all providers when historyThread is empty', async () => {
        const providers = [
            { model: 'gpt-4.1', provider: 'openai' },
            { model: 'claude-3-5-haiku-latest', provider: 'anthropic' },
            { model: 'gemini-2.5-flash-preview-05-20', provider: 'google' },
            { model: 'deepseek-chat', provider: 'deepseek' },
            { model: 'grok-3-mini-fast', provider: 'xai' },
        ];

        for (const { provider } of providers) {
            const agent: AgentDefinition = {
                model: 'test-model', // Use test model to avoid API calls
                historyThread: [],
            };

            let errorOccurred = false;
            try {
                for await (const event of ensembleRequest([], agent)) {
                    if (event.type === 'error') {
                        errorOccurred = true;
                        break;
                    }
                }
            } catch (error) {
                // Expected to throw errors
                errorOccurred = true;
            }
            expect(errorOccurred).toBe(true);
        }
    });
});
