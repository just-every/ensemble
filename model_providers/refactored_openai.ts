import { BaseModelProvider } from './base_provider.js';
import { 
  EnsembleStreamEvent,
  ToolFunction,
  ResponseInputFunctionCall,
  ResponseInputFunctionCallOutput,
  ResponseInput,
  EnsembleAgent,
  ResponseInputMessage,
  ResponseThinkingMessage,
  ResponseOutputMessage
} from '../types.js';
import {
  ResponseMessage,
  ResponseOptions,
  ResponseTurn
} from '../types/extended_types.js';
import { 
  OpenAIStreamChunk, 
  OpenAIMessage, 
  OpenAITool,
  OpenAIToolCall,
  ParsedToolCall,
  ParsedUsage
} from '../types/api_types.js';
import { validateMessages, validateTools, validateTemperature, validateMaxTokens } from '../validation.js';
import { createProviderError, ProviderError } from '../errors.js';
import { AsyncQueue } from '../utils/async_queue.js';
import OpenAI from 'openai';

/**
 * Refactored OpenAI provider demonstrating clean separation of concerns
 */
export class RefactoredOpenAIProvider extends BaseModelProvider {
  private client: OpenAI;
  private supportedModels = new Set([
    'gpt-4o',
    'gpt-4o-mini',
    'gpt-4-turbo',
    'gpt-3.5-turbo',
    'o1-preview',
    'o1-mini',
    'o3-mini'
  ]);

  constructor() {
    super('openai');
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY environment variable is required');
    }
    this.client = new OpenAI({ apiKey });
  }

  supportsModel(model: string): boolean {
    return this.supportedModels.has(model);
  }

  async *createResponseStream(
    model: string,
    messages: ResponseInput,
    agent: EnsembleAgent
  ): AsyncGenerator<EnsembleStreamEvent> {
    // Extract options from agent
    const options = agent.modelSettings || {};
    const tools = await agent.getTools();
    
    // Convert messages and extract system prompt
    let systemPrompt = '';
    const convertedMessages: ResponseMessage[] = [];
    
    for (const msg of messages) {
      if (msg.type === 'message' && msg.role === 'system') {
        systemPrompt = typeof msg.content === 'string' ? msg.content : '';
      } else {
        convertedMessages.push(msg as ResponseMessage);
      }
    }
    try {
      // Validate inputs
      validateMessages(messages);
      if (tools.length > 0) validateTools(tools.map(t => t.definition));
      
      // Convert messages and tools
      const openAIMessages = this.convertMessages(convertedMessages, systemPrompt);
      const openAITools = tools.length > 0 ? this.convertTools(tools) : undefined;
      
      // Create request
      const requestOptions = this.buildRequestOptions(
        model,
        openAIMessages,
        openAITools,
        options.tool_choice,
        options as ResponseOptions
      );
      
      // Stream response
      const stream = await this.createStream(requestOptions);
      
      // Process stream
      yield* this.processStream(stream, model);
      
      // Generator ends here - no return value for AsyncGenerator<EnsembleStreamEvent>
    } catch (error) {
      yield this.handleError(error, 'OpenAI request failed');
      throw error;
    }
  }

  /**
   * Convert internal messages to OpenAI format
   */
  private convertMessages(messages: ResponseMessage[], systemPrompt: string): OpenAIMessage[] {
    const converted: OpenAIMessage[] = [];
    
    if (systemPrompt) {
      converted.push({ role: 'system', content: systemPrompt });
    }
    
    for (const msg of messages) {
      converted.push(...this.convertMessage(msg));
    }
    
    return converted;
  }

  /**
   * Convert a single message to OpenAI format
   */
  private convertMessage(message: ResponseMessage): OpenAIMessage[] {
    switch (message.type) {
      case 'message':
        if ('content' in message && (message.role === 'user' || message.role === 'system')) {
          return [{
            role: message.role,
            content: this.convertContent(message.content)
          }];
        } else if ('content' in message && message.role === 'assistant') {
          return [{
            role: 'assistant',
            content: this.convertContent(message.content)
          }];
        }
        break;
        
      case 'function_call':
        return this.convertFunctionCall(message as ResponseInputFunctionCall);
        
      case 'function_call_output':
        return this.convertFunctionOutput(message as ResponseInputFunctionCallOutput);
    }
    
    return [];
  }

  /**
   * Convert content to OpenAI format
   */
  private convertContent(content: ResponseInputMessage['content'] | ResponseThinkingMessage['content'] | ResponseOutputMessage['content']): string | OpenAIMessage['content'] {
    if (typeof content === 'string') {
      return content;
    }
    
    // Handle array content with images
    return content.map(item => {
      if (item.type === 'input_text') {
        return { type: 'text', text: item.text };
      } else if (item.type === 'input_image') {
        return {
          type: 'image_url',
          image_url: {
            url: item.image_url || `data:image/jpeg;base64,${item.file_id}`,
            detail: item.detail
          }
        };
      }
      return { type: 'text', text: '' };
    });
  }

  /**
   * Convert function call to OpenAI format
   */
  private convertFunctionCall(call: ResponseInputFunctionCall): OpenAIMessage[] {
    return [{
      role: 'assistant',
      content: null,
      tool_calls: [{
        index: 0,
        id: call.call_id,
        type: 'function',
        function: {
          name: call.name,
          arguments: call.arguments
        }
      }]
    }];
  }

  /**
   * Convert function output to OpenAI format
   */
  private convertFunctionOutput(output: ResponseInputFunctionCallOutput): OpenAIMessage[] {
    return [{
      role: 'tool',
      content: output.output,
      tool_call_id: output.call_id
    }];
  }

  /**
   * Convert tools to OpenAI format
   */
  private convertTools(tools: ToolFunction[]): OpenAITool[] {
    return tools.map(tool => ({
      type: 'function',
      function: {
        name: tool.definition.function.name,
        description: tool.definition.function.description,
        parameters: tool.definition.function.parameters
      }
    }));
  }

  /**
   * Build request options
   */
  private buildRequestOptions(
    model: string,
    messages: OpenAIMessage[],
    tools?: OpenAITool[],
    toolChoice?: ResponseOptions['toolChoice'],
    options?: ResponseOptions
  ): OpenAI.ChatCompletionCreateParams {
    const params: OpenAI.ChatCompletionCreateParams = {
      model,
      messages: messages as any,
      stream: true,
      temperature: validateTemperature(options?.temperature),
      max_tokens: validateMaxTokens(options?.max_tokens),
      top_p: options?.top_p,
      seed: options?.seed
    };
    
    if (tools && tools.length > 0) {
      params.tools = tools;
      params.tool_choice = this.convertToolChoice(toolChoice);
    }
    
    return params;
  }

  /**
   * Convert tool choice to OpenAI format
   */
  private convertToolChoice(
    toolChoice?: ResponseOptions['toolChoice']
  ): OpenAI.ChatCompletionCreateParams['tool_choice'] {
    if (!toolChoice) return 'auto';
    if (typeof toolChoice === 'string') return toolChoice as OpenAI.ChatCompletionCreateParams['tool_choice'];
    return {
      type: 'function',
      function: { name: toolChoice.function.name }
    };
  }

  /**
   * Create streaming response
   */
  private async createStream(
    params: OpenAI.ChatCompletionCreateParams
  ): Promise<AsyncIterable<OpenAIStreamChunk>> {
    const response = await this.client.chat.completions.create(params);
    return response as AsyncIterable<OpenAIStreamChunk>;
  }

  /**
   * Process the streaming response
   */
  private async *processStream(
    stream: AsyncIterable<OpenAIStreamChunk>,
    model: string
  ): AsyncGenerator<EnsembleStreamEvent> {
    const deltaBuffer = this.createDeltaBuffer();
    const toolCallAccumulator = new ToolCallAccumulator();
    let usage: ParsedUsage | null = null;
    
    try {
      for await (const chunk of stream) {
        // Process chunk and yield events
        yield* this.processChunk(chunk, deltaBuffer, toolCallAccumulator);
        
        // Capture usage if present
        if (chunk.usage) {
          usage = {
            inputTokens: chunk.usage.prompt_tokens,
            outputTokens: chunk.usage.completion_tokens,
            totalTokens: chunk.usage.total_tokens
          };
        }
      }
      
      // Flush any remaining text
      const remainingText = deltaBuffer.flush();
      if (remainingText) {
        yield this.createTextEvent(remainingText);
      }
      
      // Emit tool calls
      yield* toolCallAccumulator.emitPendingCalls(this);
      
      // Emit usage
      if (usage) {
        yield this.createUsageEvent(usage.inputTokens, usage.outputTokens);
      }
      
      // Emit final complete event if there was content
      const finalText = deltaBuffer.flush();
      if (finalText) {
        yield {
          type: 'message_complete',
          content: finalText,
          message_id: 'msg_' + Date.now()
        };
      }
      
    } catch (error) {
      throw createProviderError('openai', error);
    }
  }

  /**
   * Process a single stream chunk
   */
  private *processChunk(
    chunk: OpenAIStreamChunk,
    deltaBuffer: ReturnType<BaseModelProvider['createDeltaBuffer']>,
    toolCallAccumulator: ToolCallAccumulator
  ): Generator<EnsembleStreamEvent> {
    const choice = chunk.choices[0];
    if (!choice?.delta) return;
    
    // Process text content
    if (choice.delta.content) {
      const flushed = deltaBuffer.add(choice.delta.content);
      if (flushed) {
        yield this.createTextEvent(flushed);
      }
    }
    
    // Process tool calls
    if (choice.delta.tool_calls) {
      for (const toolCall of choice.delta.tool_calls) {
        toolCallAccumulator.accumulate(toolCall);
      }
    }
  }

  /**
   * Build the final response turn
   */
  private buildResponseTurn(
    model: string,
    text: string,
    toolCalls: ParsedToolCall[],
    usage: ParsedUsage | null
  ): ResponseTurn {
    const messages: ResponseMessage[] = [];
    
    if (text) {
      messages.push({
        type: 'message',
        role: 'assistant',
        content: text,
        status: 'completed',
        model
      });
    }
    
    for (const toolCall of toolCalls) {
      messages.push({
        type: 'function_call',
        call_id: toolCall.id,
        name: toolCall.name,
        arguments: JSON.stringify(toolCall.arguments),
        status: 'completed',
        model
      });
    }
    
    return {
      messages,
      usage: usage ? {
        input_tokens: usage.inputTokens,
        output_tokens: usage.outputTokens
      } : undefined
    };
  }
}

/**
 * Helper class to accumulate tool calls from streaming chunks
 */
class ToolCallAccumulator {
  private toolCalls = new Map<number, {
    id: string;
    name: string;
    arguments: string;
  }>();
  
  accumulate(toolCall: OpenAIToolCall): void {
    const existing = this.toolCalls.get(toolCall.index) || {
      id: '',
      name: '',
      arguments: ''
    };
    
    if (toolCall.id) existing.id = toolCall.id;
    if (toolCall.function?.name) existing.name = toolCall.function.name;
    if (toolCall.function?.arguments) existing.arguments += toolCall.function.arguments;
    
    this.toolCalls.set(toolCall.index, existing);
  }
  
  *emitPendingCalls(provider: BaseModelProvider): Generator<EnsembleStreamEvent> {
    for (const [_, toolCall] of this.toolCalls) {
      if (toolCall.id && toolCall.name && toolCall.arguments) {
        try {
          const params = JSON.parse(toolCall.arguments);
          yield {
            type: 'tool_start',
            tool_calls: [{
              id: toolCall.id,
              type: 'function',
              call_id: toolCall.id,
              function: {
                name: toolCall.name,
                arguments: toolCall.arguments
              }
            }]
          } as EnsembleStreamEvent;
        } catch (e) {
          // Invalid JSON in arguments
          // Skip invalid tool calls - emit error
          console.error(`Failed to parse tool arguments for ${toolCall.name}:`, e);
        }
      }
    }
  }
  
  getCompletedCalls(): ParsedToolCall[] {
    const calls: ParsedToolCall[] = [];
    for (const [_, toolCall] of this.toolCalls) {
      if (toolCall.id && toolCall.name && toolCall.arguments) {
        try {
          calls.push({
            id: toolCall.id,
            name: toolCall.name,
            arguments: JSON.parse(toolCall.arguments)
          });
        } catch (e) {
          // Skip invalid tool calls
        }
      }
    }
    return calls;
  }
}