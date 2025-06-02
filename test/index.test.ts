/**
 * Test suite for the main ensemble package exports
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
    // Main API
    request,
    
    // Model provider functions
    getModelProvider,
    getProviderFromModel,
    getModelFromClass,
    isProviderKeyValid,
    
    // Model data
    MODEL_REGISTRY,
    MODEL_CLASSES,
    findModel,
    
    // Types and interfaces
    ModelProviderID,
    ModelUsage,
    TieredPrice,
    TimeBasedPrice,
    ModelEntry,
    EnsembleStreamEvent,
    ModelClassID,
    
    // Utilities
    costTracker,
    quotaTracker,
    
    // Test provider
    TestProvider,
    testProviderConfig,
    resetTestProviderConfig,
} from '../index.js';

describe('Ensemble Package Exports', () => {
    beforeEach(() => {
        // Reset test provider config before each test
        resetTestProviderConfig();
    });

    describe('Main API Functions', () => {
        it('should export the request function', () => {
            expect(typeof request).toBe('function');
        });

        it('should export model provider functions', () => {
            expect(typeof getModelProvider).toBe('function');
            expect(typeof getProviderFromModel).toBe('function');
            expect(typeof getModelFromClass).toBe('function');
            expect(typeof isProviderKeyValid).toBe('function');
        });
    });

    describe('Model Data Exports', () => {
        it('should export MODEL_REGISTRY as an array', () => {
            expect(MODEL_REGISTRY).toBeDefined();
            expect(Array.isArray(MODEL_REGISTRY)).toBe(true);
            // Verify it contains actual model data
            expect(MODEL_REGISTRY.length).toBeGreaterThan(0);
            // Check a known model exists
            const claudeModel = MODEL_REGISTRY.find(m => m.id === 'claude-3-5-haiku-latest');
            expect(claudeModel).toBeDefined();
            expect(claudeModel?.provider).toBe('claude');
        });

        it('should export MODEL_CLASSES as an object', () => {
            expect(MODEL_CLASSES).toBeDefined();
            expect(typeof MODEL_CLASSES).toBe('object');
            // Verify it contains actual model classes
            expect(MODEL_CLASSES.standard).toBeDefined();
            expect(MODEL_CLASSES.standard.models).toBeDefined();
            expect(Array.isArray(MODEL_CLASSES.standard.models)).toBe(true);
            expect(MODEL_CLASSES.standard.models.length).toBeGreaterThan(0);
        });

        it('should export findModel function', () => {
            expect(typeof findModel).toBe('function');
        });
    });

    describe('Utility Exports', () => {
        it('should export costTracker', () => {
            expect(costTracker).toBeDefined();
            expect(typeof costTracker.addUsage).toBe('function');
            expect(typeof costTracker.calculateCost).toBe('function');
            // Verify it has the expected methods
            expect(typeof costTracker.reset).toBe('function');
            expect(typeof costTracker.getTotalCost).toBe('function');
            expect(typeof costTracker.getCostsByModel).toBe('function');
            expect(typeof costTracker.printSummary).toBe('function');
        });

        it('should export quotaTracker', () => {
            expect(quotaTracker).toBeDefined();
            expect(typeof quotaTracker).toBe('object');
            // Verify it has expected methods
            expect(typeof quotaTracker.trackUsage).toBe('function');
            expect(typeof quotaTracker.hasQuota).toBe('function');
            expect(typeof quotaTracker.getSummary).toBe('function');
        });
    });

    describe('Test Provider Exports', () => {
        it('should export TestProvider class', () => {
            expect(TestProvider).toBeDefined();
            expect(typeof TestProvider).toBe('function');
            // Verify it's a constructor
            const provider = new TestProvider();
            expect(provider).toBeDefined();
            expect(typeof provider.supportsModel).toBe('function');
            expect(typeof provider.createRequestGenerator).toBe('function');
        });

        it('should export test provider config utilities', () => {
            expect(testProviderConfig).toBeDefined();
            expect(typeof testProviderConfig).toBe('object');
            // Verify it has expected properties
            expect(testProviderConfig).toHaveProperty('streamingDelay');
            expect(testProviderConfig).toHaveProperty('shouldError');
            expect(testProviderConfig).toHaveProperty('simulateToolCall');
            
            expect(typeof resetTestProviderConfig).toBe('function');
            // Verify reset works
            testProviderConfig.shouldError = true;
            resetTestProviderConfig();
            expect(testProviderConfig.shouldError).toBe(false);
        });
    });

    describe('Request API Integration', () => {
        it('should handle test provider requests', async () => {
            const events: EnsembleStreamEvent[] = [];
            
            testProviderConfig.fixedResponse = 'Test response';
            testProviderConfig.streamingDelay = 10;

            const stream = request('test-model', [
                { type: 'message', role: 'user', content: 'Hello test' }
            ], {
                agentId: 'test-agent',
                tools: [],
            });

            // Collect all events from the stream
            for await (const event of stream) {
                events.push(event);
            }

            expect(events.length).toBeGreaterThan(0);
            
            // Should have message_start event
            const startEvent = events.find(e => e.type === 'message_start');
            expect(startEvent).toBeDefined();
            expect(startEvent?.type).toBe('message_start');
            if (startEvent?.type === 'message_start') {
                expect(startEvent.message).toBeDefined();
                expect(startEvent.message.id).toBeDefined();
                expect(startEvent.message.role).toBe('assistant');
            }
            
            // Should have message_complete event
            const completeEvent = events.find(e => e.type === 'message_complete');
            expect(completeEvent).toBeDefined();
            
            // Should have stream_end event
            const endEvent = events.find(e => e.type === 'stream_end');
            expect(endEvent).toBeDefined();
        });

        it('should handle early termination', async () => {
            const events: EnsembleStreamEvent[] = [];
            
            const stream = request('test-model', [
                { type: 'message', role: 'user', content: 'Hello test' }
            ], {
                agentId: 'test-agent',
                tools: [],
            });

            // Only collect first few events then break
            for await (const event of stream) {
                events.push(event);
                if (events.length >= 2) break;
            }

            expect(events.length).toBe(2);
        });
    });

    describe('Type Definitions', () => {
        it('should have proper TypeScript types', () => {
            // Test that TypeScript types are properly exported by attempting to use them
            const mockUsage: ModelUsage = {
                model: 'test-model',
                input_tokens: 100,
                output_tokens: 200,
                cost: 0.01,
                timestamp: new Date()
            };
            
            expect(mockUsage.model).toBe('test-model');
            
            const mockEvent: EnsembleStreamEvent = {
                type: 'message_start',
                message_id: 'test-id',
                content: 'test'
            };
            
            expect(mockEvent.type).toBe('message_start');
        });
    });
});