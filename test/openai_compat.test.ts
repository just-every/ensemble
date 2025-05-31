import { describe, it, expect, vi } from 'vitest';
import OpenAIEnsemble, { chat, completions } from '../openai-compat';
import type { 
    ChatCompletionCreateParams, 
    ChatCompletionResponse,
    ChatCompletionChunk,
    CompletionCreateParams 
} from '../openai-compat';

describe('OpenAI Compatibility Layer', () => {
    describe('chat.completions.create', () => {
        it('should handle non-streaming chat completion', async () => {
            const params: ChatCompletionCreateParams = {
                model: 'test-model',
                messages: [
                    { role: 'system', content: 'You are a helpful assistant' },
                    { role: 'user', content: 'Hello!' }
                ],
                temperature: 0.7,
                max_tokens: 100
            };

            const response = await chat.completions.create(params) as ChatCompletionResponse;

            expect(response).toBeDefined();
            expect(response.object).toBe('chat.completion');
            expect(response.model).toBe('test-model');
            expect(response.choices).toHaveLength(1);
            expect(response.choices[0].message.role).toBe('assistant');
            expect(response.choices[0].message.content).toBeDefined();
            expect(response.choices[0].finish_reason).toBe('stop');
        });

        it('should handle streaming chat completion', async () => {
            const params: ChatCompletionCreateParams = {
                model: 'test-model',
                messages: [
                    { role: 'user', content: 'Tell me a story' }
                ],
                stream: true
            };

            const stream = await chat.completions.create(params) as AsyncIterable<ChatCompletionChunk>;
            
            const chunks: ChatCompletionChunk[] = [];
            for await (const chunk of stream) {
                chunks.push(chunk);
            }

            expect(chunks.length).toBeGreaterThan(0);
            expect(chunks[0].object).toBe('chat.completion.chunk');
            expect(chunks[0].choices[0].delta.role).toBe('assistant');
            
            // Check that we get content deltas
            const contentChunks = chunks.filter(c => c.choices[0].delta.content);
            expect(contentChunks.length).toBeGreaterThan(0);
            
            // Check for final chunk with finish reason
            const lastChunk = chunks[chunks.length - 1];
            expect(lastChunk.choices[0].finish_reason).toBe('stop');
        });

        it('should handle tool/function calls', async () => {
            const params: ChatCompletionCreateParams = {
                model: 'test-model',
                messages: [
                    { role: 'user', content: 'What is the weather?' }
                ],
                tools: [{
                    type: 'function',
                    function: {
                        name: 'get_weather',
                        description: 'Get weather for a location',
                        parameters: {
                            type: 'object',
                            properties: {
                                location: { type: 'string' }
                            },
                            required: ['location']
                        }
                    }
                }],
                tool_choice: 'auto'
            };

            const response = await chat.completions.create(params) as ChatCompletionResponse;

            // Test model should return text, not tools
            expect(response.choices[0].message.content).toBeDefined();
        });

        it('should convert system messages to developer role', async () => {
            const params: ChatCompletionCreateParams = {
                model: 'test-model',
                messages: [
                    { role: 'system', content: 'System prompt' },
                    { role: 'user', content: 'User message' },
                    { role: 'assistant', content: 'Assistant response' }
                ]
            };

            const response = await chat.completions.create(params) as ChatCompletionResponse;
            expect(response).toBeDefined();
            expect(response.choices[0].message.content).toBeDefined();
        });

        it('should handle response format', async () => {
            const params: ChatCompletionCreateParams = {
                model: 'test-model',
                messages: [
                    { role: 'user', content: 'Return JSON' }
                ],
                response_format: { type: 'json_object' }
            };

            const response = await chat.completions.create(params) as ChatCompletionResponse;
            expect(response).toBeDefined();
        });

        it('should handle all model settings', async () => {
            const params: ChatCompletionCreateParams = {
                model: 'test-model',
                messages: [
                    { role: 'user', content: 'Test' }
                ],
                temperature: 0.5,
                top_p: 0.9,
                max_tokens: 50,
                presence_penalty: 0.1,
                frequency_penalty: 0.2,
                stop: ['END'],
                seed: 12345
            };

            const response = await chat.completions.create(params) as ChatCompletionResponse;
            expect(response).toBeDefined();
            expect(response.usage).toBeDefined();
            expect(response.usage?.total_tokens).toBeGreaterThan(0);
        });
    });

    describe('completions.create', () => {
        it('should handle non-streaming legacy completion', async () => {
            const params: CompletionCreateParams = {
                model: 'test-model',
                prompt: 'Once upon a time',
                max_tokens: 50,
                temperature: 0.8
            };

            const response = await completions.create(params);

            expect(response).toBeDefined();
            expect(response.object).toBe('text_completion');
            expect(response.model).toBe('test-model');
            expect(response.choices).toHaveLength(1);
            expect(response.choices[0].text).toBeDefined();
            expect(response.choices[0].finish_reason).toBe('stop');
        });

        it('should handle streaming legacy completion', async () => {
            const params: CompletionCreateParams = {
                model: 'test-model',
                prompt: 'Write a poem',
                stream: true
            };

            const stream = await completions.create(params) as AsyncIterable<any>;
            
            const chunks = [];
            for await (const chunk of stream) {
                chunks.push(chunk);
            }

            expect(chunks.length).toBeGreaterThan(0);
            expect(chunks[0].object).toBe('text_completion');
            expect(chunks[0].choices[0].text).toBeDefined();
            
            // Check for final chunk
            const lastChunk = chunks[chunks.length - 1];
            expect(lastChunk.choices[0].finish_reason).toBe('stop');
        });

        it('should handle array prompts', async () => {
            const params: CompletionCreateParams = {
                model: 'test-model',
                prompt: ['First line', 'Second line', 'Third line'],
                max_tokens: 20
            };

            const response = await completions.create(params);
            expect(response).toBeDefined();
            expect(response.choices[0].text).toBeDefined();
        });

        it('should handle suffix parameter', async () => {
            const params: CompletionCreateParams = {
                model: 'test-model',
                prompt: 'Start of text',
                suffix: ' end of text',
                max_tokens: 30
            };

            const response = await completions.create(params);
            expect(response).toBeDefined();
            expect(response.choices[0].text).toBeDefined();
        });

        it('should handle all legacy parameters', async () => {
            const params: CompletionCreateParams = {
                model: 'test-model',
                prompt: 'Test prompt',
                max_tokens: 100,
                temperature: 0.7,
                top_p: 0.95,
                presence_penalty: 0.1,
                frequency_penalty: 0.2,
                stop: ['\n'],
                user: 'test-user'
            };

            const response = await completions.create(params);
            expect(response).toBeDefined();
            expect(response.usage).toBeDefined();
        });
    });

    describe('Default export structure', () => {
        it('should export OpenAI-compatible structure', () => {
            expect(OpenAIEnsemble).toBeDefined();
            expect(OpenAIEnsemble.chat).toBeDefined();
            expect(OpenAIEnsemble.chat.completions).toBeDefined();
            expect(OpenAIEnsemble.chat.completions.create).toBeInstanceOf(Function);
            expect(OpenAIEnsemble.completions).toBeDefined();
            expect(OpenAIEnsemble.completions.create).toBeInstanceOf(Function);
        });

        it('should work as drop-in replacement', async () => {
            // This mimics how someone would use it as a drop-in replacement
            const client = OpenAIEnsemble;
            
            // Modern API
            const chatResponse = await client.chat.completions.create({
                model: 'test-model',
                messages: [{ role: 'user', content: 'Hi' }]
            }) as ChatCompletionResponse;
            
            expect(chatResponse.choices[0].message.content).toBeDefined();
            
            // Legacy API
            const completionResponse = await client.completions.create({
                model: 'test-model',
                prompt: 'Hello'
            });
            
            expect(completionResponse.choices[0].text).toBeDefined();
        });
    });
});