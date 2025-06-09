/**
 * Tool Result Processor - Handles summarization and truncation of tool results
 */

import {
    ToolCall,
    ResponseInput,
    type AgentDefinition,
} from '../types/types.js';
import {
    MAX_RESULT_LENGTH,
    SKIP_SUMMARIZATION_TOOLS,
    TOOL_CONFIGS,
} from '../config/tool_execution.js';
import crypto from 'crypto';

// Advanced summarization configuration
const SUMMARIZE_AT_CHARS = 5000; // Below this length, we don't summarize
const SUMMARIZE_TRUNCATE_CHARS = 200000; // Truncate before summarizing to avoid context length errors

// Cache to avoid repeated summaries of the same content
const summaryCache = new Map<string, { summary: string; timestamp: number }>();
// Cache expiration time (1 hour)
const CACHE_EXPIRATION_MS = 60 * 60 * 1000;

// Patterns that might indicate failing tasks
const FAILURE_PATTERNS = [
    /error|exception|failed|timeout|rejected|unable to|cannot|not found|invalid/gi,
    /retry.*attempt|retrying|trying again/gi,
    /no (?:such|valid) (?:file|directory|path|route)/gi,
    /unexpected|unknown|unhandled/gi,
];

// Maximum number of retries before flagging a potential issue
const MAX_RETRIES = 3;
// Minimum frequency of error messages to consider as a potential issue
const ERROR_FREQUENCY_THRESHOLD = 0.3;

/**
 * Truncate text intelligently, keeping beginning and end
 */
function truncate(
    text: string,
    length: number = SUMMARIZE_TRUNCATE_CHARS,
    separator: string = '\n\n...[truncated for summary]...\n\n'
): string {
    text = text.trim();
    if (text.length <= length) {
        return text;
    }
    // Keep 30% from beginning and 70% from end (end usually has more important info)
    const beginLength = Math.floor(length * 0.3);
    const endLength = length - beginLength - separator.length;
    return (
        text.substring(0, beginLength) +
        separator +
        text.substring(text.length - endLength)
    );
}

/**
 * Create a summary of content using a small, fast model
 */
export async function createSummary(
    content: string,
    prompt: string
): Promise<string> {
    // Don't summarize short content
    if (content.length <= SUMMARIZE_AT_CHARS) {
        return content;
    }

    // Check cache first
    const contentHash = crypto
        .createHash('sha256')
        .update(content)
        .digest('hex');
    const cacheKey = `${contentHash}-${prompt.substring(0, 50)}`;

    const cachedSummary = summaryCache.get(cacheKey);
    if (
        cachedSummary &&
        Date.now() - cachedSummary.timestamp < CACHE_EXPIRATION_MS
    ) {
        console.log(
            `Retrieved summary from cache for hash: ${contentHash.substring(0, 8)}...`
        );
        return cachedSummary.summary;
    }

    try {
        // Truncate content before sending to LLM to avoid context length errors
        const truncatedContent = truncate(content, SUMMARIZE_TRUNCATE_CHARS);
        const originalLines = content.split('\n').length;

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
                content: truncatedContent,
            },
        ];

        const agent: AgentDefinition = {
            modelClass: 'summary',
            name: 'SummaryAgent',
        };

        let summary = '';
        for await (const event of ensembleRequest(messages, agent)) {
            if (event.type === 'message_complete' && 'content' in event) {
                summary += event.content;
            }
        }

        if (!summary) {
            throw new Error('No summary generated');
        }

        const trimmedSummary = summary.trim();
        const summaryLines = trimmedSummary.split('\n').length;
        const metadata = `\n\n[Summarized output: ${originalLines} → ${summaryLines} lines, ${content.length} → ${trimmedSummary.length} chars]`;

        const fullSummary = trimmedSummary + metadata;

        // Cache the summary
        summaryCache.set(cacheKey, {
            summary: fullSummary,
            timestamp: Date.now(),
        });

        return fullSummary;
    } catch (error) {
        console.error('Error creating summary:', error);
        // Fallback to intelligent truncation
        const truncated = truncate(content, MAX_RESULT_LENGTH);
        return truncated + '\n\n[Summary generation failed, output truncated]';
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

    // For tools that skip summarization, use intelligent truncation
    if (skipSummarization) {
        if (rawResult.length > maxLength) {
            const truncatedResult = truncate(rawResult, maxLength);
            const truncationMessage =
                config.truncationMessage ||
                `\n\n[Output truncated: ${rawResult.length} → ${maxLength} chars]`;
            return truncatedResult + truncationMessage;
        }
        return rawResult;
    }

    // Use the configured maxLength as threshold for summarization
    // But also respect the global SUMMARIZE_AT_CHARS minimum
    const summarizeThreshold = Math.max(maxLength, SUMMARIZE_AT_CHARS);

    // Check if summarization is needed
    if (rawResult.length <= summarizeThreshold) {
        return rawResult;
    }

    // Detect if the output likely contains errors
    const potentialIssues = detectPotentialIssues(rawResult);

    // Summarize the result
    let summaryPrompt = `The following is the output of a tool call \`${
        toolName
    }(${
        toolCall.function.arguments
    })\` used by an AI agent in an autonomous system. Focus on summarizing both the overall output and the final result of the tool. Your summary will be used to understand what the result of the tool call was.`;

    if (potentialIssues.isLikelyFailing) {
        summaryPrompt += ` Note: The output appears to contain errors or issues. Please highlight any errors, failures, or problems in your summary.`;
    }

    const summary = await createSummary(rawResult, summaryPrompt);

    // Add warning if issues were detected
    if (potentialIssues.isLikelyFailing && potentialIssues.issues.length > 0) {
        return (
            summary +
            `\n\n⚠️ Potential issues detected: ${potentialIssues.issues.join(', ')}`
        );
    }

    return summary;
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

/**
 * Detect potential issues in output
 */
function detectPotentialIssues(output: string): {
    isLikelyFailing: boolean;
    issues: string[];
} {
    if (!output) {
        return { isLikelyFailing: false, issues: [] };
    }

    let errorCount = 0;
    let retryCount = 0;
    const issues: string[] = [];

    // Count pattern matches
    FAILURE_PATTERNS.forEach(pattern => {
        const matches = output.match(pattern);
        if (matches) {
            errorCount += matches.length;
        }
    });

    // Count retry attempts
    const retryMatches = output.match(/retry.*attempt|retrying|trying again/gi);
    if (retryMatches) {
        retryCount += retryMatches.length;
    }

    // Calculate error frequency
    const errorFrequency = output.length > 0 ? errorCount / output.length : 0;

    // Determine if the output is likely failing
    const isLikelyFailing =
        retryCount > MAX_RETRIES || errorFrequency > ERROR_FREQUENCY_THRESHOLD;

    if (retryCount > MAX_RETRIES) {
        issues.push(`excessive retries (${retryCount})`);
    }

    if (errorFrequency > ERROR_FREQUENCY_THRESHOLD) {
        issues.push(
            `high error frequency (${(errorFrequency * 100).toFixed(1)}%)`
        );
    }

    return { isLikelyFailing, issues };
}

/**
 * Clear the summary cache (useful for testing or memory management)
 */
export function clearSummaryCache(): void {
    summaryCache.clear();
}

/**
 * Get summary cache statistics
 */
export function getSummaryCacheStats(): {
    size: number;
    oldestEntry: number | null;
} {
    let oldestTimestamp: number | null = null;

    summaryCache.forEach(({ timestamp }) => {
        if (oldestTimestamp === null || timestamp < oldestTimestamp) {
            oldestTimestamp = timestamp;
        }
    });

    return {
        size: summaryCache.size,
        oldestEntry: oldestTimestamp,
    };
}
