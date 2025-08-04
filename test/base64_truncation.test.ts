import { describe, it, expect } from 'vitest';
import { createToolFunction } from '../utils/create_tool_function.js';
import { processToolResult } from '../utils/tool_result_processor.js';
import { ToolCall } from '../types/types.js';

describe('base64 image truncation bug', () => {
    it('should not break base64 images when allowSummary is false', async () => {
        // Create a tool with allowSummary = false that returns a base64 image
        const tool = createToolFunction(
            async (_imagePath: string) => {
                // Simulate the view_image tool output with a base64 image
                // Create a large base64 string (60k chars to trigger truncation)
                const smallBase64 =
                    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
                // Repeat to make it large enough to trigger truncation (>50k chars)
                const largeBase64 = smallBase64.repeat(600); // ~60k chars

                return `Image viewed successfully:
Path: https://example.com/logo.png
Format: png
Dimensions: 1024x1024

data:image/png;base64,${largeBase64}

Use save_logos_as_source or set_source_image to save this image if desired.`;
            },
            'View an image from a local path or remote URL',
            { imagePath: { type: 'string', description: 'Path to image' } },
            undefined,
            'view_image',
            false // allowSummary = false
        );

        expect(tool.allowSummary).toBe(false);

        // Create a mock tool call
        const toolCall: ToolCall = {
            id: 'test-call-1',
            type: 'function',
            function: {
                name: 'view_image',
                arguments: JSON.stringify({ imagePath: 'https://example.com/logo.png' }),
            },
        };

        // Create the expected output
        const smallBase64 =
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
        const largeBase64 = smallBase64.repeat(600);
        const fullOutput = `Image viewed successfully:
Path: https://example.com/logo.png
Format: png
Dimensions: 1024x1024

data:image/png;base64,${largeBase64}

Use save_logos_as_source or set_source_image to save this image if desired.`;

        // Process the result
        const processed = await processToolResult(toolCall, fullOutput, undefined, false);

        // When allowSummary is false, the ENTIRE output should be preserved
        expect(processed).toBe(fullOutput);

        // No truncation messages should appear
        expect(processed).not.toContain('[truncated');
        expect(processed).not.toContain('[Output truncated');
        expect(processed).not.toContain('...');

        // The full base64 should be intact
        if (processed.includes('data:image/png;base64,')) {
            const base64Start = processed.indexOf('data:image/png;base64,') + 'data:image/png;base64,'.length;
            const base64End = processed.indexOf('\n\nUse save_logos_as_source');

            if (base64End > base64Start) {
                const extractedBase64 = processed.substring(base64Start, base64End);

                // Should be the complete base64 string
                expect(extractedBase64).toBe(largeBase64);
            }
        }
    });

    it('should preserve complete base64 images under 50k chars', async () => {
        // Create a tool with allowSummary = false
        const _tool = createToolFunction(
            async (_imagePath: string) => {
                // Small base64 that won't trigger truncation
                const base64 =
                    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

                return `Image viewed successfully:
Path: https://example.com/logo.png
Format: png
Dimensions: 100x100

data:image/png;base64,${base64}

Use save_logos_as_source to save this image.`;
            },
            'View an image',
            { imagePath: { type: 'string' } },
            undefined,
            'view_image_small',
            false // allowSummary = false
        );

        const toolCall: ToolCall = {
            id: 'test-call-2',
            type: 'function',
            function: {
                name: 'view_image_small',
                arguments: JSON.stringify({ imagePath: 'https://example.com/logo.png' }),
            },
        };

        const base64 =
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
        const fullOutput = `Image viewed successfully:
Path: https://example.com/logo.png
Format: png
Dimensions: 100x100

data:image/png;base64,${base64}

Use save_logos_as_source to save this image.`;

        // Process the result
        const processed = await processToolResult(toolCall, fullOutput, undefined, false);

        // Should return the full output unchanged since it's under 50k
        expect(processed).toBe(fullOutput);
        expect(processed).not.toContain('[truncated');
        expect(processed).not.toContain('[Output truncated');
    });

    it('should NOT truncate when allowSummary is false, even with data URLs', async () => {
        // Test that NO truncation happens when allowSummary is false
        const dataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ';
        const longPrefix = 'x'.repeat(40000); // 40k chars
        const longSuffix = 'y'.repeat(15000); // 15k chars

        const fullOutput = longPrefix + '\n' + dataUrl + '\n' + longSuffix; // >55k total

        const toolCall: ToolCall = {
            id: 'test-call-3',
            type: 'function',
            function: {
                name: 'test_tool',
                arguments: '{}',
            },
        };

        // Process with allowSummary = false
        const processed = await processToolResult(toolCall, fullOutput, undefined, false);

        // Should NOT be truncated at all
        expect(processed).toBe(fullOutput); // Exact same output
        expect(processed.length).toBe(fullOutput.length); // Same length

        // The data URL should be completely intact
        expect(processed).toContain(dataUrl);
        const dataUrlStart = processed.indexOf('data:image/');
        const dataUrlEnd = processed.indexOf('\n', dataUrlStart);
        if (dataUrlEnd > dataUrlStart) {
            const extractedDataUrl = processed.substring(dataUrlStart, dataUrlEnd);
            expect(extractedDataUrl).toBe(dataUrl); // Should be the exact data URL
        }
    });
});
