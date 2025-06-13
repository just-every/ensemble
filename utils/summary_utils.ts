/**
 * Utility functions for summarizing content and managing expandable summaries
 */
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { ToolFunction } from '../types/types.js';
import { createToolFunction } from './create_tool_function.js';

const SUMMARIZE_AT_CHARS = 5000; // Below this length, we don't summarize
const SUMMARIZE_TRUNCATE_CHARS = 200000; // Above this length, we truncate before summarizing

// Constants for persistent summaries
const HASH_MAP_FILENAME = 'summary_hash_map.json';

// --- Helper functions for hash map ---
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
            // File doesn't exist, return empty map
            return {};
        }
        console.error(
            `Error loading summary hash map from ${file_path}:`,
            error
        );
        // In case of other errors, return empty map to avoid blocking
        return {};
    }
}

async function saveHashMap(
    file_path: string,
    map: SummaryHashMap
): Promise<void> {
    try {
        const data = JSON.stringify(map, null, 2);
        await fs.writeFile(file_path, data, 'utf-8');
    } catch (error) {
        console.error(`Error saving summary hash map to ${file_path}:`, error);
        // Log error but don't throw, as failing to save the map shouldn't stop the summary process
    }
}

function truncate(
    text: string,
    length: number = SUMMARIZE_TRUNCATE_CHARS,
    separator: string = '\n\n...[truncated for summary]...\n\n'
): string {
    text = text.trim();
    if (text.length <= length) {
        return text;
    }
    return (
        text.substring(0, length * 0.3) +
        separator +
        text.substring(text.length - length * 0.7 + separator.length)
    );
}

/**
 * Create a summary of a document with optional persistent caching and expandable references.
 * If the agent has write_source and read_source tools, the summary will include references
 * for expanding the content.
 *
 * @param document The content to summarize
 * @param context Context for the summary (used by the summarization agent)
 * @param summaryFn Function to generate the summary (should take document and context)
 * @param includeExpansionReferences Whether to include expansion references in the summary
 * @param summariesDir Optional directory to store summaries (defaults to './summaries')
 * @returns The summary with optional expansion references
 */
export async function createSummary(
    document: string,
    context: string,
    summaryFn: (document: string, context: string) => Promise<string>,
    includeExpansionReferences: boolean = false,
    summariesDir?: string
): Promise<string> {
    if (document.length <= SUMMARIZE_AT_CHARS) {
        return document;
    }

    // Default summaries directory
    const finalSummariesDir = summariesDir || './summaries';
    await ensureDir(finalSummariesDir);

    // --- Persistent Summary Logic ---
    const hashMapPath = path.join(finalSummariesDir, HASH_MAP_FILENAME);
    const documentHash = crypto
        .createHash('sha256')
        .update(document)
        .digest('hex');
    const hashMap = await loadHashMap(hashMapPath);

    if (hashMap[documentHash]) {
        const summaryId = hashMap[documentHash];
        const summaryFilePath = path.join(
            finalSummariesDir,
            `summary-${summaryId}.txt`
        );
        const originalFilePath = path.join(
            finalSummariesDir,
            `original-${summaryId}.txt`
        );

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

            const metadata = includeExpansionReferences
                ? `\n\nSummarized large output to avoid excessive tokens (${originalLines} -> ${summaryLines} lines, ${originalChars} -> ${summaryChars} chars) [Write to file with write_source(${summaryId}, file_path) or read with read_source(${summaryId}, line_start, line_end)]`
                : `\n\nSummarized large output to avoid excessive tokens (${originalLines} -> ${summaryLines} lines, ${originalChars} -> ${summaryChars} chars)`;

            console.log(
                `Retrieved summary from cache for hash: ${documentHash.substring(0, 8)}...`
            );
            return existingSummary.trim() + metadata;
        } catch (error) {
            console.error(
                `Error reading cached summary files for ID ${summaryId}:`,
                error
            );
            // If reading fails, proceed to generate a new summary, removing the broken entry
            delete hashMap[documentHash];
            await saveHashMap(hashMapPath, hashMap);
        }
    }
    // --- End Persistent Summary Check ---

    // Document not found in persistent cache, generate new summary
    const originalDocumentForSave = document; // Keep original before truncation
    const originalLines = originalDocumentForSave.split('\n').length;

    // Truncate if it's too long
    document = truncate(document);

    // Generate the summary using the provided function
    const summary = await summaryFn(document, context);
    const trimmedSummary = summary.trim();
    const summaryLines = trimmedSummary.split('\n').length;

    // --- Save new summary and update hash map ---
    const newSummaryId = crypto.randomUUID();
    const summaryFilePath = path.join(
        finalSummariesDir,
        `summary-${newSummaryId}.txt`
    );
    const originalFilePath = path.join(
        finalSummariesDir,
        `original-${newSummaryId}.txt`
    );

    try {
        await Promise.all([
            fs.writeFile(summaryFilePath, trimmedSummary, 'utf-8'),
            fs.writeFile(originalFilePath, originalDocumentForSave, 'utf-8'),
        ]);

        // Update and save the hash map
        hashMap[documentHash] = newSummaryId;
        await saveHashMap(hashMapPath, hashMap);
        console.log(
            `Saved new summary with ID: ${newSummaryId} for hash: ${documentHash.substring(0, 8)}...`
        );
    } catch (error) {
        console.error(
            `Error saving new summary files for ID ${newSummaryId}:`,
            error
        );
        // Log error but proceed, returning the summary without the metadata link if saving failed
        return trimmedSummary;
    }
    // --- End Save Logic ---

    const originalChars = originalDocumentForSave.length;
    const summaryChars = trimmedSummary.length;

    const metadata = includeExpansionReferences
        ? `\n\nSummarized large output to avoid excessive tokens (${originalLines} -> ${summaryLines} lines, ${originalChars} -> ${summaryChars} chars) [Write to file with write_source(${newSummaryId}, file_path) or read with read_source(${newSummaryId}, line_start, line_end)]`
        : `\n\nSummarized large output to avoid excessive tokens (${originalLines} -> ${summaryLines} lines, ${originalChars} -> ${summaryChars} chars)`;

    return trimmedSummary + metadata;
}

/**
 * Retrieves the original document content associated with a summary ID.
 * Can optionally return a specific range of lines.
 *
 * @param summary_id The unique ID of the summary.
 * @param line_start Optional. The starting line number (0-based).
 * @param line_end Optional. The ending line number (0-based).
 * @param summariesDir Optional directory where summaries are stored (defaults to './summaries')
 * @returns The requested content of the original document or an error message.
 */
export async function read_source(
    summary_id: string,
    line_start?: number,
    line_end?: number,
    summariesDir?: string
): Promise<string> {
    const finalSummariesDir = summariesDir || './summaries';
    const originalFilePath = path.join(
        finalSummariesDir,
        `original-${summary_id}.txt`
    );

    try {
        let content = await fs.readFile(originalFilePath, 'utf-8');

        if (line_start !== undefined && line_end !== undefined) {
            const lines = content.split('\n');
            // Ensure start/end are within bounds
            const start = Math.max(0, line_start);
            const end = Math.min(lines.length, line_end + 1);

            if (start >= end || start >= lines.length) {
                return `Error: Invalid line range requested (${line_start}-${line_end}) for document with ${lines.length} lines.`;
            }
            content = lines.slice(start, end).join('\n');
        }

        return content;
    } catch (error: any) {
        if (error.code === 'ENOENT') {
            return `Error: Original document for summary ID '${summary_id}' not found at ${originalFilePath}.`;
        }
        console.error(
            `Error reading original summary source for ID ${summary_id}:`,
            error
        );
        return `Error: Could not retrieve original document for summary ID '${summary_id}'.`;
    }
}

/**
 * Write the original document content associated with a summary ID to a file.
 *
 * @param summary_id The unique ID of the summary.
 * @param file_path Path to write the content to a file.
 * @param summariesDir Optional directory where summaries are stored (defaults to './summaries')
 * @returns Confirmation or an error message.
 */
export async function write_source(
    summary_id: string,
    file_path: string,
    summariesDir?: string
): Promise<string> {
    const finalSummariesDir = summariesDir || './summaries';
    const originalFilePath = path.join(
        finalSummariesDir,
        `original-${summary_id}.txt`
    );

    try {
        const content = await fs.readFile(originalFilePath, 'utf-8');
        if (!file_path) {
            return 'Error: file_path is required.';
        }
        try {
            // Create directory if it doesn't exist
            const directory = path.dirname(file_path);
            await fs.mkdir(directory, { recursive: true });

            // Write the content to the file
            await fs.writeFile(file_path, content, 'utf-8');
            console.log(`Summary written to file: ${file_path}`);
            return `Successfully wrote ${content.length} chars to file: ${file_path}\n\nStart of content:\n\n${content.substring(0, 400)}...`;
        } catch (writeError) {
            console.error(
                `Error writing summary to file ${file_path}:`,
                writeError
            );
            return `Error: Could not write summary to file ${file_path}.`;
        }
    } catch (error: any) {
        if (error.code === 'ENOENT') {
            return `Error: Original document for summary ID '${summary_id}' not found at ${originalFilePath}.`;
        }
        console.error(
            `Error reading original summary source for ID ${summary_id}:`,
            error
        );
        return `Error: Could not retrieve original document for summary ID '${summary_id}'.`;
    }
}

/**
 * Get all summary tools as an array of tool definitions.
 * These tools allow agents to expand summarized content.
 *
 * @param summariesDir Optional directory where summaries are stored (defaults to './summaries')
 * @returns Array of ToolFunction definitions for read_source and write_source
 */
export function getSummaryTools(summariesDir?: string): ToolFunction[] {
    const readSourceWrapper = async (
        summary_id: string,
        line_start?: number,
        line_end?: number
    ) => {
        return read_source(summary_id, line_start, line_end, summariesDir);
    };

    const writeSourceWrapper = async (
        summary_id: string,
        file_path: string
    ) => {
        return write_source(summary_id, file_path, summariesDir);
    };

    return [
        createToolFunction(
            readSourceWrapper,
            'Read the original (not summarized) document content. If possible, limit lines to limit tokens returned. Results will be truncated to 1000 characters - for larger files, use write_source.',
            {
                summary_id: {
                    type: 'string',
                    description: 'The unique ID of the summary.',
                },
                line_start: {
                    type: 'number',
                    description:
                        'Starting line to retrieve (0-based). Optional.',
                    optional: true,
                },
                line_end: {
                    type: 'number',
                    description: 'Ending line to retrieve (0-based). Optional.',
                    optional: true,
                },
            }
        ),
        createToolFunction(
            writeSourceWrapper,
            'Write the original (not summarized) document to a file.',
            {
                summary_id: {
                    type: 'string',
                    description: 'The unique ID of the summary.',
                },
                file_path: {
                    type: 'string',
                    description:
                        'Relative or absolute path to write the document to.',
                },
            }
        ),
    ];
}

/**
 * Helper function to check if an agent has the required tools for expandable summaries
 *
 * @param toolNames Array of tool names that are available to the agent
 * @returns true if the agent has both write_source and read_source tools
 */
export function hasExpansionTools(toolNames: string[]): boolean {
    return (
        toolNames.includes('write_source') && toolNames.includes('read_source')
    );
}
