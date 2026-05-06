import { EventEmitter } from 'events';
import { readFile, writeFile } from 'fs/promises';
import { homedir } from 'os';
import path from 'path';
import { PassThrough } from 'stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const spawnMock = vi.hoisted(() => vi.fn());

vi.mock('child_process', () => ({
    spawn: spawnMock,
}));

import { MODEL_REGISTRY, findModel } from '../data/model_data.js';
import { CodexProvider, resolveCodexModel } from '../model_providers/codex.js';
import { getProviderFromModel } from '../model_providers/model_provider.js';
import { ensembleRequest } from '../core/ensemble_request.js';

async function collect(stream: AsyncIterable<any>): Promise<any[]> {
    const events: any[] = [];
    for await (const event of stream) {
        events.push(event);
    }
    return events;
}

function createMockChild() {
    const child = new EventEmitter() as any;
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.stdin = new PassThrough();
    child.kill = vi.fn(() => {
        setImmediate(() => child.emit('close', null, 'SIGTERM'));
        return true;
    });
    return child;
}

function getArg(args: string[], flag: string): string {
    const index = args.indexOf(flag);
    if (index === -1 || index + 1 >= args.length) {
        throw new Error(`Missing ${flag} argument`);
    }
    return args[index + 1];
}

function mockSuccessfulCodex(
    content: string,
    inspect?: (invocation: { command: string; args: string[]; options: any; stdin: string }) => void | Promise<void>
) {
    spawnMock.mockImplementation((command: string, args: string[], options: any) => {
        const child = createMockChild();
        let stdin = '';

        child.stdin.on('data', (chunk: Buffer) => {
            stdin += chunk.toString('utf8');
        });
        child.stdin.on('finish', async () => {
            try {
                await inspect?.({ command, args, options, stdin });
                await writeFile(getArg(args, '--output-last-message'), content, 'utf8');
                child.emit('close', 0, null);
            } catch (error) {
                child.emit('error', error);
            }
        });

        return child;
    });
}

describe('Codex provider', () => {
    const originalEnv = { ...process.env };

    beforeEach(() => {
        spawnMock.mockReset();
        delete process.env.CODEX_HOME;
    });

    afterEach(() => {
        spawnMock.mockReset();
        for (const key of Object.keys(process.env)) {
            delete process.env[key];
        }
        Object.assign(process.env, originalEnv);
    });

    it('routes codex-prefixed models through the codex provider and removes the old API registry entry', () => {
        expect(findModel('codex-mini-latest')).toBeUndefined();
        expect(getProviderFromModel('codex-mini-latest')).toBe('codex');
        expect(getProviderFromModel('codex-gpt-5.5')).toBe('codex');
        expect(
            MODEL_REGISTRY.filter(model => model.id.startsWith('codex-')).every(model => model.provider === 'codex')
        ).toBe(true);
    });

    it('strips the codex prefix and maps reasoning suffixes', () => {
        expect(resolveCodexModel('codex-gpt-5.5-high')).toEqual({
            model: 'gpt-5.5',
            effort: 'high',
        });
        expect(resolveCodexModel('codex-gpt-5.5-high', { thinking_budget: 0 })).toEqual({
            model: 'gpt-5.5',
            effort: 'low',
        });
        expect(resolveCodexModel('codex-gpt-5.5-minimal')).toEqual({
            model: 'gpt-5.5',
            effort: 'low',
        });
        expect(resolveCodexModel('codex-gpt-5.3-codex')).toEqual({
            model: 'gpt-5.3-codex',
            effort: 'medium',
        });
    });

    it('runs codex exec with locked-down flags, custom CODEX_HOME, cwd, prompt, and model mapping', async () => {
        mockSuccessfulCodex('Done.', invocation => {
            expect(invocation.command).toBe('codex');
            expect(getArg(invocation.args, '-m')).toBe('gpt-5.5');
            expect(getArg(invocation.args, '--cd')).toBe('/tmp/project');
            expect(invocation.args).toContain('--ephemeral');
            expect(invocation.args).toContain('--ignore-user-config');
            expect(invocation.args).toContain('--ignore-rules');
            expect(invocation.args.filter(arg => arg === '--disable')).toHaveLength(13);
            expect(invocation.args).toContain('model_reasoning_effort="high"');
            expect(invocation.options.cwd).toBe('/tmp/project');
            expect(invocation.options.env.CODEX_HOME).toBe('/tmp/custom-codex-home');
            expect(invocation.stdin).toContain('USER:\nWrite a haiku');
        });

        const provider = new CodexProvider();
        const events = await collect(
            provider.createResponseStream(
                [{ type: 'message', role: 'user', content: 'Write a haiku' }] as any,
                'codex-gpt-5.5-high',
                {
                    agent_id: 'test-codex',
                    cwd: '/tmp/project',
                    modelSettings: {
                        codex_home: '/tmp/custom-codex-home',
                    },
                } as any
            )
        );

        expect(events.find(event => event.type === 'message_complete')?.content).toBe('Done.');
    });

    it('uses the default CODEX_HOME and writes the inner JSON schema to --output-schema', async () => {
        const schema = {
            type: 'object',
            properties: {
                answer: { type: 'string' },
            },
            required: ['answer'],
        };

        mockSuccessfulCodex('{"answer":"ok"}', async invocation => {
            const schemaPath = getArg(invocation.args, '--output-schema');
            expect(JSON.parse(await readFile(schemaPath, 'utf8'))).toEqual(schema);
            expect(invocation.options.env.CODEX_HOME).toBe(path.join(homedir(), '.codex_zemaj'));
        });

        const provider = new CodexProvider();
        const events = await collect(
            provider.createResponseStream(
                [{ type: 'message', role: 'user', content: 'Return JSON' }] as any,
                'codex-gpt-5.5',
                {
                    agent_id: 'test-codex-schema',
                    modelSettings: {
                        json_schema: {
                            name: 'answer_result',
                            type: 'json_schema',
                            schema,
                        },
                    },
                } as any
            )
        );

        expect(events.find(event => event.type === 'message_complete')?.content).toBe('{"answer":"ok"}');
    });

    it('surfaces non-zero codex exits without falling back', async () => {
        spawnMock.mockImplementation(() => {
            const child = createMockChild();
            child.stdin.on('finish', () => {
                child.stderr.write('authentication failed');
                child.emit('close', 1, null);
            });
            return child;
        });

        const provider = new CodexProvider();
        const events = await collect(
            provider.createResponseStream(
                [{ type: 'message', role: 'user', content: 'Hello' }] as any,
                'codex-gpt-5.5',
                { agent_id: 'test-codex-error' } as any
            )
        );

        expect(events.find(event => event.type === 'error')?.error).toContain(
            'Codex CLI exited with authentication failed'
        );
    });

    it('surfaces a missing output-last-message file as a provider error', async () => {
        spawnMock.mockImplementation(() => {
            const child = createMockChild();
            child.stdin.on('finish', () => {
                child.emit('close', 0, null);
            });
            return child;
        });

        const provider = new CodexProvider();
        const events = await collect(
            provider.createResponseStream(
                [{ type: 'message', role: 'user', content: 'Hello' }] as any,
                'codex-gpt-5.5',
                { agent_id: 'test-codex-missing-output' } as any
            )
        );

        expect(events.find(event => event.type === 'error')?.error).toContain(
            'Codex CLI did not write the expected --output-last-message file'
        );
    });

    it('aborts the codex subprocess when the agent abort signal fires', async () => {
        let child: ReturnType<typeof createMockChild> | undefined;
        spawnMock.mockImplementation(() => {
            child = createMockChild();
            return child;
        });

        const controller = new AbortController();
        const provider = new CodexProvider();
        const eventsPromise = collect(
            provider.createResponseStream(
                [{ type: 'message', role: 'user', content: 'Hello' }] as any,
                'codex-gpt-5.5',
                {
                    agent_id: 'test-codex-abort',
                    abortSignal: controller.signal,
                } as any
            )
        );

        for (let attempt = 0; attempt < 20 && !child; attempt++) {
            await new Promise(resolve => setImmediate(resolve));
        }
        controller.abort();
        const events = await eventsPromise;

        expect(child?.kill).toHaveBeenCalledWith('SIGTERM');
        expect(events.find(event => event.type === 'error')?.error).toContain('Codex CLI request aborted');
    });

    it('rejects tool requests in v1', async () => {
        const provider = new CodexProvider();
        const events = await collect(
            provider.createResponseStream(
                [{ type: 'message', role: 'user', content: 'Call a tool' }] as any,
                'codex-gpt-5.5',
                {
                    agent_id: 'test-codex-tools',
                    tools: [
                        {
                            function: () => 'ok',
                            definition: {
                                type: 'function',
                                function: {
                                    name: 'do_thing',
                                    description: 'Do a thing',
                                    parameters: { type: 'object', properties: {}, required: [] },
                                },
                            },
                        },
                    ],
                } as any
            )
        );

        expect(events.find(event => event.type === 'error')?.error).toBe(
            'Codex provider v1 does not support tool requests.'
        );
        expect(spawnMock).not.toHaveBeenCalled();
    });

    it('lets ensembleRequest enforce strict structured-output validation', async () => {
        mockSuccessfulCodex('{"answer":123}');

        const events = await collect(
            ensembleRequest(
                [{ type: 'message', role: 'user', content: 'Return JSON' }] as any,
                {
                    agent_id: 'test-codex-strict-schema',
                    model: 'codex-gpt-5.5',
                    modelSettings: {
                        json_schema: {
                            name: 'answer_result',
                            type: 'json_schema',
                            strict: true,
                            schema: {
                                type: 'object',
                                properties: {
                                    answer: { type: 'string' },
                                },
                                required: ['answer'],
                                additionalProperties: false,
                            },
                        },
                    },
                } as any
            )
        );

        expect(events.find(event => event.type === 'error')?.error).toContain('$.answer must be string');
        expect(events.some(event => event.type === 'message_complete')).toBe(false);
    });
});
