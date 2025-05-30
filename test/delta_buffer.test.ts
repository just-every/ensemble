import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DeltaBuffer, bufferDelta, flushBufferedDeltas } from '../utils/delta_buffer.js';

describe('DeltaBuffer', () => {
    describe('basic functionality', () => {
        it('should buffer text until threshold is reached', () => {
            const buffer = new DeltaBuffer(20, 400, 20);
            
            // Add chunks that don't reach threshold
            expect(buffer.add('Hello')).toBe(null);
            expect(buffer.add(' ')).toBe(null);
            expect(buffer.add('World')).toBe(null);
            
            // This should trigger flush (total length = 11 + 9 = 20)
            expect(buffer.add('! Testing')).toBe('Hello World! Testing');
        });

        it('should grow threshold after each flush', () => {
            const buffer = new DeltaBuffer(10, 50, 10);
            
            // First flush at 10 chars
            expect(buffer.add('1234567890')).toBe('1234567890');
            
            // Threshold should now be 20
            expect(buffer.add('12345678901')).toBe(null); // 11 chars
            expect(buffer.add('234567890')).toBe('12345678901234567890'); // 20 chars total
            
            // Threshold should now be 30
            expect(buffer.add('123456789012345678901')).toBe(null); // 21 chars
            expect(buffer.add('234567890')).toBe('123456789012345678901234567890'); // 30 chars total triggers flush
        });

        it('should respect max threshold', () => {
            const buffer = new DeltaBuffer(10, 20, 10);
            
            // Flush twice to reach max
            expect(buffer.add('1234567890')).toBe('1234567890');
            expect(buffer.add('12345678901234567890')).toBe('12345678901234567890');
            
            // Now at max (20), threshold shouldn't grow
            expect(buffer.add('12345678901234567890')).toBe('12345678901234567890');
            expect(buffer.add('12345678901234567890')).toBe('12345678901234567890');
        });

        it('should handle empty chunks', () => {
            const buffer = new DeltaBuffer();
            
            expect(buffer.add('')).toBe(null);
            expect(buffer.add('Test')).toBe(null);
            expect(buffer.add('')).toBe(null);
            
            // Force flush
            const result = buffer.flush();
            expect(result).toBe('Test');
        });

        it('should flush remaining content', () => {
            const buffer = new DeltaBuffer();
            
            buffer.add('Some ');
            buffer.add('content');
            
            const flushed = buffer.flush();
            expect(flushed).toBe('Some content');
            
            // Second flush should return null
            expect(buffer.flush()).toBe(null);
        });

        it('should handle special characters', () => {
            const buffer = new DeltaBuffer(30, 100, 30);
            
            buffer.add('Line 1\n');
            buffer.add('Line 2\t');
            buffer.add('Special: 🎉');
            
            const result = buffer.flush();
            expect(result).toBe('Line 1\nLine 2\tSpecial: 🎉');
        });
    });

    describe('time-based flushing', () => {
        beforeEach(() => {
            vi.useFakeTimers();
        });

        afterEach(() => {
            vi.useRealTimers();
        });

        it('should flush after time limit', () => {
            const buffer = new DeltaBuffer(1000, 2000, 1000, 1000); // 1 second time limit
            
            expect(buffer.add('Hello')).toBe(null);
            
            // Advance time by 1 second
            vi.advanceTimersByTime(1000);
            
            // Next add should trigger time-based flush
            expect(buffer.add(' World')).toBe('Hello World');
        });

        it('should reset timer after flush', () => {
            const buffer = new DeltaBuffer(100, 200, 100, 1000);
            
            buffer.add('First chunk');
            vi.advanceTimersByTime(500);
            
            // Add more to trigger size-based flush
            expect(buffer.add('x'.repeat(90))).toBe('First chunk' + 'x'.repeat(90));
            
            // Timer should be reset
            buffer.add('Second chunk');
            vi.advanceTimersByTime(500);
            expect(buffer.add('x')).toBe(null); // Not enough time passed since last flush
            
            vi.advanceTimersByTime(500);
            expect(buffer.add('y')).toBe('Second chunkxy'); // Now it flushes
        });
    });

    describe('bufferDelta helper', () => {
        it('should manage multiple buffers by ID', () => {
            const store = new Map<string, DeltaBuffer>();
            const makeEvent = (content: string) => ({ type: 'text', content });
            
            // Add to different message IDs
            expect(bufferDelta(store, 'msg1', 'Hello ', makeEvent)).toEqual([]);
            expect(bufferDelta(store, 'msg2', 'Hi ', makeEvent)).toEqual([]);
            expect(bufferDelta(store, 'msg1', 'World', makeEvent)).toEqual([]);
            
            // Trigger flush for msg1
            const longText = 'x'.repeat(50);
            expect(bufferDelta(store, 'msg1', longText, makeEvent)).toEqual([
                { type: 'text', content: 'Hello World' + longText }
            ]);
            
            // msg2 should still be buffering
            expect(store.has('msg2')).toBe(true);
        });

        it('should create buffer on first use', () => {
            const store = new Map<string, DeltaBuffer>();
            const makeEvent = (content: string) => ({ type: 'delta', content });
            
            expect(store.size).toBe(0);
            
            bufferDelta(store, 'new-id', 'text', makeEvent);
            
            expect(store.size).toBe(1);
            expect(store.has('new-id')).toBe(true);
        });
    });

    describe('flushBufferedDeltas helper', () => {
        it('should flush all buffers and clear store', () => {
            const store = new Map<string, DeltaBuffer>();
            const makeEvent = (id: string, content: string) => ({ id, content });
            
            // Add content to multiple buffers
            const buffer1 = new DeltaBuffer();
            buffer1.add('Content 1');
            store.set('msg1', buffer1);
            
            const buffer2 = new DeltaBuffer();
            buffer2.add('Content 2');
            store.set('msg2', buffer2);
            
            const buffer3 = new DeltaBuffer();
            // Empty buffer
            store.set('msg3', buffer3);
            
            const events = flushBufferedDeltas(store, makeEvent);
            
            expect(events).toEqual([
                { id: 'msg1', content: 'Content 1' },
                { id: 'msg2', content: 'Content 2' }
                // msg3 is not included because it's empty
            ]);
            
            expect(store.size).toBe(0);
        });

        it('should handle empty store', () => {
            const store = new Map<string, DeltaBuffer>();
            const makeEvent = (id: string, content: string) => ({ id, content });
            
            const events = flushBufferedDeltas(store, makeEvent);
            
            expect(events).toEqual([]);
            expect(store.size).toBe(0);
        });
    });
});