/**
 * OpenAI model provider for the ensemble system.
 *
 * This module provides an implementation of the ModelProvider interface
 * for OpenAI's models and handles streaming responses.
 */

import {
    ModelProvider,
    ToolFunction,
    ModelSettings,
    ProviderStreamEvent,
    ToolCall,
    ResponseInput,
    AgentDefinition,
    ImageGenerationOpts,
} from '../types/types.js';
import OpenAI, { toFile } from 'openai';
// import {v4 as uuidv4} from 'uuid';
import { costTracker } from '../index.js';
import {
    log_llm_request,
    log_llm_response,
    log_llm_error,
} from '../utils/llm_logger.js';
import { isPaused } from '../utils/pause_controller.js';
import {
    appendMessageWithImage,
    resizeAndSplitForOpenAI,
} from '../utils/image_utils.js';
import {
    DeltaBuffer,
    bufferDelta,
    flushBufferedDeltas,
} from '../utils/delta_buffer.js';
import type { ResponseCreateParamsStreaming } from 'openai/resources/responses/responses.js';
import type { ReasoningEffort } from 'openai/resources/shared.js';

const BROWSER_WIDTH = 1024;
const BROWSER_HEIGHT = 1536;

/**
 * Citation tracking for footnotes
 */
interface CitationTracker {
    citations: Map<string, { title: string; url: string }>;
}

/**
 * Create a new citation tracker
 */
function createCitationTracker(): CitationTracker {
    return {
        citations: new Map(),
    };
}

/**
 * Format citation as a footnote and return a reference marker
 */
function formatCitation(
    tracker: CitationTracker,
    citation: { title: string; url: string }
): string {
    if (!tracker.citations.has(citation.url)) {
        tracker.citations.set(citation.url, citation);
    }
    return ` [${Array.from(tracker.citations.keys()).indexOf(citation.url) + 1}]`;
}

/**
 * Generate formatted footnotes from citation tracker
 */
function generateFootnotes(tracker: CitationTracker): string {
    if (tracker.citations.size === 0) return '';

    const footnotes = Array.from(tracker.citations.values())
        .map((citation, i) => `[${i + 1}] ${citation.title} – ${citation.url}`)
        .join('\n');

    return '\n\nReferences:\n' + footnotes;
}

// Convert our tool definition to OpenAI's format
/**
 * Process a JSON schema to make it compatible with OpenAI's requirements
 * This includes adding required fields, setting additionalProperties: false,
 * and removing unsupported keywords
 */
function processSchemaForOpenAI(schema: any, originalProperties?: any): any {
    // Clone schema to avoid modifying the original
    const processedSchema = JSON.parse(JSON.stringify(schema));

    // Recursively process the schema for OpenAI compatibility
    const processSchemaRecursively = (schema: any) => {
        if (!schema || typeof schema !== 'object') return;

        // 1. Remove 'optional: true' flag
        if (schema.optional === true) {
            delete schema.optional;
        }

        // 2. Convert 'oneOf' to 'anyOf'
        if (Array.isArray(schema.oneOf)) {
            schema.anyOf = schema.oneOf;
            delete schema.oneOf;
        }

        // 3. Remove OpenAI-incompatible validation keywords
        const unsupportedKeywords = [
            'minimum',
            'maximum',
            'minItems',
            'maxItems',
            'minLength',
            'maxLength',
            'pattern',
            'format',
            'multipleOf',
            'patternProperties',
            'unevaluatedProperties',
            'propertyNames',
            'minProperties',
            'maxProperties',
            'unevaluatedItems',
            'contains',
            'minContains',
            'maxContains',
            'uniqueItems',
            'default', // Remove default values as OpenAI doesn't support them
        ];
        unsupportedKeywords.forEach(keyword => {
            if (schema[keyword] !== undefined) {
                delete schema[keyword];
            }
        });

        // Detect if it's an object-like schema
        const isObject =
            schema.type === 'object' ||
            (schema.type === undefined && schema.properties !== undefined);

        // 4. Recurse into nested structures first
        // Process variants (anyOf, allOf)
        for (const key of ['anyOf', 'allOf'] as const) {
            if (Array.isArray(schema[key])) {
                schema[key].forEach((variantSchema: any) =>
                    processSchemaRecursively(variantSchema)
                );
            }
        }
        // Process properties
        if (isObject && schema.properties) {
            for (const propName in schema.properties) {
                processSchemaRecursively(schema.properties[propName]);
            }
        }
        // Process array items
        if (schema.type === 'array' && schema.items !== undefined) {
            if (Array.isArray(schema.items)) {
                // Tuple validation
                schema.items.forEach((itemSchema: any) =>
                    processSchemaRecursively(itemSchema)
                );
            } else if (typeof schema.items === 'object') {
                // Single schema for all items
                processSchemaRecursively(schema.items);
            }
        }

        // 5. AFTER recursion, process the current object level
        if (isObject) {
            // Always set additionalProperties: false for objects (required by OpenAI in strict mode)
            // This is necessary even for objects without properties
            schema.additionalProperties = false;

            // Set 'required' array to include all current properties (required by OpenAI for strict mode)
            if (schema.properties) {
                const currentRequired = Object.keys(schema.properties);
                // Only add required array if there are properties to require
                if (currentRequired.length > 0) {
                    schema.required = currentRequired;
                } else {
                    // If properties is an empty object {}, remove required
                    delete schema.required;
                }
            } else {
                // If no properties field, remove required
                delete schema.required;
            }
        }
    };

    // Apply the recursive processing to the cloned schema
    processSchemaRecursively(processedSchema);

    // If original properties were provided (for tools), fix the top-level 'required' array
    if (originalProperties) {
        // AFTER recursion, fix the top-level 'required' array based on the ORIGINAL properties.
        // This ensures top-level optional parameters are correctly handled, overriding the
        // potentially stricter 'required' array set during recursion for the top-level object.
        const topLevelRequired: string[] = [];
        for (const propName in originalProperties) {
            // Check the *original* property definition for the optional flag
            if (!originalProperties[propName].optional) {
                topLevelRequired.push(propName);
            }
        }
        // Set the correct top-level required array on the processed schema
        if (topLevelRequired.length > 0) {
            processedSchema.required = topLevelRequired;
        } else {
            // Ensure the top-level object has no required array if no properties were originally required
            delete processedSchema.required;
        }
    }

    // Ensure top-level is object with additionalProperties: false if it has properties
    if (
        processedSchema.properties &&
        processedSchema.additionalProperties === undefined
    ) {
        processedSchema.additionalProperties = false;
    }

    return processedSchema;
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
                            // Remove empty enum to avoid OpenAI validation errors
                            delete propCopy.enum;
                        }
                    } catch (e) {
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

/**
 * Convert our tool definition to OpenAI's format
 */
async function convertToOpenAITools(
    requestParams: any,
    tools?: ToolFunction[] | undefined
): Promise<any> {
    requestParams.tools = await Promise.all(
        tools.map(async (tool: ToolFunction) => {
            if (
                tool.definition.function.name === 'openai_web_search' ||
                tool.definition.function.name === 'web_search'
            ) {
                delete requestParams.reasoning;
                return {
                    type: 'web_search_preview',
                    search_context_size: 'high',
                };
            }

            // First resolve async enums, then process the schema
            const resolvedParams = await resolveAsyncEnums(
                tool.definition.function.parameters
            );
            const originalToolProperties = resolvedParams.properties;
            const paramSchema = processSchemaForOpenAI(
                resolvedParams,
                originalToolProperties
            );

            return {
                type: 'function',
                name: tool.definition.function.name,
                description: tool.definition.function.description,
                parameters: paramSchema,
                strict: true, // Keep strict mode enabled
            };
        })
    );
    if (requestParams.model === 'computer-use-preview') {
        requestParams.tools.push({
            type: 'computer_use_preview',
            display_width: BROWSER_WIDTH,
            display_height: BROWSER_HEIGHT,
            environment: 'browser',
        });
    }

    // Always allow truncation if we provide too much input
    requestParams.truncation = 'auto';
    return requestParams;
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
    input: ResponseInput,
    images: Record<string, string>,
    source: string
): Promise<ResponseInput> {
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
                    type: 'input_text',
                    text: `This is [image #${image_id}] from the ${source}`,
                });
            } else {
                // Multiple segments - explain the splitting
                messageContent.push({
                    type: 'input_text',
                    text: `This is [image #${image_id}] from the ${source} (split into ${processedImages.length} parts, each up to 768px high)`,
                });
            }

            // Add all image segments to the same message
            for (const imageSegment of processedImages) {
                messageContent.push({
                    type: 'input_image',
                    image_url: imageSegment,
                    detail: 'high',
                });
            }

            // Add the complete message with all segments
            input.push({
                type: 'message',
                role: 'user',
                content: messageContent,
            });
        } catch (error) {
            console.error(`Error processing image ${image_id}:`, error);
            // If image processing fails, add the original image as a fallback
            input.push({
                type: 'message',
                role: 'user',
                content: [
                    {
                        type: 'input_text',
                        text: `This is [image #${image_id}] from the ${source} (raw image)`,
                    },
                    {
                        type: 'input_image',
                        image_url: imageData,
                        detail: 'high',
                    },
                ],
            });
        }
    }
    return input;
}

/**
 * OpenAI model provider implementation
 */
export class OpenAIProvider implements ModelProvider {
    private _client?: OpenAI;
    private apiKey?: string;

    constructor(apiKey?: string) {
        // Store the API key for lazy initialization
        this.apiKey = apiKey || process.env.OPENAI_API_KEY;
    }

    /**
     * Lazily initialize the OpenAI client when first accessed
     * This prevents module load errors when API keys are not set
     */
    private get client(): OpenAI {
        if (!this._client) {
            if (!this.apiKey) {
                throw new Error(
                    'Failed to initialize OpenAI client. Make sure OPENAI_API_KEY is set.'
                );
            }
            this._client = new OpenAI({
                apiKey: this.apiKey,
            });
        }
        return this._client;
    }

    /**
     * Creates embeddings for text input
     * @param modelId ID of the embedding model to use (e.g., 'text-embedding-3-small')
     * @param input Text to embed (string or array of strings)
     * @param opts Optional parameters for embedding generation
     * @returns Promise resolving to embedding vector(s)
     */
    async createEmbedding(
        input: string | string[],
        model: string,
        opts?: { dimensions?: number; normalize?: boolean }
    ): Promise<number[] | number[][]> {
        try {
            // Prepare options
            const options: any = {
                model,
                input: input,
                encoding_format: 'float',
            };

            // Use 3072 dimensions to match our database schema with halfvec type
            options.dimensions = opts?.dimensions || 3072;

            console.log(`[OpenAI] Generating embedding with model ${model}`);

            // Call the OpenAI API
            const response = await this.client.embeddings.create(options);

            // Track token usage
            const inputTokens =
                response.usage?.prompt_tokens ||
                (typeof input === 'string'
                    ? Math.ceil(input.length / 4)
                    : input.reduce(
                          (sum, text) => sum + Math.ceil(text.length / 4),
                          0
                      ));

            costTracker.addUsage({
                model,
                input_tokens: inputTokens,
                output_tokens: 0, // No output tokens for embeddings
                metadata: {
                    dimensions:
                        response.data[0]?.embedding.length ||
                        opts?.dimensions ||
                        1536,
                },
            });

            // Extract the embedding vectors - handle single vs. multiple inputs
            if (Array.isArray(input) && input.length > 1) {
                return response.data.map(item => item.embedding);
            } else {
                return response.data[0].embedding;
            }
        } catch (error) {
            console.error('[OpenAI] Error generating embedding:', error);
            throw error;
        }
    }

    /**
     * Generate an image using OpenAI's GPT Image 1
     *
     * @param prompt - The text description of the image to generate
     * @param opts - Optional parameters for image generation
     * @returns A promise that resolves to
     */
    async createImage(
        prompt: string,
        model?: string,
        opts?: ImageGenerationOpts
    ): Promise<string[]> {
        try {
            // Extract options with defaults, mapping to the original function parameters
            model = model || 'gpt-image-1';
            const number_of_images = opts?.n || 1;

            // Map quality options
            let quality: 'low' | 'medium' | 'high' | 'auto' = 'auto';
            if (opts?.quality === 'standard') quality = 'medium';
            else if (opts?.quality === 'hd') quality = 'high';
            else if (
                opts?.quality === 'low' ||
                opts?.quality === 'medium' ||
                opts?.quality === 'high'
            ) {
                quality = opts.quality;
            }

            // Map size options
            let size: '1024x1024' | '1536x1024' | '1024x1536' | 'auto' = 'auto';
            if (opts?.size === 'square' || opts?.size === '1024x1024') {
                size = '1024x1024';
            } else if (
                opts?.size === 'landscape' ||
                opts?.size === '1536x1024'
            ) {
                size = '1536x1024';
            } else if (
                opts?.size === 'portrait' ||
                opts?.size === '1024x1536'
            ) {
                size = '1024x1536';
            }

            // Default background to 'auto'
            const background: 'transparent' | 'opaque' | 'auto' = 'auto';

            // Get source images if provided
            const source_images = opts?.source_images;

            console.log(
                `[OpenAI] Generating ${number_of_images} image(s) with model ${model}, prompt: "${prompt.substring(0, 100)}${prompt.length > 100 ? '...' : ''}"`
            );

            let response;

            if (source_images) {
                console.log('[OpenAI] Using images.edit with source_images');

                // Convert single string to array for consistent processing
                const imageArray = Array.isArray(source_images)
                    ? source_images
                    : [source_images];
                const imageFiles = [];

                // Process each image in the array
                for (const sourceImg of imageArray) {
                    let imageFile;

                    // Check if source_image is a URL or base64 string
                    if (
                        sourceImg.startsWith('http://') ||
                        sourceImg.startsWith('https://')
                    ) {
                        // Handle URL case - fetch the image
                        const imageResponse = await fetch(sourceImg);
                        const imageBuffer = await imageResponse.arrayBuffer();

                        // Convert to OpenAI file format
                        imageFile = await toFile(
                            new Uint8Array(imageBuffer),
                            `image_${imageFiles.length}.png`,
                            { type: 'image/png' }
                        );
                    } else {
                        // Handle base64 string case
                        // Check if it's a data URL and extract the base64 part if needed
                        let base64Data = sourceImg;
                        if (sourceImg.startsWith('data:')) {
                            base64Data = sourceImg.split(',')[1];
                        }

                        // Convert base64 to binary
                        const binaryData = Buffer.from(base64Data, 'base64');

                        // Convert to OpenAI file format
                        imageFile = await toFile(
                            new Uint8Array(binaryData),
                            `image_${imageFiles.length}.png`,
                            { type: 'image/png' }
                        );
                    }

                    imageFiles.push(imageFile);
                }

                // Handle mask if provided (for inpainting)
                let maskFile;
                if (opts?.mask) {
                    let maskBase64 = opts.mask;
                    if (opts.mask.startsWith('data:')) {
                        maskBase64 = opts.mask.split(',')[1];
                    }
                    const maskBinary = Buffer.from(maskBase64, 'base64');
                    maskFile = await toFile(
                        new Uint8Array(maskBinary),
                        'mask.png',
                        {
                            type: 'image/png',
                        }
                    );
                }

                // Use the first image as the primary image and any additional ones as references
                // OpenAI API currently uses only the first image for edit but may support multiple in the future
                const editParams: any = {
                    model,
                    prompt,
                    image: imageFiles,
                    n: number_of_images,
                    quality,
                    size,
                };

                // Add mask if provided
                if (maskFile) {
                    editParams.mask = maskFile;
                }

                response = await this.client.images.edit(editParams);
            } else {
                // Use standard image generation
                response = await this.client.images.generate({
                    model,
                    prompt,
                    n: number_of_images,
                    background,
                    quality,
                    size,
                    moderation: 'low',
                    output_format: 'png',
                } as any);
            }

            // Track usage for cost calculation
            if (response.data && response.data.length > 0) {
                const perImageCost = this.getImageCost(model, quality);

                costTracker.addUsage({
                    model,
                    image_count: response.data.length,
                    metadata: {
                        quality,
                        size,
                        cost_per_image: perImageCost,
                        is_edit: !!source_images,
                    },
                });
            }

            // Extract the base64 image data for all images
            const imageDataUrls = response.data.map(item => {
                const imageData = item?.b64_json;
                if (!imageData) {
                    throw new Error('No image data returned from OpenAI');
                }
                return `data:image/png;base64,${imageData}`;
            });

            if (imageDataUrls.length === 0) {
                throw new Error('No images returned from OpenAI');
            }

            // Return standardized result
            return imageDataUrls;
        } catch (error) {
            console.error('[OpenAI] Error generating image:', error);
            throw error;
        }
    }

    /**
     * Get the cost of generating an image based on model and parameters
     */
    private getImageCost(model: string, quality: string): number {
        // GPT Image 1 pricing
        if (model === 'gpt-image-1') {
            if (quality === 'high') {
                return 0.08; // $0.080 per image for high quality
            } else if (quality === 'medium' || quality === 'auto') {
                return 0.04; // $0.040 per image for medium quality
            } else if (quality === 'low') {
                return 0.02; // $0.020 per image for low quality
            }
        }

        // Default/unknown pricing
        return 0.04;
    }

    /**
     * Create a streaming completion using OpenAI's API
     */
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
        let requestId: string | undefined;

        try {
            // Use a more compatible approach with reduce to build the array
            // Use 'any' type assertion to avoid TypeScript errors when adding custom structures
            let input: any[] = [];

            // Process all messages
            for (const messageFull of messages) {
                let message = { ...messageFull };
                // Keep the original model for class comparison
                const originalModel: string | undefined = (message as any)
                    .model;

                delete (message as any).timestamp;
                delete (message as any).model;
                delete (message as any).pinned;

                // Handle thinking messages
                if (message.type === 'thinking') {
                    // Convert thinking messages to reasoning items for OpenAI
                    // Using type assertion to satisfy TypeScript since the OpenAI API expects
                    // a structure not directly represented in our types
                    // Use a complete type assertion to bypass TypeScript's type checking for this object
                    // The OpenAI API expects a structure different from our ResponseInputItem types

                    // Only convert to reasoning if both current model and source model are o-class
                    if (
                        model.startsWith('o') &&
                        message.thinking_id &&
                        model === originalModel
                    ) {
                        console.log(
                            `[OpenAI] Processing thinking message with ID: ${message.thinking_id}`,
                            message
                        );
                        const match = message.thinking_id.match(
                            /^(rs_[A-Za-z0-9]+)-(\d)$/
                        );
                        if (match) {
                            const reasoningId = match[1];
                            const summaryIndex = parseInt(match[2], 10);

                            // Format the summary text content
                            const summaryText =
                                typeof message.content === 'string'
                                    ? message.content
                                    : JSON.stringify(message.content);

                            // Create the summary entry
                            const summaryEntry = {
                                type: 'summary_text',
                                text: summaryText,
                            };

                            // Look for existing reasoning item with matching ID - use any type to avoid TS errors
                            const existingIndex = input.findIndex(
                                (item: any) =>
                                    item.type === 'reasoning' &&
                                    item.id === reasoningId
                            );

                            if (existingIndex !== -1) {
                                // Found existing reasoning item - update at the correct position
                                // Use any type to avoid TypeScript errors with custom properties
                                const existingItem = input[
                                    existingIndex
                                ] as any;

                                // Ensure summary array exists and is the right size
                                if (!existingItem.summary) {
                                    existingItem.summary = [];
                                }

                                // Update the summary at the specified index
                                existingItem.summary[summaryIndex] =
                                    summaryEntry;

                                // Replace the item in the array (keeping the any type assertion)
                                input[existingIndex] = existingItem;
                            } else {
                                // No existing item found - create a new one
                                const newItem = {
                                    type: 'reasoning',
                                    id: reasoningId,
                                    summary: [],
                                } as any; // Type assertion at the object level

                                // Set the summary at the specified index
                                newItem.summary[summaryIndex] = summaryEntry;

                                // Add to input
                                input.push(newItem);
                            }
                            continue;
                        }
                    }

                    // If we weren't able to process the thinking message, add it as a regular message
                    input.push({
                        type: 'message',
                        role: 'user', // Use 'user' as it's a valid type
                        content: 'Thinking: ' + message.content,
                        status: message.status || 'completed',
                    });

                    continue;
                }

                // Handle function call messages
                if (message.type === 'function_call') {
                    // Check if id doesn't start with 'fc_', and remove it if so
                    if (
                        message.id &&
                        (!message.id.startsWith('fc_') ||
                            model !== originalModel)
                    ) {
                        // If id exists and doesn't start with 'fc_', remove it
                        // eslint-disable-next-line @typescript-eslint/no-unused-vars
                        const { id, ...rest } = message;
                        message = rest;
                    }

                    message.status = message.status || 'completed';

                    // Add the message (potentially without id)
                    input.push(message);
                    continue;
                }

                // Handle function call output messages
                if (message.type === 'function_call_output') {
                    // eslint-disable-next-line @typescript-eslint/no-unused-vars
                    const { name, id, ...messageToAdd } = message; // Original code removes name

                    input = await appendMessageWithImage(
                        model,
                        input,
                        messageToAdd,
                        'output',
                        addImagesToInput,
                        `function call output of ${message.name}`
                    );
                    continue;
                }

                // Handle standard message types (user, assistant, etc.)
                // Also handle messages without a type property (treat as 'message' type)
                if (
                    (message.type ?? 'message') === 'message' &&
                    'content' in message
                ) {
                    if (
                        'id' in message &&
                        message.id &&
                        (!message.id.startsWith('msg_') ||
                            model !== originalModel)
                    ) {
                        // If id exists and doesn't start with 'msg_', remove it
                        // eslint-disable-next-line @typescript-eslint/no-unused-vars
                        const { id, ...rest } = message;
                        message = rest;
                        console.log(
                            `[OpenAI] Removed message ID: ${id} model: ${model} originalModel: ${originalModel}`
                        );
                    }

                    input = await appendMessageWithImage(
                        model,
                        input,
                        { ...message, type: 'message' },
                        'content',
                        addImagesToInput
                    );
                    continue;
                }
            }

            // Format the request according to the Responses API specification
            let requestParams: ResponseCreateParamsStreaming = {
                model,
                stream: true,
                user: 'magi',
                input,
            };

            // Add model-specific parameters
            // o3 models don't support temperature and top_p
            if (!model.startsWith('o3-')) {
                if (settings?.temperature !== undefined) {
                    requestParams.temperature = settings.temperature;
                }

                if (settings?.top_p !== undefined) {
                    requestParams.top_p = settings.top_p;
                }
            }

            // Define mapping for OpenAI reasoning effort configurations
            const REASONING_EFFORT_CONFIGS: Array<ReasoningEffort> = [
                'low',
                'medium',
                'high',
            ];

            // Check if model has any of the defined suffixes
            let hasEffortSuffix = false;

            for (const effort of REASONING_EFFORT_CONFIGS) {
                const suffix = `-${effort}`;
                if (model.endsWith(suffix)) {
                    hasEffortSuffix = true;
                    // Apply the specific reasoning effort and remove the suffix
                    requestParams.reasoning = {
                        effort: effort,
                        summary: 'auto',
                    };
                    model = model.slice(0, -suffix.length);
                    requestParams.model = model; // Update the model in the request
                    break;
                }
            }

            // Default reasoning for o-models if no suffix
            if (model.startsWith('o') && !hasEffortSuffix) {
                requestParams.reasoning = {
                    effort: 'high',
                    summary: 'auto',
                };
            }

            // Add other settings that work across models
            if (settings?.tool_choice) {
                if (
                    typeof settings.tool_choice === 'object' &&
                    settings.tool_choice?.type === 'function' &&
                    settings.tool_choice?.function?.name
                ) {
                    // If it's an object, we assume it's a function call
                    requestParams.tool_choice = {
                        type: settings.tool_choice.type,
                        name: settings.tool_choice.function.name,
                    };
                } else if (typeof settings.tool_choice === 'string') {
                    requestParams.tool_choice = settings.tool_choice;
                }
            }

            // Set JSON response format if a schema is provided
            if (settings?.json_schema?.schema) {
                const { schema, ...wrapperWithoutSchema } =
                    settings.json_schema;

                requestParams.text = {
                    format: {
                        ...wrapperWithoutSchema, // name, type:'json_schema', etc.
                        schema: processSchemaForOpenAI(schema),
                    },
                };
            }

            // Add tools if provided
            if (tools && tools.length > 0) {
                // Convert our tools to OpenAI format
                requestParams = await convertToOpenAITools(
                    requestParams,
                    tools
                );
            }

            // Log the request and save the requestId for later response logging
            requestId = log_llm_request(
                agent.agent_id,
                'openai',
                model,
                requestParams
            );

            // Wait while system is paused before making the API request
            const { waitWhilePaused } = await import('../utils/pause_controller.js');
            await waitWhilePaused(100, agent.abortSignal);

            const stream = await this.client.responses.create(requestParams);

            // Track delta positions for each message_id
            // Track positions for messages and reasoning
            const messagePositions = new Map<string, number>();
            const reasoningPositions = new Map<string, number>();
            const reasoningAggregates = new Map<string, string>();
            // Adaptive buffers for throttling message_delta emissions
            const deltaBuffers = new Map<string, DeltaBuffer>();
            // Track citations to display as footnotes
            const citationTracker = createCitationTracker();

            const toolCallStates = new Map<string, ToolCall>();

            const events: ProviderStreamEvent[] = [];
            try {
                for await (const event of stream) {
                    events.push(event as any);

                    // Check if the system was paused during the stream
                    if (isPaused()) {
                        console.log(
                            `[OpenAI] System paused during stream for model ${model}. Waiting...`
                        );
                        
                        // Wait while paused instead of aborting
                        await waitWhilePaused(100, agent.abortSignal);
                        
                        // If we're resuming, continue processing
                        console.log(
                            `[OpenAI] System resumed, continuing stream for model ${model}`
                        );
                    }

                    // --- Response Lifecycle Events ---
                    if (event.type === 'response.in_progress') {
                        // Optional: Log or update UI to indicate the response is starting/in progress
                        // console.log(`Response ${event.response.id} is in progress...`);
                    } else if (
                        event.type === 'response.completed' &&
                        event.response?.usage
                    ) {
                        // Final usage information
                        costTracker.addUsage({
                            model, // Ensure 'model' variable is accessible here
                            input_tokens:
                                event.response.usage.input_tokens || 0,
                            output_tokens:
                                event.response.usage.output_tokens || 0,
                            cached_tokens:
                                event.response.usage.input_tokens_details
                                    ?.cached_tokens || 0,
                            metadata: {
                                reasoning_tokens:
                                    event.response.usage.output_tokens_details
                                        ?.reasoning_tokens || 0,
                            },
                        });
                        // console.log(`Response ${event.response.id} completed.`);
                    } else if (
                        event.type === 'response.failed' &&
                        event.response?.error
                    ) {
                        // Response failed entirely
                        const errorInfo = event.response.error;
                        log_llm_error(requestId, errorInfo);
                        console.error(
                            `Response ${event.response.id} failed: [${errorInfo.code}] ${errorInfo.message}`
                        );
                        yield {
                            type: 'error',
                            error: `OpenAI response  failed: [${errorInfo.code}] ${errorInfo.message}`,
                        };
                    } else if (
                        event.type === 'response.incomplete' &&
                        event.response?.incomplete_details
                    ) {
                        // Response finished but is incomplete (e.g., max_tokens hit)
                        const reason = event.response.incomplete_details.reason;
                        log_llm_error(
                            requestId,
                            'OpenAI response incomplete: ' + reason
                        );
                        console.warn(
                            `Response ${event.response.id} incomplete: ${reason}`
                        );
                        yield {
                            type: 'error', // Or a more general 'response_incomplete'
                            error: 'OpenAI response incomplete: ' + reason,
                        };
                    }

                    // --- Output Item Lifecycle Events ---
                    else if (
                        event.type === 'response.output_item.added' &&
                        event.item
                    ) {
                        // A new item (message, function call, etc.) started
                        // console.log(`Output item added: index ${event.output_index}, id ${event.item.id}, type ${event.item.type}`);
                        if (event.item.type === 'function_call') {
                            // Initialize state for a new function call
                            if (!toolCallStates.has(event.item.id)) {
                                toolCallStates.set(event.item.id, {
                                    id: event.item.id, // Use the ID from the event item
                                    call_id: event.item.call_id, // Use the call_id from the event item
                                    type: 'function',
                                    function: {
                                        name: event.item.name || '', // Ensure 'name' exists on function_call item, provide fallback
                                        arguments: '',
                                    },
                                });
                            } else {
                                console.warn(
                                    `Received output_item.added for already tracked function call ID: ${event.item.id}`
                                );
                            }
                        }
                    } else if (
                        event.type === 'response.output_item.done' &&
                        event.item
                    ) {
                        // An output item finished
                        // console.log(`Output item done: index ${event.output_index}, id ${event.item.id}, type ${event.item.type}`);
                        // If it's a function call, we rely on 'function_call_arguments.done' to yield.
                        // This event could be used for cleanup if needed, but ensure no double-yielding.
                        // We already clean up state in 'function_call_arguments.done'.
                        if (
                            event.item.type === 'reasoning' &&
                            !event.item.summary.length
                        ) {
                            // In this case we get a reasoning item with no summary
                            yield {
                                type: 'message_complete',
                                content: '',
                                message_id: event.item.id + '-0',
                                thinking_content: '',
                            };
                        }
                    }

                    // --- Content Part Lifecycle Events ---
                    else if (
                        event.type === 'response.content_part.added' &&
                        event.part
                    ) {
                        // A new part within a message content array started (e.g., text block, image)
                        // console.log(`Content part added: item_id ${event.item_id}, index ${event.content_index}, type ${event.part.type}`);
                        // Don't yield message_complete here, wait for deltas/done event.
                    } else if (
                        event.type === 'response.content_part.done' &&
                        event.part
                    ) {
                        // A content part finished
                        // console.log(`Content part done: item_id ${event.item_id}, index ${event.content_index}, type ${event.part.type}`);
                        // If type is output_text, final text is usually in 'response.output_text.done'.
                    }

                    // --- Text Output Events ---
                    else if (
                        event.type === 'response.output_text.delta' &&
                        event.delta
                    ) {
                        // Streamed text chunk (buffered)
                        const itemId = event.item_id;
                        let position = messagePositions.get(itemId) ?? 0;

                        for (const ev of bufferDelta(
                            deltaBuffers,
                            itemId,
                            event.delta,
                            content =>
                                ({
                                    type: 'message_delta',
                                    content,
                                    message_id: itemId,
                                    order: position++,
                                }) as ProviderStreamEvent
                        )) {
                            yield ev;
                        }

                        messagePositions.set(itemId, position);
                    } else if (
                        (event as any).type ===
                            'response.output_text.annotation.added' &&
                        (event as any).annotation
                    ) {
                        // Handle URL citation annotations
                        const eventData = event as any;
                        if (
                            eventData.annotation?.type === 'url_citation' &&
                            eventData.annotation.url
                        ) {
                            const marker = formatCitation(citationTracker, {
                                title:
                                    eventData.annotation.title ||
                                    eventData.annotation.url,
                                url: eventData.annotation.url,
                            });
                            // Append to aggregate buffer for this item
                            let position =
                                messagePositions.get(eventData.item_id) ?? 0;
                            yield {
                                type: 'message_delta',
                                content: marker,
                                message_id: eventData.item_id,
                                order: position++,
                            };
                            messagePositions.set(eventData.item_id, position);
                        } else {
                            // Log other types of annotations
                            console.log(
                                'Annotation added:',
                                eventData.annotation
                            );
                        }
                    } else if (
                        event.type === 'response.output_text.done' &&
                        event.text !== undefined
                    ) {
                        // Check text exists
                        // Text block finalized
                        const itemId = event.item_id; // Use item_id from the event

                        // Add footnotes if we have citations
                        let finalText = event.text;
                        if (citationTracker.citations.size > 0) {
                            const footnotes =
                                generateFootnotes(citationTracker);
                            finalText += footnotes;
                        }

                        yield {
                            type: 'message_complete',
                            content: finalText,
                            message_id: itemId, // Use item_id
                        };

                        // Optional: Clean up position tracking for this message item
                        messagePositions.delete(itemId);
                        // console.log(`Text output done for item ${itemId}.`);
                    }

                    // --- Refusal Events ---
                    else if (
                        event.type === 'response.refusal.delta' &&
                        event.delta
                    ) {
                        // Streamed refusal text chunk
                        console.log(
                            `Refusal delta for item ${event.item_id}: ${event.delta}`
                        );
                        // Decide how to handle/yield refusal text (e.g., separate event type)
                        //yield { type: 'refusal_delta', message_id: event.item_id, content: event.delta };
                    } else if (
                        event.type === 'response.refusal.done' &&
                        event.refusal
                    ) {
                        // Refusal text finalized
                        log_llm_error(
                            requestId,
                            'OpenAI refusal error: ' + event.refusal
                        );
                        console.log(
                            `Refusal done for item ${event.item_id}: ${event.refusal}`
                        );
                        yield {
                            type: 'error',
                            error: 'OpenAI refusal error: ' + event.refusal,
                        };
                    }

                    // --- Function Call Events (Based on Docs) ---
                    else if (
                        event.type ===
                            'response.function_call_arguments.delta' &&
                        event.delta
                    ) {
                        // Streamed arguments for a function call
                        const currentCall = toolCallStates.get(event.item_id);
                        if (currentCall) {
                            currentCall.function.arguments += event.delta;
                        } else {
                            // This might happen if output_item.added wasn't received/processed first
                            console.warn(
                                `Received function_call_arguments.delta for unknown item_id: ${event.item_id}`
                            );
                            // Optional: Could attempt to create the state here if needed, but less ideal
                        }
                    } else if (
                        event.type ===
                            'response.function_call_arguments.done' &&
                        event.arguments !== undefined
                    ) {
                        // Check arguments exist
                        // Function call arguments finalized
                        const currentCall = toolCallStates.get(event.item_id);
                        if (currentCall) {
                            currentCall.function.arguments = event.arguments; // Assign final arguments
                            yield {
                                type: 'tool_start',
                                tool_call: currentCall as ToolCall, // Yield the completed call
                            };
                            toolCallStates.delete(event.item_id); // Clean up state for this completed call
                            // console.log(`Function call arguments done for item ${event.item_id}. Yielded tool_start.`);
                        } else {
                            console.warn(
                                `Received function_call_arguments.done for unknown or already yielded item_id: ${event.item_id}`
                            );
                        }
                    }

                    // --- File Search Events ---
                    else if (
                        event.type === 'response.file_search_call.in_progress'
                    ) {
                        console.log(
                            `File search in progress for item ${event.item_id}...`
                        );
                        //yield { type: 'file_search_started', item_id: event.item_id };
                    } else if (
                        event.type === 'response.file_search_call.searching'
                    ) {
                        console.log(
                            `File search searching for item ${event.item_id}...`
                        );
                        //yield { type: 'file_search_pending', item_id: event.item_id };
                    } else if (
                        event.type === 'response.file_search_call.completed'
                    ) {
                        console.log(
                            `File search completed for item ${event.item_id}.`
                        );
                        //yield { type: 'file_search_completed', item_id: event.item_id };
                        // Note: Results are typically delivered via annotations in the text output.
                    }

                    // --- Web Search Events ---
                    else if (
                        event.type === 'response.web_search_call.in_progress'
                    ) {
                        console.log(
                            `Web search in progress for item ${event.item_id}...`
                        );
                        //yield { type: 'web_search_started', item_id: event.item_id };
                    } else if (
                        event.type === 'response.web_search_call.searching'
                    ) {
                        console.log(
                            `Web search searching for item ${event.item_id}...`
                        );
                        //yield { type: 'web_search_pending', item_id: event.item_id };
                    } else if (
                        event.type === 'response.web_search_call.completed'
                    ) {
                        console.log(
                            `Web search completed for item ${event.item_id}.`
                        );
                        //yield { type: 'web_search_completed', item_id: event.item_id };
                        // Note: Results might be used internally by the model or delivered via annotations/text.
                    }

                    // --- Reasoning Summary Events ---
                    else if (
                        event.type === 'response.reasoning_summary_part.added'
                    ) {
                        // A new reasoning summary part was added - we just log this
                        console.log(
                            `Reasoning summary part added for item ${event.item_id}, index ${event.summary_index}`
                        );
                        // We don't yield anything here, we wait for the text deltas
                    } else if (
                        event.type === 'response.reasoning_summary_part.done'
                    ) {
                        // A reasoning summary part was completed - we just log this
                        console.log(
                            `Reasoning summary part done for item ${event.item_id}, index ${event.summary_index}`
                        );
                        // We don't yield anything here, we rely on the text.done event
                    } else if (
                        event.type ===
                            'response.reasoning_summary_text.delta' &&
                        event.delta
                    ) {
                        // A delta was added to a reasoning summary text
                        const itemId =
                            event.item_id + '-' + event.summary_index;
                        if (!reasoningPositions.has(itemId)) {
                            reasoningPositions.set(itemId, 0);
                            reasoningAggregates.set(itemId, '');
                        }
                        const position = reasoningPositions.get(itemId)!;
                        reasoningAggregates.set(
                            itemId,
                            reasoningAggregates.get(itemId)! + event.delta
                        );

                        // Yield the delta as a message_delta with thinking_content
                        yield {
                            type: 'message_delta',
                            content: '', // No visible content for reasoning
                            message_id: itemId,
                            thinking_content: event.delta,
                            order: position,
                        };
                        reasoningPositions.set(itemId, position + 1);
                    } else if (
                        event.type === 'response.reasoning_summary_text.done' &&
                        event.text !== undefined
                    ) {
                        // A reasoning summary text was completed
                        const itemId =
                            event.item_id + '-' + event.summary_index;
                        const aggregatedThinking =
                            reasoningAggregates.get(itemId) ?? event.text;

                        // Yield the completed thinking content
                        yield {
                            type: 'message_complete',
                            content: '', // No visible content for reasoning
                            message_id: itemId,
                            thinking_content: aggregatedThinking,
                        };

                        // Clean up tracking
                        reasoningPositions.delete(itemId);
                        reasoningAggregates.delete(itemId);
                    }

                    // --- API Stream Error Event ---
                    else if (event.type === 'error' && event.message) {
                        log_llm_error(requestId, event);
                        // An error reported by the API within the stream
                        console.error(
                            `API Stream Error (${model}): [${event.code || 'N/A'}] ${event.message}`
                        );
                        yield {
                            type: 'error',
                            error: `OpenAI API error (${model}): [${event.code || 'N/A'}] ${event.message}`,
                        };
                    }

                    // --- Catch unexpected event types (shouldn't happen if user confirmation is correct) ---
                    // else {
                    //    console.warn('Received unexpected event type:', event.type, event);
                    // }
                }
            } catch (streamError) {
                log_llm_error(requestId, streamError);
                // Catch errors during stream iteration/processing
                console.error('Error processing response stream:', streamError);
                yield {
                    type: 'error',
                    error: `OpenAI stream request error (${model}): ${streamError}`,
                };
            } finally {
                // Clean up: Check if any tool calls were started but not completed
                if (toolCallStates.size > 0) {
                    console.warn(
                        `Stream ended with ${toolCallStates.size} incomplete tool call(s).`
                    );
                    for (const [, toolCall] of toolCallStates.entries()) {
                        // Optionally yield incomplete tool calls if appropriate for your application
                        if (toolCall.function.name) {
                            // Check if it was minimally valid
                            yield {
                                type: 'tool_start', // Or maybe 'tool_incomplete'?
                                tool_call: toolCall as ToolCall,
                            };
                        }
                    }
                    toolCallStates.clear(); // Clear the map
                }
                // Flush any buffered d
                for (const ev of flushBufferedDeltas(
                    deltaBuffers,
                    (id, content) =>
                        ({
                            type: 'message_delta',
                            content,
                            message_id: id,
                            order: messagePositions.get(id) ?? 0,
                        }) as ProviderStreamEvent
                )) {
                    yield ev;
                }
                messagePositions.clear(); // Clear positions map
                // console.log("Stream processing finished.");

                // For streaming responses, we log basic summary data
                log_llm_response(requestId, events);
            }
        } catch (error) {
            log_llm_error(requestId, error);
            console.error('Error in OpenAI streaming response:', error);
            yield {
                type: 'error',
                error:
                    'OpenAI streaming error: ' +
                    (error instanceof Error ? error.stack : String(error)),
            };
        }
    }
}

// Export an instance of the provider
export const openaiProvider = new OpenAIProvider();
