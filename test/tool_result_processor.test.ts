import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    createSummary,
    processToolResult,
    shouldSummarizeResult,
    getTruncationMessage,
} from '../utils/tool_result_processor.js';
import { ToolCall } from '../types/types.js';

// Mock the module before any imports that might use it
vi.mock('../core/ensemble_request.js', () => ({
    ensembleRequest: vi.fn(),
}));

// Import the mocked function
import { ensembleRequest } from '../core/ensemble_request.js';

describe('Tool Result Processor', () => {
    const mockToolCall: ToolCall = {
        id: 'test-id',
        type: 'function',
        function: {
            name: 'test_tool',
            arguments: '{"param": "value"}',
        },
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('createSummary', () => {
        it('should not summarize short content', async () => {
            const shortContent = 'This is short content';
            const summary = await createSummary(shortContent, 'Summarize this content');

            // Content below 5000 chars should not be summarized
            expect(summary).toBe(shortContent);
        });

        it('should create a summary using LLM', async () => {
            const mockEnsembleRequest = ensembleRequest as any;

            // Mock the async generator
            mockEnsembleRequest.mockImplementation(async function* () {
                yield {
                    type: 'message_complete',
                    content: 'This is a summary',
                };
            });

            // Create content > 5000 chars to trigger summarization
            const longContent = 'x'.repeat(6000);
            const summary = await createSummary(longContent, 'Summarize this content');

            expect(summary).toContain('This is a summary');
            expect(summary).toContain('[Summarized output');
            // Don't check exact content since it gets truncated
            expect(mockEnsembleRequest).toHaveBeenCalled();
        });

        it('should fallback to truncation on error', async () => {
            const mockEnsembleRequest = ensembleRequest as any;
            mockEnsembleRequest.mockRejectedValue(new Error('LLM error'));

            const longContent = 'x'.repeat(6000);
            const summary = await createSummary(longContent, 'Summarize');

            expect(summary).toContain('[truncated for summary]');
            expect(summary).toContain('[Summary generation failed, output truncated]');
        });

        it('should handle empty response from LLM', async () => {
            const mockEnsembleRequest = ensembleRequest as any;
            mockEnsembleRequest.mockImplementation(async function* () {
                // Empty response
            });

            const content = 'x'.repeat(6000);
            const summary = await createSummary(content, 'Summarize');

            expect(summary).toContain('[truncated for summary]');
            expect(summary).toContain('[Summary generation failed, output truncated]');
        });
    });

    describe('processToolResult', () => {
        it('should return images as-is', async () => {
            const imageData = 'data:image/png;base64,iVBORw0KGgoAAAANS...';
            const result = await processToolResult(mockToolCall, imageData);
            expect(result).toBe(imageData);
        });

        it('should skip summarization for configured tools', async () => {
            const readSourceCall: ToolCall = {
                ...mockToolCall,
                function: {
                    name: 'read_source',
                    arguments: '{}',
                },
            };

            const content = 'x'.repeat(15000);
            const result = await processToolResult(readSourceCall, content);

            expect(result).toContain('[truncated for summary]');
            expect(result).toContain(
                '[Full output truncated: Use write_source(summary_id, file_path) to write full output to a file.]'
            );
        });

        it('should not truncate short results', async () => {
            const shortContent = 'This is a short result';
            const result = await processToolResult(mockToolCall, shortContent);
            expect(result).toBe(shortContent);
        });

        it('should summarize long results for non-skip tools', async () => {
            const { ensembleRequest } = await import('../core/ensemble_request.js');
            const mockEnsembleRequest = ensembleRequest as any;
            mockEnsembleRequest.mockImplementation(async function* () {
                yield {
                    type: 'message_complete',
                    content: 'Summarized content',
                };
            });

            const longContent = 'x'.repeat(6000);
            const result = await processToolResult(mockToolCall, longContent);

            expect(result).toContain('Summarized content');
            expect(result).toContain('[Summarized output');
            expect(mockEnsembleRequest).toHaveBeenCalled();
        });

        it('should handle tools from SKIP_SUMMARIZATION_TOOLS set', async () => {
            const listFilesCall: ToolCall = {
                ...mockToolCall,
                function: {
                    name: 'list_files',
                    arguments: '{}',
                },
            };

            const content = 'x'.repeat(15000);
            const result = await processToolResult(listFilesCall, content);

            expect(result).toContain('[truncated for summary]');
            expect(result).toContain('[Output truncated:');
        });
    });

    describe('shouldSummarizeResult', () => {
        it('should return false for tools in skip list', () => {
            expect(shouldSummarizeResult('read_source', 1500)).toBe(false);
            expect(shouldSummarizeResult('get_page_content', 1500)).toBe(false);
            expect(shouldSummarizeResult('read_file', 1500)).toBe(false);
        });

        it('should return false for short results', () => {
            expect(shouldSummarizeResult('test_tool', 500)).toBe(false);
        });

        it('should return true for long results from other tools', () => {
            expect(shouldSummarizeResult('test_tool', 6000)).toBe(true);
        });

        it('should respect custom tool config max length', () => {
            // read_source has custom maxLength of 10000
            expect(shouldSummarizeResult('read_source', 5000)).toBe(false);
            expect(shouldSummarizeResult('read_source', 15000)).toBe(false); // Still false because it's in skip list
        });
    });

    describe('getTruncationMessage', () => {
        it('should return custom message for configured tools', () => {
            expect(getTruncationMessage('read_source')).toBe(
                '\n\n[Full output truncated: Use write_source(summary_id, file_path) to write full output to a file.]'
            );
        });

        it('should return default message for other tools', () => {
            expect(getTruncationMessage('test_tool')).toBe('... Output truncated to 5000 characters');
        });

        it('should include custom max length in default message', () => {
            expect(getTruncationMessage('get_page_content')).toBe('... Output truncated to 10000 characters');
        });
    });
});
