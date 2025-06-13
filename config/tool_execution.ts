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
    'inspect_running_tool',
    'wait_for_running_tool',
    'terminate_running_tool',
    'start_task',
    'send_message',
    'get_task_status',
    'check_all_task_health',
    'wait_for_running_task',
    'read_source',
    'write_source',
    'read_file',
    'write_file',
    'list_directory',
]);

/**
 * Tools that enable background status tracking for timeouts
 */
export const STATUS_TRACKING_TOOLS = new Set([
    'get_running_tools',
    'wait_for_running_tool',
    'get_tool_status',
]);

/**
 * Maximum length for tool results before summarization
 * This is used as a fallback for truncation when summarization fails
 */
export const MAX_RESULT_LENGTH = 5000;

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
        maxLength: 10000,
        truncationMessage:
            '\n\n[Full output truncated: Use write_source(summary_id, file_path) to write full output to a file.]',
    },
    get_page_content: {
        skipSummarization: true,
        maxLength: 10000,
    },
    read_file: {
        skipSummarization: true,
        maxLength: 10000,
    },
    // Tools that should summarize more aggressively
    run_shell_command: {
        maxLength: 5000,
    },
    execute_code: {
        maxLength: 5000,
    },
    debug_code: {
        maxLength: 5000,
    },
};
