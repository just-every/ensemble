/**
 * Gemini model provider for the ensemble system.
 *
 * This module provides an implementation of the ModelProvider interface
 * for Google's Gemini models and handles streaming responses using the
 * latest API structure from the @google/genai package.
 *
 * Updated for @google/genai 0.7.0+ to use the new API patterns for:
 * - Streaming response handling
 * - Function calling with the new function declaration format
 * - Content structure with proper modalities
 */

import {
    GoogleGenAI,
    FunctionDeclaration,
    Type,
    Content,
    FunctionCallingConfigMode,
    GenerateContentResponseUsageMetadata,
    GenerateContentResponse,
    type GenerateContentConfig,
    type GenerateContentParameters,
    type SpeechConfig,
    Modality,
    MediaResolution,
} from '@google/genai';
import { EmbedOpts } from './model_provider.js';
import { v4 as uuidv4 } from 'uuid';
import {
    ToolFunction,
    ModelSettings,
    ProviderStreamEvent,
    ResponseInput,
    AgentDefinition,
    ImageGenerationOpts,
    VoiceGenerationOpts,
    type MessageEvent,
    TranscriptionOpts,
    TranscriptionAudioSource,
    TranscriptionEvent,
    LiveConfig,
    LiveOptions,
    LiveSession,
    LiveEvent,
    LiveAudioBlob,
    ToolCall,
    ToolCallResult,
    ResponseInputMessage,
    ResponseOutputMessage,
} from '../types/types.js';
import { BaseModelProvider } from './base_provider.js';
import { costTracker } from '../utils/cost_tracker.js';
import { log_llm_error, log_llm_request, log_llm_response } from '../utils/llm_logger.js';
import { isPaused } from '../utils/pause_controller.js';
import { appendMessageWithImage, normalizeImageDataUrl, resizeAndTruncateForGemini } from '../utils/image_utils.js';
import { hasEventHandler } from '../utils/event_controller.js';
import { truncateLargeValues } from '../utils/truncate_utils.js';

// Convert our tool definition to Gemini's updated FunctionDeclaration format
/**
 * Recursively convert parameter schema to Gemini format
 */
function convertParameterToGeminiFormat(param: any): any {
    let type: Type = Type.STRING;

    switch (param.type) {
        case 'string':
            type = Type.STRING;
            break;
        case 'number':
            type = Type.NUMBER;
            break;
        case 'boolean':
            type = Type.BOOLEAN;
            break;
        case 'object':
            type = Type.OBJECT;
            break;
        case 'array':
            type = Type.ARRAY;
            break;
        case 'null':
            type = Type.STRING;
            console.warn("Mapping 'null' type to STRING");
            break;
        default:
            console.warn(`Unsupported parameter type '${param.type}'. Defaulting to STRING.`);
            type = Type.STRING;
    }

    const result: any = { type, description: param.description };

    if (type === Type.ARRAY) {
        // Handle array items - Gemini has limitations with complex array item schemas
        if (param.items) {
            // Determine the item type
            let itemType: string | undefined;
            let itemEnum: any;
            let itemProperties: any;

            // Check if items has a type property (could be either format)
            if (typeof param.items === 'object') {
                itemType = param.items.type;
                itemEnum = param.items.enum;
                // Check if it's a full ToolParameter with properties
                if ('properties' in param.items) {
                    itemProperties = param.items.properties;
                }
            }

            if (itemType === 'object' || itemProperties) {
                // Gemini doesn't support object types in array items
                // Convert to string array with description about JSON encoding
                result.items = { type: Type.STRING };
                result.description = `${result.description || 'Array parameter'} (Each item should be a JSON-encoded object)`;

                // Add information about the expected object structure if available
                if (itemProperties) {
                    const propNames = Object.keys(itemProperties);
                    result.description += `. Expected properties: ${propNames.join(', ')}`;
                }
            } else if (itemType) {
                // Simple type conversion
                result.items = {
                    type:
                        itemType === 'string'
                            ? Type.STRING
                            : itemType === 'number'
                              ? Type.NUMBER
                              : itemType === 'boolean'
                                ? Type.BOOLEAN
                                : itemType === 'null'
                                  ? Type.STRING
                                  : Type.STRING,
                };
                if (itemEnum) {
                    // Handle enum - could be array or function
                    if (typeof itemEnum === 'function') {
                        // For now, we can't handle async enum functions in Gemini
                        console.warn('Gemini provider does not support async enum functions in array items');
                    } else {
                        result.items.enum = itemEnum;
                    }
                }
            } else {
                // No type specified, default to string
                result.items = { type: Type.STRING };
            }
        } else {
            // No items specified, default to string
            result.items = { type: Type.STRING };
        }
    } else if (type === Type.OBJECT) {
        // Gemini requires OBJECT types to have a properties field
        if (param.properties && typeof param.properties === 'object') {
            // Recursively convert nested properties
            result.properties = {};
            for (const [propName, propSchema] of Object.entries(param.properties)) {
                result.properties[propName] = convertParameterToGeminiFormat(propSchema);
            }
        } else {
            // No properties specified, add empty object
            result.properties = {};
        }
    } else if (param.enum) {
        // Handle enum - could be array or function
        if (typeof param.enum === 'function') {
            // For now, we can't handle async enum functions in Gemini at conversion time
            console.warn('Gemini provider does not support async enum functions. Enum will be omitted.');
            // We could potentially call sync functions here, but that would break async functions
            // For safety, we'll skip enum entirely when it's a function
        } else {
            result.format = 'enum';
            result.enum = param.enum;
        }
    }

    return result;
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

async function convertToGeminiFunctionDeclarations(tools: ToolFunction[]): Promise<FunctionDeclaration[]> {
    const declarations = await Promise.all(
        tools.map(async tool => {
            // Special handling for Google web search
            if (tool.definition.function.name === 'google_web_search') {
                // Return null for this special tool - we'll handle it separately in the config
                return null;
            }

            // First resolve async enums
            const resolvedParams = await resolveAsyncEnums(tool.definition?.function?.parameters);
            const toolParams = resolvedParams?.properties;

            const properties: Record<string, any> = {};
            if (toolParams) {
                for (const [name, param] of Object.entries(toolParams)) {
                    properties[name] = convertParameterToGeminiFormat(param);
                }
            } else {
                console.warn(
                    `Tool ${tool.definition?.function?.name || 'Unnamed Tool'} has missing or invalid parameters definition.`
                );
            }

            return {
                name: tool.definition.function.name,
                description: tool.definition.function.description,
                parameters: {
                    type: Type.OBJECT,
                    properties,
                    required: Array.isArray(resolvedParams?.required) ? resolvedParams.required : [],
                },
            };
        })
    );
    return declarations.filter(Boolean) as FunctionDeclaration[]; // Filter out null entries from special tools
}

/**
 * Helper function to determine image MIME type from base64 data
 */
export function getImageMimeType(imageData: string): string {
    if (imageData.includes('data:image/png')) return 'image/png';
    if (imageData.includes('data:image/jpeg')) return 'image/jpeg';
    if (imageData.includes('data:image/gif')) return 'image/gif';
    if (imageData.includes('data:image/webp')) return 'image/webp';
    // Default to jpeg if no specific type found
    return 'image/png';
}

/**
 * Best-effort MIME inference for URL-based images.
 */
function inferImageMimeTypeFromUrl(src: string): string {
    try {
        const url = new URL(src);
        const path = url.pathname.toLowerCase();
        if (path.endsWith('.png')) return 'image/png';
        if (path.endsWith('.jpg') || path.endsWith('.jpeg')) return 'image/jpeg';
        if (path.endsWith('.webp')) return 'image/webp';
        if (path.endsWith('.gif')) return 'image/gif';
        if (path.endsWith('.bmp')) return 'image/bmp';
        if (path.endsWith('.tif') || path.endsWith('.tiff')) return 'image/tiff';
        if (path.endsWith('.svg')) return 'image/svg+xml';
    } catch {
        // Ignore URL parsing errors and fall back to heuristic below.
    }

    const lower = src.toLowerCase();
    if (lower.includes('.png')) return 'image/png';
    if (lower.includes('.jpg') || lower.includes('.jpeg')) return 'image/jpeg';
    if (lower.includes('.webp')) return 'image/webp';
    if (lower.includes('.gif')) return 'image/gif';
    if (lower.includes('.bmp')) return 'image/bmp';
    if (lower.includes('.tif') || lower.includes('.tiff')) return 'image/tiff';
    if (lower.includes('.svg')) return 'image/svg+xml';

    return 'image/jpeg';
}

/**
 * Helper function to clean base64 data by removing the prefix
 */
export function cleanBase64Data(imageData: string): string {
    return imageData.replace(/^data:image\/[a-z]+;base64,/, '');
}

/**
 * Format Google search grounding chunks into readable text
 */
function formatGroundingChunks(chunks: any[]): string {
    return chunks
        .filter(c => c?.web?.uri)
        .map((c, i) => `${i + 1}. ${c.web.title || 'Untitled'} – ${c.web.uri}`)
        .join('\n');
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
async function addImagesToInput(input: Content[], images: Record<string, string>, source: string): Promise<Content[]> {
    // Add developer messages for each image
    for (const [image_id, imageData] of Object.entries(images)) {
        // Resize and split the image if needed
        const processedImageData = await resizeAndTruncateForGemini(imageData);
        const mimeType = getImageMimeType(processedImageData);
        const cleanedImageData = cleanBase64Data(processedImageData);

        input.push({
            role: 'user',
            parts: [
                {
                    text: `[image #${image_id}] from the ${source}`,
                },
                {
                    inlineData: {
                        mimeType: mimeType,
                        data: cleanedImageData,
                    },
                },
            ],
        });
    }
    return input;
}

// Convert message history to Gemini's content format
async function convertToGeminiContents(model: string, messages: ResponseInput): Promise<Content[]> {
    let contents: Content[] = [];

    for (const msg of messages) {
        if (msg.type === 'function_call') {
            // Function call from assistant to be included as a model message
            let args: Record<string, unknown> = {};
            try {
                const parsedArgs = JSON.parse(msg.arguments || '{}');
                args = typeof parsedArgs === 'object' && parsedArgs !== null ? parsedArgs : { value: parsedArgs };
            } catch (e) {
                console.error(
                    `Failed to parse function call arguments for ${msg.name}:`,
                    truncateLargeValues(msg.arguments),
                    e
                );
                args = {
                    error: 'Invalid JSON arguments provided',
                    raw_args: msg.arguments,
                };
            }

            contents.push({
                role: 'model',
                parts: [
                    {
                        functionCall: {
                            name: msg.name,
                            args,
                        },
                    },
                ],
            });
        } else if (msg.type === 'function_call_output') {
            let textOutput = '';
            if (typeof msg.output === 'string') {
                textOutput = msg.output;
            } else {
                textOutput = JSON.stringify(msg.output);
            }

            const message: Content = {
                role: 'user',
                parts: [
                    {
                        functionResponse: {
                            name: msg.name,
                            response: { content: textOutput || '' },
                        },
                    },
                ],
            };

            contents = await appendMessageWithImage(
                model,
                contents,
                message,
                {
                    read: () => textOutput,
                    write: value => {
                        message.parts[0].functionResponse.response.content = value;
                        return message;
                    },
                },
                addImagesToInput
            );
        } else {
            // Regular message
            const role = msg.role === 'assistant' ? 'model' : 'user';

            // Handle array content with input_text and input_image types
            if (Array.isArray(msg.content)) {
                const parts: any[] = [];
                for (const item of msg.content) {
                    if (item.type === 'input_text') {
                        parts.push({
                            thought: msg.type === 'thinking',
                            text: item.text || '',
                        });
                    } else if (item.type === 'input_image' || item.type === 'image') {
                        const normalized = normalizeImageDataUrl({
                            data: 'data' in item ? item.data : undefined,
                            image_url: 'image_url' in item ? item.image_url : undefined,
                            url: 'url' in item ? item.url : undefined,
                            mime_type: 'mime_type' in item ? item.mime_type : undefined,
                        });
                        // Convert input_image/image to Gemini's inlineData format
                        const imageUrl = normalized.dataUrl || normalized.url || ('image_url' in item ? item.image_url : '');
                        if (imageUrl.startsWith('data:')) {
                            // Parse data URL: data:image/png;base64,xxx
                            const match = imageUrl.match(/^data:([^;]+);base64,(.+)$/);
                            if (match) {
                                const mimeType = match[1];
                                const base64Data = match[2];
                                // Resize image for Gemini if needed
                                const processedData = await resizeAndTruncateForGemini(imageUrl);
                                const processedMatch = processedData.match(/^data:([^;]+);base64,(.+)$/);
                                if (processedMatch) {
                                    parts.push({
                                        inlineData: {
                                            mimeType: processedMatch[1],
                                            data: processedMatch[2],
                                        },
                                    });
                                } else {
                                    parts.push({
                                        inlineData: {
                                            mimeType: mimeType,
                                            data: base64Data,
                                        },
                                    });
                                }
                            }
                        } else if (imageUrl.startsWith('http://') || imageUrl.startsWith('https://')) {
                            // Handle URL-based images
                            parts.push({
                                fileData: {
                                    mimeType: inferImageMimeTypeFromUrl(imageUrl),
                                    fileUri: imageUrl,
                                },
                            });
                        }
                    }
                }

                if (parts.length > 0) {
                    const message: Content = { role, parts };
                    contents.push(message);
                }
            } else {
                // Handle string content (non-array case)
                let textContent = '';
                if (typeof msg.content === 'string') {
                    textContent = msg.content;
                } else {
                    // Fallback for unexpected content types
                    textContent = JSON.stringify(msg.content);
                }

                const message: Content = {
                    role,
                    parts: [
                        {
                            thought: msg.type === 'thinking',
                            text: textContent.trim(),
                        },
                    ],
                };

                contents = await appendMessageWithImage(
                    model,
                    contents,
                    message,
                    {
                        read: () => textContent,
                        write: value => {
                            message.parts[0].text = value;
                            return message;
                        },
                    },
                    addImagesToInput
                );
            }
        }
    }

    return contents;
}

// Define mappings for thinking budget configurations
const THINKING_BUDGET_CONFIGS: Record<string, number> = {
    '-low': 0,
    '-medium': 2048,
    '-high': 12288,
    '-max': 24576,
};

/**
 * Gemini model provider implementation
 */
export class GeminiProvider extends BaseModelProvider {
    private _client?: GoogleGenAI;
    private apiKey?: string;

    constructor(apiKey?: string) {
        super('google');
        // Store the API key for lazy initialization
        this.apiKey = apiKey;
    }

    /**
     * Lazily initialize the Google GenAI client when first accessed
     */
    private get client(): GoogleGenAI {
        if (!this._client) {
            // Check for API key at runtime, not construction time
            const apiKey = this.apiKey || process.env.GOOGLE_API_KEY;
            if (!apiKey) {
                throw new Error('Failed to initialize Gemini client. GOOGLE_API_KEY is missing or not provided.');
            }
            // Use v1beta to access the latest Gemini 3 preview endpoints
            this._client = new GoogleGenAI({
                apiKey: apiKey,
                vertexai: false,
                httpOptions: { apiVersion: 'v1beta' },
            });
        }
        return this._client;
    }

    /**
     * Creates embeddings for text input using Gemini embedding models
     * @param input Text to embed (string or array of strings)
     * @param model ID of the embedding model to use (e.g., 'gemini/gemini-embedding-exp-03-07')
     * @param opts Optional parameters for embedding generation
     * @returns Promise resolving to embedding vector(s)
     */
    async createEmbedding(
        input: string | string[],
        model: string,
        agent: AgentDefinition,
        opts?: EmbedOpts
    ): Promise<number[] | number[][]> {
        const requestId = `req_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
        let finalRequestId = requestId; // Define in outer scope
        try {
            // Handle 'gemini/' prefix if present
            let actualModelId = model.startsWith('gemini/') ? model.substring(7) : model;

            // Check for suffix and remove it from actual model ID while setting thinking config
            let thinkingConfig: { thinkingBudget: number } | null = null;

            // Check if model has any of the defined suffixes
            for (const [suffix, budget] of Object.entries(THINKING_BUDGET_CONFIGS)) {
                if (actualModelId.endsWith(suffix)) {
                    thinkingConfig = { thinkingBudget: budget };
                    actualModelId = actualModelId.slice(0, -suffix.length);
                    break;
                }
            }

            console.log(
                `[Gemini] Generating embedding with model ${actualModelId}${opts?.dimensions ? ` (dimensions: ${opts.dimensions})` : ''}`
            );

            // Prepare the embedding request payload
            const payload = {
                model: actualModelId,
                contents: input,
                config: {
                    taskType: opts?.taskType ?? 'SEMANTIC_SIMILARITY',
                    // Add outputDimensionality if specified in options
                    ...(opts?.dimensions && { outputDimensionality: opts.dimensions }),
                } as any, // Cast to any to allow additional properties
            };

            // Add thinking configuration if suffix was detected
            if (thinkingConfig) {
                payload.config.thinkingConfig = thinkingConfig;
            }

            // Log the request
            const loggedRequestId = log_llm_request(
                agent.agent_id || 'default',
                'gemini',
                actualModelId,
                {
                    ...payload,
                    input_length: Array.isArray(input) ? input.length : 1,
                },
                new Date(),
                requestId,
                agent.tags
            );
            // Use the logged request ID for consistency
            finalRequestId = loggedRequestId;

            // Call the Gemini API
            const response = await this.client.models.embedContent(payload);

            // Log the raw response structure for debugging
            console.log(
                '[Gemini] Embedding response structure:',
                JSON.stringify(
                    response,
                    (key, value) =>
                        key === 'values' && Array.isArray(value) && value.length > 10
                            ? `[${value.length} items]`
                            : value,
                    2
                )
            );

            // Extract the embedding values correctly
            // Check if response has the embedding field with values
            if (!response.embeddings || !Array.isArray(response.embeddings)) {
                console.error('[Gemini] Unexpected embedding response structure:', truncateLargeValues(response));
                throw new Error('Invalid embedding response structure from Gemini API');
            }

            // Track usage for cost calculation (Gemini embeddings are currently free)
            // but we still want to track usage for metrics
            const estimatedTokens =
                typeof input === 'string'
                    ? Math.ceil(input.length / 4)
                    : input.reduce((sum, text) => sum + Math.ceil(text.length / 4), 0);

            // Extract the values from the correct path in the response
            let extractedValues: number[] | number[][] = [];
            let dimensions = 0;

            // Handle the Gemini API response format
            if (response.embeddings.length > 0) {
                // Access the correct property path - in Gemini API it should be 'values'
                if (response.embeddings[0].values) {
                    extractedValues = response.embeddings.map(e => e.values as number[]);
                    dimensions = (extractedValues[0] as number[]).length;
                } else {
                    // Try direct embedding access if the expected property isn't found
                    console.warn('[Gemini] Could not find expected "values" property in embeddings response');
                    extractedValues = response.embeddings as unknown as number[][];
                    dimensions = Array.isArray(extractedValues[0]) ? extractedValues[0].length : 0;
                }
            }

            costTracker.addUsage({
                model: actualModelId,
                input_tokens: estimatedTokens,
                output_tokens: 0,
                metadata: {
                    dimensions,
                },
            });

            // Log the successful response
            log_llm_response(finalRequestId, {
                model: actualModelId,
                dimensions,
                vector_count: extractedValues.length,
                estimated_tokens: estimatedTokens,
            });

            // Extract and return the embeddings, ensuring correct type
            if (Array.isArray(input) && input.length > 1) {
                // Handle the multi-input case - ensure we have an array of arrays
                return extractedValues as number[][];
            } else {
                // Handle the single-input case - ensure we return a single array
                let result: number[];

                if (Array.isArray(extractedValues) && extractedValues.length >= 1) {
                    const firstValue = extractedValues[0];
                    // Ensure we're returning a number[] and not a single number
                    if (Array.isArray(firstValue)) {
                        result = firstValue;
                    } else {
                        // If somehow we got a single number or non-array, return empty array
                        console.error(
                            '[Gemini] Unexpected format in embedding result:',
                            truncateLargeValues(firstValue)
                        );
                        result = [];
                    }
                } else {
                    // Fallback to empty array if no values
                    result = [];
                }

                return result;
            }
        } catch (error) {
            log_llm_error(finalRequestId, error);
            console.error('[Gemini] Error generating embedding:', truncateLargeValues(error));
            throw error;
        }
    }

    /**
     * Create a streaming completion using Gemini's API
     */
    /**
     * Helper for retrying a stream if it fails with "Incomplete JSON segment" error
     * @param requestFn Function to create the request
     * @param maxRetries Maximum retry attempts
     */
    private async *retryStreamOnIncompleteJson<T>(
        requestFn: () => Promise<AsyncIterable<T>>,
        maxRetries: number = 2
    ): AsyncGenerator<T> {
        let attempts = 0;

        while (attempts <= maxRetries) {
            try {
                const stream = await requestFn();
                for await (const chunk of stream) {
                    yield chunk;
                }
                return; // Stream completed successfully
            } catch (error) {
                attempts++;
                const errorMsg = error instanceof Error ? error.message : String(error);

                // Only retry for incomplete JSON segment errors
                if (errorMsg.includes('Incomplete JSON segment') && attempts <= maxRetries) {
                    console.warn(`[Gemini] Incomplete JSON segment error, retrying (${attempts}/${maxRetries})...`);
                    // Add a small delay before retry
                    await new Promise(resolve => setTimeout(resolve, 1000 * attempts));
                    continue;
                }

                // For other errors or if we've exhausted retries, rethrow
                throw error;
            }
        }
    }

    async *createResponseStream(
        messages: ResponseInput,
        model: string,
        agent: AgentDefinition,
        requestId?: string
    ): AsyncGenerator<ProviderStreamEvent> {
        const { getToolsFromAgent } = await import('../utils/agent.js');
        const tools: ToolFunction[] | undefined = agent ? await getToolsFromAgent(agent) : [];
        const settings: ModelSettings | undefined = agent?.modelSettings;

        let messageId = uuidv4();
        let contentBuffer = '';
        let thoughtBuffer = '';
        let eventOrder = 0;
        // Track shown grounding URLs to avoid duplicates
        const shownGrounding = new Set<string>();

        // Helper function to add request_id to all events
        const withRequestId = (event: ProviderStreamEvent): ProviderStreamEvent => {
            return requestId ? { ...event, request_id: requestId } : event;
        };
        const chunks: GenerateContentResponse[] = [];
        try {
            // --- Prepare Request ---
            const contents = await convertToGeminiContents(model, messages);

            // Safety check for empty contents
            if (contents.length === 0) {
                console.warn(
                    'Gemini API Warning: No valid content found in messages after conversion. Adding default message.'
                );
                // Add a default user message
                contents.push({
                    role: 'user',
                    parts: [
                        {
                            text: "Let's think this through step by step.",
                        },
                    ],
                });
            }

            // Check if the last message is from the user
            const lastContent = contents[contents.length - 1];
            if (lastContent.role !== 'user') {
                console.warn("Last message in history is not from 'user'. Gemini might not respond as expected.");
            }

            // Handle model suffixes for thinking budget
            let thinkingBudget: number | null = null;

            // Check if model has any of the defined suffixes
            for (const [suffix, budget] of Object.entries(THINKING_BUDGET_CONFIGS)) {
                if (model.endsWith(suffix)) {
                    thinkingBudget = budget;
                    model = model.slice(0, -suffix.length);
                    break;
                }
            }

            // Prepare generation config
            const config: GenerateContentConfig = {
                thinkingConfig: {
                    includeThoughts: true,
                },
            };

            // Add thinking configuration if suffix was detected
            if (thinkingBudget) {
                // thinkingBudget exists in runtime API but not in TypeScript definitions
                (config as any).thinkingConfig.thinkingBudget = thinkingBudget;
            }
            if (settings?.stop_sequence) {
                config.stopSequences = [settings.stop_sequence];
            }
            if (settings?.temperature) {
                config.temperature = settings.temperature;
            }
            if (settings?.max_tokens) {
                config.maxOutputTokens = settings.max_tokens;
            }
            if (settings?.top_p) {
                config.topP = settings.top_p;
            }
            if (settings?.top_k) {
                config.topK = settings.top_k;
            }
            if (settings?.json_schema) {
                config.responseMimeType = 'application/json';
                config.responseSchema = settings.json_schema.schema;

                // Remove additionalProperties from schema as Gemini doesn't support it
                if (config.responseSchema) {
                    const removeAdditionalProperties = (obj: any): void => {
                        if (!obj || typeof obj !== 'object') {
                            return;
                        }

                        // Delete additionalProperties at current level
                        if ('additionalProperties' in obj) {
                            delete obj.additionalProperties;
                        }

                        // Process nested objects in properties
                        if (obj.properties && typeof obj.properties === 'object') {
                            Object.values(obj.properties).forEach(prop => {
                                removeAdditionalProperties(prop);
                            });
                        }

                        // Process items in arrays
                        if (obj.items) {
                            removeAdditionalProperties(obj.items);
                        }

                        // Process oneOf, anyOf, allOf schemas
                        ['oneOf', 'anyOf', 'allOf'].forEach(key => {
                            if (obj[key] && Array.isArray(obj[key])) {
                                obj[key].forEach((subSchema: any) => {
                                    removeAdditionalProperties(subSchema);
                                });
                            }
                        });
                    };

                    removeAdditionalProperties(config.responseSchema);
                }
            }

            // Check if any tools require special handling
            let hasGoogleWebSearch = false;
            let functionDeclarations: FunctionDeclaration[] = [];
            if (tools && tools.length > 0) {
                // Check for Google web search tool
                hasGoogleWebSearch = tools.some(tool => tool.definition.function.name === 'google_web_search');

                // Configure standard function calling tools
                functionDeclarations = await convertToGeminiFunctionDeclarations(tools);
                let allowedFunctionNames: string[] = [];

                if (functionDeclarations.length > 0) {
                    config.tools = [{ functionDeclarations }];

                    if (settings?.tool_choice) {
                        let toolChoice: FunctionCallingConfigMode | undefined;

                        if (
                            typeof settings.tool_choice === 'object' &&
                            settings.tool_choice?.type === 'function' &&
                            settings.tool_choice?.function?.name
                        ) {
                            toolChoice = FunctionCallingConfigMode.ANY;
                            allowedFunctionNames = [settings.tool_choice.function.name];
                        } else if (settings.tool_choice === 'required') {
                            toolChoice = FunctionCallingConfigMode.ANY;
                        } else if (settings.tool_choice === 'auto') {
                            toolChoice = FunctionCallingConfigMode.AUTO;
                        } else if (settings.tool_choice === 'none') {
                            toolChoice = FunctionCallingConfigMode.NONE;
                        }

                        if (toolChoice) {
                            config.toolConfig = {
                                functionCallingConfig: {
                                    mode: toolChoice,
                                },
                            };
                            if (allowedFunctionNames.length > 0) {
                                config.toolConfig.functionCallingConfig.allowedFunctionNames = allowedFunctionNames;
                            }
                        }
                    }
                } else if (!hasGoogleWebSearch) {
                    console.warn('Tools were provided but resulted in empty declarations after conversion.');
                }
            }

            // Set up Google Search grounding if needed
            if (hasGoogleWebSearch) {
                console.log('[Gemini] Enabling Google Search grounding');
                // Configure the Google Search grounding. Do not set functionCallingConfig when only using
                // googleSearch, as it is not a function declaration tool.
                const toolGroups: NonNullable<GenerateContentConfig['tools']> = [{ googleSearch: {} }];
                if (functionDeclarations.length > 0) {
                    toolGroups.push({ functionDeclarations });
                }
                config.tools = toolGroups;

                if (functionDeclarations.length === 0) {
                    delete config.toolConfig;
                }
            }

            const requestParams: GenerateContentParameters = {
                model,
                contents,
                config,
            };

            const loggedRequestId = log_llm_request(
                agent.agent_id,
                'google',
                model,
                requestParams,
                new Date(),
                requestId,
                agent.tags
            );
            requestId = loggedRequestId;

            // Wait while system is paused before making the API request
            const { waitWhilePaused } = await import('../utils/pause_controller.js');
            await waitWhilePaused(100, agent.abortSignal);

            // --- Start streaming with retry logic ---
            const getStreamFn = () => this.client.models.generateContentStream(requestParams);
            const response = this.retryStreamOnIncompleteJson(getStreamFn);

            let usageMetadata: GenerateContentResponseUsageMetadata | undefined;

            // --- Process the stream chunks ---
            for await (const chunk of response) {
                chunks.push(chunk);

                if (chunk.responseId) {
                    messageId = chunk.responseId;
                }

                // Log raw chunks for debugging if needed
                // console.debug('[Gemini] Raw chunk:', JSON.stringify(chunk));
                // Check if the system was paused during the stream
                if (isPaused()) {
                    console.log(`[Gemini] System paused during stream for model ${model}. Waiting...`);

                    // Wait while paused instead of aborting
                    await waitWhilePaused(100, agent.abortSignal);

                    // If we're resuming, continue processing
                    console.log(`[Gemini] System resumed, continuing stream for model ${model}`);
                }

                // Handle function calls (if present)
                if (chunk.functionCalls && chunk.functionCalls.length > 0) {
                    for (const fc of chunk.functionCalls) {
                        if (fc && fc.name) {
                            yield withRequestId({
                                type: 'tool_start',
                                tool_call: {
                                    id: fc.id || `call_${uuidv4()}`,
                                    type: 'function',
                                    function: {
                                        name: fc.name,
                                        arguments: JSON.stringify(fc.args || {}),
                                    },
                                },
                            });
                        }
                    }
                }

                for (const candidate of chunk.candidates) {
                    if (candidate.content?.parts) {
                        for (const part of candidate.content.parts) {
                            let text = '';
                            if (part.text) {
                                text += part.text;
                            }
                            if (part.executableCode) {
                                if (text) {
                                    text += '\n\n';
                                }
                                text += part.executableCode;
                            }
                            if (part.videoMetadata) {
                                if (text) {
                                    text += '\n\n';
                                }
                                text += JSON.stringify(part.videoMetadata);
                            }
                            if (text.length > 0) {
                                const ev: MessageEvent = {
                                    type: 'message_delta',
                                    content: '',
                                    message_id: messageId,
                                    order: eventOrder++,
                                };
                                if (part.thought) {
                                    thoughtBuffer += text;
                                    ev.thinking_content = text;
                                } else {
                                    contentBuffer += text;
                                    ev.content = text;
                                }
                                yield ev as MessageEvent;
                            }
                            if (part.inlineData?.data) {
                                yield withRequestId({
                                    type: 'file_complete',
                                    data_format: 'base64',
                                    data: part.inlineData.data,
                                    mime_type: part.inlineData.mimeType || 'image/png',
                                    message_id: uuidv4(),
                                    order: eventOrder++,
                                });
                            }
                        }
                    }
                    const gChunks = candidate.groundingMetadata?.groundingChunks;
                    if (Array.isArray(gChunks)) {
                        const newChunks = gChunks.filter(c => c?.web?.uri && !shownGrounding.has(c.web.uri));
                        if (newChunks.length) {
                            newChunks.forEach(c => shownGrounding.add(c.web.uri));
                            const formatted = formatGroundingChunks(newChunks);
                            yield withRequestId({
                                type: 'message_delta',
                                content: '\n\nSearch Results:\n' + formatted + '\n',
                                message_id: messageId,
                                order: eventOrder++,
                            });
                            contentBuffer += '\n\nSearch Results:\n' + formatted + '\n';
                        }
                    }
                }
                if (chunk.usageMetadata) {
                    // Always use the latest usage metadata
                    usageMetadata = chunk.usageMetadata;
                }
            }

            if (usageMetadata) {
                const calculatedUsage = costTracker.addUsage({
                    model,
                    input_tokens: usageMetadata.promptTokenCount || 0,
                    output_tokens: usageMetadata.candidatesTokenCount || 0,
                    cached_tokens: usageMetadata.cachedContentTokenCount || 0,
                    metadata: {
                        total_tokens: usageMetadata.totalTokenCount || 0,
                        reasoning_tokens: usageMetadata.thoughtsTokenCount || 0,
                        tool_tokens: usageMetadata.toolUsePromptTokenCount || 0,
                    },
                });

                // Only yield cost_update event if no global event handler is set
                // This prevents duplicate events when using the global EventController
                if (!hasEventHandler()) {
                    yield withRequestId({
                        type: 'cost_update',
                        usage: {
                            ...calculatedUsage,
                            total_tokens: usageMetadata.totalTokenCount || 0,
                        },
                    });
                }
            } else {
                console.warn('[Gemini] No usage metadata found in the response. Using token estimation.');

                // Estimate input tokens from the contents
                let inputText = '';
                for (const content of contents) {
                    if (content.parts) {
                        for (const part of content.parts) {
                            if (part.text) {
                                inputText += part.text + '\n';
                            }
                        }
                    }
                }

                // Use addEstimatedUsage which returns the calculated usage
                const calculatedUsage = costTracker.addEstimatedUsage(model, inputText, contentBuffer + thoughtBuffer, {
                    provider: 'gemini',
                });

                // Only yield cost_update event if no global event handler is set
                // This prevents duplicate events when using the global EventController
                if (!hasEventHandler()) {
                    yield withRequestId({
                        type: 'cost_update',
                        usage: {
                            ...calculatedUsage,
                            total_tokens: calculatedUsage.input_tokens + calculatedUsage.output_tokens,
                        },
                    });
                }
            }

            // --- Stream Finished, Emit Final Events ---
            if (contentBuffer || thoughtBuffer) {
                yield withRequestId({
                    type: 'message_complete',
                    content: contentBuffer,
                    thinking_content: thoughtBuffer,
                    message_id: messageId,
                });
            }
        } catch (error) {
            log_llm_error(requestId, error);
            //console.error('Error during Gemini stream processing:', error);
            const errorMessage = error instanceof Error ? error.stack || error.message : String(error);

            // Add special handling for incomplete JSON errors in logs
            if (errorMessage.includes('Incomplete JSON segment')) {
                console.error(
                    '[Gemini] Stream terminated with incomplete JSON. This may indicate network issues or timeouts.'
                );
            }

            // 1️⃣  Dump the object exactly as Node sees it
            console.error('\n=== Gemini error ===');
            console.dir(error, { depth: null }); // prints enumerable props

            // 3️⃣  JSON-serialize every own property
            console.error('\n=== JSON dump of error ===');
            console.error(truncateLargeValues(JSON.stringify(error, Object.getOwnPropertyNames(error), 2)));

            // 5️⃣  Fallback: iterate keys manually (helps spot symbols, etc.)
            console.error('\n=== Manual property walk ===');
            for (const key of Reflect.ownKeys(error)) {
                console.error(`${String(key)}:`, truncateLargeValues(error[key]));
            }

            yield withRequestId({
                type: 'error',
                error: `Gemini error ${model}: ${errorMessage}`,
            });

            // Emit any partial content if we haven't yielded a tool call
            if (contentBuffer || thoughtBuffer) {
                yield withRequestId({
                    type: 'message_complete',
                    content: contentBuffer,
                    thinking_content: thoughtBuffer,
                    message_id: messageId,
                });
            }
        } finally {
            log_llm_response(requestId, chunks);
        }
    }

    /**
     * Generate images using Google's Imagen models
     * @param prompt Text description of the image to generate
     * @param opts Optional parameters for image generation
     * @returns Promise resolving to generated image data
     */
    async createImage(
        prompt: string,
        model: string,
        agent: AgentDefinition,
        opts?: ImageGenerationOpts
    ): Promise<string[]> {
        const requestId = `req_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
        let finalRequestId = requestId; // Define in outer scope
        try {
            // Extract options with defaults
            // Default to Gemini's native image model (preview)
            model = model || 'gemini-2.5-flash-image-preview';
            const numberOfImages = opts?.n || 1;

            const { getToolsFromAgent } = await import('../utils/agent.js');
            const tools: ToolFunction[] | undefined = agent ? await getToolsFromAgent(agent) : [];
            const hasGoogleWebSearch = tools?.some(tool => tool.definition.function.name === 'google_web_search');
            const hasOtherTools = tools?.some(tool => tool.definition.function.name !== 'google_web_search');
            if (hasOtherTools) {
                console.warn('[Gemini] Image generation ignores function tools; only google_web_search is supported.');
            }

            // Map size to an aspect ratio where supported (Imagen API only)
            let aspectRatio = '1:1'; // square by default
            if (opts?.size === 'landscape') aspectRatio = '16:9';
            else if (opts?.size === 'portrait') aspectRatio = '9:16';

            console.log(
                `[Gemini] Generating ${numberOfImages} image(s) with model ${model}, prompt: "${prompt.substring(0, 100)}${prompt.length > 100 ? '...' : ''}"`
            );

            // If using Gemini image models that expose image parts via generateContentStream
            if (model.includes('gemini-2.5-flash-image-preview') || model.includes('gemini-3-pro-image-preview')) {
                // Build a constraints hint to emulate feature parity (aspect ratio, size, style, background)
                const constraints: string[] = [];
                // Map size to human-friendly instructions
                const sizeMap: Record<string, { ar?: string; px?: string }> = {
                    square: { ar: '1:1', px: '1024x1024' },
                    landscape: { ar: '16:9' },
                    portrait: { ar: '9:16' },
                    '256x256': { ar: '1:1', px: '256x256' },
                    '512x512': { ar: '1:1', px: '512x512' },
                    '1024x1024': { ar: '1:1', px: '1024x1024' },
                    '1536x1024': { ar: '3:2', px: '1536x1024' },
                    '1024x1536': { ar: '2:3', px: '1024x1536' },
                    '1792x1024': { ar: '16:9', px: '1792x1024' },
                    '1024x1792': { ar: '9:16', px: '1024x1792' },
                };
                const sm = opts?.size ? sizeMap[String(opts.size)] : undefined;
                if (sm?.ar) constraints.push(`Aspect ratio: ${sm.ar}.`);
                if (sm?.px) constraints.push(`Target size: ${sm.px} pixels (approximate).`);
                if (opts?.style) constraints.push(`Style: ${opts.style}.`);
                if (opts?.background) constraints.push(`Background: ${opts.background} (use transparency if supported).`);

                // Preserve user-facing size/quality controls for streaming image models.
                // The Gemini SDK supports `imageConfig` on GenerateContentConfig.
                const imageConfig: { aspectRatio?: string; imageSize?: string } = {};
                if (sm?.ar) imageConfig.aspectRatio = sm.ar;

                const qualityKey = typeof opts?.quality === 'string' ? opts.quality.toLowerCase() : '';
                const imageSizeMap: Record<string, '1K' | '2K' | '4K'> = {
                    low: '1K',
                    standard: '2K',
                    medium: '2K',
                    hd: '4K',
                    high: '4K',
                };
                const imageSize = imageSizeMap[qualityKey];
                if (imageSize) imageConfig.imageSize = imageSize;
                const perImageCost = this.getImageCost(model, imageSize);

                const constraintText = constraints.length
                    ? `\n\nImage constraints (please prioritize):\n- ${constraints.join('\n- ')}`
                    : '';

                const makeOne = async (): Promise<string[]> => {
                    const requestParams: GenerateContentParameters = {
                        model,
                        contents: [
                            {
                                role: 'user',
                                parts: [
                                    // If source images provided, include them as parts first
                                    ...(Array.isArray(opts?.source_images)
                                        ? (opts!.source_images as any[])
                                              .map((img: any) => typeof img === 'string' ? { _src: img } : img)
                                              .map((it: any) => {
                                                  const src: string = it?.data || it?._src || it;
                                                  if (typeof src !== 'string') return null;
                                                  if (src.startsWith('data:')) {
                                                      // data URL
                                                      const m = /^data:([^;]+);base64,(.+)$/i.exec(src);
                                                      if (!m) return null;
                                                      return {
                                                          inlineData: {
                                                              mimeType: m[1] || 'image/png',
                                                              data: m[2],
                                                          },
                                                      };
                                                  }
                                                  // Assume http(s) URL
                                                  return {
                                                      fileData: {
                                                          mimeType: inferImageMimeTypeFromUrl(src),
                                                          fileUri: src,
                                                      },
                                                  };
                                              })
                                              .filter(Boolean)
                                        : typeof opts?.source_images === 'string'
                                        ? [
                                              (() => {
                                                  const s = String(opts?.source_images);
                                                  if (s.startsWith('data:')) {
                                                      const m = /^data:([^;]+);base64,(.+)$/i.exec(s);
                                                      return m
                                                          ? { inlineData: { mimeType: m[1] || 'image/png', data: m[2] } }
                                                          : null;
                                                  }
                                                  return {
                                                      fileData: {
                                                          mimeType: inferImageMimeTypeFromUrl(s),
                                                          fileUri: s,
                                                      },
                                                  };
                                              })(),
                                          ].filter(Boolean)
                                        : []),
                                    { text: `${prompt}${constraintText}` },
                                ],
                            },
                        ],
                        config: {
                            responseModalities: [Modality.IMAGE, Modality.TEXT],
                            ...(Object.keys(imageConfig).length ? { imageConfig } : {}),
                            ...(hasGoogleWebSearch ? { tools: [{ googleSearch: {} }] } : {}),
                        },
                    };

                    const loggedRequestId = log_llm_request(
                        agent.agent_id || 'default',
                        'gemini',
                        model,
                        requestParams,
                        new Date(),
                        requestId,
                        agent.tags
                    );
                    finalRequestId = loggedRequestId;

                    const response = await this.client.models.generateContentStream(requestParams);
                    const images: string[] = [];
                    let usageMetadata: GenerateContentResponseUsageMetadata | undefined;

                    for await (const chunk of response) {
                        if (chunk.usageMetadata) {
                            usageMetadata = chunk.usageMetadata;
                        }
                        if (!chunk.candidates) continue;
                        for (const cand of chunk.candidates) {
                            const parts = cand.content?.parts || [];
                            for (const part of parts) {
                                if (part.inlineData?.data) {
                                    const mime = part.inlineData.mimeType || 'image/png';
                                    images.push(`data:${mime};base64,${part.inlineData.data}`);
                                }
                            }
                        }
                    }

                    // Cost tracking per call
                    if (images.length > 0) {
                        const baseMetadata = {
                            cost_per_image: perImageCost,
                            ...(imageSize ? { image_size: imageSize } : {}),
                        };
                        if (usageMetadata) {
                            const promptTokensRaw = usageMetadata.promptTokenCount || 0;
                            const toolTokens = usageMetadata.toolUsePromptTokenCount || 0;
                            const thoughtTokens = usageMetadata.thoughtsTokenCount || 0;
                            const candidateTokens = usageMetadata.candidatesTokenCount || 0;
                            const totalTokens = usageMetadata.totalTokenCount || 0;
                            let promptTokens = promptTokensRaw;

                            if (promptTokens === 0 && totalTokens > 0) {
                                const derivedPrompt = totalTokens - candidateTokens - toolTokens - thoughtTokens;
                                if (derivedPrompt > 0) {
                                    promptTokens = derivedPrompt;
                                }
                            }

                            const inputTokens = promptTokens + toolTokens;
                            const outputTokens = candidateTokens + thoughtTokens;
                            costTracker.addUsage({
                                model,
                                image_count: images.length,
                                input_tokens: inputTokens,
                                output_tokens: outputTokens,
                                cached_tokens: usageMetadata.cachedContentTokenCount || 0,
                                // Pass through request correlation id so streaming consumers receive cost_update
                                request_id: opts?.request_id,
                                metadata: {
                                    ...baseMetadata,
                                    total_tokens: totalTokens,
                                    reasoning_tokens: thoughtTokens,
                                    tool_tokens: toolTokens,
                                },
                            });
                        } else {
                            costTracker.addUsage({
                                model,
                                image_count: images.length,
                                // Pass through request correlation id so streaming consumers receive cost_update
                                request_id: opts?.request_id,
                                metadata: baseMetadata,
                            });
                        }
                    }
                    return images;
                };

                const allImages: string[] = [];
                const calls = Math.max(1, numberOfImages);
                for (let i = 0; i < calls; i++) {
                    const imgs = await makeOne();
                    // Some responses may contain more than one image; respect n by slicing
                    for (const img of imgs) {
                        if (allImages.length < numberOfImages) allImages.push(img);
                    }
                    if (allImages.length >= numberOfImages) break;
                }

                if (allImages.length === 0) {
                    throw new Error('No images returned from Gemini 2.5 Flash Image model');
                }

                log_llm_response(finalRequestId, {
                    model,
                    image_count: allImages.length,
                    cost: allImages.length * perImageCost,
                });
                return allImages;
            }

            // Otherwise use the Imagen API
            const requestParams = {
                model,
                prompt,
                config: {
                    numberOfImages,
                    aspectRatio,
                    includeSafetyAttributes: false,
                },
            };

            // Log the request
            const loggedRequestId = log_llm_request(
                agent.agent_id || 'default',
                'gemini',
                model,
                requestParams,
                new Date(),
                requestId,
                agent.tags
            );
            // Use the logged request ID for consistency
            finalRequestId = loggedRequestId;

            // Use Gemini/Imagen API for image generation
            const response = await this.client.models.generateImages(requestParams);

            // Process the response (Imagen)
            const images: string[] = [];

            if (response.generatedImages && response.generatedImages.length > 0) {
                for (const generatedImage of response.generatedImages) {
                    if (generatedImage.image?.imageBytes) {
                        // Convert to base64 data URL
                        const base64Image = `data:image/png;base64,${generatedImage.image.imageBytes}`;
                        images.push(base64Image);
                    }
                }

                // Calculate cost - Imagen pricing
                const perImageCost = this.getImageCost(model);

                costTracker.addUsage({
                    model,
                    image_count: images.length,
                    cost: images.length * perImageCost,
                    request_id: opts?.request_id,
                    metadata: {
                        aspect_ratio: aspectRatio,
                        cost_per_image: perImageCost,
                    },
                });
            }

            if (images.length === 0) {
                throw new Error('No images returned from Gemini/Imagen');
            }

            // Log the successful response
            const perImageCost = this.getImageCost(model);
            log_llm_response(finalRequestId, {
                model,
                image_count: images.length,
                aspect_ratio: aspectRatio,
                cost: images.length * perImageCost,
            });

            // Return standardized result
            return images;
        } catch (error) {
            log_llm_error(finalRequestId, error);
            console.error('[Gemini] Error generating image:', truncateLargeValues(error));
            throw error;
        }
    }

    /**
     * Get the cost of generating an image with Gemini/Imagen
     */
    private getImageCost(model: string, imageSize?: '1K' | '2K' | '4K'): number {
        // Pricing (as of latest docs)
        if (model.includes('gemini-2.5-flash-image-preview')) {
            // $0.039 per image (1024x1024 ~1290 tokens @ $30 / 1M)
            return 0.039;
        } else if (model.includes('gemini-3-pro-image-preview')) {
            // Gemini 3 Pro Image (preview): 1K/2K = $0.134, 4K = $0.24 (standard generation)
            if (imageSize === '4K') return 0.24;
            return 0.134;
        }
        // Imagen pricing
        if (model.includes('imagen-3')) {
            return 0.04; // $0.040 per image for Imagen 3
        } else if (model.includes('imagen-2')) {
            return 0.02; // $0.020 per image for Imagen 2
        }

        // Default pricing
        return 0.04;
    }

    /**
     * Generate speech audio from text using Gemini's Text-to-Speech models
     * @param text Text to convert to speech
     * @param model Model ID for TTS (e.g., 'gemini-2.5-flash-preview-tts')
     * @param opts Optional parameters for voice generation
     * @returns Promise resolving to audio stream or buffer
     */
    async createVoice(
        text: string,
        model: string,
        agent: AgentDefinition,
        opts?: VoiceGenerationOpts
    ): Promise<ReadableStream<Uint8Array> | ArrayBuffer> {
        const requestId = `req_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
        let finalRequestId = requestId; // Define finalRequestId in outer scope
        try {
            console.log(
                `[Gemini] Generating speech with model ${model}, text: "${text.substring(0, 100)}${text.length > 100 ? '...' : ''}"`
            );

            // Map voice options to Gemini's voice names
            const voiceName = this.mapVoiceToGemini(opts?.voice);

            // Build speech config
            const speechConfig: SpeechConfig = {
                voiceConfig: {
                    prebuiltVoiceConfig: {
                        voiceName: voiceName,
                    },
                },
            };

            // Prepare generation config
            const config: GenerateContentConfig = {
                responseModalities: [Modality.AUDIO],
                speechConfig: speechConfig,
            };

            // Speed adjustment is not directly supported in Gemini TTS
            // But we can suggest it in the prompt
            let say_prefix = '';
            let say_postfix = '';
            if (opts?.speed && opts.speed !== 1.0) {
                const speedDescription =
                    opts.speed < 1.0
                        ? `slowly at ${Math.round(opts.speed * 100)}% speed`
                        : `quickly at ${Math.round(opts.speed * 100)}% speed`;
                say_postfix = speedDescription;
            }
            if (opts?.affect) {
                say_prefix = `Sound ${opts.affect}`;
            }
            if (say_postfix || say_prefix) {
                if (say_postfix && say_prefix) {
                    text = `${say_prefix} and say ${say_postfix}:\n${text}`;
                } else if (say_postfix) {
                    text = `Say ${say_postfix}:\n${text}`;
                } else if (say_prefix) {
                    text = `${say_prefix} and say:\n${text}`;
                }
            }

            // Log the request
            const requestParams = {
                model,
                text_length: text.length,
                voice: voiceName,
                speed: opts?.speed,
                affect: opts?.affect,
                config,
            };

            const loggedRequestId = log_llm_request(
                agent.agent_id || 'default',
                'gemini',
                model,
                requestParams,
                new Date(),
                requestId,
                agent.tags
            );
            // Use the logged request ID for consistency
            finalRequestId = loggedRequestId;

            // Use streaming API for better performance
            console.log(`[Gemini] Starting generateContentStream call...`);
            const streamPromise = this.client.models.generateContentStream({
                model,
                contents: [{ role: 'user', parts: [{ text }] }],
                config,
            });

            // Track usage
            const textLength = text.length;
            costTracker.addUsage({
                model,
                input_tokens: Math.ceil(textLength / 4), // Rough estimate
                output_tokens: 0,
                metadata: {
                    voice: voiceName,
                    text_length: textLength,
                    type: 'voice_generation',
                },
            });

            // Return as stream if requested
            if (opts?.stream) {
                // Create a transform stream to handle the streaming response
                // Since Gemini returns all data at once, create a more efficient stream
                const stream = await streamPromise;
                const chunks: Uint8Array[] = [];

                for await (const chunk of stream) {
                    if (chunk.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data) {
                        const part = chunk.candidates[0].content.parts[0];
                        const binaryString = atob(part.inlineData.data);
                        const bytes = new Uint8Array(binaryString.length);
                        for (let i = 0; i < binaryString.length; i++) {
                            bytes[i] = binaryString.charCodeAt(i);
                        }
                        chunks.push(bytes);

                        if (part.inlineData.mimeType) {
                            console.log(`[Gemini] Audio format: ${part.inlineData.mimeType}`);
                        }
                    }
                }

                // Combine all chunks
                const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
                const combined = new Uint8Array(totalLength);
                let offset = 0;
                for (const chunk of chunks) {
                    combined.set(chunk, offset);
                    offset += chunk.length;
                }

                // Log the successful response
                log_llm_response(finalRequestId, {
                    model,
                    text_length: textLength,
                    voice: voiceName,
                    audio_size: combined.length,
                    stream: true,
                });

                // Return as a single-chunk stream for efficiency
                return new ReadableStream<Uint8Array>({
                    start(controller) {
                        controller.enqueue(combined);
                        controller.close();
                    },
                });
            }

            // For non-streaming, collect all chunks
            let allData = new Uint8Array(0);
            const stream = await streamPromise;
            for await (const chunk of stream) {
                if (!chunk.candidates || !chunk.candidates[0]?.content?.parts) {
                    continue;
                }

                const part = chunk.candidates[0].content.parts[0];
                if (part?.inlineData?.data) {
                    const binaryString = atob(part.inlineData.data);
                    const bytes = new Uint8Array(binaryString.length);
                    for (let i = 0; i < binaryString.length; i++) {
                        bytes[i] = binaryString.charCodeAt(i);
                    }

                    // Append to allData
                    const newData = new Uint8Array(allData.length + bytes.length);
                    newData.set(allData);
                    newData.set(bytes, allData.length);
                    allData = newData;
                }
            }

            if (allData.length === 0) {
                throw new Error('No audio data generated from Gemini TTS');
            }

            // Log the successful response
            log_llm_response(finalRequestId, {
                model,
                text_length: textLength,
                voice: voiceName,
                audio_size: allData.length,
                stream: false,
            });

            // Return as ArrayBuffer
            return allData.buffer;
        } catch (error) {
            log_llm_error(finalRequestId, error);
            console.error('[Gemini] Error generating voice:', truncateLargeValues(error));
            throw error;
        }
    }

    /**
     * Map common voice names to Gemini's prebuilt voice names
     */
    private mapVoiceToGemini(voice?: string): string {
        // Gemini's available voices (as of the documentation)
        const geminiVoices = [
            'Kore',
            'Puck',
            'Charon',
            'Fenrir',
            'Aoede',
            'Glados',
            // Add more as they become available
        ];

        if (!voice) {
            return 'Kore'; // Default voice
        }

        // Check if it's already a valid Gemini voice name
        if (geminiVoices.includes(voice)) {
            return voice;
        }

        // Map common voice names to Gemini voices
        const voiceMap: Record<string, string> = {
            // OpenAI-style voices to Gemini mapping
            alloy: 'Kore',
            echo: 'Puck',
            fable: 'Charon',
            onyx: 'Fenrir',
            nova: 'Aoede',
            shimmer: 'Glados',

            // Gender/style based mapping
            male: 'Puck',
            female: 'Kore',
            neutral: 'Charon',
            young: 'Aoede',
            mature: 'Fenrir',
            robotic: 'Glados',

            // Direct names (case-insensitive)
            kore: 'Kore',
            puck: 'Puck',
            charon: 'Charon',
            fenrir: 'Fenrir',
            aoede: 'Aoede',
            glados: 'Glados',
        };

        const mappedVoice = voiceMap[voice.toLowerCase()];
        if (mappedVoice) {
            return mappedVoice;
        }

        // If no mapping found, use default
        console.warn(`[Gemini] Unknown voice '${voice}', using default voice 'Kore'`);
        return 'Kore';
    }

    /**
     * Create transcription from audio stream using Gemini Live API
     */
    async *createTranscription(
        audio: TranscriptionAudioSource,
        agent: AgentDefinition,
        model: string,
        opts?: TranscriptionOpts
    ): AsyncGenerator<TranscriptionEvent> {
        const requestId = `req_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
        let finalRequestId = requestId; // Define in outer scope
        let session: any = null;
        let isConnected = false;

        try {
            // Initialize AI client with v1beta (Live also available on v1beta)
            const ai = new GoogleGenAI({
                apiKey: this.apiKey,
                httpOptions: { apiVersion: 'v1beta' },
            });

            // Set up real-time configuration
            const realtimeInputConfig = opts?.realtimeInputConfig || {
                automaticActivityDetection: {
                    disabled: false,
                    startOfSpeechSensitivity: 'START_SENSITIVITY_HIGH',
                    endOfSpeechSensitivity: 'END_SENSITIVITY_LOW',
                },
            };
            const speechConfig = opts?.speechConfig || {
                languageCode: 'en-US',
            };

            // Extract custom instructions from agent if provided
            const systemInstruction =
                agent.instructions || `You should reply only "OK" to every single message from the user. Nothing else.`;

            // Connect to Gemini Live API
            console.log('[Gemini] Connecting to Live API for transcription...');

            // Create a promise that resolves when connected
            const connectionPromise = new Promise<void>((resolve, reject) => {
                const timeout = setTimeout(() => {
                    reject(new Error('Connection timeout'));
                }, 10000); // 10 second timeout for faster failure

                const config = {
                    responseModalities: [Modality.TEXT],
                    mediaResolution: MediaResolution.MEDIA_RESOLUTION_MEDIUM,
                    speechConfig,
                    realtimeInputConfig,
                    systemInstruction: {
                        parts: [{ text: systemInstruction }],
                    },
                    inputAudioTranscription: {}, // Enable input audio transcription
                };
                ai.live
                    .connect({
                        model: model,
                        config,
                        callbacks: {
                            onopen: () => {
                                clearTimeout(timeout);
                                console.log('[Gemini] Live session connected');
                                isConnected = true;
                                resolve();
                            },
                            onmessage: async (msg: any) => {
                                // Handle input audio transcription (user's speech)
                                if (msg.serverContent?.inputTranscription?.text) {
                                    const previewEvent: TranscriptionEvent = {
                                        type: 'transcription_turn_delta',
                                        timestamp: new Date().toISOString(),
                                        delta: msg.serverContent.inputTranscription.text,
                                    };
                                    transcriptEvents.push(previewEvent);
                                }

                                // Check for turn complete
                                if (msg.serverContent?.turnComplete) {
                                    const turnEvent: TranscriptionEvent = {
                                        type: 'transcription_turn_complete',
                                        timestamp: new Date().toISOString(),
                                        // text will be added by ensembleListen
                                    };
                                    transcriptEvents.push(turnEvent);
                                }

                                // Handle usage metadata
                                if (msg.usageMetadata) {
                                    // Track usage with modality information
                                    // Handle prompt tokens (input) by modality
                                    if (
                                        msg.usageMetadata.promptTokensDetails &&
                                        Array.isArray(msg.usageMetadata.promptTokensDetails)
                                    ) {
                                        for (const detail of msg.usageMetadata.promptTokensDetails) {
                                            if (detail.modality && detail.tokenCount > 0) {
                                                costTracker.addUsage({
                                                    model: model,
                                                    input_tokens: detail.tokenCount,
                                                    output_tokens: 0,
                                                    input_modality: detail.modality.toLowerCase(),
                                                    // Don't set output_modality for input tokens
                                                    metadata: {
                                                        totalTokens: msg.usageMetadata.totalTokenCount || 0,
                                                        source: 'gemini-live-transcription',
                                                        modalityType: 'input',
                                                        originalModality: detail.modality,
                                                    },
                                                });
                                            }
                                        }
                                    }

                                    // Handle response tokens (output) by modality
                                    if (
                                        msg.usageMetadata.responseTokensDetails &&
                                        Array.isArray(msg.usageMetadata.responseTokensDetails)
                                    ) {
                                        for (const detail of msg.usageMetadata.responseTokensDetails) {
                                            if (detail.modality && detail.tokenCount > 0) {
                                                costTracker.addUsage({
                                                    model: model,
                                                    input_tokens: 0,
                                                    output_tokens: detail.tokenCount,
                                                    // Don't set input_modality for output tokens
                                                    output_modality: detail.modality.toLowerCase(),
                                                    metadata: {
                                                        totalTokens: msg.usageMetadata.totalTokenCount || 0,
                                                        source: 'gemini-live-transcription',
                                                        modalityType: 'output',
                                                        originalModality: detail.modality,
                                                    },
                                                });
                                            }
                                        }
                                    }

                                    // Fallback for cases without detailed modality breakdown
                                    if (
                                        (!msg.usageMetadata.promptTokensDetails ||
                                            msg.usageMetadata.promptTokensDetails.length === 0) &&
                                        (!msg.usageMetadata.responseTokensDetails ||
                                            msg.usageMetadata.responseTokensDetails.length === 0)
                                    ) {
                                        costTracker.addUsage({
                                            model: model,
                                            input_tokens: msg.usageMetadata.promptTokenCount || 0,
                                            output_tokens: msg.usageMetadata.responseTokenCount || 0,
                                            input_modality: 'audio',
                                            output_modality: 'text',
                                            metadata: {
                                                totalTokens: msg.usageMetadata.totalTokenCount || 0,
                                                source: 'gemini-live-transcription',
                                            },
                                        });
                                    }
                                }
                            },
                            onerror: (err: any) => {
                                console.error(
                                    '[Gemini] Live API error:',
                                    truncateLargeValues({
                                        code: err.code,
                                        reason: err.reason,
                                        wasClean: err.wasClean,
                                    })
                                );
                                connectionError = err;
                            },
                            onclose: (event?: any) => {
                                console.log('[Gemini] Live session closed');
                                if (event) {
                                    console.log('[Gemini] Close event details:', {
                                        code: event.code,
                                        reason: event.reason,
                                        wasClean: event.wasClean,
                                    });
                                }
                                isConnected = false;
                            },
                        },
                    })
                    .then(async s => {
                        session = s;
                    });
            });

            // Store events to yield - use pre-allocated array for better performance
            const transcriptEvents: TranscriptionEvent[] = [];
            let connectionError: any = null;

            // Wait for connection
            await connectionPromise;

            // Log the request
            const requestParams = {
                model,
                systemInstruction,
                realtimeInputConfig,
                speechConfig,
                mediaResolution: MediaResolution.MEDIA_RESOLUTION_MEDIUM,
            };

            const loggedRequestId = log_llm_request(
                agent.agent_id,
                'gemini',
                model,
                requestParams,
                new Date(),
                requestId,
                agent.tags
            );
            // Use the logged request ID for consistency
            finalRequestId = loggedRequestId;

            // Process audio stream
            const audioStream = normalizeAudioSource(audio);
            const reader = audioStream.getReader();

            // Helper to send audio chunk with pre-allocated base64 encoding
            const sendAudioChunk = async (chunk: Buffer) => {
                try {
                    // Use faster base64 encoding method
                    const base64Data = chunk.toString('base64');
                    await session.sendRealtimeInput({
                        media: {
                            mimeType: 'audio/pcm;rate=16000',
                            data: base64Data,
                        },
                    });
                } catch (err) {
                    console.error('[Gemini] Error sending audio chunk:', truncateLargeValues(err));
                    connectionError = err;
                    throw err;
                }
            };

            // Read and process audio
            try {
                while (true) {
                    const { done, value } = await reader.read();

                    if (done) break;

                    if (value && session && isConnected) {
                        // Send chunks immediately as they arrive
                        // Avoid creating new Buffer if value is already a Buffer
                        const chunk = value instanceof Buffer ? value : Buffer.from(value);
                        await sendAudioChunk(chunk);
                    }

                    // Yield any pending events more efficiently
                    if (transcriptEvents.length > 0) {
                        const events = transcriptEvents.splice(0, transcriptEvents.length);
                        for (const event of events) {
                            yield event;
                        }
                    }

                    // Check for connection errors
                    if (connectionError) {
                        throw connectionError;
                    }
                }

                // Wait a bit for final responses
                await new Promise(resolve => setTimeout(resolve, 1000));

                // Yield any remaining events
                if (transcriptEvents.length > 0) {
                    const events = transcriptEvents.splice(0, transcriptEvents.length);
                    for (const event of events) {
                        yield event;
                    }
                }

                // Log the successful response
                log_llm_response(finalRequestId, {
                    model,
                    transcription_complete: true,
                });
            } finally {
                reader.releaseLock();
                if (session) {
                    session.close();
                }
            }
        } catch (error) {
            log_llm_error(finalRequestId, error);
            console.error('[Gemini] Transcription error:', truncateLargeValues(error));
            const errorEvent: TranscriptionEvent = {
                type: 'error',
                timestamp: new Date().toISOString(),
                error: error instanceof Error ? error.message : 'Transcription failed',
            };
            yield errorEvent;
        }
    }

    /**
     * Creates a Live API session for real-time interaction
     * @param config Live API configuration
     * @param agent Agent definition with tools and settings
     * @param model Model ID for the live session
     * @param opts Optional parameters for the live session
     * @returns Promise resolving to a LiveSession object
     */
    async createLiveSession(
        config: LiveConfig,
        agent: AgentDefinition,
        model: string,
        opts?: LiveOptions
    ): Promise<LiveSession> {
        console.log(`[Gemini] Creating Live session with model ${model}`);

        // Validate model supports Live API
        const liveModels = [
            'gemini-2.0-flash-live-001',
            'gemini-live-2.5-flash-preview',
            'gemini-2.5-flash-preview-native-audio-dialog',
            'gemini-2.5-flash-exp-native-audio-thinking-dialog',
            'gemini-2.0-flash-exp', // Experimental model that might support v1alpha
        ];

        if (!liveModels.some(m => model.includes(m))) {
            throw new Error(`Model ${model} does not support Live API. Supported models: ${liveModels.join(', ')}`);
        }

        // Create session
        const sessionId = uuidv4();
        const liveSession = new GeminiLiveSession(sessionId, this.client, model, config, agent, opts);

        // Initialize the session
        await liveSession.initialize();

        return liveSession;
    }
}

// Helper to normalize audio source (local copy to avoid circular dependency)
function normalizeAudioSource(source: TranscriptionAudioSource): ReadableStream<Uint8Array> {
    if (source instanceof ReadableStream) {
        return source;
    }

    if (typeof source === 'object' && source !== null && Symbol.asyncIterator in source) {
        return new ReadableStream({
            async start(controller) {
                try {
                    for await (const chunk of source as AsyncIterable<Uint8Array>) {
                        controller.enqueue(chunk);
                    }
                    controller.close();
                } catch (error) {
                    controller.error(error);
                }
            },
        });
    }

    if (typeof source === 'function') {
        const iterable = source();
        return normalizeAudioSource(iterable as TranscriptionAudioSource);
    }

    if (source instanceof ArrayBuffer || source instanceof Uint8Array) {
        const data = source instanceof ArrayBuffer ? new Uint8Array(source) : source;
        return new ReadableStream({
            start(controller) {
                controller.enqueue(data);
                controller.close();
            },
        });
    }

    throw new Error(`Unsupported audio source type: ${typeof source}`);
}

/**
 * Implementation of Gemini Live Session
 */
class GeminiLiveSession implements LiveSession {
    private session: any | null = null; // GoogleLiveSession is not exported
    private eventQueue: LiveEvent[] = [];
    private eventResolvers: ((value: IteratorResult<LiveEvent>) => void)[] = [];
    private _isActive = true;
    private sessionClosed = false;
    private messageHistory: (ResponseInputMessage | ResponseOutputMessage)[] = [];
    private currentTurn: { role: 'user' | 'model'; text: string } | null = null;

    constructor(
        public sessionId: string,
        private ai: GoogleGenAI,
        private model: string,
        private config: LiveConfig,
        private agent: AgentDefinition,
        private options?: LiveOptions
    ) {}

    async initialize(): Promise<void> {
        const connectionPromise = new Promise<void>((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Connection timeout'));
            }, 30000);

            // Convert tools to Gemini format
            const tools: any[] = [];

            // Function declarations
            if (this.config.tools) {
                for (const toolGroup of this.config.tools) {
                    if (toolGroup.functionDeclarations) {
                        const functionDeclarations = toolGroup.functionDeclarations.map(func => ({
                            name: func.name,
                            description: func.description,
                            parameters: convertParameterToGeminiFormat(func.parameters),
                        }));
                        tools.push({ functionDeclarations });
                    }
                    if (toolGroup.codeExecution) {
                        tools.push({ codeExecution: {} });
                    }
                    if (toolGroup.googleSearch) {
                        tools.push({ googleSearch: {} });
                    }
                }
            }

            // Build system instruction from agent
            let systemInstruction: any = undefined;
            if (this.agent.instructions) {
                systemInstruction = {
                    parts: [{ text: this.agent.instructions }],
                };
            }

            // Build generation config
            const responseModalities =
                this.config.responseModalities[0] === 'AUDIO' ? [Modality.AUDIO] : [Modality.TEXT];

            // Build config object
            const config: any = {
                responseModalities,
                systemInstruction,
                tools: tools.length > 0 ? tools : undefined,
            };

            // Add speech config if audio output
            if (this.config.responseModalities[0] === 'AUDIO' && this.config.speechConfig) {
                config.speechConfig = {
                    voiceConfig: this.config.speechConfig.voiceConfig,
                };
            }

            // Tool choice configuration
            // Note: functionCallingConfig is not available in GenerateContentConfig for Live API
            // The Live API handles function calling differently

            // Add other config options
            if (this.config.realtimeInputConfig) {
                config.realtimeInputConfig = {
                    automaticActivityDetection: this.config.realtimeInputConfig.automaticActivityDetection
                        ? {
                              disabled: this.config.realtimeInputConfig.automaticActivityDetection.disabled,
                              // Map string constants to proper enum values if needed
                              // The actual enum values depend on the @google/genai package version
                          }
                        : undefined,
                };
            }

            if (this.config.inputAudioTranscription) {
                config.inputAudioTranscription = true;
            }

            if (this.config.outputAudioTranscription) {
                config.outputAudioTranscription = true;
            }

            // Add affective dialog if enabled
            if (this.config.enableAffectiveDialog) {
                config.enableAffectiveDialog = true;
            }

            // Add proactivity settings
            if (this.config.proactivity) {
                config.proactivity = this.config.proactivity;
            }

            // Log the config being sent
            console.log('[Gemini] Connecting with config:', JSON.stringify(config, null, 2));

            // Create live connection
            this.ai.live
                .connect({
                    model: this.model,
                    config,
                    callbacks: {
                        onopen: () => {
                            clearTimeout(timeout);
                            console.log('[Gemini] Live session connected');
                            this.pushEvent({
                                type: 'live_ready',
                                timestamp: new Date().toISOString(),
                            });
                            resolve();
                        },
                        onmessage: (msg: any) => {
                            this.handleMessage(msg);
                        },
                        onerror: (err: any) => {
                            console.error('[Gemini] Live API error:', truncateLargeValues(err));
                            console.error('[Gemini] Error details:', truncateLargeValues(JSON.stringify(err, null, 2)));
                            this.pushEvent({
                                type: 'error',
                                timestamp: new Date().toISOString(),
                                error: err.message || String(err),
                                code: err.code,
                                recoverable: true,
                            });
                        },
                        onclose: (event?: any) => {
                            console.log('[Gemini] Live session closed', event);
                            if (event) {
                                console.log('[Gemini] Close event details:', {
                                    code: event.code,
                                    reason: event.reason,
                                    wasClean: event.wasClean,
                                });
                            }
                            this._isActive = false;
                            this.sessionClosed = true;
                            this.resolveAllWaitingEvents();
                        },
                    },
                })
                .then(s => {
                    this.session = s;
                });
        });

        await connectionPromise;
    }

    private handleMessage(msg: any): void {
        // Log all messages for debugging
        console.log('[Gemini] Received message:', JSON.stringify(msg, null, 2));

        // Check for errors in the message
        if (msg.error) {
            console.error('[Gemini] Error in message:', truncateLargeValues(msg.error));
            this.pushEvent({
                type: 'error',
                timestamp: new Date().toISOString(),
                error: msg.error.message || JSON.stringify(msg.error),
                code: msg.error.code || 'UNKNOWN_ERROR',
                recoverable: false,
            });
            return;
        }

        // Handle different message types from Gemini Live API

        // Audio output
        if (msg.serverContent?.modelTurn?.parts) {
            for (const part of msg.serverContent.modelTurn.parts) {
                if (part.inlineData?.mimeType?.startsWith('audio/')) {
                    this.pushEvent({
                        type: 'audio_output',
                        timestamp: new Date().toISOString(),
                        data: part.inlineData.data,
                        format: {
                            sampleRate: 24000, // Gemini default
                            channels: 1,
                            encoding: 'pcm',
                        },
                    });
                }

                // Text output
                if (part.text) {
                    if (!this.currentTurn || this.currentTurn.role !== 'model') {
                        this.currentTurn = { role: 'model', text: '' };
                        this.pushEvent({
                            type: 'turn_start',
                            timestamp: new Date().toISOString(),
                            role: 'model',
                        });
                    }

                    this.currentTurn.text += part.text;

                    this.pushEvent({
                        type: 'text_delta',
                        timestamp: new Date().toISOString(),
                        delta: part.text,
                    });

                    // Also emit message_delta for compatibility
                    this.pushEvent({
                        type: 'message_delta',
                        timestamp: new Date().toISOString(),
                        delta: part.text,
                    });
                }
            }
        }

        // Tool calls
        if (msg.serverContent?.modelTurn?.parts) {
            for (const part of msg.serverContent.modelTurn.parts) {
                if (part.functionCall) {
                    const toolCall: ToolCall = {
                        id: uuidv4(),
                        type: 'function',
                        function: {
                            name: part.functionCall.name,
                            arguments: JSON.stringify(part.functionCall.args),
                        },
                    };

                    this.pushEvent({
                        type: 'tool_call',
                        timestamp: new Date().toISOString(),
                        toolCalls: [toolCall],
                    });
                }
            }
        }

        // Input transcription
        if (msg.serverContent?.inputAudioTranscription) {
            const text =
                msg.serverContent.inputAudioTranscription.text ||
                msg.serverContent.inputAudioTranscription.transcript ||
                '';
            if (text) {
                this.pushEvent({
                    type: 'transcription_input',
                    timestamp: new Date().toISOString(),
                    text,
                });
            }
        }

        // Output transcription
        if (msg.serverContent?.outputTranscription) {
            const text = msg.serverContent.outputTranscription.text || '';
            if (text) {
                this.pushEvent({
                    type: 'transcription_output',
                    timestamp: new Date().toISOString(),
                    text,
                });
            }
        }

        // Turn complete
        if (msg.serverContent?.turnComplete) {
            if (this.currentTurn) {
                // For message history, we need to use ResponseOutputMessage for assistant messages
                const message =
                    this.currentTurn.role === 'model'
                        ? {
                              type: 'message' as const,
                              role: 'assistant' as const,
                              content: this.currentTurn.text,
                              status: 'completed' as const,
                          }
                        : ({
                              type: 'message' as const,
                              role: 'user' as const,
                              content: this.currentTurn.text,
                          } as ResponseInputMessage);

                this.messageHistory.push(message);

                this.pushEvent({
                    type: 'turn_complete',
                    timestamp: new Date().toISOString(),
                    role: this.currentTurn.role,
                    message,
                });

                this.currentTurn = null;
            }
        }

        // Interrupted
        if (msg.serverContent?.interrupted) {
            const cancelledToolCalls: string[] = [];
            if (msg.serverContent.cancelledFunctionCalls) {
                cancelledToolCalls.push(...msg.serverContent.cancelledFunctionCalls.map((fc: any) => fc.id));
            }

            this.pushEvent({
                type: 'interrupted',
                timestamp: new Date().toISOString(),
                cancelledToolCalls,
            });
        }

        // Usage metadata (cost tracking)
        if (msg.usageMetadata) {
            const usage = msg.usageMetadata;
            const inputTokens = usage.promptTokenCount || 0;
            const outputTokens = usage.candidatesTokenCount || 0;
            const totalTokens = usage.totalTokenCount || 0;

            // Track with cost tracker
            costTracker.addUsage({
                model: this.model,
                input_tokens: inputTokens,
                output_tokens: outputTokens,
                cached_tokens: usage.cachedContentTokenCount || 0,
                metadata: {
                    total_tokens: totalTokens,
                    source: 'gemini-live',
                },
            });
        }
    }

    async sendAudio(audio: LiveAudioBlob): Promise<void> {
        if (!this.session || !this._isActive) {
            console.error(`[GeminiLiveSession ${this.sessionId}] Cannot send audio - session not active`);
            throw new Error('Session is not active');
        }

        console.log(
            `[GeminiLiveSession ${this.sessionId}] Sending audio: ${audio.data.length} chars (base64), mimeType: ${audio.mimeType}`
        );

        try {
            await this.session.sendRealtimeInput({
                media: {
                    mimeType: audio.mimeType,
                    data: audio.data,
                },
            });
            console.log(`[GeminiLiveSession ${this.sessionId}] Audio sent successfully`);
        } catch (error) {
            console.error(`[GeminiLiveSession ${this.sessionId}] Error sending audio:`, truncateLargeValues(error));
            throw error;
        }

        // Calculate size for event
        const size = Math.ceil((audio.data.length * 3) / 4); // Rough base64 to bytes
        this.pushEvent({
            type: 'audio_input',
            timestamp: new Date().toISOString(),
            size,
        });
    }

    async sendText(text: string, role: 'user' | 'assistant' = 'user'): Promise<void> {
        if (!this.session || !this._isActive) {
            throw new Error('Session is not active');
        }

        // Send as client content
        const message = {
            role: role === 'assistant' ? 'model' : 'user',
            parts: [{ text }],
        };

        await this.session.sendClientContent({
            turns: [message],
        });

        // Track turn
        this.pushEvent({
            type: 'turn_start',
            timestamp: new Date().toISOString(),
            role: role === 'assistant' ? 'model' : 'user',
        });
    }

    async sendToolResponse(toolResults: ToolCallResult[]): Promise<void> {
        if (!this.session || !this._isActive) {
            throw new Error('Session is not active');
        }

        // Convert to Gemini format
        const functionResponses = toolResults.map(result => ({
            id: result.call_id || result.id,
            name: result.toolCall.function.name,
            response: result.error ? { error: result.error } : { result: result.output },
        }));

        await this.session.sendToolResponse({ functionResponses });
    }

    async *getEventStream(): AsyncIterable<LiveEvent> {
        while (this._isActive || this.eventQueue.length > 0) {
            if (this.eventQueue.length > 0) {
                yield this.eventQueue.shift()!;
            } else {
                // Wait for new events
                const result = await new Promise<IteratorResult<LiveEvent>>(resolve => {
                    if (this.sessionClosed && this.eventQueue.length === 0) {
                        resolve({ done: true, value: undefined });
                    } else {
                        this.eventResolvers.push(resolve);
                    }
                });

                if (result.done) break;
                if (result.value) yield result.value;
            }
        }
    }

    async close(): Promise<void> {
        if (this.session && this._isActive) {
            this._isActive = false;
            await this.session.close();
        }
    }

    isActive(): boolean {
        return this._isActive;
    }

    private pushEvent(event: LiveEvent): void {
        if (this.eventResolvers.length > 0) {
            const resolver = this.eventResolvers.shift()!;
            resolver({ value: event, done: false });
        } else {
            this.eventQueue.push(event);
        }
    }

    private resolveAllWaitingEvents(): void {
        for (const resolver of this.eventResolvers) {
            resolver({ done: true, value: undefined });
        }
        this.eventResolvers = [];
    }
}

// Export an instance of the provider
export const geminiProvider = new GeminiProvider();
