import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
    setEnsembleLogger,
    addEnsembleLogger,
    removeEnsembleLogger,
    getAllEnsembleLoggers,
    getEnsembleLogger,
    log_llm_request,
    log_llm_response,
    log_llm_error,
} from '../utils/llm_logger.js';
import { EnsembleLogger } from '../types/types.js';

describe('Multi-Logger Support', () => {
    let logger1: EnsembleLogger;
    let logger2: EnsembleLogger;
    let logger3: EnsembleLogger;

    beforeEach(() => {
        // Clear all loggers before each test
        setEnsembleLogger(null);

        // Create mock loggers
        logger1 = {
            log_llm_request: vi.fn().mockReturnValue('request-1'),
            log_llm_response: vi.fn(),
            log_llm_error: vi.fn(),
        };

        logger2 = {
            log_llm_request: vi.fn().mockReturnValue('request-2'),
            log_llm_response: vi.fn(),
            log_llm_error: vi.fn(),
        };

        logger3 = {
            log_llm_request: vi.fn().mockReturnValue('request-3'),
            log_llm_response: vi.fn(),
            log_llm_error: vi.fn(),
        };
    });

    describe('setEnsembleLogger', () => {
        it('should add a logger without replacing existing ones', () => {
            setEnsembleLogger(logger1);
            setEnsembleLogger(logger2);

            const loggers = getAllEnsembleLoggers();
            expect(loggers).toHaveLength(2);
            expect(loggers).toContain(logger1);
            expect(loggers).toContain(logger2);
        });

        it('should not add duplicate loggers', () => {
            setEnsembleLogger(logger1);
            setEnsembleLogger(logger1);

            const loggers = getAllEnsembleLoggers();
            expect(loggers).toHaveLength(1);
        });

        it('should clear all loggers when passed null', () => {
            setEnsembleLogger(logger1);
            setEnsembleLogger(logger2);
            setEnsembleLogger(null);

            const loggers = getAllEnsembleLoggers();
            expect(loggers).toHaveLength(0);
        });
    });

    describe('addEnsembleLogger', () => {
        it('should add a logger', () => {
            addEnsembleLogger(logger1);
            addEnsembleLogger(logger2);

            const loggers = getAllEnsembleLoggers();
            expect(loggers).toHaveLength(2);
            expect(loggers).toContain(logger1);
            expect(loggers).toContain(logger2);
        });
    });

    describe('removeEnsembleLogger', () => {
        it('should remove a specific logger', () => {
            setEnsembleLogger(logger1);
            setEnsembleLogger(logger2);
            setEnsembleLogger(logger3);

            removeEnsembleLogger(logger2);

            const loggers = getAllEnsembleLoggers();
            expect(loggers).toHaveLength(2);
            expect(loggers).toContain(logger1);
            expect(loggers).toContain(logger3);
            expect(loggers).not.toContain(logger2);
        });

        it('should handle removing non-existent logger gracefully', () => {
            setEnsembleLogger(logger1);
            removeEnsembleLogger(logger2);

            const loggers = getAllEnsembleLoggers();
            expect(loggers).toHaveLength(1);
            expect(loggers).toContain(logger1);
        });
    });

    describe('getEnsembleLogger', () => {
        it('should return the first logger for backward compatibility', () => {
            setEnsembleLogger(logger1);
            setEnsembleLogger(logger2);

            const logger = getEnsembleLogger();
            expect(logger).toBe(logger1);
        });

        it('should return null when no loggers are set', () => {
            const logger = getEnsembleLogger();
            expect(logger).toBeNull();
        });
    });

    describe('log_llm_request', () => {
        it('should call all loggers and return first request ID', () => {
            setEnsembleLogger(logger1);
            setEnsembleLogger(logger2);
            setEnsembleLogger(logger3);

            const requestId = log_llm_request('agent-1', 'openai', 'gpt-4', { prompt: 'test' });

            expect(logger1.log_llm_request).toHaveBeenCalledWith(
                'agent-1',
                'openai',
                'gpt-4',
                { prompt: 'test' },
                undefined
            );
            expect(logger2.log_llm_request).toHaveBeenCalledWith(
                'agent-1',
                'openai',
                'gpt-4',
                { prompt: 'test' },
                undefined
            );
            expect(logger3.log_llm_request).toHaveBeenCalledWith(
                'agent-1',
                'openai',
                'gpt-4',
                { prompt: 'test' },
                undefined
            );
            expect(requestId).toBe('request-1');
        });

        it('should handle logger errors gracefully', () => {
            const errorLogger: EnsembleLogger = {
                log_llm_request: vi.fn().mockImplementation(() => {
                    throw new Error('Logger error');
                }),
                log_llm_response: vi.fn(),
                log_llm_error: vi.fn(),
            };

            setEnsembleLogger(errorLogger);
            setEnsembleLogger(logger2);

            const requestId = log_llm_request('agent-1', 'openai', 'gpt-4', { prompt: 'test' });

            expect(logger2.log_llm_request).toHaveBeenCalled();
            expect(requestId).toBe('request-2');
        });
    });

    describe('log_llm_response', () => {
        it('should call all loggers', () => {
            setEnsembleLogger(logger1);
            setEnsembleLogger(logger2);

            log_llm_response('request-1', { response: 'test' });

            expect(logger1.log_llm_response).toHaveBeenCalledWith('request-1', { response: 'test' }, undefined);
            expect(logger2.log_llm_response).toHaveBeenCalledWith('request-1', { response: 'test' }, undefined);
        });
    });

    describe('log_llm_error', () => {
        it('should call all loggers', () => {
            setEnsembleLogger(logger1);
            setEnsembleLogger(logger2);

            log_llm_error('request-1', { error: 'test error' });

            expect(logger1.log_llm_error).toHaveBeenCalledWith('request-1', { error: 'test error' }, undefined);
            expect(logger2.log_llm_error).toHaveBeenCalledWith('request-1', { error: 'test error' }, undefined);
        });
    });
});
