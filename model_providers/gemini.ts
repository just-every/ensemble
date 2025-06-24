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
} from '../types/types.js';
import { BaseModelProvider } from './base_provider.js';
import { costTracker } from '../index.js';
import {
    log_llm_error,
    log_llm_request,
    log_llm_response,
} from '../utils/llm_logger.js';
import { isPaused } from '../utils/pause_controller.js';
import {
    appendMessageWithImage,
    resizeAndTruncateForGemini,
} from '../utils/image_utils.js';

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
            console.warn(
                `Unsupported parameter type '${param.type}'. Defaulting to STRING.`
            );
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
                        console.warn(
                            'Gemini provider does not support async enum functions in array items'
                        );
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
            for (const [propName, propSchema] of Object.entries(
                param.properties
            )) {
                result.properties[propName] =
                    convertParameterToGeminiFormat(propSchema);
            }
        } else {
            // No properties specified, add empty object
            result.properties = {};
        }
    } else if (param.enum) {
        // Handle enum - could be array or function
        if (typeof param.enum === 'function') {
            // For now, we can't handle async enum functions in Gemini at conversion time
            console.warn(
                'Gemini provider does not support async enum functions. Enum will be omitted.'
            );
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

async function convertToGeminiFunctionDeclarations(
    tools: ToolFunction[]
): Promise<FunctionDeclaration[]> {
    const declarations = await Promise.all(
        tools.map(async tool => {
            // Special handling for Google web search
            if (tool.definition.function.name === 'google_web_search') {
                console.log('[Gemini] Enabling Google Search grounding');
                // Return null for this special tool - we'll handle it separately in the config
                return null;
            }

            // First resolve async enums
            const resolvedParams = await resolveAsyncEnums(
                tool.definition?.function?.parameters
            );
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
                    required: Array.isArray(resolvedParams?.required)
                        ? resolvedParams.required
                        : [],
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
async function addImagesToInput(
    input: Content[],
    images: Record<string, string>,
    source: string
): Promise<Content[]> {
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
                    text: `This is [image #${image_id}] from the ${source}`,
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
async function convertToGeminiContents(
    model: string,
    messages: ResponseInput
): Promise<Content[]> {
    let contents: Content[] = [];

    for (const msg of messages) {
        if (msg.type === 'function_call') {
            // Function call from assistant to be included as a model message
            let args: Record<string, unknown> = {};
            try {
                const parsedArgs = JSON.parse(msg.arguments || '{}');
                args =
                    typeof parsedArgs === 'object' && parsedArgs !== null
                        ? parsedArgs
                        : { value: parsedArgs };
            } catch (e) {
                console.error(
                    `Failed to parse function call arguments for ${msg.name}:`,
                    msg.arguments,
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
                        message.parts[0].functionResponse.response.content =
                            value;
                        return message;
                    },
                },
                addImagesToInput
            );
        } else {
            // Regular message
            let textContent = '';
            if (typeof msg.content === 'string') {
                textContent = msg.content;
            } else if (
                msg.content &&
                typeof msg.content === 'object' &&
                'text' in msg.content
            ) {
                textContent = msg.content.text as string;
            } else {
                textContent = JSON.stringify(msg.content);
            }

            const role = msg.role === 'assistant' ? 'model' : 'user';
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
                throw new Error(
                    'Failed to initialize Gemini client. GOOGLE_API_KEY is missing or not provided.'
                );
            }
            this._client = new GoogleGenAI({
                apiKey: apiKey,
                vertexai: false,
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
        opts?: EmbedOpts
    ): Promise<number[] | number[][]> {
        try {
            // Handle 'gemini/' prefix if present
            let actualModelId = model.startsWith('gemini/')
                ? model.substring(7)
                : model;

            // Check for suffix and remove it from actual model ID while setting thinking config
            let thinkingConfig: { thinkingBudget: number } | null = null;

            // Check if model has any of the defined suffixes
            for (const [suffix, budget] of Object.entries(
                THINKING_BUDGET_CONFIGS
            )) {
                if (actualModelId.endsWith(suffix)) {
                    thinkingConfig = { thinkingBudget: budget };
                    actualModelId = actualModelId.slice(0, -suffix.length);
                    break;
                }
            }

            console.log(
                `[Gemini] Generating embedding with model ${actualModelId}`
            );

            // Prepare the embedding request payload
            const payload = {
                model: actualModelId,
                contents: input,
                config: {
                    taskType: opts?.taskType ?? 'SEMANTIC_SIMILARITY',
                } as any, // Cast to any to allow additional properties
            };

            // Add thinking configuration if suffix was detected
            if (thinkingConfig) {
                payload.config.thinkingConfig = thinkingConfig;
            }

            // Call the Gemini API
            const response = await this.client.models.embedContent(payload);

            // Log the raw response structure for debugging
            console.log(
                '[Gemini] Embedding response structure:',
                JSON.stringify(
                    response,
                    (key, value) =>
                        key === 'values' &&
                        Array.isArray(value) &&
                        value.length > 10
                            ? `[${value.length} items]`
                            : value,
                    2
                )
            );

            // Extract the embedding values correctly
            // Check if response has the embedding field with values
            if (!response.embeddings || !Array.isArray(response.embeddings)) {
                console.error(
                    '[Gemini] Unexpected embedding response structure:',
                    response
                );
                throw new Error(
                    'Invalid embedding response structure from Gemini API'
                );
            }

            // Track usage for cost calculation (Gemini embeddings are currently free)
            // but we still want to track usage for metrics
            const estimatedTokens =
                typeof input === 'string'
                    ? Math.ceil(input.length / 4)
                    : input.reduce(
                          (sum, text) => sum + Math.ceil(text.length / 4),
                          0
                      );

            // Extract the values from the correct path in the response
            let extractedValues: number[] | number[][] = [];
            let dimensions = 0;

            // Handle the Gemini API response format
            if (response.embeddings.length > 0) {
                // Access the correct property path - in Gemini API it should be 'values'
                if (response.embeddings[0].values) {
                    extractedValues = response.embeddings.map(
                        e => e.values as number[]
                    );
                    dimensions = (extractedValues[0] as number[]).length;
                } else {
                    // Try direct embedding access if the expected property isn't found
                    console.warn(
                        '[Gemini] Could not find expected "values" property in embeddings response'
                    );
                    extractedValues =
                        response.embeddings as unknown as number[][];
                    dimensions = Array.isArray(extractedValues[0])
                        ? extractedValues[0].length
                        : 0;
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

            // Extract and return the embeddings, ensuring correct type
            if (Array.isArray(input) && input.length > 1) {
                // Handle the multi-input case - ensure we have an array of arrays
                return extractedValues as number[][];
            } else {
                // Handle the single-input case - ensure we return a single array
                let result: number[];

                if (
                    Array.isArray(extractedValues) &&
                    extractedValues.length >= 1
                ) {
                    const firstValue = extractedValues[0];
                    // Ensure we're returning a number[] and not a single number
                    if (Array.isArray(firstValue)) {
                        result = firstValue;
                    } else {
                        // If somehow we got a single number or non-array, return empty array
                        console.error(
                            '[Gemini] Unexpected format in embedding result:',
                            firstValue
                        );
                        result = [];
                    }
                } else {
                    // Fallback to empty array if no values
                    result = [];
                }

                // Ensure we truncate or pad to exactly 3072 dimensions for our halfvec database schema
                let adjustedResult = result;
                if (result.length !== 3072) {
                    console.warn(
                        `Gemini embedding returned ${result.length} dimensions, adjusting to 3072...`
                    );
                    if (result.length > 3072) {
                        // Truncate if too long
                        adjustedResult = result.slice(0, 3072);
                    } else {
                        // Pad with zeros if too short
                        adjustedResult = [
                            ...result,
                            ...Array(3072 - result.length).fill(0),
                        ];
                    }
                }
                return adjustedResult; // This is guaranteed to be number[] with exactly 3072 dimensions
            }
        } catch (error) {
            console.error('[Gemini] Error generating embedding:', error);
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
                const errorMsg =
                    error instanceof Error ? error.message : String(error);

                // Only retry for incomplete JSON segment errors
                if (
                    errorMsg.includes('Incomplete JSON segment') &&
                    attempts <= maxRetries
                ) {
                    console.warn(
                        `[Gemini] Incomplete JSON segment error, retrying (${attempts}/${maxRetries})...`
                    );
                    // Add a small delay before retry
                    await new Promise(resolve =>
                        setTimeout(resolve, 1000 * attempts)
                    );
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
        agent: AgentDefinition
    ): AsyncGenerator<ProviderStreamEvent> {
        const { getToolsFromAgent } = await import('../utils/agent.js');
        const tools: ToolFunction[] | undefined = agent
            ? await getToolsFromAgent(agent)
            : [];
        const settings: ModelSettings | undefined = agent?.modelSettings;

        let messageId = uuidv4();
        let contentBuffer = '';
        let thoughtBuffer = '';
        let eventOrder = 0;
        // Track shown grounding URLs to avoid duplicates
        const shownGrounding = new Set<string>();

        let requestId: string | undefined = undefined;
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
                console.warn(
                    "Last message in history is not from 'user'. Gemini might not respond as expected."
                );
            }

            // Handle model suffixes for thinking budget
            let thinkingBudget: number | null = null;

            // Check if model has any of the defined suffixes
            for (const [suffix, budget] of Object.entries(
                THINKING_BUDGET_CONFIGS
            )) {
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
                        if (
                            obj.properties &&
                            typeof obj.properties === 'object'
                        ) {
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
            if (tools && tools.length > 0) {
                // Check for Google web search tool
                hasGoogleWebSearch = tools.some(
                    tool =>
                        tool.definition.function.name === 'google_web_search'
                );

                // Configure standard function calling tools
                const functionDeclarations =
                    await convertToGeminiFunctionDeclarations(tools);
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
                            allowedFunctionNames = [
                                settings.tool_choice.function.name,
                            ];
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
                                config.toolConfig.functionCallingConfig.allowedFunctionNames =
                                    allowedFunctionNames;
                            }
                        }
                    }
                } else if (!hasGoogleWebSearch) {
                    console.warn(
                        'Tools were provided but resulted in empty declarations after conversion.'
                    );
                }
            }

            // Set up Google Search grounding if needed
            if (hasGoogleWebSearch) {
                console.log('[Gemini] Enabling Google Search grounding');
                // Configure the Google Search grounding
                config.tools = [{ googleSearch: {} }];
                config.toolConfig = {
                    functionCallingConfig: {
                        mode: FunctionCallingConfigMode.ANY,
                        allowedFunctionNames: ['googleSearch'],
                    },
                };
            }

            const requestParams: GenerateContentParameters = {
                model,
                contents,
                config,
            };

            requestId = log_llm_request(
                agent.agent_id,
                'google',
                model,
                requestParams
            );

            // Wait while system is paused before making the API request
            const { waitWhilePaused } = await import(
                '../utils/pause_controller.js'
            );
            await waitWhilePaused(100, agent.abortSignal);

            // --- Start streaming with retry logic ---
            const getStreamFn = () =>
                this.client.models.generateContentStream(requestParams);
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
                    console.log(
                        `[Gemini] System paused during stream for model ${model}. Waiting...`
                    );

                    // Wait while paused instead of aborting
                    await waitWhilePaused(100, agent.abortSignal);

                    // If we're resuming, continue processing
                    console.log(
                        `[Gemini] System resumed, continuing stream for model ${model}`
                    );
                }

                // Handle function calls (if present)
                if (chunk.functionCalls && chunk.functionCalls.length > 0) {
                    for (const fc of chunk.functionCalls) {
                        if (fc && fc.name) {
                            yield {
                                type: 'tool_start',
                                tool_call: {
                                    id: fc.id || `call_${uuidv4()}`,
                                    type: 'function',
                                    function: {
                                        name: fc.name,
                                        arguments: JSON.stringify(
                                            fc.args || {}
                                        ),
                                    },
                                },
                            };
                        }
                    }
                }

                for (const candidate of chunk.candidates) {
                    if (candidate.content.parts) {
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
                                yield {
                                    type: 'file_complete',
                                    data_format: 'base64',
                                    data: part.inlineData.data,
                                    mime_type:
                                        part.inlineData.mimeType || 'image/png',
                                    message_id: uuidv4(),
                                    order: eventOrder++,
                                };
                            }
                        }
                    }
                    const gChunks =
                        candidate.groundingMetadata?.groundingChunks;
                    if (Array.isArray(gChunks)) {
                        const newChunks = gChunks.filter(
                            c => c?.web?.uri && !shownGrounding.has(c.web.uri)
                        );
                        if (newChunks.length) {
                            newChunks.forEach(c =>
                                shownGrounding.add(c.web.uri)
                            );
                            const formatted = formatGroundingChunks(newChunks);
                            yield {
                                type: 'message_delta',
                                content:
                                    '\n\nSearch Results:\n' + formatted + '\n',
                                message_id: messageId,
                                order: eventOrder++,
                            };
                            contentBuffer +=
                                '\n\nSearch Results:\n' + formatted + '\n';
                        }
                    }
                }
                if (chunk.usageMetadata) {
                    // Always use the latest usage metadata
                    usageMetadata = chunk.usageMetadata;
                }
            }

            if (usageMetadata) {
                costTracker.addUsage({
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
            } else {
                console.error(
                    '[Gemini] No usage metadata found in the response. This may affect token tracking.'
                );
                costTracker.addUsage({
                    model,
                    input_tokens: 0, // Not provided in streaming response
                    output_tokens: 0, // Not provided in streaming response
                    cached_tokens: 0,
                    metadata: {
                        total_tokens: 0,
                        source: 'estimated',
                    },
                });
            }

            // --- Stream Finished, Emit Final Events ---
            if (contentBuffer || thoughtBuffer) {
                yield {
                    type: 'message_complete',
                    content: contentBuffer,
                    thinking_content: thoughtBuffer,
                    message_id: messageId,
                };
            }
        } catch (error) {
            log_llm_error(requestId, error);
            //console.error('Error during Gemini stream processing:', error);
            const errorMessage =
                error instanceof Error
                    ? error.stack || error.message
                    : String(error);

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
            console.error(
                JSON.stringify(error, Object.getOwnPropertyNames(error), 2)
            );

            // 5️⃣  Fallback: iterate keys manually (helps spot symbols, etc.)
            console.error('\n=== Manual property walk ===');
            for (const key of Reflect.ownKeys(error)) {
                console.error(`${String(key)}:`, error[key]);
            }

            yield {
                type: 'error',
                error: `Gemini error ${model}: ${errorMessage}`,
            };

            // Emit any partial content if we haven't yielded a tool call
            if (contentBuffer || thoughtBuffer) {
                yield {
                    type: 'message_complete',
                    content: contentBuffer,
                    thinking_content: thoughtBuffer,
                    message_id: messageId,
                };
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
        model?: string,
        opts?: ImageGenerationOpts
    ): Promise<string[]> {
        try {
            // Extract options with defaults
            model = model || 'imagen-3.0-generate-002';
            const numberOfImages = opts?.n || 1;

            // Map quality to Imagen's aspectRatio if needed
            let aspectRatio = '1:1'; // square by default
            if (opts?.size === 'landscape') {
                aspectRatio = '16:9';
            } else if (opts?.size === 'portrait') {
                aspectRatio = '9:16';
            }

            console.log(
                `[Gemini] Generating ${numberOfImages} image(s) with model ${model}, prompt: "${prompt.substring(0, 100)}${prompt.length > 100 ? '...' : ''}"`
            );

            // Use Gemini/Imagen API for image generation
            const response = await this.client.models.generateImages({
                model,
                prompt,
                config: {
                    numberOfImages,
                    aspectRatio,
                    includeSafetyAttributes: false,
                    // personGeneration: 'allow_all', // Comment out for now - may need proper enum value
                },
            });

            // Process the response
            const images: string[] = [];

            if (
                response.generatedImages &&
                response.generatedImages.length > 0
            ) {
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
                    metadata: {
                        aspect_ratio: aspectRatio,
                        cost_per_image: perImageCost,
                    },
                });
            }

            if (images.length === 0) {
                throw new Error('No images returned from Gemini/Imagen');
            }

            // Return standardized result
            return images;
        } catch (error) {
            console.error('[Gemini] Error generating image:', error);
            throw error;
        }
    }

    /**
     * Get the cost of generating an image with Imagen
     */
    private getImageCost(model: string): number {
        // Imagen pricing (as of latest docs)
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
        model: string = 'gemini-2.5-flash-preview-tts',
        opts?: VoiceGenerationOpts
    ): Promise<ReadableStream<Uint8Array> | ArrayBuffer> {
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

            // Generate the audio
            const response = await this.client.models.generateContent({
                model,
                contents: [{ role: 'user', parts: [{ text }] }],
                config,
            });

            // Extract audio data from response
            if (!response.candidates || response.candidates.length === 0) {
                throw new Error('No audio generated from Gemini TTS');
            }

            const candidate = response.candidates[0];
            if (
                !candidate.content.parts ||
                candidate.content.parts.length === 0
            ) {
                throw new Error('No audio parts in Gemini TTS response');
            }

            // Find the audio part
            let audioData: string | undefined;
            for (const part of candidate.content.parts) {
                if (
                    part.inlineData &&
                    part.inlineData.mimeType?.includes('audio')
                ) {
                    audioData = part.inlineData.data;
                    break;
                }
            }

            if (!audioData) {
                throw new Error('No audio data found in Gemini TTS response');
            }

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

            // Convert base64 to ArrayBuffer
            const binaryString = atob(audioData);
            const bytes = new Uint8Array(binaryString.length);
            for (let i = 0; i < binaryString.length; i++) {
                bytes[i] = binaryString.charCodeAt(i);
            }

            // Return as stream if requested
            if (opts?.stream) {
                // Create a readable stream from the audio data
                const chunkSize = 8192; // 8KB chunks
                let position = 0;

                return new ReadableStream<Uint8Array>({
                    pull(controller) {
                        if (position >= bytes.length) {
                            controller.close();
                            return;
                        }

                        const chunk = bytes.slice(
                            position,
                            Math.min(position + chunkSize, bytes.length)
                        );
                        position += chunk.length;
                        controller.enqueue(chunk);
                    },
                });
            }

            // Return as ArrayBuffer
            return bytes.buffer;
        } catch (error) {
            console.error('[Gemini] Error generating voice:', error);
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
        console.warn(
            `[Gemini] Unknown voice '${voice}', using default voice 'Kore'`
        );
        return 'Kore';
    }

    /**
     * Create transcription from audio stream using Gemini Live API
     */
    async *createTranscription(
        audio: TranscriptionAudioSource,
        model: string,
        opts?: TranscriptionOpts & { agent?: AgentDefinition }
    ): AsyncGenerator<TranscriptionEvent> {
        let session: any = null;
        let audioBuffer = Buffer.alloc(0);
        let isConnected = false;

        try {
            // Initialize AI client
            const ai = new GoogleGenAI({ apiKey: this.apiKey });

            // Set up real-time configuration
            const realtimeConfig = opts?.realtimeConfig
                ?.automaticActivityDetection || {
                prefixPaddingMs: 20,
                silenceDurationMs: 100,
            };

            // Extract custom instructions from agent if provided
            const systemInstruction =
                opts?.agent?.instructions ||
                `You are a real-time transcription assistant. Your only task is to transcribe speech as you hear it. DO NOT ADD YOUR OWN RESPONSE OR COMMENTARY. TRANSCRIBE WHAT YOU HEAR ONLY.
Respond immediately with transcribed text as you process the audio.
If quick corrections are used e.g. "Let's go to Point A, no Point B" then just remove incorrect part e.g. respond with "Let's go to Point B".
When it makes the transcription clearer, remove filler words (like "um") add punctuation, correct obvious grammar issues and add in missing words.`;

            // Connect to Gemini Live API
            console.log('[Gemini] Connecting to Live API for transcription...');

            // Create a promise that resolves when connected
            const connectionPromise = new Promise<void>((resolve, reject) => {
                const timeout = setTimeout(() => {
                    reject(new Error('Connection timeout'));
                }, 30000); // 30 second timeout

                ai.live
                    .connect({
                        model: model,
                        config: {
                            responseModalities: [Modality.TEXT],
                            systemInstruction: {
                                parts: [{ text: systemInstruction }],
                            },
                            realtimeInputConfig: {
                                automaticActivityDetection: realtimeConfig,
                            },
                        },
                        callbacks: {
                            onopen: () => {
                                clearTimeout(timeout);
                                console.log('[Gemini] Live session connected');
                                isConnected = true;
                                resolve();
                            },
                            onmessage: async (msg: any) => {
                                // Handle transcript
                                if (msg.serverContent?.modelTurn?.parts) {
                                    for (const part of msg.serverContent
                                        .modelTurn.parts) {
                                        if (part.text && part.text.trim()) {
                                            const deltaEvent: TranscriptionEvent =
                                                {
                                                    type: 'transcription_delta',
                                                    timestamp:
                                                        new Date().toISOString(),
                                                    delta: part.text,
                                                    partial: false, // Gemini Live doesn't distinguish
                                                };

                                            // Store event to yield later
                                            transcriptEvents.push(deltaEvent);
                                        }
                                    }
                                }

                                // Handle usage metadata
                                if (msg.usageMetadata) {
                                    // Track usage with modality information
                                    // This will automatically emit a cost_update event
                                    costTracker.addUsage({
                                        model: model,
                                        input_tokens:
                                            msg.usageMetadata
                                                .promptTokenCount || 0,
                                        output_tokens:
                                            msg.usageMetadata
                                                .responseTokenCount || 0,
                                        input_modality: 'audio', // Audio input for transcription
                                        output_modality: 'text', // Text output for transcription
                                        metadata: {
                                            totalTokens:
                                                msg.usageMetadata
                                                    .totalTokenCount || 0,
                                            source: 'gemini-live-transcription',
                                        },
                                    });
                                }
                            },
                            onerror: (err: any) => {
                                console.error('[Gemini] Live API error:', err);
                                connectionError = err;
                            },
                            onclose: () => {
                                console.log('[Gemini] Live session closed');
                                isConnected = false;
                            },
                        },
                    })
                    .then(s => {
                        session = s;
                    });
            });

            // Store events to yield
            const transcriptEvents: TranscriptionEvent[] = [];
            let connectionError: any = null;

            // Wait for connection
            await connectionPromise;

            // Process audio stream
            const audioStream = normalizeAudioSource(audio);
            const reader = audioStream.getReader();

            // Buffer configuration
            const chunkSize = opts?.bufferConfig?.chunkSize || 8000; // 250ms at 16kHz
            const flushInterval = opts?.bufferConfig?.flushInterval || 500;

            // Set up flush timer
            let flushTimer: NodeJS.Timeout | null = null;
            const scheduleFlush = () => {
                if (flushTimer) clearTimeout(flushTimer);
                flushTimer = setTimeout(async () => {
                    if (audioBuffer.length > 0 && session && isConnected) {
                        await sendAudioChunk(audioBuffer);
                        audioBuffer = Buffer.alloc(0);
                    }
                }, flushInterval);
            };

            // Helper to send audio chunk
            const sendAudioChunk = async (chunk: Buffer) => {
                try {
                    await session.sendRealtimeInput({
                        media: {
                            mimeType: 'audio/pcm;rate=16000',
                            data: chunk.toString('base64'),
                        },
                    });
                } catch (err) {
                    console.error('[Gemini] Error sending audio chunk:', err);
                    throw err;
                }
            };

            // Read and process audio
            try {
                while (true) {
                    const { done, value } = await reader.read();

                    if (done) break;

                    if (value) {
                        // Append to buffer
                        audioBuffer = Buffer.concat([
                            audioBuffer,
                            Buffer.from(value),
                        ]);

                        // Send in optimal chunks
                        while (audioBuffer.length >= chunkSize) {
                            const chunk = audioBuffer.slice(0, chunkSize);
                            audioBuffer = audioBuffer.slice(chunkSize);

                            if (session && isConnected) {
                                await sendAudioChunk(chunk);
                            }
                        }

                        scheduleFlush();
                    }

                    // Yield any pending events
                    while (transcriptEvents.length > 0) {
                        const event = transcriptEvents.shift();
                        if (event) yield event;
                    }

                    // Check for connection errors
                    if (connectionError) {
                        throw connectionError;
                    }
                }

                // Send any remaining audio
                if (audioBuffer.length > 0 && session && isConnected) {
                    await sendAudioChunk(audioBuffer);
                }

                // Wait a bit for final responses
                await new Promise(resolve => setTimeout(resolve, 1000));

                // Yield any remaining events
                while (transcriptEvents.length > 0) {
                    const event = transcriptEvents.shift();
                    if (event) yield event;
                }
            } finally {
                reader.releaseLock();
                if (flushTimer) clearTimeout(flushTimer);
                if (session) {
                    session.close();
                }
            }
        } catch (error) {
            console.error('[Gemini] Transcription error:', error);
            const errorEvent: TranscriptionEvent = {
                type: 'error',
                timestamp: new Date().toISOString(),
                error:
                    error instanceof Error
                        ? error.message
                        : 'Transcription failed',
            };
            yield errorEvent;
        }
    }
}

// Helper to normalize audio source (local copy to avoid circular dependency)
function normalizeAudioSource(
    source: TranscriptionAudioSource
): ReadableStream<Uint8Array> {
    if (source instanceof ReadableStream) {
        return source;
    }

    if (
        typeof source === 'object' &&
        source !== null &&
        Symbol.asyncIterator in source
    ) {
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
        const data =
            source instanceof ArrayBuffer ? new Uint8Array(source) : source;
        return new ReadableStream({
            start(controller) {
                controller.enqueue(data);
                controller.close();
            },
        });
    }

    throw new Error(`Unsupported audio source type: ${typeof source}`);
}

// Export an instance of the provider
export const geminiProvider = new GeminiProvider();
