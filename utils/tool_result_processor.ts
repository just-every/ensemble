/**
 * Tool Result Processor - Handles summarization and truncation of tool results
 */

import { ToolCall, ResponseInput, type AgentDefinition } from '../types/types.js';
import { MAX_RESULT_LENGTH, SKIP_SUMMARIZATION_TOOLS, TOOL_CONFIGS } from '../config/tool_execution.js';
import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';

// Advanced summarization configuration
const SUMMARIZE_AT_CHARS = 5000; // Below this length, we don't summarize
const SUMMARIZE_TRUNCATE_CHARS = 200000; // Truncate before summarizing to avoid context length errors

// Cache to avoid repeated summaries of the same content
const summaryCache = new Map<string, { summary: string; timestamp: number }>();
// Cache expiration time (1 hour)
const CACHE_EXPIRATION_MS = 60 * 60 * 1000;

// Constants for persistent summaries
const HASH_MAP_FILENAME = 'summary_hash_map.json';

// --- Helper functions for persistent summaries ---
type SummaryHashMap = { [hash: string]: string }; // Map<documentHash, summaryId>

async function ensureDir(dir: string): Promise<void> {
    try {
        await fs.mkdir(dir, { recursive: true });
    } catch (error: any) {
        if (error.code !== 'EEXIST') {
            throw error;
        }
    }
}

async function loadHashMap(file_path: string): Promise<SummaryHashMap> {
    try {
        const data = await fs.readFile(file_path, 'utf-8');
        return JSON.parse(data);
    } catch (error: any) {
        if (error.code === 'ENOENT') {
            return {};
        }
        console.error(`Error loading summary hash map from ${file_path}:`, error);
        return {};
    }
}

async function saveHashMap(file_path: string, map: SummaryHashMap): Promise<void> {
    try {
        const data = JSON.stringify(map, null, 2);
        await fs.writeFile(file_path, data, 'utf-8');
    } catch (error) {
        console.error(`Error saving summary hash map to ${file_path}:`, error);
    }
}

// Storage for agents that have been injected with summary tools
const agentsWithSummaryTools = new Set<string>();

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
    return text.substring(0, beginLength) + separator + text.substring(text.length - endLength);
}

/**
 * Create a summary of content using a small, fast model with optional expandable references
 */
export async function createSummary(content: string, prompt: string, agent?: AgentDefinition): Promise<string> {
    // Don't summarize short content
    if (content.length <= SUMMARIZE_AT_CHARS) {
        return content;
    }

    // Check cache first for non-expandable summaries (backwards compatibility)
    const contentHash = crypto.createHash('sha256').update(content).digest('hex');
    const cacheKey = `${contentHash}-${prompt.substring(0, 50)}`;

    const cachedSummary = summaryCache.get(cacheKey);
    if (
        cachedSummary &&
        Date.now() - cachedSummary.timestamp < CACHE_EXPIRATION_MS &&
        !agent // Only use cache if we don't have an agent (backwards compatibility)
    ) {
        console.log(`Retrieved summary from cache for hash: ${contentHash.substring(0, 8)}...`);
        return cachedSummary.summary;
    }

    // If we have an agent, create expandable summaries
    if (agent) {
        return createExpandableSummary(content, prompt, agent);
    }

    // Fallback to original summarization logic
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

        const summaryAgent: AgentDefinition = {
            modelClass: 'summary',
            name: 'SummaryAgent',
        };

        let summary = '';
        for await (const event of ensembleRequest(messages, summaryAgent)) {
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

        // Cache the summary only if no agent was passed (backwards compatibility)
        if (!agent) {
            summaryCache.set(cacheKey, {
                summary: fullSummary,
                timestamp: Date.now(),
            });
        }

        return fullSummary;
    } catch (error) {
        console.error('Error creating summary:', error);
        // Fallback to intelligent truncation
        const truncated = truncate(content, MAX_RESULT_LENGTH);
        return truncated + '\n\n[Summary generation failed, output truncated]';
    }
}

/**
 * Create an expandable summary with persistent storage and tool injection
 */
async function createExpandableSummary(content: string, prompt: string, agent: AgentDefinition): Promise<string> {
    const summariesDir = './summaries';
    await ensureDir(summariesDir);

    // --- Persistent Summary Logic ---
    const hashMapPath = path.join(summariesDir, HASH_MAP_FILENAME);
    const documentHash = crypto.createHash('sha256').update(content).digest('hex');
    const hashMap = await loadHashMap(hashMapPath);

    if (hashMap[documentHash]) {
        const summaryId = hashMap[documentHash];
        const summaryFilePath = path.join(summariesDir, `summary-${summaryId}.txt`);
        const originalFilePath = path.join(summariesDir, `original-${summaryId}.txt`);

        try {
            // Read existing summary and original document
            const [existingSummary, originalDoc] = await Promise.all([
                fs.readFile(summaryFilePath, 'utf-8'),
                fs.readFile(originalFilePath, 'utf-8'),
            ]);

            const originalLines = originalDoc.split('\n').length;
            const summaryLines = existingSummary.split('\n').length;
            const originalChars = originalDoc.length;
            const summaryChars = existingSummary.length;

            console.log(`Retrieved expandable summary from cache for hash: ${documentHash.substring(0, 8)}...`);

            // Ensure agent has summary tools and get the final metadata
            await injectSummaryTools(agent);
            const metadata = `\n\nSummarized large output to avoid excessive tokens (${originalLines} -> ${summaryLines} lines, ${originalChars} -> ${summaryChars} chars) [Write to file with write_source(${summaryId}, file_path) or read with read_source(${summaryId}, line_start, line_end)]`;

            return existingSummary.trim() + metadata;
        } catch (error) {
            console.error(`Error reading cached summary files for ID ${summaryId}:`, error);
            // If reading fails, proceed to generate a new summary, removing the broken entry
            delete hashMap[documentHash];
            await saveHashMap(hashMapPath, hashMap);
        }
    }

    // Document not found in persistent cache, generate new summary
    const originalDocumentForSave = content;
    const originalLines = originalDocumentForSave.split('\n').length;

    // Truncate if it's too long
    const truncatedContent = truncate(content, SUMMARIZE_TRUNCATE_CHARS);

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
                content: truncatedContent,
            },
        ];

        const summaryAgent: AgentDefinition = {
            modelClass: 'summary',
            name: 'SummaryAgent',
        };

        let summary = '';
        for await (const event of ensembleRequest(messages, summaryAgent)) {
            if (event.type === 'message_complete' && 'content' in event) {
                summary += event.content;
            }
        }

        if (!summary) {
            throw new Error('No summary generated');
        }

        const trimmedSummary = summary.trim();
        const summaryLines = trimmedSummary.split('\n').length;

        // --- Save new summary and update hash map ---
        const newSummaryId = crypto.randomUUID();
        const summaryFilePath = path.join(summariesDir, `summary-${newSummaryId}.txt`);
        const originalFilePath = path.join(summariesDir, `original-${newSummaryId}.txt`);

        try {
            await Promise.all([
                fs.writeFile(summaryFilePath, trimmedSummary, 'utf-8'),
                fs.writeFile(originalFilePath, originalDocumentForSave, 'utf-8'),
            ]);

            // Update and save the hash map
            hashMap[documentHash] = newSummaryId;
            await saveHashMap(hashMapPath, hashMap);
            console.log(
                `Saved new expandable summary with ID: ${newSummaryId} for hash: ${documentHash.substring(0, 8)}...`
            );
        } catch (error) {
            console.error(`Error saving new summary files for ID ${newSummaryId}:`, error);
            // Log error but proceed, returning the summary without the metadata link if saving failed
            return trimmedSummary;
        }

        const originalChars = originalDocumentForSave.length;
        const summaryChars = trimmedSummary.length;

        // Ensure agent has summary tools and get the final metadata
        await injectSummaryTools(agent);
        const metadata = `\n\nSummarized large output to avoid excessive tokens (${originalLines} -> ${summaryLines} lines, ${originalChars} -> ${summaryChars} chars) [Write to file with write_source(${newSummaryId}, file_path) or read with read_source(${newSummaryId}, line_start, line_end)]`;

        return trimmedSummary + metadata;
    } catch (error) {
        console.error('Error creating expandable summary:', error);
        // Fallback to intelligent truncation
        const truncated = truncate(content, MAX_RESULT_LENGTH);
        return truncated + '\n\n[Summary generation failed, output truncated]';
    }
}

/**
 * Inject summary tools into an agent if not already present
 */
async function injectSummaryTools(agent: AgentDefinition): Promise<void> {
    const agentId = agent.agent_id || 'unknown';

    // Skip if already injected
    if (agentsWithSummaryTools.has(agentId)) {
        return;
    }

    // Create summary tools
    const { getSummaryTools } = await import('./summary_utils.js');
    const summaryTools = getSummaryTools();

    // Initialize tools array if it doesn't exist
    if (!agent.tools) {
        agent.tools = [];
    }

    // Check if tools already exist
    const hasReadSource = agent.tools.some(tool => tool.definition.function.name === 'read_source');
    const hasWriteSource = agent.tools.some(tool => tool.definition.function.name === 'write_source');

    // Add missing tools
    if (!hasReadSource) {
        agent.tools.push(summaryTools[0]); // read_source
    }
    if (!hasWriteSource) {
        agent.tools.push(summaryTools[1]); // write_source
    }

    // Mark as injected
    agentsWithSummaryTools.add(agentId);

    console.log(`Injected summary tools into agent ${agentId}`);
}

/**
 * Process tool result with summarization and truncation, with automatic tool injection for expandable summaries
 */
export async function processToolResult(
    toolCall: ToolCall,
    rawResult: string,
    agent?: AgentDefinition,
    allowSummary?: boolean
): Promise<string> {
    const toolName = toolCall.function.name;
    const config = TOOL_CONFIGS[toolName] || {};

    // Check if result is an image
    if (rawResult.startsWith('data:image/')) {
        return rawResult; // Return images as-is
    }

    // Check if we should skip summarization
    const skipSummarization =
        config.skipSummarization || SKIP_SUMMARIZATION_TOOLS.has(toolName) || allowSummary === false;

    // When allowSummary is false, use a much larger limit (50k chars) to preserve raw content
    const maxLength = allowSummary === false ? 50000 : config.maxLength || MAX_RESULT_LENGTH;

    // For tools that skip summarization, use intelligent truncation
    if (skipSummarization) {
        if (rawResult.length > maxLength) {
            const truncatedResult = truncate(rawResult, maxLength);
            const truncationMessage =
                config.truncationMessage || `\n\n[Output truncated: ${rawResult.length} → ${maxLength} chars]`;
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
    let summaryPrompt = `The following is the output of a tool call \`${toolName}(${
        toolCall.function.arguments
    })\` used by an AI agent in an autonomous system. Focus on summarizing both the overall output and the final result of the tool. Your summary will be used to understand what the result of the tool call was.`;

    if (potentialIssues.isLikelyFailing) {
        summaryPrompt += ` Note: The output appears to contain errors or issues. Please highlight any errors, failures, or problems in your summary.`;
    }

    // Pass agent to createSummary to enable expandable summaries
    const summary = await createSummary(rawResult, summaryPrompt, agent);

    // Add warning if issues were detected
    if (potentialIssues.isLikelyFailing && potentialIssues.issues.length > 0) {
        return summary + `\n\n⚠️ Potential issues detected: ${potentialIssues.issues.join(', ')}`;
    }

    return summary;
}

/**
 * Check if a tool result should be summarized
 */
export function shouldSummarizeResult(toolName: string, resultLength: number): boolean {
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
    return config.truncationMessage || `... Output truncated to ${config.maxLength || MAX_RESULT_LENGTH} characters`;
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
    const isLikelyFailing = retryCount > MAX_RETRIES || errorFrequency > ERROR_FREQUENCY_THRESHOLD;

    if (retryCount > MAX_RETRIES) {
        issues.push(`excessive retries (${retryCount})`);
    }

    if (errorFrequency > ERROR_FREQUENCY_THRESHOLD) {
        issues.push(`high error frequency (${(errorFrequency * 100).toFixed(1)}%)`);
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
