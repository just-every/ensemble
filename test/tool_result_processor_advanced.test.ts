import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
    processToolResult,
    clearSummaryCache,
    getSummaryCacheStats,
} from '../utils/tool_result_processor.js';
import type { ToolCall } from '../types/types.js';

describe('Advanced Tool Result Processor', () => {
    beforeEach(() => {
        clearSummaryCache();
    });

    it('should not summarize content below threshold', async () => {
        const toolCall: ToolCall = {
            id: 'test-1',
            type: 'function',
            function: {
                name: 'test_tool',
                arguments: '{}',
            },
        };

        const shortContent =
            'This is a short output that should not be summarized.';
        const result = await processToolResult(toolCall, shortContent);

        expect(result).toBe(shortContent);
    });

    it('should intelligently truncate when skipping summarization', async () => {
        const toolCall: ToolCall = {
            id: 'test-2',
            type: 'function',
            function: {
                name: 'read_file',
                arguments: '{"path": "test.txt"}',
            },
        };

        // Create content that exceeds the limit
        const longContent =
            'A'.repeat(5000) + 'MIDDLE_SECTION' + 'Z'.repeat(10000);
        const result = await processToolResult(toolCall, longContent);

        // Should contain truncation indicator
        expect(result).toContain('[truncated for summary]');
        // Should preserve beginning and end
        expect(result).toContain('AAA');
        expect(result).toContain('ZZZ');
        // Should have truncation message
        expect(result).toContain('[Full output truncated');
    });

    it('should detect potential issues in error-laden output', async () => {
        const toolCall: ToolCall = {
            id: 'test-3',
            type: 'function',
            function: {
                name: 'run_command',
                arguments: '{"cmd": "failing-command"}',
            },
        };

        const errorOutput = `
Error: Command failed with exit code 1
Retrying attempt 1...
Error: Command failed again
Retrying attempt 2...
Error: Still failing
Retrying attempt 3...
Error: Maximum retries exceeded
Fatal error: Unable to complete operation
Exception: Timeout occurred
Failed to connect to server
`.repeat(100); // Make it long enough to trigger summarization

        const result = await processToolResult(toolCall, errorOutput);

        // Should detect issues
        expect(result).toContain('Potential issues detected');
        expect(result).toContain('excessive retries');
    });

    it('should cache summaries for identical content', async () => {
        const toolCall: ToolCall = {
            id: 'test-4',
            type: 'function',
            function: {
                name: 'test_tool',
                arguments: '{}',
            },
        };

        // Create long content that will be summarized
        const longContent = 'This is a very long content. '.repeat(500);

        // First call
        const result1 = await processToolResult(toolCall, longContent);
        const stats1 = getSummaryCacheStats();
        expect(stats1.size).toBe(1);

        // Second call with same content
        const result2 = await processToolResult(toolCall, longContent);
        const stats2 = getSummaryCacheStats();

        // Should use cache
        expect(stats2.size).toBe(1);
        expect(result1).toBe(result2);
    });

    it('should handle very large documents without context length errors', async () => {
        const toolCall: ToolCall = {
            id: 'test-5',
            type: 'function',
            function: {
                name: 'read_massive_file',
                arguments: '{}',
            },
        };

        // Create massive content that would exceed context limits
        const massiveContent = 'X'.repeat(300000); // 300k chars

        const result = await processToolResult(toolCall, massiveContent);

        // Should truncate before summarizing
        expect(result.length).toBeLessThan(massiveContent.length);
        expect(result).toContain('[Summarized output');
    });

    it('should preserve images without processing', async () => {
        const toolCall: ToolCall = {
            id: 'test-6',
            type: 'function',
            function: {
                name: 'generate_image',
                arguments: '{}',
            },
        };

        const imageData = 'data:image/png;base64,iVBORw0KGgoAAAANS...';
        const result = await processToolResult(toolCall, imageData);

        expect(result).toBe(imageData);
    });

    it('should use tool-specific configuration', async () => {
        const toolCall: ToolCall = {
            id: 'test-7',
            type: 'function',
            function: {
                name: 'execute_code',
                arguments: '{"code": "print(\'hello\')"}',
            },
        };

        // Create content that exceeds the tool-specific limit (5000)
        const codeOutput = 'Output line\\n'.repeat(600); // ~7200 chars
        const result = await processToolResult(toolCall, codeOutput);

        // Should summarize because it exceeds tool-specific limit
        expect(result).toContain('[Summarized output');
    });
});
