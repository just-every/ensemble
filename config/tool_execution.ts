/**
 * Tool Execution Configuration
 */

/**
 * Default timeout for tool execution in milliseconds
 */
export const FUNCTION_TIMEOUT_MS = 30000; // 30 seconds

/**
 * Tools that are excluded from timeout
 */
export const EXCLUDED_FROM_TIMEOUT_FUNCTIONS = new Set([
    'wait_for_running_tool',
    'run_shell_command_with_output',
    'execute_code',
    'debug_code',
    'test_code',
]);

/**
 * Maximum length for tool results before summarization
 */
export const MAX_RESULT_LENGTH = 1000;

/**
 * Tools that skip summarization (but still get truncated)
 */
export const SKIP_SUMMARIZATION_TOOLS = new Set([
    'read_source',
    'get_page_content',
    'read_file',
    'list_files',
]);

/**
 * Configuration for tool-specific handling
 */
export interface ToolConfig {
    skipSummarization?: boolean;
    maxLength?: number;
    truncationMessage?: string;
}

export const TOOL_CONFIGS: Record<string, ToolConfig> = {
    read_source: {
        skipSummarization: true,
        maxLength: 1000,
        truncationMessage:
            '\n\n[Full output truncated: Use write_source(summary_id, file_path) to write full output to a file.]',
    },
    get_page_content: {
        skipSummarization: true,
        maxLength: 1000,
    },
    read_file: {
        skipSummarization: true,
        maxLength: 1000,
    },
};
