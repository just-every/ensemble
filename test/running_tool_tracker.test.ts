import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
    RunningToolTracker,
    RunningTool,
    ToolCompletionEvent,
} from '../utils/running_tool_tracker.js';

describe('RunningToolTracker', () => {
    let tracker: RunningToolTracker;

    beforeEach(() => {
        tracker = new RunningToolTracker();
    });

    describe('addRunningTool', () => {
        it('should add a new running tool', () => {
            const tool = tracker.addRunningTool(
                'test-id',
                'testTool',
                'testAgent',
                '{"arg": "value"}'
            );

            expect(tool.id).toBe('test-id');
            expect(tool.toolName).toBe('testTool');
            expect(tool.agentName).toBe('testAgent');
            expect(tool.args).toBe('{"arg": "value"}');
            expect(tool.startTime).toBeDefined();
            expect(tool.abortController).toBeDefined();
        });
    });

    describe('getRunningTool', () => {
        it('should retrieve a running tool by ID', () => {
            tracker.addRunningTool('test-id', 'testTool', 'testAgent', '{}');
            const tool = tracker.getRunningTool('test-id');

            expect(tool).toBeDefined();
            expect(tool?.id).toBe('test-id');
        });

        it('should return undefined for non-existent tool', () => {
            const tool = tracker.getRunningTool('non-existent');
            expect(tool).toBeUndefined();
        });
    });

    describe('markTimedOut', () => {
        it('should mark a tool as timed out', () => {
            tracker.addRunningTool('test-id', 'testTool', 'testAgent', '{}');
            tracker.markTimedOut('test-id');

            const tool = tracker.getRunningTool('test-id');
            expect(tool?.timedOut).toBe(true);
        });
    });

    describe('completeRunningTool', () => {
        it('should complete a running tool', async () => {
            tracker.addRunningTool('test-id', 'testTool', 'testAgent', '{}');
            await tracker.completeRunningTool('test-id', 'result');

            const tool = tracker.getRunningTool('test-id');
            expect(tool).toBeUndefined(); // Should be removed after completion
        });

        it('should emit completion event for timed out tool', async () => {
            const completionHandler = vi.fn();
            tracker.onCompletion(completionHandler);

            tracker.addRunningTool('test-id', 'testTool', 'testAgent', '{}');
            tracker.markTimedOut('test-id');
            await tracker.completeRunningTool('test-id', 'result');

            expect(completionHandler).toHaveBeenCalledWith(
                expect.objectContaining({
                    id: 'test-id',
                    toolName: 'testTool',
                    agentName: 'testAgent',
                    timedOut: true,
                    result: 'result',
                })
            );
        });
    });

    describe('failRunningTool', () => {
        it('should fail a running tool', async () => {
            tracker.addRunningTool('test-id', 'testTool', 'testAgent', '{}');
            await tracker.failRunningTool('test-id', 'error message');

            const tool = tracker.getRunningTool('test-id');
            expect(tool).toBeUndefined(); // Should be removed after failure
        });

        it('should emit completion event with error for timed out tool', async () => {
            const completionHandler = vi.fn();
            tracker.onCompletion(completionHandler);

            tracker.addRunningTool('test-id', 'testTool', 'testAgent', '{}');
            tracker.markTimedOut('test-id');
            await tracker.failRunningTool('test-id', 'error message');

            expect(completionHandler).toHaveBeenCalledWith(
                expect.objectContaining({
                    id: 'test-id',
                    error: 'error message',
                    timedOut: true,
                })
            );
        });
    });

    describe('getRunningToolsForAgent', () => {
        it('should return tools for specific agent', () => {
            tracker.addRunningTool('id1', 'tool1', 'agent1', '{}');
            tracker.addRunningTool('id2', 'tool2', 'agent2', '{}');
            tracker.addRunningTool('id3', 'tool3', 'agent1', '{}');

            const agent1Tools = tracker.getRunningToolsForAgent('agent1');
            expect(agent1Tools).toHaveLength(2);
            expect(agent1Tools.map(t => t.id)).toContain('id1');
            expect(agent1Tools.map(t => t.id)).toContain('id3');
        });
    });

    describe('abortRunningTool', () => {
        it('should abort a running tool', () => {
            const tool = tracker.addRunningTool('test-id', 'testTool', 'testAgent', '{}');
            const abortSpy = vi.spyOn(tool.abortController!, 'abort');

            tracker.abortRunningTool('test-id');
            expect(abortSpy).toHaveBeenCalled();
        });
    });

    describe('isToolRunning', () => {
        it('should check if specific tool is running for agent', () => {
            tracker.addRunningTool('id1', 'tool1', 'agent1', '{}');
            tracker.addRunningTool('id2', 'tool2', 'agent1', '{}');

            expect(tracker.isToolRunning('agent1', 'tool1')).toBe(true);
            expect(tracker.isToolRunning('agent1', 'tool3')).toBe(false);
            expect(tracker.isToolRunning('agent2', 'tool1')).toBe(false);
        });
    });

    describe('waitForTool', () => {
        it('should wait for tool completion', async () => {
            tracker.addRunningTool('test-id', 'testTool', 'testAgent', '{}');
            
            const waitPromise = tracker.waitForTool('test-id');
            
            // Complete the tool
            tracker.markTimedOut('test-id');
            await tracker.completeRunningTool('test-id', 'result');

            const event = await waitPromise;
            expect(event).toMatchObject({
                id: 'test-id',
                result: 'result',
            });
        });

        it('should timeout when waiting too long', async () => {
            tracker.addRunningTool('test-id', 'testTool', 'testAgent', '{}');

            await expect(tracker.waitForTool('test-id', 100)).rejects.toThrow(
                'Timeout waiting for tool test-id'
            );
        });

        it('should return null for non-existent tool', async () => {
            const result = await tracker.waitForTool('non-existent');
            expect(result).toBeNull();
        });
    });

    describe('clear', () => {
        it('should clear all running tools and abort them', () => {
            const tool1 = tracker.addRunningTool('id1', 'tool1', 'agent1', '{}');
            const tool2 = tracker.addRunningTool('id2', 'tool2', 'agent2', '{}');
            
            const abort1Spy = vi.spyOn(tool1.abortController!, 'abort');
            const abort2Spy = vi.spyOn(tool2.abortController!, 'abort');

            tracker.clear();

            expect(abort1Spy).toHaveBeenCalled();
            expect(abort2Spy).toHaveBeenCalled();
            expect(tracker.getRunningToolCount()).toBe(0);
        });
    });
});