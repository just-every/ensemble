import { describe, it, expect, vi } from 'vitest';
import { MessageHistory } from '../utils/message_history.js';

// Mock the model_data module
vi.mock('../data/model_data.js', () => ({
    findModel: vi.fn((modelId: string) => {
        if (modelId === 'test-model-small-context') {
            return {
                id: 'test-model-small-context',
                features: {
                    context_length: 4000, // Small context for testing
                },
            };
        }
        return null;
    }),
}));

// Mock createSummary
vi.mock('../utils/tool_result_processor.js', () => ({
    createSummary: vi.fn(async (content: string) => {
        return `[Summary of ${content.split('\n').length} lines]`;
    }),
}));

describe('MessageHistory Automatic Compaction', () => {
    it('should automatically compact messages when approaching context limit', async () => {
        const history = new MessageHistory([], {
            modelId: 'test-model-small-context',
            compactionThreshold: 0.7, // Compact at 70% (2800 tokens)
        });

        // Add messages that will eventually trigger compaction
        // Each message ~250 characters = ~62 tokens
        for (let i = 0; i < 50; i++) {
            await history.add({
                type: 'message',
                role: i % 2 === 0 ? 'user' : 'assistant',
                content: 'x'.repeat(250), // ~62 tokens each
            });
        }

        // Should have compacted by now
        const messages = await history.getMessages('test-model-small-context');

        // Should have fewer messages after compaction
        expect(messages.length).toBeLessThan(50);

        // Should have a summary message (with new format)
        const summaryMessage = messages.find(
            m =>
                m.type === 'message' &&
                m.role === 'system' &&
                typeof m.content === 'string' &&
                m.content.includes('[Previous Conversation Summary]')
        );
        expect(summaryMessage).toBeDefined();
    });

    it('should preserve system messages during compaction', async () => {
        const systemMessage = {
            type: 'message' as const,
            role: 'system' as const,
            content: 'You are a helpful assistant.',
        };

        const history = new MessageHistory([systemMessage], {
            modelId: 'test-model-small-context',
            compactionThreshold: 0.7,
        });

        // Add many messages
        for (let i = 0; i < 50; i++) {
            await history.add({
                type: 'message',
                role: i % 2 === 0 ? 'user' : 'assistant',
                content: 'x'.repeat(250),
            });
        }

        const messages = await history.getMessages('test-model-small-context');

        // Original system message should still be there (with pinned flag added)
        expect(messages[0]).toMatchObject(systemMessage);
    });

    it('should not compact if model has no context length', async () => {
        const history = new MessageHistory([], {
            modelId: 'unknown-model',
            compactionThreshold: 0.7,
        });

        // Add many messages
        for (let i = 0; i < 50; i++) {
            await history.add({
                type: 'message',
                role: i % 2 === 0 ? 'user' : 'assistant',
                content: 'x'.repeat(250),
            });
        }

        // Should have all messages (no compaction)
        const messages = await history.getMessages();
        expect(messages.length).toBe(50);
    });

    it('should not compact if threshold not set', async () => {
        const history = new MessageHistory([], {
            modelId: 'test-model-small-context',
            compactionThreshold: 0, // Explicitly disable compaction
        });

        // Add many messages
        for (let i = 0; i < 50; i++) {
            await history.add({
                type: 'message',
                role: i % 2 === 0 ? 'user' : 'assistant',
                content: 'x'.repeat(250),
            });
        }

        // Should have all messages (no compaction)
        const messages = await history.getMessages();
        expect(messages.length).toBe(50);
    });

    it('should keep recent messages and summarize older ones', async () => {
        const history = new MessageHistory([], {
            modelId: 'test-model-small-context',
            compactionThreshold: 0.7,
        });

        // Add identifiable messages - make them larger to trigger compaction
        // With 4000 token context and 0.7 threshold = 2800 tokens to trigger
        // Each message with 400 chars = ~100 tokens, so 30 messages = 3000 tokens
        for (let i = 0; i < 35; i++) {
            await history.add({
                type: 'message',
                role: i % 2 === 0 ? 'user' : 'assistant',
                content: `Message ${i}: ${'x'.repeat(400)}`, // ~105 tokens each
            });
        }

        const messages = await history.getMessages('test-model-small-context');

        // Recent messages should be preserved
        expect(messages.length).toBeGreaterThan(0);
        expect(messages.length).toBeLessThan(35); // Should have compacted some messages

        // Should have a summary of older messages (with new format)
        const hasSummary = messages.some(
            m =>
                m.type === 'message' &&
                typeof m.content === 'string' &&
                m.content.includes('[Previous Conversation Summary]')
        );
        expect(hasSummary).toBe(true);
    });

    it('should handle tool calls during compaction', async () => {
        const history = new MessageHistory([], {
            modelId: 'test-model-small-context',
            compactionThreshold: 0.7,
        });

        // Add messages with tool calls - need enough to trigger compaction
        for (let i = 0; i < 30; i++) {
            await history.add({
                type: 'message',
                role: 'user',
                content: `Question ${i}: ${'x'.repeat(200)}`, // ~55 tokens
            });

            await history.add({
                type: 'message',
                role: 'assistant',
                content: `Calling tool for question ${i}: ${'x'.repeat(200)}`, // ~60 tokens
            });

            await history.add({
                type: 'function_call',
                call_id: `call_${i}`,
                name: 'test_tool',
                arguments: JSON.stringify({ query: i, data: 'x'.repeat(100) }), // ~30 tokens
            });

            await history.add({
                type: 'function_call_output',
                call_id: `call_${i}`,
                output: 'x'.repeat(200), // ~50 tokens
            });
        }

        const messages = await history.getMessages('test-model-small-context');

        // Should have compacted
        expect(messages.length).toBeLessThan(120); // 30 * 4 = 120 original messages

        // Should still have proper message structure
        const messageTypes = messages.map(m => m.type);
        expect(messageTypes).toContain('message');
        expect(messageTypes).toContain('function_call');
        expect(messageTypes).toContain('function_call_output');
    });

    it('should support pinning messages to prevent compaction', async () => {
        const history = new MessageHistory([], {
            modelId: 'test-model-small-context',
            compactionThreshold: 0.7,
        });

        // Add a regular message
        await history.add({
            type: 'message',
            role: 'user',
            content: 'Important: Remember this message!',
        });

        // Pin the first message
        history.pinMessage(0);

        // Add many more messages to trigger compaction
        for (let i = 0; i < 50; i++) {
            await history.add({
                type: 'message',
                role: i % 2 === 0 ? 'user' : 'assistant',
                content: 'x'.repeat(250),
            });
        }

        const messages = await history.getMessages('test-model-small-context');

        // The pinned message should still be present
        const pinnedMessage = messages.find(
            m =>
                m.type === 'message' &&
                typeof m.content === 'string' &&
                m.content.includes('Important: Remember this message!')
        );
        expect(pinnedMessage).toBeDefined();
    });

    it('should maintain micro-log during conversation', async () => {
        const history = new MessageHistory([], {
            modelId: 'test-model-small-context',
        });

        await history.add({
            type: 'message',
            role: 'user',
            content: 'What is the weather like?',
        });

        await history.add({
            type: 'message',
            role: 'assistant',
            content:
                'I can help you check the weather. Let me look that up for you.',
        });

        await history.add({
            type: 'function_call',
            call_id: 'call_123',
            name: 'get_weather',
            arguments: '{"location": "New York"}',
        });

        const microLog = history.getMicroLog();

        expect(microLog).toHaveLength(3);
        expect(microLog[0].summary).toBe('What is the weather like?');
        expect(microLog[1].summary).toBe(
            'I can help you check the weather. Let me look that up for you.'
        );
        expect(microLog[2].summary).toBe('Called get_weather()');
    });

    it('should extract entities, decisions, and todos', async () => {
        const history = new MessageHistory([]);

        await history.add({
            type: 'message',
            role: 'user',
            content: 'Please update the file at /home/user/project/main.py',
        });

        await history.add({
            type: 'message',
            role: 'assistant',
            content:
                'I will update the file at "/home/user/project/main.py". First, I need to read its contents. TODO: Add error handling after updating.',
        });

        const extractedInfo = history.getExtractedInfo();

        // Should extract file paths
        expect(Array.from(extractedInfo.entities)).toContain(
            '/home/user/project/main.py'
        );

        // Should extract decisions (may be truncated by regex)
        const hasDecision = extractedInfo.decisions.some(d =>
            d.includes('update the file')
        );
        expect(hasDecision).toBe(true);

        // Should extract todos
        expect(extractedInfo.todos).toContainEqual(
            expect.stringContaining('Add error handling after updating')
        );
    });

    it('should create hybrid summary with all components', async () => {
        const history = new MessageHistory([], {
            modelId: 'test-model-small-context',
            compactionThreshold: 0.7,
        });

        // Add diverse content to test all summary components
        await history.add({
            type: 'message',
            role: 'user',
            content:
                'I need to analyze the data at https://example.com/data.json',
        });

        await history.add({
            type: 'message',
            role: 'assistant',
            content:
                "I'll analyze the data from that URL. The approach is to fetch and parse the JSON data.",
        });

        await history.add({
            type: 'function_call',
            call_id: 'call_456',
            name: 'fetch_url',
            arguments: '{"url": "https://example.com/data.json"}',
        });

        // Add many more messages to trigger compaction
        for (let i = 0; i < 40; i++) {
            await history.add({
                type: 'message',
                role: i % 2 === 0 ? 'user' : 'assistant',
                content: `Message ${i}: ${'x'.repeat(300)}`,
            });
        }

        const messages = await history.getMessages('test-model-small-context');
        const summaryMessage = messages.find(
            m =>
                m.type === 'message' &&
                m.role === 'system' &&
                typeof m.content === 'string' &&
                m.content.includes('[Previous Conversation Summary]')
        );

        expect(summaryMessage).toBeDefined();
        if (summaryMessage && typeof summaryMessage.content === 'string') {
            // Should have conversation flow section
            expect(summaryMessage.content).toContain('## Conversation Flow');

            // Should have key information section
            expect(summaryMessage.content).toContain('## Key Information');

            // Should mention the URL entity
            expect(summaryMessage.content).toContain(
                'https://example.com/data.json'
            );

            // Should mention the tool used
            expect(summaryMessage.content).toContain('fetch_url');
        }
    });
});
