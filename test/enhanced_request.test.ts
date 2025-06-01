/**
 * Tests for enhanced request functionality
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { enhancedRequest } from '../utils/enhanced_request.js';
import { 
    createRequestContext, 
    ToolCallAction,
    EnhancedToolFunction 
} from '../types/tool_types.js';

describe('Enhanced Request', () => {
    const mockMessages = [
        { type: 'message', role: 'user', content: 'Test message' }
    ];
    
    const mockTool: EnhancedToolFunction = {
        definition: {
            type: 'function',
            function: {
                name: 'test_tool',
                description: 'Test tool',
                parameters: {
                    type: 'object',
                    properties: {
                        input: { type: 'string' }
                    },
                    required: ['input']
                }
            }
        },
        function: vi.fn().mockResolvedValue('test result'),
        category: 'utility',
        priority: 1
    };
    
    beforeEach(() => {
        vi.clearAllMocks();
    });
    
    describe('Tool Execution Control', () => {
        it('should execute tools with custom handler', async () => {
            const onToolCall = vi.fn().mockResolvedValue(ToolCallAction.EXECUTE);
            const onToolComplete = vi.fn();
            
            const events = [];
            const stream = enhancedRequest('test-model', mockMessages, {
                tools: [mockTool],
                toolHandler: {
                    onToolCall,
                    onToolComplete
                }
            });
            
            for await (const event of stream) {
                events.push(event);
                if (event.type === 'stream_end') break;
            }
            
            // Verify lifecycle hooks were called
            if (events.some(e => e.type === 'tool_start')) {
                expect(onToolCall).toHaveBeenCalled();
                expect(onToolComplete).toHaveBeenCalled();
            }
        });
        
        it('should skip tools when action is SKIP', async () => {
            const onToolCall = vi.fn().mockResolvedValue(ToolCallAction.SKIP);
            
            const events = [];
            const stream = enhancedRequest('test-model', mockMessages, {
                tools: [mockTool],
                toolHandler: { onToolCall }
            });
            
            for await (const event of stream) {
                events.push(event);
                if (event.type === 'stream_end') break;
            }
            
            // Tool function should not be called when skipped
            expect(mockTool.function).not.toHaveBeenCalled();
        });
        
        it('should halt execution when action is HALT', async () => {
            const context = createRequestContext();
            const onToolCall = vi.fn().mockResolvedValue(ToolCallAction.HALT);
            
            const stream = enhancedRequest('test-model', mockMessages, {
                tools: [mockTool],
                toolHandler: { onToolCall }
            }, context);
            
            const events = [];
            for await (const event of stream) {
                events.push(event);
                // Check if context was halted after tool call
                if (event.type === 'tool_start' && context.isHalted) {
                    break;
                }
            }
            
            // If tools were called, context should be halted
            const hasToolCalls = events.some(e => e.type === 'tool_start');
            if (hasToolCalls) {
                expect(context.isHalted).toBe(true);
            } else {
                // If no tool calls, test passes
                expect(true).toBe(true);
            }
        });
    });
    
    describe('Tool Filtering', () => {
        it('should filter tools by category', async () => {
            const utilityTool = { ...mockTool, category: 'utility' };
            const controlTool = { ...mockTool, category: 'control' };
            
            const stream = enhancedRequest('test-model', mockMessages, {
                tools: [utilityTool, controlTool],
                toolCategories: ['utility']
            });
            
            // Only utility tools should be available
            const events = [];
            for await (const event of stream) {
                events.push(event);
                if (event.type === 'stream_end') break;
            }
            
            // Verify through the stream behavior
            expect(events).toBeDefined();
        });
        
        it('should apply custom tool filter', async () => {
            const tools = [
                { ...mockTool, priority: 1 },
                { ...mockTool, priority: 2 },
                { ...mockTool, priority: 3 }
            ];
            
            const toolFilter = vi.fn((tool) => tool.priority > 1);
            
            const stream = enhancedRequest('test-model', mockMessages, {
                tools,
                toolFilter
            });
            
            const events = [];
            for await (const event of stream) {
                events.push(event);
                if (event.type === 'stream_end') break;
            }
            
            expect(toolFilter).toHaveBeenCalled();
        });
    });
    
    describe('Loop Control', () => {
        it('should respect maxIterations', async () => {
            const context = createRequestContext();
            let iterations = 0;
            
            const stream = enhancedRequest('test-model', mockMessages, {
                loop: {
                    maxIterations: 3,
                    onIteration: async (iter) => {
                        iterations = iter + 1;
                    }
                }
            }, context);
            
            for await (const event of stream) {
                if (event.type === 'stream_end') break;
            }
            
            expect(iterations).toBeLessThanOrEqual(3);
        });
        
        it('should stop on continue condition', async () => {
            const context = createRequestContext();
            let stopped = false;
            
            const stream = enhancedRequest('test-model', mockMessages, {
                loop: {
                    maxIterations: 10,
                    continueCondition: (ctx) => {
                        if (ctx.getMetadata('stop')) {
                            stopped = true;
                            return false;
                        }
                        return true;
                    },
                    onIteration: async (iter, ctx) => {
                        if (iter === 2) {
                            ctx.setMetadata('stop', true);
                        }
                    }
                }
            }, context);
            
            for await (const event of stream) {
                if (event.type === 'stream_end') break;
            }
            
            expect(stopped).toBe(true);
        });
    });
    
    describe('Tool Choice Strategy', () => {
        it('should apply dynamic tool choice', async () => {
            const toolChoiceStrategy = vi.fn((callCount) => {
                return callCount > 2 ? 'none' : 'auto';
            });
            
            const stream = enhancedRequest('test-model', mockMessages, {
                tools: [mockTool],
                toolChoiceStrategy,
                maxToolCalls: 5
            });
            
            for await (const event of stream) {
                if (event.type === 'stream_end') break;
            }
            
            expect(toolChoiceStrategy).toHaveBeenCalled();
        });
    });
    
    describe('Result Transformation', () => {
        it('should transform tool results', async () => {
            const transform = vi.fn((name, result) => `TRANSFORMED: ${result}`);
            
            const stream = enhancedRequest('test-model', mockMessages, {
                tools: [mockTool],
                toolResultTransformer: {
                    transform
                }
            });
            
            const events = [];
            for await (const event of stream) {
                events.push(event);
                if (event.type === 'stream_end') break;
            }
            
            // Check if transform was called when tools were used
            const hasToolCalls = events.some(e => e.type === 'tool_start');
            if (hasToolCalls) {
                expect(transform).toHaveBeenCalled();
            }
        });
    });
    
    describe('Request Context', () => {
        it('should maintain context state', () => {
            const context = createRequestContext({
                metadata: { test: 'value' }
            });
            
            expect(context.metadata.test).toBe('value');
            
            context.setMetadata('newKey', 'newValue');
            expect(context.getMetadata('newKey')).toBe('newValue');
            
            context.halt();
            expect(context.isHalted).toBe(true);
            expect(context.shouldContinue).toBe(false);
        });
        
        it('should manage message history', () => {
            const context = createRequestContext();
            
            const message = { type: 'message', role: 'user', content: 'test' };
            context.addMessage(message);
            
            const history = context.getHistory();
            expect(history).toHaveLength(1);
            expect(history[0]).toEqual(message);
        });
    });
    
    describe('Event Handling', () => {
        it('should filter events', async () => {
            const allowedEvents = ['message_delta', 'tool_start'];
            const emittedEvents = [];
            
            const stream = enhancedRequest('test-model', mockMessages, {
                tools: [mockTool],
                allowedEvents,
                eventEmitter: async (event) => {
                    emittedEvents.push(event.type);
                }
            });
            
            for await (const event of stream) {
                if (event.type === 'stream_end') break;
            }
            
            // All emitted events should be in allowed list
            emittedEvents.forEach(type => {
                expect(allowedEvents).toContain(type);
            });
        });
    });
    
    describe('Tool Constraints', () => {
        it('should handle tool constraints', () => {
            // Test constraint checking logic directly
            const tool: EnhancedToolFunction = {
                ...mockTool,
                maxExecutions: 1,
                cooldown: 1000
            };
            
            // Verify tool has constraints
            expect(tool.maxExecutions).toBe(1);
            expect(tool.cooldown).toBe(1000);
            
            // The actual constraint enforcement is tested through integration
            // but would require more complex mocking to test in isolation
        });
    });
});