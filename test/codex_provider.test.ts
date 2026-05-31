import { EventEmitter } from 'events';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { homedir, tmpdir } from 'os';
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
import { costTracker } from '../utils/cost_tracker.js';
import type { ModelUsage } from '../types/types.js';

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
    inspect?: (invocation: { command: string; args: string[]; options: any; stdin: string }) => void | Promise<void>,
    stdout = ''
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
                if (stdout) child.stdout.write(stdout);
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
        expect(findModel('codex-gpt-5.5')).toMatchObject({
            id: 'codex-gpt-5.5',
            provider: 'codex',
            class: 'code',
            features: {
                tool_use: true,
                json_output: true,
            },
        });
        expect(findModel('codex-gpt-image-2')).toMatchObject({
            id: 'codex-gpt-image-2',
            provider: 'codex',
            class: 'image_generation',
        });
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
            expect(invocation.args).toContain('--json');
            expect(invocation.args).toContain('--ephemeral');
            expect(invocation.args).toContain('--ignore-user-config');
            expect(invocation.args).toContain('--ignore-rules');
            expect(invocation.args).toContain('--skip-git-repo-check');
            expect(invocation.args.filter(arg => arg === '--disable')).toHaveLength(13);
            expect(invocation.args).toContain('model_reasoning_effort="high"');
            expect(invocation.args.some(arg => arg.startsWith('model_instructions_file='))).toBe(false);
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

    it('captures real Codex CLI JSON usage through the cost tracker', async () => {
        const usageEvents: ModelUsage[] = [];
        const onUsage = (usage: ModelUsage) => {
            usageEvents.push(usage);
        };
        costTracker.onAddUsage(onUsage);
        try {
            mockSuccessfulCodex(
                'Done.',
                undefined,
                [
                    '{"type":"thread.started","thread_id":"thread-test"}',
                    '{"type":"turn.completed","usage":{"input_tokens":28882,"cached_input_tokens":20864,"output_tokens":2,"reasoning_output_tokens":0}}',
                    '',
                ].join('\n')
            );

            const provider = new CodexProvider();
            await collect(
                provider.createResponseStream(
                    [{ type: 'message', role: 'user', content: 'Reply OK' }] as any,
                    'codex-gpt-5.5',
                    { agent_id: 'test-codex-usage' } as any
                )
            );

            expect(usageEvents.at(-1)).toMatchObject({
                model: 'codex-gpt-5.5',
                input_tokens: 28882,
                cached_tokens: 20864,
                output_tokens: 2,
                total_tokens: 28884,
                metadata: {
                    codex_cli_model: 'gpt-5.5',
                    source: 'codex_cli_json',
                    reasoning_output_tokens: 0,
                },
            });
            expect(typeof usageEvents.at(-1)?.cost).toBe('number');
        } finally {
            costTracker.offAddUsage(onUsage);
        }
    });

    it('passes image inputs to codex exec with --image attachments', async () => {
        const png =
            'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7+XxkAAAAASUVORK5CYII=';

        mockSuccessfulCodex('It is a tiny image.', async invocation => {
            const imageArg = getArg(invocation.args, '--image');
            const imagePaths = imageArg.split(',');
            expect(imagePaths).toHaveLength(1);
            expect(await readFile(imagePaths[0])).toEqual(Buffer.from(png.split(',')[1], 'base64'));
            expect(invocation.stdin).toContain('USER:\nDescribe this image');
            expect(invocation.stdin).not.toContain('data:image/png;base64');
        });

        const provider = new CodexProvider();
        const events = await collect(
            provider.createResponseStream(
                [
                    {
                        type: 'message',
                        role: 'user',
                        content: [
                            { type: 'input_text', text: 'Describe this image' },
                            { type: 'image', data: png, mime_type: 'image/png' },
                        ],
                    },
                ] as any,
                'codex-gpt-5.5',
                { agent_id: 'test-codex-image-input' } as any
            )
        );

        expect(events.find(event => event.type === 'message_complete')?.content).toBe('It is a tiny image.');
    });

    it('passes a model instructions file only when instructions are non-empty', async () => {
        mockSuccessfulCodex('Done with instructions.', async invocation => {
            const instructionsArg = invocation.args.find(arg => arg.startsWith('model_instructions_file='));
            expect(instructionsArg).toBeDefined();
            const instructionsPath = JSON.parse(instructionsArg!.replace('model_instructions_file=', ''));
            expect(await readFile(instructionsPath, 'utf8')).toBe('Keep the answer terse.');
        });

        const provider = new CodexProvider();
        const events = await collect(
            provider.createResponseStream(
                [{ type: 'message', role: 'user', content: 'Write a haiku' }] as any,
                'codex-gpt-5.5-high',
                {
                    agent_id: 'test-codex-instructions',
                    instructions: 'Keep the answer terse.',
                } as any
            )
        );

        expect(events.find(event => event.type === 'message_complete')?.content).toBe('Done with instructions.');
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
            expect(invocation.options.env.CODEX_HOME).toBe(path.join(homedir(), '.codex'));
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

    it('does not crash when codex closes stdin with EPIPE', async () => {
        spawnMock.mockImplementation((_command: string, args: string[]) => {
            const child = createMockChild();
            child.stdin.on('finish', async () => {
                child.stdin.emit('error', Object.assign(new Error('write EPIPE'), { code: 'EPIPE' }));
                await writeFile(getArg(args, '--output-last-message'), 'Done after closed stdin.', 'utf8');
                child.emit('close', 0, null);
            });
            return child;
        });

        const provider = new CodexProvider();
        const events = await collect(
            provider.createResponseStream(
                [{ type: 'message', role: 'user', content: 'Hello' }] as any,
                'codex-gpt-5.5',
                { agent_id: 'test-codex-epipe' } as any
            )
        );

        expect(events.find(event => event.type === 'message_complete')?.content).toBe('Done after closed stdin.');
        expect(events.some(event => event.type === 'error')).toBe(false);
    });

    it('does not crash when codex output streams emit EPIPE', async () => {
        spawnMock.mockImplementation((_command: string, args: string[]) => {
            const child = createMockChild();
            child.stdin.on('finish', async () => {
                child.stdout.emit('error', Object.assign(new Error('write EPIPE'), { code: 'EPIPE' }));
                child.stderr.emit('error', Object.assign(new Error('write EPIPE'), { code: 'EPIPE' }));
                await writeFile(getArg(args, '--output-last-message'), 'Done after closed output.', 'utf8');
                child.emit('close', 0, null);
            });
            return child;
        });

        const provider = new CodexProvider();
        const events = await collect(
            provider.createResponseStream(
                [{ type: 'message', role: 'user', content: 'Hello' }] as any,
                'codex-gpt-5.5',
                { agent_id: 'test-codex-output-epipe' } as any
            )
        );

        expect(events.find(event => event.type === 'message_complete')?.content).toBe('Done after closed output.');
        expect(events.some(event => event.type === 'error')).toBe(false);
    });

    it('aborts the codex subprocess when the agent abort signal fires', async () => {
        let child: ReturnType<typeof createMockChild> | undefined;
        let markSpawned!: () => void;
        const spawned = new Promise<void>(resolve => {
            markSpawned = resolve;
        });
        spawnMock.mockImplementation(() => {
            child = createMockChild();
            markSpawned();
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

        await spawned;
        controller.abort();
        const events = await eventsPromise;

        expect(child?.kill).toHaveBeenCalledWith('SIGTERM');
        expect(events.find(event => event.type === 'error')?.error).toContain('Codex CLI request aborted');
    });

    it('emits simulated tool calls from Codex structured output', async () => {
        mockSuccessfulCodex(
            JSON.stringify({
                action: 'tool_calls',
                toolCalls: [
                    {
                        name: 'do_thing',
                        argumentsJson: JSON.stringify({ label: 'ok' }),
                    },
                ],
                finalResponse: '',
            }),
            async invocation => {
                expect(invocation.args).toContain('--output-schema');
                expect(invocation.stdin).toContain('Call a tool');
            }
        );

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
                                    parameters: {
                                        type: 'object',
                                        properties: {
                                            label: {
                                                type: 'string',
                                            },
                                        },
                                        required: ['label'],
                                    },
                                },
                            },
                        },
                    ],
                } as any
            )
        );

        expect(events.find(event => event.type === 'tool_start')?.tool_call).toMatchObject({
            type: 'function',
            function: {
                name: 'do_thing',
                arguments: JSON.stringify({ label: 'ok' }),
            },
        });
        expect(events.find(event => event.type === 'error')).toBeUndefined();
    });

    it('requires tool calls when Codex simulated tools include a terminal tool', async () => {
        mockSuccessfulCodex(
            JSON.stringify({
                action: 'tool_calls',
                toolCalls: [
                    {
                        name: 'finish_task',
                        argumentsJson: JSON.stringify({ message: 'done' }),
                    },
                ],
                finalResponse: '',
            }),
            async invocation => {
                const schema = JSON.parse(await readFile(getArg(invocation.args, '--output-schema'), 'utf8'));
                expect(schema.properties.action.enum).toEqual(['tool_calls']);
                const instructionsConfig = invocation.args.find(arg => arg.startsWith('model_instructions_file='));
                expect(instructionsConfig).toBeTruthy();
                const instructionsPath = JSON.parse(instructionsConfig!.slice('model_instructions_file='.length));
                const instructions = await readFile(instructionsPath, 'utf8');
                expect(instructions).toContain(
                    'This request is not complete until you call one of these terminal tools: finish_task.'
                );
                expect(instructions).toContain('Do not use final_response.');
            }
        );

        const provider = new CodexProvider();
        const events = await collect(
            provider.createResponseStream(
                [{ type: 'message', role: 'user', content: 'Finish with the terminal tool' }] as any,
                'codex-gpt-5.5',
                {
                    agent_id: 'test-codex-terminal-tools',
                    terminalToolNames: ['finish_task'],
                    tools: [
                        {
                            function: () => 'done',
                            definition: {
                                type: 'function',
                                function: {
                                    name: 'finish_task',
                                    description: 'Finish the task',
                                    parameters: {
                                        type: 'object',
                                        properties: {
                                            message: {
                                                type: 'string',
                                            },
                                        },
                                        required: ['message'],
                                    },
                                },
                            },
                        },
                    ],
                } as any
            )
        );

        expect(events.find(event => event.type === 'tool_start')?.tool_call).toMatchObject({
            type: 'function',
            function: {
                name: 'finish_task',
                arguments: JSON.stringify({ message: 'done' }),
            },
        });
        expect(events.find(event => event.type === 'error')).toBeUndefined();
    });

    it('can expose Codex tools as filesystem command wrappers', async () => {
        mockSuccessfulCodex('done', async invocation => {
            expect(invocation.args.filter(arg => arg === '--disable')).toHaveLength(12);
            expect(
                invocation.args.some((arg, index) => arg === '--disable' && invocation.args[index + 1] === 'shell_tool')
            ).toBe(false);
            expect(getArg(invocation.args, '--sandbox')).toBe('workspace-write');
            const cwd = getArg(invocation.args, '--cd');
            expect(cwd).toContain('ensemble-codex-');
            expect(getArg(invocation.args, '--add-dir')).toBe(cwd);
            expect(invocation.options.cwd).toBe(cwd);
            expect(await readFile(path.join(cwd, 'input.json'), 'utf8')).toBe('{"hello":true}');
            expect(await readFile(path.join(cwd, 'tools', 'do_thing'), 'utf8')).toContain(
                'const toolName = "do_thing";'
            );
            const instructionsConfig = invocation.args.find(arg => arg.startsWith('model_instructions_file='));
            expect(instructionsConfig).toBeTruthy();
            const instructionsPath = JSON.parse(instructionsConfig!.slice('model_instructions_file='.length));
            const instructions = await readFile(instructionsPath, 'utf8');
            expect(instructions).toContain('Codex filesystem tool mode');
            expect(instructions).toContain('- input.json');
            expect(instructions).toContain('./tools/do_thing <arguments-json-file>');
            expect(invocation.stdin).toContain('USER:\nUse the filesystem tool');
        });

        const provider = new CodexProvider();
        const events = await collect(
            provider.createResponseStream(
                [{ type: 'message', role: 'user', content: 'Use the filesystem tool' }] as any,
                'codex-gpt-5.5',
                {
                    agent_id: 'test-codex-filesystem-tools',
                    terminalToolNames: ['do_thing'],
                    modelSettings: {
                        codex_tool_transport: 'filesystem',
                        codex_workspace_files: {
                            'input.json': '{"hello":true}',
                        },
                    },
                    tools: [
                        {
                            function: () => 'tool-result',
                            definition: {
                                type: 'function',
                                function: {
                                    name: 'do_thing',
                                    description: 'Do a thing',
                                    parameters: {
                                        type: 'object',
                                        properties: {
                                            label: {
                                                type: 'string',
                                            },
                                        },
                                    },
                                },
                            },
                        },
                    ],
                } as any
            )
        );

        expect(spawnMock).toHaveBeenCalledTimes(1);
        expect(events.find(event => event.type === 'message_complete')?.content).toBe('done');
        expect(events.find(event => event.type === 'error')).toBeUndefined();
    });

    it('lets ensembleRequest execute simulated Codex tool calls and continue', async () => {
        const responses = [
            JSON.stringify({
                action: 'tool_calls',
                toolCalls: [
                    {
                        name: 'do_thing',
                        argumentsJson: JSON.stringify({ label: 'ok' }),
                    },
                ],
                finalResponse: '',
            }),
            JSON.stringify({
                action: 'final_response',
                toolCalls: [],
                finalResponse: 'done',
            }),
        ];

        spawnMock.mockImplementation((command: string, args: string[], _options: any) => {
            const child = createMockChild();
            child.stdin.on('finish', async () => {
                try {
                    expect(command).toBe('codex');
                    await writeFile(getArg(args, '--output-last-message'), responses.shift() ?? '', 'utf8');
                    child.emit('close', 0, null);
                } catch (error) {
                    child.emit('error', error);
                }
            });
            return child;
        });

        const events = await collect(
            ensembleRequest(
                [{ type: 'message', role: 'user', content: 'Call the tool, then finish.' }] as any,
                {
                    agent_id: 'test-codex-ensemble-tools',
                    model: 'codex-gpt-5.5',
                    modelSettings: {
                        tool_choice: 'required',
                    },
                    tools: [
                        {
                            function: (label: string) => `tool:${label}`,
                            definition: {
                                type: 'function',
                                function: {
                                    name: 'do_thing',
                                    description: 'Do a thing',
                                    parameters: {
                                        type: 'object',
                                        properties: {
                                            label: {
                                                type: 'string',
                                            },
                                        },
                                        required: ['label'],
                                    },
                                },
                            },
                        },
                    ],
                } as any
            )
        );

        expect(spawnMock).toHaveBeenCalledTimes(2);
        expect(events.find(event => event.type === 'tool_done')?.result?.output).toBe('tool:ok');
        expect(events.find(event => event.type === 'message_complete')?.content).toBe('done');
        expect(events.find(event => event.type === 'error')).toBeUndefined();
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

    it('runs codex-gpt-image-2 through Codex image generation with source images', async () => {
        const cwd = await mkdtemp(path.join(tmpdir(), 'ensemble-codex-image-test-'));
        const codexHome = await mkdtemp(path.join(tmpdir(), 'ensemble-codex-image-home-'));
        const sourcePng =
            'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7+XxkAAAAASUVORK5CYII=';
        const generatedPng = Buffer.from(sourcePng.split(',')[1], 'base64');

        try {
            mockSuccessfulCodex('{"images":["generated.png"]}', async invocation => {
                expect(invocation.args.filter(arg => arg === '--disable')).toHaveLength(12);
                expect(invocation.args.filter(arg => arg === '--enable')).toHaveLength(1);
                expect(getArg(invocation.args, '--enable')).toBe('image_generation');
                expect(invocation.args).toContain('--skip-git-repo-check');
                expect(
                    invocation.args.some(
                        (arg, index) => arg === '--disable' && invocation.args[index + 1] === 'image_generation'
                    )
                ).toBe(false);
                expect(invocation.args).not.toContain('-m');
                const codexOutputDir = getArg(invocation.args, '--cd');
                expect(codexOutputDir).toContain('ensemble-codex-image-');
                expect(codexOutputDir).not.toBe(cwd);
                expect(invocation.options.env.CODEX_HOME).not.toBe(codexHome);
                expect(invocation.options.env.CODEX_HOME).toContain('ensemble-codex-image-');
                expect(invocation.args).not.toContain('--output-schema');
                const imageArg = getArg(invocation.args, '--image');
                expect(await readFile(imageArg)).toEqual(Buffer.from(sourcePng.split(',')[1], 'base64'));
                expect(invocation.stdin).toContain('$imagegen');
                expect(invocation.stdin).toContain('Actually invoke the image generation tool.');
                expect(invocation.stdin).toContain('Requested size or aspect ratio: 1024x1024.');
                expect(invocation.stdin).toContain('Requested quality: high.');
                await writeFile(path.join(codexOutputDir, 'generated.png'), generatedPng);
            });

            const provider = new CodexProvider();
            const images = await provider.createImage(
                'Create a polished app icon from the reference.',
                'codex-gpt-image-2',
                {
                    agent_id: 'test-codex-image-generation',
                    cwd,
                    modelSettings: {
                        codex_home: codexHome,
                    },
                } as any,
                {
                    source_images: [sourcePng],
                    size: '1024x1024',
                    quality: 'high',
                }
            );

            expect(images).toEqual([`data:image/png;base64,${generatedPng.toString('base64')}`]);
        } finally {
            await rm(cwd, { recursive: true, force: true });
            await rm(codexHome, { recursive: true, force: true });
        }
    });

    it('can run codex-gpt-image-2 with a separate Codex prompt model', async () => {
        const cwd = await mkdtemp(path.join(tmpdir(), 'ensemble-codex-image-prompt-model-'));
        const codexHome = await mkdtemp(path.join(tmpdir(), 'ensemble-codex-image-prompt-home-'));
        const generatedPng = Buffer.from('generated-with-prompt-model');

        try {
            mockSuccessfulCodex('{"images":["generated.png"]}', async invocation => {
                expect(getArg(invocation.args, '-m')).toBe('gpt-5.3-codex-spark');
                expect(invocation.args).toContain('model_reasoning_effort="medium"');
                await writeFile(path.join(getArg(invocation.args, '--cd'), 'generated.png'), generatedPng);
            });

            const provider = new CodexProvider();
            const images = await provider.createImage(
                'Create one image.',
                'codex-gpt-image-2',
                {
                    agent_id: 'test-codex-image-prompt-model',
                    cwd,
                    modelSettings: {
                        codex_home: codexHome,
                    },
                } as any,
                {
                    prompt_model: 'codex-gpt-5.3-codex-spark',
                }
            );

            expect(images).toEqual([`data:image/png;base64,${generatedPng.toString('base64')}`]);
        } finally {
            await rm(cwd, { recursive: true, force: true });
            await rm(codexHome, { recursive: true, force: true });
        }
    });

    it('caches Codex prompt models that cannot call image generation', async () => {
        const cwd = await mkdtemp(path.join(tmpdir(), 'ensemble-codex-image-prompt-fallback-'));
        const codexHome = await mkdtemp(path.join(tmpdir(), 'ensemble-codex-image-prompt-fallback-home-'));
        let invocationCount = 0;

        try {
            spawnMock.mockImplementation((command: string, args: string[], _options: any) => {
                const child = createMockChild();
                child.stdin.on('finish', async () => {
                    invocationCount += 1;
                    try {
                        if (invocationCount === 1) {
                            expect(getArg(args, '-m')).toBe('gpt-5.3-codex-spark');
                            await writeFile(
                                getArg(args, '--output-last-message'),
                                'Cannot fulfill: this session has no callable image generation tool/API available.',
                                'utf8'
                            );
                        } else {
                            expect(command).toBe('codex');
                            expect(getArg(args, '-m')).toBe('gpt-5.5');
                            expect(args).toContain('model_reasoning_effort="low"');
                            const outputPath = path.join(cwd, `fallback-${invocationCount}.png`);
                            await writeFile(outputPath, Buffer.from(`generated-with-fallback-${invocationCount}`));
                            await writeFile(
                                getArg(args, '--output-last-message'),
                                JSON.stringify({ images: [outputPath] }),
                                'utf8'
                            );
                        }
                        child.emit('close', 0, null);
                    } catch (error) {
                        child.emit('error', error);
                    }
                });
                return child;
            });

            const provider = new CodexProvider();
            const images = await provider.createImage(
                'Create one image.',
                'codex-gpt-image-2',
                {
                    agent_id: 'test-codex-image-prompt-model-fallback',
                    cwd,
                    modelSettings: {
                        codex_home: codexHome,
                    },
                } as any,
                {
                    prompt_model: 'codex-gpt-5.3-codex-spark',
                    prompt_model_fallbacks: ['codex-gpt-5.5-low'],
                }
            );

            expect(invocationCount).toBe(2);
            expect(images).toEqual([
                `data:image/png;base64,${Buffer.from('generated-with-fallback-2').toString('base64')}`,
            ]);

            const nextImages = await provider.createImage(
                'Create another image.',
                'codex-gpt-image-2',
                {
                    agent_id: 'test-codex-image-prompt-model-fallback-repeat',
                    cwd,
                    modelSettings: {
                        codex_home: codexHome,
                    },
                } as any,
                {
                    prompt_model: 'codex-gpt-5.3-codex-spark',
                    prompt_model_fallbacks: ['codex-gpt-5.5-low'],
                }
            );

            expect(invocationCount).toBe(3);
            expect(nextImages).toEqual([
                `data:image/png;base64,${Buffer.from('generated-with-fallback-3').toString('base64')}`,
            ]);
        } finally {
            await rm(cwd, { recursive: true, force: true });
            await rm(codexHome, { recursive: true, force: true });
        }
    });

    it('recovers images saved to the isolated Codex output directory when response paths are missing', async () => {
        const cwd = await mkdtemp(path.join(tmpdir(), 'ensemble-codex-image-cwd-'));
        const codexHome = await mkdtemp(path.join(tmpdir(), 'ensemble-codex-home-'));
        const generatedPng = Buffer.from('generated-codex-image');

        try {
            mockSuccessfulCodex('{"images":["/missing/generated-image.png"]}', async ({ args }) => {
                await writeFile(path.join(getArg(args, '--cd'), 'ig_real.png'), generatedPng);
            });

            const provider = new CodexProvider();
            const images = await provider.createImage(
                'Create one image.',
                'codex-gpt-image-2',
                {
                    agent_id: 'test-codex-image-artifact-recovery',
                    cwd,
                    modelSettings: {
                        codex_home: codexHome,
                    },
                } as any,
                {}
            );

            expect(images).toEqual([`data:image/png;base64,${generatedPng.toString('base64')}`]);
        } finally {
            await rm(cwd, { recursive: true, force: true });
            await rm(codexHome, { recursive: true, force: true });
        }
    });

    it('recovers images saved to the isolated Codex home when response paths are missing', async () => {
        const cwd = await mkdtemp(path.join(tmpdir(), 'ensemble-codex-image-cwd-'));
        const codexHome = await mkdtemp(path.join(tmpdir(), 'ensemble-codex-home-'));
        const generatedPng = Buffer.from('generated-codex-home-image');

        try {
            mockSuccessfulCodex(
                '/Users/example/.codex/generated_images/predicted-but-missing.png',
                async ({ options }) => {
                    const generatedDir = path.join(options.env.CODEX_HOME, 'generated_images', 'test-session');
                    await mkdir(generatedDir, { recursive: true });
                    await writeFile(path.join(generatedDir, 'ig_real.png'), generatedPng);
                }
            );

            const provider = new CodexProvider();
            const images = await provider.createImage(
                'Create one image.',
                'codex-gpt-image-2',
                {
                    agent_id: 'test-codex-image-home-artifact-recovery',
                    cwd,
                    modelSettings: {
                        codex_home: codexHome,
                    },
                } as any,
                {}
            );

            expect(images).toEqual([`data:image/png;base64,${generatedPng.toString('base64')}`]);
        } finally {
            await rm(cwd, { recursive: true, force: true });
            await rm(codexHome, { recursive: true, force: true });
        }
    });

    it('recovers images saved to the isolated Codex home when the last message file is missing', async () => {
        const cwd = await mkdtemp(path.join(tmpdir(), 'ensemble-codex-image-cwd-'));
        const codexHome = await mkdtemp(path.join(tmpdir(), 'ensemble-codex-home-'));
        const generatedPng = Buffer.from('generated-codex-home-image-without-last-message');

        try {
            spawnMock.mockImplementation((_command: string, _args: string[], options: any) => {
                const child = createMockChild();
                child.stdin.on('finish', async () => {
                    try {
                        const generatedDir = path.join(options.env.CODEX_HOME, 'generated_images', 'test-session');
                        await mkdir(generatedDir, { recursive: true });
                        await writeFile(path.join(generatedDir, 'ig_real.png'), generatedPng);
                        child.emit('close', 0, null);
                    } catch (error) {
                        child.emit('error', error);
                    }
                });
                return child;
            });

            const provider = new CodexProvider();
            const images = await provider.createImage(
                'Create one image.',
                'codex-gpt-image-2',
                {
                    agent_id: 'test-codex-image-home-artifact-no-last-message',
                    cwd,
                    modelSettings: {
                        codex_home: codexHome,
                    },
                } as any,
                {}
            );

            expect(images).toEqual([`data:image/png;base64,${generatedPng.toString('base64')}`]);
        } finally {
            await rm(cwd, { recursive: true, force: true });
            await rm(codexHome, { recursive: true, force: true });
        }
    });

    it('prefers image paths from the Codex last message over isolated output artifacts', async () => {
        const cwd = await mkdtemp(path.join(tmpdir(), 'ensemble-codex-image-cwd-'));
        const codexHome = await mkdtemp(path.join(tmpdir(), 'ensemble-codex-home-'));
        const responsePng = Buffer.from('response-image');
        const outputPng = Buffer.from('output-image');
        const responsePath = path.join(cwd, 'response.png');

        try {
            mockSuccessfulCodex(JSON.stringify({ images: [responsePath] }), async ({ args }) => {
                await writeFile(responsePath, responsePng);
                await writeFile(path.join(getArg(args, '--cd'), 'ig_output.png'), outputPng);
            });

            const provider = new CodexProvider();
            const images = await provider.createImage(
                'Create one image.',
                'codex-gpt-image-2',
                {
                    agent_id: 'test-codex-image-response-path-priority',
                    cwd,
                    modelSettings: {
                        codex_home: codexHome,
                    },
                } as any,
                {}
            );

            expect(images).toEqual([`data:image/png;base64,${responsePng.toString('base64')}`]);
        } finally {
            await rm(cwd, { recursive: true, force: true });
            await rm(codexHome, { recursive: true, force: true });
        }
    });

    it('uses existing image paths from the Codex last message when no generated artifact is listed', async () => {
        const cwd = await mkdtemp(path.join(tmpdir(), 'ensemble-codex-image-cwd-'));
        const codexHome = await mkdtemp(path.join(tmpdir(), 'ensemble-codex-home-'));
        const responsePng = Buffer.from('response-image');
        const responsePath = path.join(cwd, 'response.png');

        try {
            mockSuccessfulCodex(JSON.stringify({ images: [responsePath] }), async () => {
                await writeFile(responsePath, responsePng);
            });

            const provider = new CodexProvider();
            const images = await provider.createImage(
                'Create one image.',
                'codex-gpt-image-2',
                {
                    agent_id: 'test-codex-image-response-path',
                    cwd,
                    modelSettings: {
                        codex_home: codexHome,
                    },
                } as any,
                {}
            );

            expect(images).toEqual([`data:image/png;base64,${responsePng.toString('base64')}`]);
        } finally {
            await rm(cwd, { recursive: true, force: true });
            await rm(codexHome, { recursive: true, force: true });
        }
    });

    it('extracts existing image paths from prose Codex last messages', async () => {
        const cwd = await mkdtemp(path.join(tmpdir(), 'ensemble-codex-image-cwd-'));
        const codexHome = await mkdtemp(path.join(tmpdir(), 'ensemble-codex-home-'));
        const responsePng = Buffer.from('prose-response-image');
        const responsePath = path.join(cwd, 'prose-response.png');

        try {
            mockSuccessfulCodex(`Generated image: ${responsePath}.`, async () => {
                await writeFile(responsePath, responsePng);
            });

            const provider = new CodexProvider();
            const images = await provider.createImage(
                'Create one image.',
                'codex-gpt-image-2',
                {
                    agent_id: 'test-codex-image-prose-response-path',
                    cwd,
                    modelSettings: {
                        codex_home: codexHome,
                    },
                } as any,
                {}
            );

            expect(images).toEqual([`data:image/png;base64,${responsePng.toString('base64')}`]);
        } finally {
            await rm(cwd, { recursive: true, force: true });
            await rm(codexHome, { recursive: true, force: true });
        }
    });

    it('runs Codex image artifact recovery concurrently with isolated Codex homes', async () => {
        const cwd = await mkdtemp(path.join(tmpdir(), 'ensemble-codex-image-cwd-'));
        const codexHome = await mkdtemp(path.join(tmpdir(), 'ensemble-codex-home-'));
        let activeExecutions = 0;
        let maxActiveExecutions = 0;
        let invocationCount = 0;

        spawnMock.mockImplementation((command: string, args: string[], options: any) => {
            const child = createMockChild();

            child.stdin.on('finish', async () => {
                invocationCount += 1;
                const invocationIndex = invocationCount;
                activeExecutions += 1;
                maxActiveExecutions = Math.max(maxActiveExecutions, activeExecutions);

                try {
                    await new Promise(resolve => setTimeout(resolve, 25));
                    const generatedDir = path.join(
                        options.env.CODEX_HOME,
                        'generated_images',
                        `session-${invocationIndex}`
                    );
                    await mkdir(generatedDir, { recursive: true });
                    await writeFile(
                        path.join(generatedDir, `ig_${invocationIndex}.png`),
                        Buffer.from(`image-${invocationIndex}`)
                    );
                    await writeFile(
                        getArg(args, '--output-last-message'),
                        'No generated local image file path was returned.',
                        'utf8'
                    );
                    activeExecutions -= 1;
                    child.emit('close', 0, null);
                } catch (error) {
                    activeExecutions -= 1;
                    child.emit('error', error);
                }
            });

            return child;
        });

        try {
            const provider = new CodexProvider();
            const [firstImages, secondImages] = await Promise.all([
                provider.createImage(
                    'Create image one.',
                    'codex-gpt-image-2',
                    {
                        agent_id: 'test-codex-image-lock-1',
                        cwd,
                        modelSettings: {
                            codex_home: codexHome,
                        },
                    } as any,
                    {}
                ),
                provider.createImage(
                    'Create image two.',
                    'codex-gpt-image-2',
                    {
                        agent_id: 'test-codex-image-lock-2',
                        cwd,
                        modelSettings: {
                            codex_home: codexHome,
                        },
                    } as any,
                    {}
                ),
            ]);

            expect([firstImages[0], secondImages[0]].sort()).toEqual(
                [
                    `data:image/png;base64,${Buffer.from('image-1').toString('base64')}`,
                    `data:image/png;base64,${Buffer.from('image-2').toString('base64')}`,
                ].sort()
            );
            expect(maxActiveExecutions).toBeGreaterThan(1);
        } finally {
            await rm(cwd, { recursive: true, force: true });
            await rm(codexHome, { recursive: true, force: true });
        }
    });

    it('fails Codex image generation when the last message and generated artifacts are both missing', async () => {
        const cwd = await mkdtemp(path.join(tmpdir(), 'ensemble-codex-image-cwd-'));
        const codexHome = await mkdtemp(path.join(tmpdir(), 'ensemble-codex-home-'));

        try {
            spawnMock.mockImplementation(() => {
                const child = createMockChild();
                child.stdin.on('finish', () => {
                    child.emit('close', 0, null);
                });
                return child;
            });

            const provider = new CodexProvider();
            await expect(
                provider.createImage(
                    'Create one image.',
                    'codex-gpt-image-2',
                    {
                        agent_id: 'test-codex-image-missing-last-message-and-artifact',
                        cwd,
                        modelSettings: {
                            codex_home: codexHome,
                        },
                    } as any,
                    {}
                )
            ).rejects.toThrow('Codex CLI did not write --output-last-message');
        } finally {
            await rm(cwd, { recursive: true, force: true });
            await rm(codexHome, { recursive: true, force: true });
        }
    });

    it('fails Codex image generation when no new image artifact is created', async () => {
        const cwd = await mkdtemp(path.join(tmpdir(), 'ensemble-codex-image-cwd-'));
        const codexHome = await mkdtemp(path.join(tmpdir(), 'ensemble-codex-home-'));

        try {
            mockSuccessfulCodex('/Users/example/.codex/generated_images/predicted-but-missing.png');

            const provider = new CodexProvider();
            await expect(
                provider.createImage(
                    'Create one image.',
                    'codex-gpt-image-2',
                    {
                        agent_id: 'test-codex-image-missing-artifact',
                        cwd,
                        modelSettings: {
                            codex_home: codexHome,
                        },
                    } as any,
                    {}
                )
            ).rejects.toThrow('Codex image generation resolved 0 image artifacts, expected 1.');
        } finally {
            await rm(cwd, { recursive: true, force: true });
            await rm(codexHome, { recursive: true, force: true });
        }
    });
});
