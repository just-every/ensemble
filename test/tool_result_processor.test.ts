import { describe, it, expect, vi, Mock } from 'vitest';
import {
    createSummary,
    processToolResult,
    shouldSummarizeResult,
    getTruncationMessage,
} from '../utils/tool_result_processor.js';
import { ToolCall } from '../types/types.js';
import * as ensembleRequestModule from '../core/ensemble_request.js';

// Mock ensemble request
vi.mock('../core/ensemble_request.js', () => ({
    ensembleRequest: vi.fn(),
}));

describe('Tool Result Processor', () => {
    const mockToolCall: ToolCall = {
        id: 'test-id',
        type: 'function',
        function: {
            name: 'test_tool',
            arguments: '{"param": "value"}',
        },
    };

    describe('createSummary', () => {
        it('should create a summary using LLM', async () => {
            const mockEnsembleRequest =
                ensembleRequestModule.ensembleRequest as Mock;

            // Mock the async generator
            mockEnsembleRequest.mockImplementation(async function* () {
                yield { type: 'message_delta', content: 'This is a summary' };
            });

            const summary = await createSummary(
                'Long content to summarize',
                'Summarize this content'
            );

            expect(summary).toBe('This is a summary');
            expect(mockEnsembleRequest).toHaveBeenCalledWith(
                [
                    {
                        type: 'message',
                        role: 'system',
                        content: 'Summarize this content',
                    },
                    {
                        type: 'message',
                        role: 'user',
                        content: 'Long content to summarize',
                    },
                ],
                {
                    model: 'o4-mini',
                    agent_id: 'summarizer',
                }
            );
        });

        it('should fallback to truncation on error', async () => {
            const mockEnsembleRequest =
                ensembleRequestModule.ensembleRequest as Mock;
            mockEnsembleRequest.mockRejectedValue(new Error('LLM error'));

            const longContent = 'x'.repeat(2000);
            const summary = await createSummary(longContent, 'Summarize');

            expect(summary).toBe('x'.repeat(1000) + '...');
        });

        it('should handle empty response from LLM', async () => {
            const mockEnsembleRequest =
                ensembleRequestModule.ensembleRequest as Mock;
            mockEnsembleRequest.mockImplementation(async function* () {
                // Empty response
            });

            const content = 'x'.repeat(2000);
            const summary = await createSummary(content, 'Summarize');

            expect(summary).toBe('x'.repeat(1000) + '...');
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

            const content = 'x'.repeat(1500);
            const result = await processToolResult(readSourceCall, content);

            expect(result).toBe(
                'x'.repeat(1000) +
                    '\n\n[Full output truncated: Use write_source(summary_id, file_path) to write full output to a file.]'
            );
        });

        it('should not truncate short results', async () => {
            const shortContent = 'This is a short result';
            const result = await processToolResult(mockToolCall, shortContent);
            expect(result).toBe(shortContent);
        });

        it('should summarize long results for non-skip tools', async () => {
            const mockEnsembleRequest =
                ensembleRequestModule.ensembleRequest as Mock;
            mockEnsembleRequest.mockImplementation(async function* () {
                yield { type: 'message_delta', content: 'Summarized content' };
            });

            const longContent = 'x'.repeat(1500);
            const result = await processToolResult(mockToolCall, longContent);

            expect(result).toBe('Summarized content');
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

            const content = 'x'.repeat(1500);
            const result = await processToolResult(listFilesCall, content);

            expect(result).toBe(
                'x'.repeat(1000) + '... Output truncated to 1000 characters'
            );
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
            expect(shouldSummarizeResult('test_tool', 1500)).toBe(true);
        });

        it('should respect custom tool config max length', () => {
            // read_source has custom maxLength of 1000
            expect(shouldSummarizeResult('read_source', 500)).toBe(false);
            expect(shouldSummarizeResult('read_source', 1500)).toBe(false); // Still false because it's in skip list
        });
    });

    describe('getTruncationMessage', () => {
        it('should return custom message for configured tools', () => {
            expect(getTruncationMessage('read_source')).toBe(
                '\n\n[Full output truncated: Use write_source(summary_id, file_path) to write full output to a file.]'
            );
        });

        it('should return default message for other tools', () => {
            expect(getTruncationMessage('test_tool')).toBe(
                '... Output truncated to 1000 characters'
            );
        });

        it('should include custom max length in default message', () => {
            expect(getTruncationMessage('get_page_content')).toBe(
                '... Output truncated to 1000 characters'
            );
        });
    });
});
