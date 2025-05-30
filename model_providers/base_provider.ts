import { ModelProvider } from './model_provider.js';
import { ModelProviderID } from '../model_data.js';
import { 
  EnsembleStreamEvent, 
  ResponseInput,
  ToolFunction,
  ModelSettings,
  EnsembleAgent
} from '../types.js';
import {
  ResponseMessage,
  ResponseOptions,
  ResponseTurn
} from '../types/extended_types.js';
import { resizeAndSplitForOpenAI } from '../utils/image_utils.js';
import { DeltaBuffer } from '../utils/delta_buffer.js';
import { EnsembleLogger } from '../utils/llm_logger.js';

/**
 * Abstract base class for model providers that implements common functionality
 */
export abstract class BaseModelProvider implements ModelProvider {
  protected logger?: EnsembleLogger;
  
  constructor(protected providerId: ModelProviderID) {}

  abstract supportsModel(model: string): boolean;
  abstract createResponseStream(
    model: string,
    messages: ResponseInput,
    agent: EnsembleAgent
  ): AsyncGenerator<EnsembleStreamEvent>;

  /**
   * Common error handling logic
   */
  protected handleError(error: unknown, context: string): EnsembleStreamEvent {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const fullMessage = `${context}: ${errorMessage}`;
    
    if (this.logger) {
      this.logger.log_llm_error(undefined, fullMessage);
    }
    
    return {
      type: 'error',
      error: fullMessage
    };
  }

  /**
   * Process and resize images with common logic
   */
  protected async processImage(
    base64Image: string,
    mediaType: string,
    options: ResponseOptions
  ): Promise<{ data: string; mediaType: string }> {
    const maxWidth = options.maxImageDimension || 1024;
    const maxHeight = options.maxImageDimension || 1024;
    
    try {
      // Create data URL from base64
      const dataUrl = `data:${mediaType};base64,${base64Image}`;
      
      // Use the resize function (returns array of image URLs)
      const resizedUrls = await resizeAndSplitForOpenAI(dataUrl);
      
      // Extract base64 from the first URL (data:image/jpeg;base64,...)
      if (resizedUrls.length > 0) {
        const match = resizedUrls[0].match(/^data:(image\/[^;]+);base64,(.+)$/);
        if (match) {
          return {
            data: match[2],
            mediaType: match[1]
          };
        }
      }
      
      // Fallback to original
      return {
        data: base64Image,
        mediaType
      };
    } catch (error) {
      throw new Error(`Failed to process image: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Extract base64 image data from various input formats
   */
  protected extractBase64Image(data: string): { data: string; mediaType: string } | null {
    // Data URL format: data:image/jpeg;base64,/9j/4AAQ...
    const dataUrlMatch = data.match(/^data:(image\/(?:jpeg|jpg|png|gif|webp));base64,(.+)$/);
    if (dataUrlMatch) {
      return {
        mediaType: dataUrlMatch[1],
        data: dataUrlMatch[2]
      };
    }
    
    // Base64 with newlines (common in some formats)
    const base64WithNewlines = data.replace(/\s/g, '');
    if (this.isValidBase64(base64WithNewlines)) {
      // Try to detect image type from base64 data
      const mediaType = this.detectImageType(base64WithNewlines);
      if (mediaType) {
        return {
          mediaType,
          data: base64WithNewlines
        };
      }
    }
    
    return null;
  }

  /**
   * Validate base64 string
   */
  protected isValidBase64(str: string): boolean {
    try {
      return btoa(atob(str)) === str;
    } catch {
      return false;
    }
  }

  /**
   * Detect image type from base64 data
   */
  protected detectImageType(base64Data: string): string | null {
    try {
      const decoded = atob(base64Data.slice(0, 16));
      const bytes = new Uint8Array(decoded.split('').map(char => char.charCodeAt(0)));
      
      // Check magic numbers
      if (bytes[0] === 0xFF && bytes[1] === 0xD8) return 'image/jpeg';
      if (bytes[0] === 0x89 && bytes[1] === 0x50) return 'image/png';
      if (bytes[0] === 0x47 && bytes[1] === 0x49) return 'image/gif';
      if (bytes[0] === 0x52 && bytes[1] === 0x49) return 'image/webp';
      
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Create a delta buffer for streaming text
   */
  protected createDeltaBuffer(): DeltaBuffer {
    return new DeltaBuffer();
  }

  /**
   * Common tool parameter validation
   */
  protected validateToolParameters(
    params: Record<string, unknown>,
    schema: Record<string, unknown>
  ): boolean {
    // Basic validation - can be extended with Zod later
    const required = (schema as any).required || [];
    for (const field of required) {
      if (!(field in params)) {
        return false;
      }
    }
    return true;
  }

  /**
   * Set logger instance
   */
  public setLogger(logger: EnsembleLogger): void {
    this.logger = logger;
  }

  /**
   * Convert internal tool format to common structure
   */
  protected convertToolToCommon(tool: ToolFunction): {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  } {
    return {
      name: tool.definition.function.name,
      description: tool.definition.function.description || '',
      parameters: tool.definition.function.parameters || {}
    };
  }

  /**
   * Create a message delta event
   */
  protected createTextEvent(text: string): EnsembleStreamEvent {
    return {
      type: 'message_delta',
      content: text,
      message_id: 'msg_' + Date.now()
    };
  }

  /**
   * Create a tool call event
   */
  protected createToolCallEvent(
    id: string,
    name: string,
    parameters: Record<string, unknown>
  ): EnsembleStreamEvent {
    return {
      type: 'tool_start',
      tool_calls: [{
        id,
        type: 'function',
        call_id: id,
        function: {
          name,
          arguments: JSON.stringify(parameters)
        }
      }]
    };
  }

  /**
   * Create a cost update event
   */
  protected createUsageEvent(
    inputTokens: number,
    outputTokens: number
  ): EnsembleStreamEvent {
    return {
      type: 'cost_update',
      usage: {
        input_tokens: inputTokens,
        output_tokens: outputTokens
      }
    };
  }

  /**
   * Create a cost event
   */
  protected createCostEvent(
    inputCost: number,
    outputCost: number
  ): EnsembleStreamEvent {
    // Cost is included in cost_update event
    return this.createUsageEvent(0, 0);
  }
}