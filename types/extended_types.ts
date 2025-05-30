/**
 * Extended types and aliases for improved compatibility
 */

import {
  ResponseInputMessage,
  ResponseThinkingMessage,
  ResponseOutputMessage,
  ResponseInputFunctionCall,
  ResponseInputFunctionCallOutput,
  ModelSettings,
  ModelClassID,
  ResponseInput,
  ResponseContentText,
  ResponseContentImage,
  ResponseContentFileInput,
  ModelUsage
} from '../types.js';

// Unified message type
export type ResponseMessage = 
  | ResponseInputMessage
  | ResponseThinkingMessage
  | ResponseOutputMessage
  | ResponseInputFunctionCall
  | ResponseInputFunctionCallOutput;

// Response options
export interface ResponseOptions {
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  top_k?: number;
  seed?: number;
  stop_sequences?: string[];
  responseFormat?: {
    type: 'text' | 'json_object' | 'json_schema';
    json_schema?: {
      name: string;
      schema: Record<string, unknown>;
      strict?: boolean;
    };
  };
  toolChoice?: ModelSettings['tool_choice'];
  tools?: Array<{
    type: 'function';
    function: {
      name: string;
      description?: string;
      parameters: Record<string, unknown>;
    };
  }>;
  maxImageDimension?: number;
  fallbackModels?: string[];
}

// Response turn
export interface ResponseTurn {
  messages: ResponseMessage[];
  usage?: {
    input_tokens: number;
    output_tokens: number;
    cached_tokens?: number;
  };
  cost?: {
    input: number;
    output: number;
    total: number;
  };
}