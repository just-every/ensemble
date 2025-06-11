/**
 * Claude model provider for the ensemble system.
 *
 * This module provides an implementation of the ModelProvider interface
 * for Anthropic's Claude models and handles streaming responses.
 */

import Anthropic from '@anthropic-ai/sdk';
import { v4 as uuidv4 } from 'uuid';
import {
    createCitationTracker,
    formatCitation,
    generateFootnotes,
} from '../utils/citation_tracker.js';

/**
 * Format web search results into a readable text format
 */
function formatWebSearchResults(results: any[]): string {
    if (!Array.isArray(results)) return '';
    return results
        .filter(r => r.type === 'web_search_result')
        .map((r, i) => `${i + 1}. ${r.title || 'Untitled'} – ${r.url}`)
        .join('\n');
}
import {
    ModelProvider,
    ToolFunction,
    ModelSettings,
    ProviderStreamEvent,
    ToolCall,
    ResponseInput,
    ResponseInputItem,
    AgentDefinition,
} from '../types/types.js';
import { costTracker } from '../index.js';
import {
    log_llm_error,
    log_llm_request,
    log_llm_response,
} from '../utils/llm_logger.js';
import { isPaused } from '../utils/pause_controller.js';
import { findModel, ModelClassID } from '../data/model_data.js';
import {
    appendMessageWithImage,
    resizeAndTruncateForClaude,
} from '../utils/image_utils.js';
import {
    DeltaBuffer,
    bufferDelta,
    flushBufferedDeltas,
} from '../utils/delta_buffer.js';

// Define mappings for thinking budget configurations
const THINKING_BUDGET_CONFIGS: Record<string, number> = {
    '-low': 0,
    '-medium': 8000,
    '-high': 15000,
    '-max': 30000,
};

// Content has many forms... here we extract them all!
function contentToString(content: any) {
    if (content) {
        if (Array.isArray(content)) {
            let results = '';
            for (const eachContent of content) {
                const convertedContent = contentToString(eachContent);
                if (convertedContent.length > 0) {
                    if (results.length > 0) {
                        results += '\n\n';
                    }
                    results += convertedContent;
                }
            }
            return results.trim();
        } else if (typeof content === 'string') {
            return content.trim();
        } else if (typeof content.text === 'string') {
            return content.text.trim();
        }
        return JSON.stringify(content);
    }
    return '';
}

/**
 * Resolves any async enum values in tool parameters
 */
async function resolveAsyncEnums(params: any): Promise<any> {
    if (!params || typeof params !== 'object') {
        return params;
    }

    const resolved = { ...params };

    // Process properties recursively
    if (resolved.properties) {
        const resolvedProps: any = {};
        for (const [key, value] of Object.entries(resolved.properties)) {
            if (value && typeof value === 'object') {
                const propCopy = { ...value } as any;

                // Check if enum is a function (async or sync)
                if (typeof propCopy.enum === 'function') {
                    try {
                        const enumValue = await propCopy.enum();
                        // Only set if we got a valid array back
                        if (Array.isArray(enumValue) && enumValue.length > 0) {
                            propCopy.enum = enumValue;
                        } else {
                            // Remove empty enum to avoid validation errors
                            delete propCopy.enum;
                        }
                    } catch {
                        // If enum resolution fails, remove it
                        delete propCopy.enum;
                    }
                }

                // Recursively process nested properties
                resolvedProps[key] = await resolveAsyncEnums(propCopy);
            } else {
                resolvedProps[key] = value;
            }
        }
        resolved.properties = resolvedProps;
    }

    return resolved;
}

// Convert our tool definition to Claude's format
async function convertToClaudeTools(tools: ToolFunction[]): Promise<any[]> {
    return await Promise.all(
        tools.map(async tool => {
            // Special handling for web search tool
            if (tool.definition.function.name === 'claude_web_search') {
                return {
                    type: 'web_search_20250305',
                    name: 'web_search',
                };
            }

            // Standard tool handling for other tools
            return {
                // Directly map the properties to the top level
                name: tool.definition.function.name,
                description: tool.definition.function.description,
                // Resolve async enums and map 'parameters' to 'input_schema' for Claude
                input_schema: await resolveAsyncEnums(
                    tool.definition.function.parameters
                ),
            };
        })
    );
}

// Assuming ResponseInputItem is your internal message structure type
// Assuming ClaudeMessage is the structure Anthropic expects (or null)
type ClaudeMessage = {
    role: 'user' | 'assistant' | 'system';
    content: any;
} | null; // Simplified type

/**
 * Helper function to determine image media type from base64 data
 */
function getImageMediaType(imageData: string): string {
    if (imageData.includes('data:image/jpeg')) return 'image/jpeg';
    if (imageData.includes('data:image/png')) return 'image/png';
    if (imageData.includes('data:image/gif')) return 'image/gif';
    if (imageData.includes('data:image/webp')) return 'image/webp';
    // Default to jpeg if no specific type found
    return 'image/jpeg';
}

/**
 * Helper function to clean base64 data by removing the prefix
 */
function cleanBase64Data(imageData: string): string {
    return imageData.replace(/^data:image\/[a-z]+;base64,/, '');
}

/**
 * Processes images and adds them to the input array for OpenAI
 * Resizes images to max 1024px width and splits into sections if height > 768px
 *
 * @param input - The input array to add images to
 * @param images - Record of image IDs to base64 image data
 * @param source - Description of where the images came from
 * @returns Updated input array with processed images
 */
async function addImagesToInput(
    input: any[],
    images: Record<string, string>
): Promise<any[]> {
    // Add developer messages for each image
    for (const [, imageData] of Object.entries(images)) {
        // Resize and split the image if needed
        const processedImageData = await resizeAndTruncateForClaude(imageData);
        const mediaType = getImageMediaType(processedImageData);
        const cleanedImageData = cleanBase64Data(processedImageData);

        // Add image block
        input.push({
            type: 'image',
            source: {
                type: 'base64',
                media_type: mediaType,
                data: cleanedImageData,
            },
        });
    }
    return input;
}

/**
 * Converts a custom ResponseInputItem into Anthropic Claude's message format.
 * Handles text messages, tool use requests (function calls), and tool results (function outputs).
 *
 * @param role The original role associated with the message ('user', 'assistant', 'system').
 * @param content The text content, primarily for non-tool messages.
 * @param msg The detailed message object (ResponseInputItem).
 * @returns A Claude message object or null if conversion is not applicable (e.g., system message, empty content).
 */
async function convertToClaudeMessage(
    model: string,
    role: string,
    content: string,
    msg: ResponseInputItem,
    result?: any[]
): Promise<ClaudeMessage> {
    if (!msg) return null;

    // --- Handle Tool Use (Function Call) ---
    if (msg.type === 'function_call') {
        let inputArgs: Record<string, unknown> = {};
        try {
            // Claude expects 'input' as an object
            const argsString = msg.arguments || '{}';

            // Handle concatenated JSON objects (malformed arguments)
            if (argsString.includes('}{')) {
                console.warn(
                    `Malformed concatenated JSON arguments for ${msg.name}: ${argsString}`
                );
                // Try to extract the first valid JSON object
                const firstBraceIndex = argsString.indexOf('{');
                const firstCloseBraceIndex = argsString.indexOf('}') + 1;
                if (
                    firstBraceIndex !== -1 &&
                    firstCloseBraceIndex > firstBraceIndex
                ) {
                    const firstJsonStr = argsString.substring(
                        firstBraceIndex,
                        firstCloseBraceIndex
                    );
                    try {
                        inputArgs = JSON.parse(firstJsonStr);
                        console.log(
                            `Successfully extracted first JSON object: ${firstJsonStr}`
                        );
                    } catch (innerE) {
                        console.error(
                            `Failed to parse extracted JSON: ${firstJsonStr}`,
                            innerE
                        );
                        inputArgs = {};
                    }
                } else {
                    inputArgs = {};
                }
            } else {
                inputArgs = JSON.parse(argsString);
            }
        } catch (e) {
            console.error(
                `Error parsing function call arguments for ${msg.name}: ${msg.arguments}`,
                e
            );
            // Try to provide a meaningful fallback based on the content
            inputArgs = {};
        }

        const toolUseBlock = {
            type: 'tool_use',
            id: msg.call_id, // Use the consistent ID field
            name: msg.name,
            input: inputArgs,
        };

        return { role: 'assistant', content: [toolUseBlock] };
    } else if (msg.type === 'function_call_output') {
        // Check if output contains a base64 image
        const toolResultBlock = {
            type: 'tool_result',
            tool_use_id: msg.call_id, // ID must match the corresponding tool_use block
            content: msg.output || '', // Default to empty string if output is missing
            ...(msg.status === 'incomplete' ? { is_error: true } : {}),
        };

        let contentBlocks = [];
        contentBlocks = await appendMessageWithImage(
            model,
            contentBlocks,
            toolResultBlock,
            'content',
            addImagesToInput
        );

        // Anthropic expects role: 'user' for tool_result
        return { role: 'user', content: contentBlocks };
    } else if (msg.type === 'thinking') {
        if (!content) {
            return null; // Can't process thinking without content
        }

        if ('signature' in msg && msg.signature) {
            // Return a thinking message with the content and signature
            return {
                role: 'assistant',
                content: [
                    {
                        type: 'thinking',
                        thinking: content.trim(),
                        signature: msg.signature,
                    },
                ],
            };
        }
        return { role: 'assistant', content: 'Thinking: ' + content.trim() };
    } else {
        // Skip messages with no actual text content
        if (!content) {
            return null; // Skip messages with no text content
        }

        let messageRole: 'assistant' | 'user' | 'system' | 'developer' =
            role as 'assistant' | 'user' | 'system' | 'developer';
        if (messageRole === 'developer') {
            if (!result?.length) {
                messageRole = 'system';
            } else {
                messageRole = 'user';
            }
        }
        if (!['user', 'assistant', 'system'].includes(messageRole)) {
            messageRole = 'user';
        }

        let contentBlocks = [];
        contentBlocks = await appendMessageWithImage(
            model,
            contentBlocks,
            {
                type: 'text',
                text: content,
            },
            'text',
            addImagesToInput
        );
        return {
            role: messageRole,
            content: contentBlocks,
        };
    }
}

/**
 * Claude model provider implementation
 */
export class ClaudeProvider implements ModelProvider {
    private _client?: Anthropic;
    private apiKey?: string;

    constructor(apiKey?: string) {
        // Store the API key for lazy initialization
        this.apiKey = apiKey || process.env.ANTHROPIC_API_KEY;
    }

    /**
     * Lazily initialize the Anthropic client when first accessed
     */
    private get client(): Anthropic {
        if (!this._client) {
            if (!this.apiKey) {
                throw new Error(
                    'Failed to initialize Claude client. Make sure ANTHROPIC_API_KEY is set.'
                );
            }
            this._client = new Anthropic({
                apiKey: this.apiKey,
            });
        }
        return this._client;
    }

    /**
     * Combined preprocessing (image conversion) and Claude-specific mapping in a single pass.
     *
     * @param messages The original conversation history.
     * @param modelId  The Claude model identifier (used to decide image handling).
     * @returns Array of Claude-ready messages.
     */
    private async prepareClaudeMessages(
        messages: ResponseInput,
        modelId: string
    ): Promise<ClaudeMessage[]> {
        const result: ClaudeMessage[] = [];
        const seenToolUseIds = new Set<string>(); // Track tool_use IDs to prevent duplicates

        for (const msg of messages) {
            const role =
                'role' in msg && msg.role !== 'developer' ? msg.role : 'system';

            let content = '';
            if ('content' in msg) {
                content = contentToString(msg.content);
            }

            const structuredMsg = await convertToClaudeMessage(
                modelId,
                role,
                content,
                msg,
                result
            );
            if (structuredMsg) {
                // Check for duplicate tool_use IDs before adding
                if (
                    structuredMsg.role === 'assistant' &&
                    Array.isArray(structuredMsg.content)
                ) {
                    let hasDuplicateToolUse = false;
                    for (const contentBlock of structuredMsg.content) {
                        if (contentBlock.type === 'tool_use') {
                            if (seenToolUseIds.has(contentBlock.id)) {
                                console.warn(
                                    `Skipping duplicate tool_use ID: ${contentBlock.id}`
                                );
                                hasDuplicateToolUse = true;
                                break;
                            } else {
                                seenToolUseIds.add(contentBlock.id);
                            }
                        }
                    }
                    // Only add the message if it doesn't contain duplicate tool_use IDs
                    if (!hasDuplicateToolUse) {
                        result.push(structuredMsg);
                    }
                } else {
                    result.push(structuredMsg);
                }
            }
            /* ---------- End Claude message build ---------- */
        }

        return result;
    }

    /**
     * Create a streaming completion using Claude's API
     */
    async *createResponseStream(
        messages: ResponseInput,
        model: string,
        agent: AgentDefinition
    ): AsyncGenerator<ProviderStreamEvent> {
        // --- Usage Accumulators ---
        let totalInputTokens = 0;
        let totalOutputTokens = 0;
        let totalCacheCreationInputTokens = 0;
        let totalCacheReadInputTokens = 0;
        let streamCompletedSuccessfully = false; // Flag to track successful stream completion
        let messageCompleteYielded = false; // Flag to track if message_complete was yielded
        let requestId: string | undefined;

        try {
            const { getToolsFromAgent } = await import('../utils/agent.js');
            const tools: ToolFunction[] | undefined = agent
                ? await getToolsFromAgent(agent)
                : [];
            const settings: ModelSettings | undefined = agent?.modelSettings;

            // Enable interleaved thinking where possible
            let headers = undefined;
            if (
                model.startsWith('claude-sonnet-4') ||
                model.startsWith('claude-opus-4')
            ) {
                headers = {
                    'anthropic-beta': 'interleaved-thinking-2025-05-14',
                };
            }

            // Enable thinking if specified for the model
            let thinking = undefined;
            let thinkingSet = false;
            for (const [suffix, budget] of Object.entries(
                THINKING_BUDGET_CONFIGS
            )) {
                if (model.endsWith(suffix)) {
                    thinkingSet = true;
                    if (budget > 0) {
                        thinking = {
                            type: 'enabled',
                            budget_tokens: budget,
                        };
                    }
                    model = model.slice(0, -suffix.length);
                    break;
                }
            }

            // Set max tokens based on settings or model
            const modelData = findModel(model);
            let max_tokens =
                settings?.max_tokens ||
                modelData?.features?.max_output_tokens ||
                8192;
            // Ensure we don't go over the limit if using settings
            if (modelData?.features?.max_output_tokens) {
                max_tokens = Math.min(
                    max_tokens,
                    modelData.features.max_output_tokens
                );
            }

            if (
                !thinkingSet &&
                (model.startsWith('claude-sonnet-4') ||
                    model.startsWith('claude-opus-4') ||
                    model.startsWith('claude-3-7-sonnet'))
            ) {
                // Default extended thinking
                thinking = {
                    type: 'enabled',
                    budget_tokens: 8000,
                };
            }

            if (settings?.json_schema) {
                messages.push({
                    type: 'message',
                    role: 'system',
                    content: `Your response MUST be a valid JSON object that conforms to this schema:\n${JSON.stringify(settings.json_schema, null, 2)}`,
                });
            }

            // Preprocess *and* convert messages for Claude in one pass
            const claudeMessages = await this.prepareClaudeMessages(
                messages,
                model
            );

            // Ensure content is a string. Handle cases where content might be structured differently or missing.
            const systemPrompt = claudeMessages.reduce((acc, msg): string => {
                if (msg.role === 'system' && msg.content) {
                    if (acc.length > 0) {
                        acc += '\n\n';
                    }
                    acc += contentToString(msg.content);
                }
                return acc;
            }, '');

            // Format the request according to Claude API specifications
            const requestParams: any = {
                model: model,
                // Filter for only user and assistant messages for the 'messages' array
                messages: claudeMessages.filter(
                    m => m.role === 'user' || m.role === 'assistant'
                ),
                // Add system prompt string if it exists
                ...(systemPrompt ? { system: systemPrompt.trim() } : {}),
                stream: true,
                max_tokens,
                ...(thinking ? { thinking } : {}),
                ...(settings?.temperature !== undefined
                    ? { temperature: settings.temperature }
                    : {}),
            };

            // Add tools if provided, using the corrected conversion function
            if (tools && tools.length > 0) {
                requestParams.tools = await convertToClaudeTools(tools); // Uses the corrected function
            }

            // --- Pre-flight Check: Ensure messages are not empty, add default if needed ---
            if (
                !requestParams.messages ||
                requestParams.messages.length === 0
            ) {
                console.warn(
                    'Claude API Warning: No user or assistant messages provided after filtering. Adding default message.'
                );
                // Add the default user message
                requestParams.messages = [
                    {
                        role: 'user',
                        content: "Let's think this through step by step.",
                    },
                ];
            }

            // Log the request and save the requestId for later response logging
            requestId = log_llm_request(
                agent.agent_id,
                'anthropic',
                model,
                requestParams,
                new Date()
            );

            // Track current tool call info
            let currentToolCall: any = null;
            let toolCallStarted = false; // Track if tool_start was emitted
            let accumulatedSignature = '';
            let accumulatedThinking = '';
            let accumulatedContent = ''; // To collect all content for final message_complete
            const messageId = uuidv4(); // Generate a unique ID for this message
            // Track delta positions for ordered message chunks
            let deltaPosition = 0;
            const deltaBuffers = new Map<string, DeltaBuffer>();
            // Citation tracking
            const citationTracker = createCitationTracker();

            // Wait while system is paused before making the API request
            const { waitWhilePaused } = await import(
                '../utils/pause_controller.js'
            );
            await waitWhilePaused(100, agent.abortSignal);

            // Make the API call
            const stream = await this.client.messages.create(requestParams, {
                ...(headers ? { headers } : {}),
            });

            const events: ProviderStreamEvent[] = [];
            try {
                // @ts-expect-error - Claude's stream is AsyncIterable but TypeScript might not recognize it properly
                for await (const event of stream) {
                    events.push(event); // Store events for logs

                    // Check if the system was paused during the stream
                    if (isPaused()) {
                        console.log(
                            `[Claude] System paused during stream for model ${model}. Waiting...`
                        );

                        // Wait while paused instead of aborting
                        await waitWhilePaused(100, agent.abortSignal);

                        // If we're resuming, continue processing
                        console.log(
                            `[Claude] System resumed, continuing stream for model ${model}`
                        );
                    }

                    // --- Accumulate Usage ---
                    // Check message_start for initial usage (often includes input tokens)
                    if (
                        event.type === 'message_start' &&
                        event.message?.usage
                    ) {
                        const usage = event.message.usage;
                        totalInputTokens += usage.input_tokens || 0;
                        totalOutputTokens += usage.output_tokens || 0; // Sometimes initial output tokens are here
                        totalCacheCreationInputTokens +=
                            usage.cache_creation_input_tokens || 0;
                        totalCacheReadInputTokens +=
                            usage.cache_read_input_tokens || 0;
                    }
                    // Check message_delta for incremental usage (often includes output tokens)
                    else if (event.type === 'message_delta' && event.usage) {
                        const usage = event.usage;
                        // Input tokens shouldn't change mid-stream, but check just in case
                        totalInputTokens += usage.input_tokens || 0;
                        totalOutputTokens += usage.output_tokens || 0;
                        totalCacheCreationInputTokens +=
                            usage.cache_creation_input_tokens || 0;
                        totalCacheReadInputTokens +=
                            usage.cache_read_input_tokens || 0;
                    }

                    // --- Handle Content and Tool Events ---
                    // Handle content block delta
                    if (event.type === 'content_block_delta') {
                        // Emit delta event for streaming UI updates with incrementing order
                        if (
                            event.delta.type === 'signature_delta' &&
                            event.delta.signature
                        ) {
                            accumulatedSignature += event.delta.signature;
                        } else if (
                            event.delta.type === 'thinking_delta' &&
                            event.delta.thinking
                        ) {
                            yield {
                                type: 'message_delta',
                                content: '',
                                thinking_content: event.delta.thinking,
                                message_id: messageId,
                                order: deltaPosition++,
                            };
                            accumulatedThinking += event.delta.thinking;
                        } else if (
                            event.delta.type === 'text_delta' &&
                            event.delta.text
                        ) {
                            for (const ev of bufferDelta(
                                deltaBuffers,
                                messageId,
                                event.delta.text,
                                content =>
                                    ({
                                        type: 'message_delta',
                                        content,
                                        message_id: messageId,
                                        order: deltaPosition++,
                                    }) as ProviderStreamEvent
                            )) {
                                yield ev;
                            }
                            accumulatedContent += event.delta.text;
                        } else if (
                            event.delta.type === 'input_json_delta' &&
                            currentToolCall &&
                            event.delta.partial_json
                        ) {
                            try {
                                // Accumulate partial JSON for proper reconstruction
                                if (
                                    !currentToolCall.function._partialArguments
                                ) {
                                    currentToolCall.function._partialArguments =
                                        '';
                                }
                                currentToolCall.function._partialArguments +=
                                    event.delta.partial_json;

                                // Only update arguments if we can validate it's proper JSON
                                // Don't update the main arguments field until we have complete JSON
                                // This prevents malformed concatenated JSON from being created

                                // Yielding tool_start repeatedly might be noisy; consider yielding tool_delta if needed
                                yield {
                                    type: 'tool_delta',
                                    tool_call: {
                                        ...currentToolCall,
                                        function: {
                                            ...currentToolCall.function,
                                            // Don't expose partial arguments that might be malformed
                                            arguments: '{}', // Placeholder until complete
                                        },
                                    } as ToolCall,
                                };
                            } catch (err) {
                                console.error(
                                    'Error processing tool_use delta (input_json_delta):',
                                    err,
                                    event
                                );
                            }
                        } else if (
                            event.delta.type === 'citations_delta' &&
                            event.delta.citation
                        ) {
                            // Format the citation and append a reference marker
                            const citationMarker = formatCitation(
                                citationTracker,
                                {
                                    title: event.delta.citation.title,
                                    url: event.delta.citation.url,
                                    citedText: event.delta.citation.cited_text,
                                }
                            );

                            // Yield the citation marker
                            yield {
                                type: 'message_delta',
                                content: citationMarker,
                                message_id: messageId,
                                order: deltaPosition++,
                            };
                            accumulatedContent += citationMarker;
                        }
                    }
                    // Handle content block start for text
                    else if (
                        event.type === 'content_block_start' &&
                        event.content_block?.type === 'text'
                    ) {
                        if (event.content_block.text) {
                            for (const ev of bufferDelta(
                                deltaBuffers,
                                messageId,
                                event.content_block.text,
                                content =>
                                    ({
                                        type: 'message_delta',
                                        content,
                                        message_id: messageId,
                                        order: deltaPosition++,
                                    }) as ProviderStreamEvent
                            )) {
                                yield ev;
                            }
                            accumulatedContent += event.content_block.text;
                        }
                    }
                    // Handle content block stop for text (less common for text deltas, but handle defensively)
                    else if (
                        event.type === 'content_block_stop' &&
                        event.content_block?.type === 'text'
                    ) {
                        // No specific action needed here usually if deltas are handled,
                        // but keep the structure in case API behavior changes.
                    }
                    // Handle web search tool results
                    else if (
                        event.type === 'content_block_start' &&
                        event.content_block?.type === 'web_search_tool_result'
                    ) {
                        if (event.content_block.content) {
                            // Format the web search results as a nicely formatted list
                            const formatted = formatWebSearchResults(
                                event.content_block.content
                            );
                            if (formatted) {
                                // Yield the formatted results
                                yield {
                                    type: 'message_delta',
                                    content:
                                        '\n\nSearch Results:\n' +
                                        formatted +
                                        '\n',
                                    message_id: messageId,
                                    order: deltaPosition++,
                                };
                                accumulatedContent +=
                                    '\n\nSearch Results:\n' + formatted + '\n';
                            }
                        }
                    }
                    // Handle tool use start
                    else if (
                        event.type === 'content_block_start' &&
                        event.content_block?.type === 'tool_use'
                    ) {
                        const toolUse = event.content_block;
                        const toolId =
                            toolUse.id ||
                            `call_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
                        const toolName = toolUse.name;
                        const toolInput =
                            toolUse.input !== undefined ? toolUse.input : {};
                        currentToolCall = {
                            id: toolId,
                            type: 'function',
                            function: {
                                name: toolName,
                                arguments:
                                    typeof toolInput === 'string'
                                        ? toolInput
                                        : JSON.stringify(toolInput),
                            },
                        };
                        toolCallStarted = false; // Reset flag for new tool
                    }
                    // Handle tool use stop
                    else if (
                        event.type === 'content_block_stop' &&
                        event.content_block?.type === 'tool_use' &&
                        currentToolCall
                    ) {
                        try {
                            // Finalize arguments if they were streamed partially
                            if (currentToolCall.function._partialArguments) {
                                // Validate that we have proper JSON before finalizing
                                const partialArgs =
                                    currentToolCall.function._partialArguments;
                                try {
                                    JSON.parse(partialArgs); // Validate JSON
                                    currentToolCall.function.arguments =
                                        partialArgs;
                                } catch (jsonError) {
                                    console.warn(
                                        `Invalid JSON in partial arguments for ${currentToolCall.function.name}: ${partialArgs}`,
                                        jsonError
                                    );
                                    // Try to extract the first valid JSON object if it's concatenated
                                    if (partialArgs.includes('}{')) {
                                        const firstBraceIndex =
                                            partialArgs.indexOf('{');
                                        const firstCloseBraceIndex =
                                            partialArgs.indexOf('}') + 1;
                                        if (
                                            firstBraceIndex !== -1 &&
                                            firstCloseBraceIndex >
                                                firstBraceIndex
                                        ) {
                                            const firstJsonStr =
                                                partialArgs.substring(
                                                    firstBraceIndex,
                                                    firstCloseBraceIndex
                                                );
                                            try {
                                                JSON.parse(firstJsonStr); // Validate extracted JSON
                                                currentToolCall.function.arguments =
                                                    firstJsonStr;
                                                console.log(
                                                    `Extracted valid JSON from partial arguments: ${firstJsonStr}`
                                                );
                                            } catch (extractError) {
                                                console.error(
                                                    `Failed to extract valid JSON: ${firstJsonStr}`,
                                                    extractError
                                                );
                                                currentToolCall.function.arguments =
                                                    '{}';
                                            }
                                        } else {
                                            currentToolCall.function.arguments =
                                                '{}';
                                        }
                                    } else {
                                        currentToolCall.function.arguments =
                                            '{}';
                                    }
                                }
                                delete currentToolCall.function
                                    ._partialArguments; // Clean up temporary field
                            }
                            yield {
                                type: 'tool_start',
                                tool_call: currentToolCall as ToolCall,
                            };
                            toolCallStarted = true; // Mark that tool_start was emitted
                        } catch (err) {
                            console.error(
                                'Error finalizing tool call:',
                                err,
                                event
                            );
                        } finally {
                            // Reset currentToolCall *after* potential final processing
                            currentToolCall = null;
                            // Do not reset toolCallStarted here - it needs to remain true
                            // to prevent duplicate tool_start emission at message_stop
                        }
                    }
                    // Handle message stop
                    else if (event.type === 'message_stop') {
                        // Check for any final usage info (less common here, but possible)
                        // Note: The example payload doesn't show usage here, but the Anthropic SDK might add it.
                        if (event['amazon-bedrock-invocationMetrics']) {
                            // Check for Bedrock specific metrics if applicable
                            const metrics =
                                event['amazon-bedrock-invocationMetrics'];
                            totalInputTokens += metrics.inputTokenCount || 0;
                            totalOutputTokens += metrics.outputTokenCount || 0;
                            // Add other Bedrock metrics if needed
                        } else if (event.usage) {
                            // Check standard usage object as a fallback
                            const usage = event.usage;
                            totalInputTokens += usage.input_tokens || 0;
                            totalOutputTokens += usage.output_tokens || 0;
                            totalCacheCreationInputTokens +=
                                usage.cache_creation_input_tokens || 0;
                            totalCacheReadInputTokens +=
                                usage.cache_read_input_tokens || 0;
                        }

                        // Complete any pending tool call (should ideally be handled by content_block_stop)
                        if (currentToolCall) {
                            // If a tool call is still active here, it means content_block_stop might not have fired correctly.
                            console.warn(
                                'Tool call was still active at message_stop:',
                                currentToolCall
                            );

                            // Only emit tool_start if we haven't already emitted it
                            if (!toolCallStarted) {
                                // Finalize arguments if they were streamed partially with proper JSON validation
                                if (
                                    currentToolCall.function._partialArguments
                                ) {
                                    const partialArgs =
                                        currentToolCall.function
                                            ._partialArguments;
                                    try {
                                        JSON.parse(partialArgs); // Validate JSON
                                        currentToolCall.function.arguments =
                                            partialArgs;
                                    } catch (jsonError) {
                                        console.warn(
                                            `Invalid JSON in partial arguments at message_stop for ${currentToolCall.function.name}: ${partialArgs}`,
                                            jsonError
                                        );
                                        // Try to extract the first valid JSON object if it's concatenated
                                        if (partialArgs.includes('}{')) {
                                            const firstBraceIndex =
                                                partialArgs.indexOf('{');
                                            const firstCloseBraceIndex =
                                                partialArgs.indexOf('}') + 1;
                                            if (
                                                firstBraceIndex !== -1 &&
                                                firstCloseBraceIndex >
                                                    firstBraceIndex
                                            ) {
                                                const firstJsonStr =
                                                    partialArgs.substring(
                                                        firstBraceIndex,
                                                        firstCloseBraceIndex
                                                    );
                                                try {
                                                    JSON.parse(firstJsonStr); // Validate extracted JSON
                                                    currentToolCall.function.arguments =
                                                        firstJsonStr;
                                                    console.log(
                                                        `Extracted valid JSON at message_stop: ${firstJsonStr}`
                                                    );
                                                } catch (extractError) {
                                                    console.error(
                                                        `Failed to extract valid JSON at message_stop: ${firstJsonStr}`,
                                                        extractError
                                                    );
                                                    currentToolCall.function.arguments =
                                                        '{}';
                                                }
                                            } else {
                                                currentToolCall.function.arguments =
                                                    '{}';
                                            }
                                        } else {
                                            currentToolCall.function.arguments =
                                                '{}';
                                        }
                                    }
                                    delete currentToolCall.function
                                        ._partialArguments;
                                }

                                yield {
                                    type: 'tool_start',
                                    tool_call: currentToolCall as ToolCall,
                                };
                            }
                            // If tool_start was already emitted, we don't need to do anything
                            // The tool execution will be handled by ensemble_request.ts
                            currentToolCall = null; // Reset anyway
                        }

                        // Flush any buffered deltas before final message_complete
                        for (const ev of flushBufferedDeltas(
                            deltaBuffers,
                            (_id, content) =>
                                ({
                                    type: 'message_delta',
                                    content,
                                    message_id: messageId,
                                    order: deltaPosition++,
                                }) as ProviderStreamEvent
                        )) {
                            yield ev;
                        }
                        // Emit message_complete if there's content
                        if (accumulatedContent || accumulatedThinking) {
                            // Add footnotes if there are citations
                            if (citationTracker.citations.size > 0) {
                                const footnotes =
                                    generateFootnotes(citationTracker);
                                accumulatedContent += footnotes;
                            }

                            yield {
                                type: 'message_complete',
                                message_id: messageId,
                                content: accumulatedContent,
                                thinking_content: accumulatedThinking,
                                thinking_signature: accumulatedSignature,
                            };
                            messageCompleteYielded = true; // Mark that it was yielded here
                        }
                        streamCompletedSuccessfully = true; // Mark stream as complete
                        // **Cost tracking moved after the loop**
                    }
                    // Handle error event
                    else if (event.type === 'error') {
                        log_llm_error(requestId, event);
                        console.error('Claude API error event:', event.error);
                        yield {
                            type: 'error',
                            error:
                                'Claude API error: ' +
                                (event.error
                                    ? event.error.message ||
                                      JSON.stringify(event.error)
                                    : 'Unknown error'),
                        };
                        // Don't mark as successful on API error
                        streamCompletedSuccessfully = false;
                        break; // Stop processing on error
                    }
                } // End for await loop

                // Ensure a message_complete is emitted if somehow message_stop didn't fire
                // but we have content and no error occurred.
                if (
                    streamCompletedSuccessfully &&
                    (accumulatedContent || accumulatedThinking) &&
                    !messageCompleteYielded
                ) {
                    console.warn(
                        'Stream finished successfully but message_stop might not have triggered message_complete emission. Emitting now.'
                    );
                    // Flush any buffered deltas before final message_complete
                    for (const ev of flushBufferedDeltas(
                        deltaBuffers,
                        (_id, content) =>
                            ({
                                type: 'message_delta',
                                content,
                                message_id: messageId,
                                order: deltaPosition++,
                            }) as ProviderStreamEvent
                    )) {
                        yield ev;
                    }
                    // Add footnotes if there are citations (same as in message_stop)
                    if (citationTracker.citations.size > 0) {
                        const footnotes = generateFootnotes(citationTracker);
                        accumulatedContent += footnotes;
                    }

                    yield {
                        type: 'message_complete',
                        message_id: messageId,
                        content: accumulatedContent,
                        thinking_content: accumulatedThinking,
                        thinking_signature: accumulatedSignature,
                    };
                    messageCompleteYielded = true; // Mark as yielded here too
                }
            } catch (streamError) {
                log_llm_error(requestId, streamError);
                console.error('Error processing Claude stream:', streamError);
                yield {
                    type: 'error',
                    error: `Claude stream error (${model}): ${streamError}`,
                };
            } finally {
                log_llm_response(requestId, events);
            }
        } catch (error) {
            log_llm_error(requestId, error);
            console.error('Error in Claude streaming completion setup:', error);
            yield {
                type: 'error',
                error: `Claude request error (${model}): ${error}`,
            };
        } finally {
            // Track cost if we have token usage data
            if (totalInputTokens > 0 || totalOutputTokens > 0) {
                const cachedTokens =
                    totalCacheCreationInputTokens + totalCacheReadInputTokens;
                costTracker.addUsage({
                    model,
                    input_tokens: totalInputTokens,
                    output_tokens: totalOutputTokens,
                    cached_tokens: cachedTokens,
                    metadata: {
                        cache_creation_input_tokens:
                            totalCacheCreationInputTokens,
                        cache_read_input_tokens: totalCacheReadInputTokens,
                        total_tokens: totalInputTokens + totalOutputTokens,
                    },
                });
            }
        }
    }
}

// Export an instance of the provider
export const claudeProvider = new ClaudeProvider();
