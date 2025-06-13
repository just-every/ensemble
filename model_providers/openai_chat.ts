/**
 * OpenAI model provider implementation using chat.completions.create API.
 * Handles streaming responses, native tool calls, and simulated tool calls via text parsing.
 * Cleans simulated tool call markers from final yielded content events.
 * Updated to handle MULTIPLE simulated tool calls in an array format.
 * Supports extended stream formats from providers like Perplexity/OpenRouter with reasoning and citations.
 */

import {
    ToolFunction,
    ModelSettings,
    ProviderStreamEvent,
    ToolCall,
    ResponseInput,
    AgentDefinition,
} from '../types/types.js';
import { BaseModelProvider } from './base_provider.js';
import OpenAI, { APIError } from 'openai';
import { v4 as uuidv4 } from 'uuid';
import { costTracker } from '../index.js';
import {
    log_llm_error,
    log_llm_request,
    log_llm_response,
} from '../utils/llm_logger.js';
import { isPaused } from '../utils/pause_controller.js';
import { ModelProviderID } from '../data/model_data.js'; // Adjust path as needed
import {
    appendMessageWithImage,
    resizeAndSplitForOpenAI,
} from '../utils/image_utils.js';
// import { convertImageToTextIfNeeded } from '../utils/image_to_text.js';
import {
    DeltaBuffer,
    bufferDelta,
    flushBufferedDeltas,
} from '../utils/delta_buffer.js';
import {
    createCitationTracker,
    formatCitation,
    generateFootnotes,
} from '../utils/citation_tracker.js';

// Extended types for Perplexity/OpenRouter response formats
interface ExtendedDelta
    extends OpenAI.Chat.Completions.ChatCompletionChunk.Choice.Delta {
    reasoning?: string;
    annotations?: Array<{
        type: string;
        url_citation?: {
            title: string;
            url: string;
        };
    }>;
}

interface ExtendedChunk extends OpenAI.Chat.Completions.ChatCompletionChunk {
    citations?: string[];
}

// --- Constants for Simulated Tool Call Handling ---
// Regex to find the MULTIPLE simulated tool call pattern (TOOL_CALLS: [ ... ]) at the end
// Also detects when pattern is inside code blocks with backticks
const SIMULATED_TOOL_CALL_REGEX =
    /\n?\s*(?:```(?:json)?\s*)?\s*TOOL_CALLS:\s*(\[.*\])(?:\s*```)?/gs; // Use greedy .*
const TOOL_CALL_CLEANUP_REGEX =
    /\n?\s*(?:```(?:json)?\s*)?\s*TOOL_CALLS:\s*\[.*\](?:\s*```)?/gms; // Use greedy .* here too for consistency
const CLEANUP_PLACEHOLDER = '[Simulated Tool Calls Removed]';

// --- Helper Functions ---

/** Resolves any async enum values in tool parameters */
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
                            // Remove empty enum to avoid OpenAI validation errors
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

/** Converts internal ToolFunction definitions to OpenAI format. */
async function convertToOpenAITools(
    tools: ToolFunction[]
): Promise<OpenAI.Chat.Completions.ChatCompletionTool[]> {
    // Map tools and resolve async enums
    return await Promise.all(
        tools.map(async (tool: ToolFunction) => ({
            type: 'function' as const,
            function: {
                name: tool.definition.function.name,
                description: tool.definition.function.description,
                parameters: await resolveAsyncEnums(
                    tool.definition.function.parameters
                ),
            },
        }))
    );
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
export async function addImagesToInput(
    input: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
    images: Record<string, string>,
    source: string
): Promise<OpenAI.Chat.Completions.ChatCompletionMessageParam[]> {
    // Add developer messages for each image
    for (const [image_id, imageData] of Object.entries(images)) {
        try {
            // Resize and split the image if needed
            const processedImages = await resizeAndSplitForOpenAI(imageData);

            // Create a content array for the message
            const messageContent = [];

            // Add description text first
            if (processedImages.length === 1) {
                // Single image (no splitting needed)
                messageContent.push({
                    type: 'text',
                    text: `This is [image #${image_id}] from the ${source}`,
                });
            } else {
                // Multiple segments - explain the splitting
                messageContent.push({
                    type: 'text',
                    text: `This is [image #${image_id}] from the ${source} (split into ${processedImages.length} parts, each up to 768px high)`,
                });
            }

            // Add all image segments to the same message
            for (const imageSegment of processedImages) {
                messageContent.push({
                    type: 'image_url',
                    image_url: {
                        url: imageSegment,
                    },
                });
            }

            // Add the complete message with all segments
            input.push({
                role: 'user',
                content: messageContent,
            });
        } catch (error) {
            console.error(`Error processing image ${image_id}:`, error);
            // If image processing fails, add the original image as a fallback
            input.push({
                role: 'user',
                content: [
                    {
                        type: 'text',
                        text: `This is [image #${image_id}] from the ${source} (raw image)`,
                    },
                    {
                        type: 'image_url',
                        image_url: {
                            url: imageData,
                        },
                    },
                ],
            });
        }
    }
    return input;
}

/** Maps internal message history format to OpenAI's format. */
async function mapMessagesToOpenAI(
    messages: ResponseInput,
    model: string
): Promise<OpenAI.Chat.Completions.ChatCompletionMessageParam[]> {
    // Use flatMap to allow returning multiple messages when needed (e.g., for image extraction)
    let result: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];

    for (const msg of messages) {
        // Create a clean copy without non-standard properties
        const message = { ...msg };

        // Handle function call output messages
        if (msg.type === 'function_call_output') {
            const toolMessage = {
                role: 'tool',
                tool_call_id: msg.call_id,
                content: msg.output || '',
            } as OpenAI.Chat.Completions.ChatCompletionToolMessageParam;
            result = await appendMessageWithImage(
                model,
                result,
                toolMessage,
                'content',
                addImagesToInput
            );
        }
        // Handle function call messages
        else if (msg.type === 'function_call') {
            // Type assertion to access function call fields
            const functionCallMsg = message as {
                call_id: string;
                name?: string;
                arguments?: string;
            };

            result.push({
                role: 'assistant',
                tool_calls: [
                    {
                        id: functionCallMsg.call_id,
                        type: 'function',
                        function: {
                            name: functionCallMsg.name || '',
                            arguments: functionCallMsg.arguments || '',
                        },
                    },
                ],
            } as OpenAI.Chat.Completions.ChatCompletionAssistantMessageParam);
        }
        // Handle standard message types
        else if (
            !msg.type ||
            msg.type === 'message' ||
            msg.type === 'thinking'
        ) {
            // Extract content from the message
            if ('content' in message) {
                // Clean up non-standard fields before sending
                delete (message as any).type;
                delete (message as any).timestamp;
                delete (message as any).model;
                delete (message as any).pinned;
                delete (message as any).status;
                delete (message as any).thinking_id;
                delete (message as any).signature;

                if (message.role === 'developer') message.role = 'system';
                if (!['system', 'user', 'assistant'].includes(message.role)) {
                    message.role = 'user';
                }
                result = await appendMessageWithImage(
                    model,
                    result,
                    message,
                    'content',
                    addImagesToInput
                );
            }
        }
    }

    return result.filter(
        Boolean
    ) as OpenAI.Chat.Completions.ChatCompletionMessageParam[];
}

/** Type definition for the result of parsing simulated tool calls. */
type SimulatedToolCallParseResult = {
    handled: boolean;
    eventsToYield?: ProviderStreamEvent[];
    cleanedContent?: string; // Used if handled is false
};

/**
 * OpenAI model provider implementation.
 */
export class OpenAIChat extends BaseModelProvider {
    protected _client?: OpenAI;
    protected provider: ModelProviderID;
    protected baseURL: string | undefined;
    protected commonParams: any = {};
    protected apiKey?: string;
    protected defaultHeaders?: Record<string, string | null | undefined>;
    public provider_id = 'openai_chat';

    constructor(
        provider?: ModelProviderID,
        apiKey?: string,
        baseURL?: string,
        defaultHeaders?: Record<string, string | null | undefined>,
        commonParams?: any
    ) {
        super(provider || 'openai');
        // Store parameters for lazy initialization
        this.provider = provider || 'openai';
        this.apiKey = apiKey || process.env.OPENAI_API_KEY;
        this.baseURL = baseURL;
        this.commonParams = commonParams || {};
        this.defaultHeaders = defaultHeaders || {
            'User-Agent': 'magi',
        };
    }

    /**
     * Lazily initialize the OpenAI client when first accessed
     */
    protected get client(): OpenAI {
        if (!this._client) {
            if (!this.apiKey) {
                throw new Error(
                    `Failed to initialize OpenAI client for ${this.provider}. API key is missing.`
                );
            }
            this._client = new OpenAI({
                apiKey: this.apiKey,
                baseURL: this.baseURL,
                defaultHeaders: this.defaultHeaders,
            });
        }
        return this._client;
    }

    /** Base parameter preparation method. */
    prepareParameters(
        requestParams: OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming
    ): OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming {
        return requestParams;
    }

    /**
     * Parses the aggregated content for the MULTIPLE simulated tool call marker (`TOOL_CALLS: [...]`) at the end.
     * If found and valid, prepares the corresponding events.
     * @param aggregatedContent The full text content from the model response.
     * @param messageId The ID for the current message stream.
     * @returns A result object indicating if calls were handled and events/cleaned content.
     */
    private _parseAndPrepareSimulatedToolCalls(
        aggregatedContent: string,
        messageId: string
    ): SimulatedToolCallParseResult {
        // Use matchAll to find all occurrences of the pattern
        const matches = Array.from(
            aggregatedContent.matchAll(SIMULATED_TOOL_CALL_REGEX)
        );
        let jsonArrayString: string | null = null;
        let matchIndex: number = -1; // Store the start index of the last match

        // If matches were found, get the JSON string from the *last* match
        if (matches.length > 0) {
            const lastMatch = matches[matches.length - 1];
            if (lastMatch && lastMatch[1]) {
                // lastMatch[1] captures the array string "[...]"
                jsonArrayString = lastMatch[1];
                matchIndex = lastMatch.index ?? -1; // Store the index where the last match started
                console.log(
                    `(${this.provider}) Found ${matches.length} TOOL_CALLS patterns. Processing the last one.`
                );
            }
        } else {
            // Optional: Add your debugging for when no matches are found at all
            if (aggregatedContent.includes('TOOL_CALLS')) {
                console.log(
                    `(${this.provider}) TOOL_CALLS found but regex didn't match globally. Content snippet:`,
                    aggregatedContent.substring(
                        Math.max(
                            0,
                            aggregatedContent.indexOf('TOOL_CALLS') - 20
                        ),
                        Math.min(
                            aggregatedContent.length,
                            aggregatedContent.indexOf('TOOL_CALLS') + 300
                        )
                    )
                ); // Increased snippet length
            } else {
                console.log(
                    `(${this.provider}) No TOOL_CALLS found in response.`
                );
            }
            console.debug(
                `(${this.provider}) Full response content:`,
                aggregatedContent
            );
        }

        // Proceed only if a JSON string was extracted from the last match
        if (jsonArrayString !== null && matchIndex !== -1) {
            try {
                console.log(
                    `(${this.provider}) Processing last TOOL_CALLS JSON string:`,
                    jsonArrayString
                );

                // Try to parse the potentially complete JSON string
                let parsedToolCallArray;
                try {
                    // 1. Try original JSON string (from the last match with greedy capture)
                    parsedToolCallArray = JSON.parse(jsonArrayString);
                } catch (initialParseError) {
                    // NOTE: Keep your fallback logic here if the LLM might still produce invalid/truncated JSON
                    // For this specific error (truncation due to regex), the greedy match should fix it,
                    // but fallbacks are good for general robustness.
                    console.error(
                        `(${this.provider}) Failed initial parse. Error: ${initialParseError}. JSON String: ${jsonArrayString}`
                    );
                    // Optional: Attempt your cleaning/balancing logic here if needed as fallbacks
                    // Example: throw initialParseError; // Re-throw if fallbacks are not implemented or fail
                    // If you have fixTruncatedJson or cleaning, try them here:
                    // try { /* ... try cleaned ... */ } catch { /* ... try balanced ... */ }
                    // For now, we re-throw assuming the greedy regex fixed the primary issue
                    throw initialParseError;
                }

                // Validate that it's an array
                if (!Array.isArray(parsedToolCallArray)) {
                    if (
                        typeof parsedToolCallArray === 'object' &&
                        parsedToolCallArray !== null
                    ) {
                        console.log(
                            `(${this.provider}) Parsed JSON is not an array but an object, wrapping in array`
                        );
                        parsedToolCallArray = [parsedToolCallArray];
                    } else {
                        throw new Error(
                            'Parsed JSON is not an array or object.'
                        );
                    }
                }

                const validSimulatedCalls: ToolCall[] = [];
                // Iterate through the parsed array - THIS HANDLES MULTIPLE CALLS within the block
                for (const callData of parsedToolCallArray) {
                    console.log(
                        `(${this.provider}) Processing tool call object:`,
                        callData
                    );

                    // Flexible validation to handle different formats
                    if (callData && typeof callData === 'object') {
                        // Basic check
                        // We'll use a custom type that's similar to ToolCall but doesn't have the readonly restriction
                        // Create an object with the full structure ready to go
                        const toolCall = {
                            id: callData.id || `sim_${uuidv4()}`, // Use provided ID or generate unique ID
                            type: 'function' as const, // Force it to be 'function' type
                            function: {
                                name: '',
                                arguments: '{}',
                            },
                        } satisfies ToolCall; // Make sure it satisfies the ToolCall interface

                        // Extract function details
                        const funcDetails = callData.function;
                        if (
                            typeof funcDetails === 'object' &&
                            funcDetails !== null
                        ) {
                            if (typeof funcDetails.name === 'string') {
                                toolCall.function.name = funcDetails.name;
                            }
                            // Handle arguments (ensure it's a stringified JSON)
                            if (funcDetails.arguments !== undefined) {
                                if (typeof funcDetails.arguments === 'string') {
                                    try {
                                        JSON.parse(funcDetails.arguments); // Validate JSON string
                                        toolCall.function.arguments =
                                            funcDetails.arguments;
                                    } catch {
                                        console.warn(
                                            `(${this.provider}) Argument string is not valid JSON, wrapping in quotes:`,
                                            funcDetails.arguments
                                        );
                                        // If it's meant to be a plain string, JSON stringify it
                                        toolCall.function.arguments =
                                            JSON.stringify(
                                                funcDetails.arguments
                                            );
                                    }
                                } else {
                                    toolCall.function.arguments =
                                        JSON.stringify(funcDetails.arguments);
                                }
                            }
                        } else if (typeof callData.name === 'string') {
                            // Handle simpler format { name: "...", arguments: "..." }
                            toolCall.function.name = callData.name;
                            if (callData.arguments !== undefined) {
                                if (typeof callData.arguments === 'string') {
                                    try {
                                        JSON.parse(callData.arguments); // Validate JSON string
                                        toolCall.function.arguments =
                                            callData.arguments;
                                    } catch {
                                        console.warn(
                                            `(${this.provider}) Argument string is not valid JSON, wrapping in quotes:`,
                                            callData.arguments
                                        );
                                        toolCall.function.arguments =
                                            JSON.stringify(callData.arguments);
                                    }
                                } else {
                                    toolCall.function.arguments =
                                        JSON.stringify(callData.arguments);
                                }
                            }
                        }

                        // Only add the tool call if it has a valid name
                        if (
                            toolCall.function.name &&
                            toolCall.function.name.length > 0
                        ) {
                            validSimulatedCalls.push(toolCall);
                        } else {
                            console.warn(
                                `(${this.provider}) Invalid tool call object, missing name:`,
                                callData
                            );
                        }
                    } else {
                        console.warn(
                            `(${this.provider}) Skipping invalid item in tool call array:`,
                            callData
                        );
                    }
                }

                console.log(
                    `(${this.provider}) Valid simulated calls extracted:`,
                    validSimulatedCalls
                );

                // Proceed only if at least one valid call was parsed from the last match
                if (validSimulatedCalls.length > 0) {
                    // Extract and clean text *before* the *last* marker
                    let textBeforeToolCall = aggregatedContent
                        .substring(0, matchIndex)
                        .trim();
                    // Clean up *all* markers potentially before the last one too
                    textBeforeToolCall = textBeforeToolCall.replaceAll(
                        TOOL_CALL_CLEANUP_REGEX,
                        CLEANUP_PLACEHOLDER
                    );

                    const eventsToYield: ProviderStreamEvent[] = [];
                    if (textBeforeToolCall) {
                        eventsToYield.push({
                            type: 'message_complete', // Or 'message_delta' depending on your streaming logic
                            content: textBeforeToolCall,
                            message_id: messageId,
                        });
                    }
                    // Yield a single tool_start event containing the array of calls
                    for (const validSimulatedCall of validSimulatedCalls) {
                        eventsToYield.push({
                            type: 'tool_start',
                            tool_call: validSimulatedCall,
                        });
                    }

                    return { handled: true, eventsToYield };
                } else {
                    console.warn(
                        `(${this.provider}) Last TOOL_CALLS array found but contained no valid tool call objects after processing.`
                    );
                }
            } catch (parseError) {
                // Log the error with the JSON string that failed
                console.error(
                    `(${this.provider}) Found last TOOL_CALLS pattern, but failed during processing: ${parseError}. JSON String: ${jsonArrayString}`
                );
            }
        }

        // If no match, or parsing/validation failed for the last match
        console.log(
            `(${this.provider}) No valid tool calls processed from TOOL_CALLS markers.`
        );
        const cleanedContent = aggregatedContent.replaceAll(
            TOOL_CALL_CLEANUP_REGEX,
            CLEANUP_PLACEHOLDER
        );
        return { handled: false, cleanedContent: cleanedContent };
    }

    /** Creates a streaming response using OpenAI's chat.completions.create API. */
    async *createResponseStream(
        messages: ResponseInput,
        model: string,
        agent: AgentDefinition
    ): AsyncGenerator<ProviderStreamEvent> {
        // Get tools asynchronously (getTools now returns a Promise)
        const { getToolsFromAgent } = await import('../utils/agent.js');
        const toolsPromise = agent
            ? getToolsFromAgent(agent)
            : Promise.resolve([]);
        const tools = await toolsPromise;
        const settings: ModelSettings | undefined = agent?.modelSettings;
        let requestId: string | undefined;

        try {
            // --- Prepare Request ---
            const chatMessages = await mapMessagesToOpenAI(messages, model);
            let requestParams: OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming =
                { model, messages: chatMessages, stream: true };
            // ... (parameter setup unchanged) ...
            if (settings?.temperature !== undefined)
                requestParams.temperature = settings.temperature;
            if (settings?.top_p !== undefined)
                requestParams.top_p = settings.top_p;
            if (settings?.max_tokens)
                requestParams.max_tokens = settings.max_tokens;
            if (settings?.tool_choice)
                requestParams.tool_choice =
                    settings.tool_choice as OpenAI.Chat.Completions.ChatCompletionToolChoiceOption;
            if (settings?.json_schema) {
                requestParams.response_format = {
                    type: 'json_schema',
                    json_schema: settings.json_schema,
                };
            }
            if (tools && tools.length > 0)
                requestParams.tools = await convertToOpenAITools(tools);

            const overrideParams = { ...this.commonParams };

            // Define mapping for OpenAI style reasoning effort configurations
            // Works for OpenRouter
            const REASONING_EFFORT_CONFIGS: Array<string> = [
                'low',
                'medium',
                'high',
            ];

            for (const effort of REASONING_EFFORT_CONFIGS) {
                const suffix = `-${effort}`;
                if (model.endsWith(suffix)) {
                    // Apply the specific reasoning effort and remove the suffix
                    overrideParams.reasoning = {
                        effort: effort,
                    };
                    model = model.slice(0, -suffix.length);
                    requestParams.model = model; // Update the model in the request
                    break;
                }
            }
            // Merge common parameters with requestParams
            requestParams = {
                ...requestParams,
                ...overrideParams,
            };

            requestParams = this.prepareParameters(requestParams);
            requestId = log_llm_request(
                agent.agent_id,
                this.provider,
                model,
                requestParams
            );

            // Wait while system is paused before making the API request
            const { waitWhilePaused } = await import(
                '../utils/pause_controller.js'
            );
            await waitWhilePaused(100, agent.abortSignal);

            // --- Process Stream ---
            const stream =
                await this.client.chat.completions.create(requestParams);
            let aggregatedContent = '';
            let aggregatedThinking = '';
            const messageId = uuidv4();
            let messageIndex = 0;
            const partialToolCallsByIndex = new Map<number, ToolCall>();
            let finishReason: string | null = null;
            let usage: OpenAI.CompletionUsage | undefined = undefined;
            // Track citations to display as footnotes
            const citationTracker = createCitationTracker();

            const chunks: OpenAI.Chat.Completions.ChatCompletionChunk[] = [];
            try {
                // Track delta buffers for message content
                const deltaBuffers = new Map<string, DeltaBuffer>();
                for await (const chunk of stream) {
                    chunks.push(chunk);

                    // Check if the system was paused during the stream
                    if (isPaused()) {
                        console.log(
                            `[${this.provider}] System paused during stream for model ${model}. Waiting...`
                        );

                        // Wait while paused instead of aborting
                        await waitWhilePaused(100, agent.abortSignal);

                        // If we're resuming, continue processing
                        console.log(
                            `[${this.provider}] System resumed, continuing stream for model ${model}`
                        );
                    }

                    // ... (stream aggregation logic unchanged) ...
                    const choice = chunk.choices[0];
                    if (!choice?.delta) continue;
                    const delta = choice.delta;
                    if (delta.content) {
                        aggregatedContent += delta.content;

                        for (const ev of bufferDelta(
                            deltaBuffers,
                            messageId,
                            delta.content,
                            content =>
                                ({
                                    type: 'message_delta',
                                    content,
                                    message_id: messageId,
                                    order: messageIndex++,
                                }) as ProviderStreamEvent
                        )) {
                            yield ev;
                        }
                    }

                    // Handle reasoning content (Perplexity/OpenRouter format)
                    const extendedDelta = delta as ExtendedDelta;
                    if (extendedDelta.reasoning) {
                        aggregatedContent += extendedDelta.reasoning;
                        for (const ev of bufferDelta(
                            deltaBuffers,
                            messageId,
                            extendedDelta.reasoning,
                            content =>
                                ({
                                    type: 'message_delta',
                                    content,
                                    message_id: messageId,
                                    order: messageIndex++,
                                }) as ProviderStreamEvent
                        )) {
                            yield ev;
                        }
                    }

                    // Handle annotations (citations in Perplexity/OpenRouter format)
                    if (Array.isArray(extendedDelta.annotations)) {
                        for (const ann of extendedDelta.annotations) {
                            if (
                                ann.type === 'url_citation' &&
                                ann.url_citation?.url
                            ) {
                                const marker = formatCitation(citationTracker, {
                                    title:
                                        ann.url_citation.title ||
                                        ann.url_citation.url,
                                    url: ann.url_citation.url,
                                });
                                aggregatedContent += marker;
                                yield {
                                    type: 'message_delta',
                                    content: marker,
                                    message_id: messageId,
                                    order: messageIndex++,
                                };
                            }
                        }
                    }

                    // Handle citations array at chunk level (another format variant)
                    const extendedChunk = chunk as ExtendedChunk;
                    if (
                        Array.isArray(extendedChunk.citations) &&
                        extendedChunk.citations.length > 0
                    ) {
                        for (const url of extendedChunk.citations) {
                            if (
                                typeof url === 'string' &&
                                !citationTracker.citations.has(url)
                            ) {
                                const title = url.split('/').pop() || url;
                                const marker = formatCitation(citationTracker, {
                                    title,
                                    url,
                                });
                                // Only add the marker if this is a new citation
                                if (marker) {
                                    aggregatedContent += marker;
                                    yield {
                                        type: 'message_delta',
                                        content: marker,
                                        message_id: messageId,
                                        order: messageIndex++,
                                    };
                                }
                            }
                        }
                    }
                    if ('reasoning_content' in delta) {
                        const thinking_content =
                            delta.reasoning_content as string;
                        if (thinking_content) {
                            aggregatedThinking += thinking_content;
                            yield {
                                type: 'message_delta',
                                content: '',
                                message_id: messageId,
                                thinking_content,
                                order: messageIndex++,
                            };
                        }
                    }
                    if ('thinking_content' in delta) {
                        const thinking_content =
                            delta.thinking_content as string;
                        if (thinking_content) {
                            aggregatedThinking += thinking_content;
                            yield {
                                type: 'message_delta',
                                content: '',
                                message_id: messageId,
                                thinking_content,
                                order: messageIndex++,
                            };
                        }
                    }
                    if (delta.tool_calls) {
                        for (const toolCallDelta of delta.tool_calls) {
                            // Type assertion for toolCallDelta since the OpenAI types are sometimes incomplete
                            const typedDelta = toolCallDelta as {
                                index?: number;
                                id?: string;
                                type?: string;
                                function?: {
                                    name?: string;
                                    arguments?: string;
                                };
                            };

                            const index = typedDelta.index;
                            if (typeof index !== 'number') continue;

                            let partialCall =
                                partialToolCallsByIndex.get(index);
                            if (!partialCall) {
                                partialCall = {
                                    id: typedDelta.id || '',
                                    type: 'function',
                                    function: {
                                        name: typedDelta.function?.name || '',
                                        arguments:
                                            typedDelta.function?.arguments ||
                                            '',
                                    },
                                };
                                partialToolCallsByIndex.set(index, partialCall);
                            } else {
                                if (typedDelta.id)
                                    partialCall.id = typedDelta.id;
                                if (typedDelta.function?.name)
                                    partialCall.function.name =
                                        typedDelta.function.name;
                                if (typedDelta.function?.arguments) {
                                    // For xAI/Grok, validate accumulated arguments to prevent JSON errors
                                    const newArgs =
                                        typedDelta.function.arguments;
                                    const accumulatedArgs =
                                        partialCall.function.arguments +
                                        newArgs;

                                    // Try to parse to check if we have valid JSON so far
                                    try {
                                        JSON.parse(accumulatedArgs);
                                        partialCall.function.arguments =
                                            accumulatedArgs;
                                    } catch {
                                        // If parsing fails, it might be incomplete JSON
                                        // For xAI, we'll just accumulate and validate later
                                        partialCall.function.arguments =
                                            accumulatedArgs;
                                    }
                                }
                            }
                        }
                    }
                    if (choice.finish_reason)
                        finishReason = choice.finish_reason;
                    if (chunk.usage) usage = chunk.usage;
                } // End stream loop

                // Add footnotes to the content if we have citations
                if (citationTracker.citations.size > 0) {
                    const footnotes = generateFootnotes(citationTracker);
                    aggregatedContent += footnotes;
                    // Yield as a separate delta so it appears after all other content
                    yield {
                        type: 'message_delta',
                        content: footnotes,
                        message_id: messageId,
                        order: messageIndex++,
                    };
                }

                // --- Post-Stream Processing ---
                if (usage) {
                    costTracker.addUsage({
                        model: model,
                        input_tokens: usage.prompt_tokens || 0,
                        output_tokens: usage.completion_tokens || 0,
                        cached_tokens:
                            usage.prompt_tokens_details?.cached_tokens || 0,
                        metadata: {
                            total_tokens: usage.total_tokens || 0,
                            reasoning_tokens:
                                usage.completion_tokens_details
                                    ?.reasoning_tokens || 0,
                        },
                    });
                } else {
                    console.warn(
                        `(${this.provider}) Usage info not found in stream for cost tracking.`
                    );
                }

                // Flush any remaining buffered deltas and yield them
                for (const ev of flushBufferedDeltas(
                    deltaBuffers,
                    (id, content) =>
                        ({
                            type: 'message_delta',
                            content,
                            message_id: id,
                            order: messageIndex++,
                        }) as ProviderStreamEvent
                )) {
                    yield ev;
                }

                // --- Handle Final State Based on Finish Reason ---
                if (finishReason === 'stop') {
                    // Use the updated helper function for parsing TOOL_CALLS: [...]
                    const parseResult = this._parseAndPrepareSimulatedToolCalls(
                        aggregatedContent,
                        messageId
                    );
                    if (parseResult.handled && parseResult.eventsToYield) {
                        for (const event of parseResult.eventsToYield) {
                            yield event;
                        }
                    } else {
                        // No simulated call found/parsed, yield cleaned full content
                        yield {
                            type: 'message_complete',
                            content: parseResult.cleanedContent ?? '',
                            message_id: messageId,
                            thinking_content: aggregatedThinking,
                        };
                    }
                } else if (finishReason === 'tool_calls') {
                    // Handle NATIVE tool calls (unchanged)
                    const completedToolCalls: ToolCall[] = Array.from(
                        partialToolCallsByIndex.values()
                    ).filter(call => call.id && call.function.name);
                    if (completedToolCalls.length > 0) {
                        for (const completedToolCall of completedToolCalls) {
                            // Validate and fix JSON arguments before yielding
                            if (completedToolCall.function.arguments) {
                                try {
                                    // Try to parse to validate JSON
                                    const parsed = JSON.parse(
                                        completedToolCall.function.arguments
                                    );
                                    // Re-stringify to ensure clean format
                                    completedToolCall.function.arguments =
                                        JSON.stringify(parsed);
                                } catch (error) {
                                    console.warn(
                                        `(${this.provider}) Invalid JSON in tool arguments for ${completedToolCall.function.name}, attempting to fix: ${error}`
                                    );

                                    // For xAI/Grok, try to extract valid JSON
                                    const argStr =
                                        completedToolCall.function.arguments;

                                    // Try to find a complete JSON object
                                    const matches = argStr.match(
                                        /\{(?:[^{}]|(?:\{[^{}]*\}))*\}/
                                    );
                                    if (matches && matches[0]) {
                                        try {
                                            const parsed = JSON.parse(
                                                matches[0]
                                            );
                                            completedToolCall.function.arguments =
                                                JSON.stringify(parsed);
                                            console.log(
                                                `(${this.provider}) Successfully extracted valid JSON`
                                            );
                                        } catch {
                                            // If all else fails, use empty object
                                            completedToolCall.function.arguments =
                                                '{}';
                                            console.error(
                                                `(${this.provider}) Could not parse arguments, using empty object`
                                            );
                                        }
                                    } else {
                                        completedToolCall.function.arguments =
                                            '{}';
                                    }
                                }
                            }

                            yield {
                                type: 'tool_start',
                                tool_call: completedToolCall,
                            };
                        }
                    } else {
                        log_llm_error(
                            requestId,
                            `Error (${this.provider}): Model indicated tool calls, but none were parsed correctly.`
                        );
                        console.warn(
                            `(${this.provider}) Finish reason 'tool_calls', but no complete native tool calls parsed.`
                        );
                        yield {
                            type: 'error',
                            error: `Error (${this.provider}): Model indicated tool calls, but none were parsed correctly.`,
                        };
                    }
                } else if (finishReason === 'length') {
                    const cleanedPartialContent = aggregatedContent.replaceAll(
                        TOOL_CALL_CLEANUP_REGEX,
                        CLEANUP_PLACEHOLDER
                    );
                    log_llm_error(
                        requestId,
                        `Error (${this.provider}): Response truncated (max_tokens). Partial: ${cleanedPartialContent.substring(0, 100)}...`
                    );
                    yield {
                        type: 'error',
                        error: `Error (${this.provider}): Response truncated (max_tokens). Partial: ${cleanedPartialContent.substring(0, 100)}...`,
                    };
                } else if (finishReason) {
                    const cleanedReasonContent = aggregatedContent.replaceAll(
                        TOOL_CALL_CLEANUP_REGEX,
                        CLEANUP_PLACEHOLDER
                    );
                    log_llm_error(
                        requestId,
                        `Error (${this.provider}): Response stopped due to: ${finishReason}. Content: ${cleanedReasonContent.substring(0, 100)}...`
                    );
                    yield {
                        type: 'error',
                        error: `Error (${this.provider}): Response stopped due to: ${finishReason}. Content: ${cleanedReasonContent.substring(0, 100)}...`,
                    };
                } else {
                    // Handle stream ending without a finish reason
                    if (aggregatedContent) {
                        console.warn(
                            `(${this.provider}) Stream finished without finish_reason, yielding cleaned content.`
                        );
                        // Attempt to parse simulated calls even without finish reason 'stop'
                        const parseResult =
                            this._parseAndPrepareSimulatedToolCalls(
                                aggregatedContent,
                                messageId
                            );
                        if (parseResult.handled && parseResult.eventsToYield) {
                            for (const event of parseResult.eventsToYield) {
                                yield event;
                            }
                        } else {
                            yield {
                                type: 'message_complete',
                                content: parseResult.cleanedContent ?? '',
                                message_id: messageId,
                                thinking_content: aggregatedThinking,
                            };
                        }
                    } else if (partialToolCallsByIndex.size > 0) {
                        // ... (unchanged native tool call error handling) ...
                        log_llm_error(
                            requestId,
                            `Error (${this.provider}): Stream ended unexpectedly during native tool call generation.`
                        );
                        console.warn(
                            `(${this.provider}) Stream finished without finish_reason during native tool call generation.`
                        );
                        yield {
                            type: 'error',
                            error: `Error (${this.provider}): Stream ended unexpectedly during native tool call generation.`,
                        };
                    } else {
                        // ... (unchanged empty stream error handling) ...
                        log_llm_error(
                            requestId,
                            `Error (${this.provider}): Stream finished unexpectedly empty.`
                        );
                        console.warn(
                            `(${this.provider}) Stream finished empty without reason, content, or tool calls.`
                        );
                        yield {
                            type: 'error',
                            error: `Error (${this.provider}): Stream finished unexpectedly empty.`,
                        };
                    }
                }
            } catch (streamError) {
                log_llm_error(requestId, streamError);
                console.error(
                    `(${this.provider}) Error processing chat completions stream:`,
                    streamError
                );
                yield {
                    type: 'error',
                    error:
                        `Stream processing error (${this.provider} ${model}): ` +
                        (streamError instanceof OpenAI.APIError ||
                        streamError instanceof APIError
                            ? `${streamError.status} ${streamError.name} ${streamError.message} ${JSON.stringify(streamError.error)}`
                            : streamError instanceof Error
                              ? streamError.stack
                              : Object.getPrototypeOf(streamError) +
                                ' ' +
                                String(streamError)),
                };
            } finally {
                partialToolCallsByIndex.clear();

                // Log the end of the request
                log_llm_response(requestId, chunks);
            }
        } catch (error) {
            log_llm_error(requestId, error);
            console.error(
                `Error running ${this.provider} chat completions stream:`,
                error
            );
            yield {
                type: 'error',
                error:
                    `API Error (${this.provider} - ${model}): ` +
                    (error instanceof OpenAI.APIError ||
                    error instanceof APIError
                        ? `${error.status} ${error.name} ${error.message}`
                        : error instanceof Error
                          ? error.stack
                          : Object.getPrototypeOf(error) + ' ' + String(error)),
            };
        }
    }
}
