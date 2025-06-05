/**
 * Tool Result Processor - Handles summarization and truncation of tool results
 */

import { ToolCall, ResponseInput, type AgentDefinition } from '../types/types.js';
import {
    MAX_RESULT_LENGTH,
    SKIP_SUMMARIZATION_TOOLS,
    TOOL_CONFIGS,
} from '../config/tool_execution.js';
import type { Agent } from 'openai/_shims/node-types.mjs';

/**
 * Create a summary of content using a small, fast model
 */
export async function createSummary(
    content: string,
    prompt: string
): Promise<string> {
    try {
        // Lazy load to avoid circular dependency
        const { ensembleRequest } = await import('../core/ensemble_request.js');

        // Use a small, fast model for summarization
        const messages: ResponseInput = [
            {
                type: 'message',
                role: 'system',
                content: prompt,
            },
            {
                type: 'message',
                role: 'user',
                content: content,
            },
        ];

        const agent: AgentDefinition = {
            modelClass: 'summary',
            name: 'SummaryAgent',
        };

        let summary = '';
        for await (const event of ensembleRequest(messages, agent)) {
            if (event.type === 'message_delta' && 'content' in event) {
                summary += event.content;
            }
        }

        return summary || content.substring(0, MAX_RESULT_LENGTH) + '...';
    } catch (error) {
        console.error('Error creating summary:', error);
        // Fallback to simple truncation
        return content.substring(0, MAX_RESULT_LENGTH) + '...';
    }
}

/**
 * Process tool result with summarization and truncation
 */
export async function processToolResult(
    toolCall: ToolCall,
    rawResult: string
): Promise<string> {
    const toolName = toolCall.function.name;
    const config = TOOL_CONFIGS[toolName] || {};

    // Check if result is an image
    if (rawResult.startsWith('data:image/')) {
        return rawResult; // Return images as-is
    }

    // Check if we should skip summarization
    const skipSummarization =
        config.skipSummarization || SKIP_SUMMARIZATION_TOOLS.has(toolName);

    const maxLength = config.maxLength || MAX_RESULT_LENGTH;

    if (skipSummarization) {
        // Just truncate if needed
        if (rawResult.length > maxLength) {
            const truncationMessage =
                config.truncationMessage ||
                `... Output truncated to ${maxLength} characters`;
            return rawResult.substring(0, maxLength) + truncationMessage;
        }
        return rawResult;
    }

    // Check if summarization is needed
    if (rawResult.length <= maxLength) {
        return rawResult;
    }

    // Summarize the result
    const summaryPrompt = `The following is the output of a tool call \`${
        toolName
    }(${
        toolCall.function.arguments
    })\` used by an AI agent in an autonomous system. Focus on summarizing both the overall output and the final result of the tool. Your summary will be used to understand what the result of the tool call was.`;

    return createSummary(rawResult, summaryPrompt);
}

/**
 * Check if a tool result should be summarized
 */
export function shouldSummarizeResult(
    toolName: string,
    resultLength: number
): boolean {
    const config = TOOL_CONFIGS[toolName] || {};

    if (config.skipSummarization || SKIP_SUMMARIZATION_TOOLS.has(toolName)) {
        return false;
    }

    const maxLength = config.maxLength || MAX_RESULT_LENGTH;
    return resultLength > maxLength;
}

/**
 * Get truncation message for a tool
 */
export function getTruncationMessage(toolName: string): string {
    const config = TOOL_CONFIGS[toolName] || {};
    return (
        config.truncationMessage ||
        `... Output truncated to ${
            config.maxLength || MAX_RESULT_LENGTH
        } characters`
    );
}
