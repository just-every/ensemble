import { spawn } from 'child_process';
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir, homedir } from 'os';
import path from 'path';
import { BaseModelProvider } from './base_provider.js';
import {
    AgentDefinition,
    ModelSettings,
    ProviderStreamEvent,
    ResponseContent,
    ResponseInput,
    ResponseInputItem,
} from '../types/types.js';
import { log_llm_error, log_llm_request, log_llm_response } from '../utils/llm_logger.js';

type CodexReasoningEffort = 'low' | 'medium' | 'high' | 'xhigh';
type CodexReasoningEffortInput = 'none' | 'minimal' | CodexReasoningEffort;

const CODEX_MODEL_PREFIX = 'codex-';
const CODEX_DISABLED_FEATURES = [
    'plugins',
    'apps',
    'browser_use',
    'memories',
    'multi_agent',
    'image_generation',
    'computer_use',
    'shell_tool',
    'tool_search',
    'tool_suggest',
    'workspace_dependencies',
    'goals',
    'personality',
] as const;

const REASONING_EFFORT_SUFFIXES: CodexReasoningEffortInput[] = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'];

function parseThinkingBudget(value: unknown): number | null {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        return null;
    }
    return Math.max(0, Math.floor(value));
}

function mapThinkingBudgetToReasoningEffort(budget: number): CodexReasoningEffort | undefined {
    if (!Number.isFinite(budget) || budget < 0) return undefined;
    if (budget <= 8192) return 'low';
    if (budget <= 16384) return 'medium';
    if (budget <= 32768) return 'high';
    return 'xhigh';
}

function normalizeReasoningEffort(effort: CodexReasoningEffortInput): CodexReasoningEffort {
    if (effort === 'none' || effort === 'minimal') {
        return 'low';
    }
    return effort;
}

export function resolveCodexModel(
    model: string,
    settings?: ModelSettings
): { model: string; effort: CodexReasoningEffort } {
    if (!model.startsWith(CODEX_MODEL_PREFIX)) {
        throw new Error(`Codex provider only supports models prefixed with ${CODEX_MODEL_PREFIX}`);
    }

    let codexModel = model.slice(CODEX_MODEL_PREFIX.length);
    let effort: CodexReasoningEffort | undefined;

    for (const candidate of REASONING_EFFORT_SUFFIXES) {
        const suffix = `-${candidate}`;
        if (codexModel.endsWith(suffix)) {
            codexModel = codexModel.slice(0, -suffix.length);
            effort = normalizeReasoningEffort(candidate);
            break;
        }
    }

    const thinkingBudget = parseThinkingBudget(settings?.thinking_budget);
    if (thinkingBudget !== null) {
        effort = mapThinkingBudgetToReasoningEffort(thinkingBudget);
    }

    if (!codexModel) {
        throw new Error('Codex provider requires a model after the codex- prefix.');
    }

    return {
        model: codexModel,
        effort: effort ?? 'medium',
    };
}

function resolveCodexHome(settings?: ModelSettings): string {
    const configuredHome = settings?.codex_home?.trim();
    if (configuredHome) {
        return configuredHome;
    }

    const environmentHome = process.env.CODEX_HOME?.trim();
    if (environmentHome) {
        return environmentHome;
    }

    return path.join(homedir(), '.codex_zemaj');
}

function requireTextContent(content: ResponseContent, context: string): string {
    if (typeof content === 'string') {
        return content;
    }

    const textParts: string[] = [];
    for (const part of content) {
        if (part.type !== 'input_text') {
            throw new Error(`Codex provider v1 only supports text content; ${context} contains ${part.type}.`);
        }
        textParts.push(part.text);
    }
    return textParts.join('\n');
}

function serializeMessageForCodex(message: ResponseInputItem): { instruction?: string; prompt?: string } {
    if (message.type === 'message') {
        const content = requireTextContent(message.content, `${message.role} message`);
        if (message.role === 'system' || message.role === 'developer') {
            return { instruction: content };
        }
        return { prompt: `${message.role.toUpperCase()}:\n${content}` };
    }

    if (message.type === 'thinking') {
        return {
            prompt: `ASSISTANT THINKING SUMMARY:\n${requireTextContent(message.content, 'thinking message')}`,
        };
    }

    if (message.type === 'function_call') {
        return {
            prompt: `ASSISTANT TOOL CALL ${message.name}:\n${message.arguments}`,
        };
    }

    if (message.type === 'function_call_output') {
        return {
            prompt: `TOOL OUTPUT ${message.name ?? message.call_id}:\n${message.output}`,
        };
    }

    return { prompt: JSON.stringify(message) };
}

function buildCodexInput(messages: ResponseInput, agent: AgentDefinition): { instructions: string; prompt: string } {
    const instructions: string[] = [];
    const prompt: string[] = [];

    if (agent.instructions?.trim()) {
        instructions.push(agent.instructions.trim());
    }

    for (const message of messages) {
        const serialized = serializeMessageForCodex(message);
        if (serialized.instruction?.trim()) {
            instructions.push(serialized.instruction.trim());
        }
        if (serialized.prompt?.trim()) {
            prompt.push(serialized.prompt.trim());
        }
    }

    return {
        instructions: instructions.join('\n\n'),
        prompt: prompt.length > 0 ? prompt.join('\n\n') : 'Please proceed.',
    };
}

function normalizeLastMessageContent(rawContent: string, structured: boolean): string {
    if (structured) {
        return rawContent.trim();
    }

    const trimmed = rawContent.trim();
    if (!trimmed) {
        return '';
    }

    try {
        const parsed = JSON.parse(trimmed);
        if (typeof parsed === 'string') {
            return parsed;
        }
        if (parsed && typeof parsed === 'object' && 'content' in parsed && typeof parsed.content === 'string') {
            return parsed.content;
        }
    } catch {
        return rawContent;
    }

    return rawContent;
}

function createAbortError(): Error & { code?: string } {
    const error = new Error('Codex CLI request aborted.') as Error & { code?: string };
    error.code = 'ABORT_ERR';
    return error;
}

async function runCodexExec(options: {
    commandArgs: string[];
    cwd: string;
    env: NodeJS.ProcessEnv;
    prompt: string;
    abortSignal?: AbortSignal;
}): Promise<{ stdout: string; stderr: string }> {
    if (options.abortSignal?.aborted) {
        throw createAbortError();
    }

    let stdout = '';
    let stderr = '';

    await new Promise<void>((resolve, reject) => {
        let settled = false;
        let abortError: Error | undefined;

        const child = spawn('codex', options.commandArgs, {
            cwd: options.cwd,
            env: options.env,
            stdio: ['pipe', 'pipe', 'pipe'],
        });

        const cleanup = () => {
            if (options.abortSignal) {
                options.abortSignal.removeEventListener('abort', onAbort);
            }
        };

        const finish = (error?: Error) => {
            if (settled) return;
            settled = true;
            cleanup();
            if (error) {
                reject(error);
            } else {
                resolve();
            }
        };

        const onAbort = () => {
            abortError = createAbortError();
            child.kill('SIGTERM');
        };

        options.abortSignal?.addEventListener('abort', onAbort, { once: true });

        child.stdout?.on('data', chunk => {
            stdout += Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
        });
        child.stderr?.on('data', chunk => {
            stderr += Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
        });

        child.once('error', error => {
            finish(error);
        });

        child.once('close', (code, signal) => {
            if (abortError) {
                finish(abortError);
                return;
            }
            if (code !== 0) {
                const details = stderr.trim() || stdout.trim() || (signal ? `signal ${signal}` : `exit code ${code}`);
                finish(new Error(`Codex CLI exited with ${details}.`));
                return;
            }
            finish();
        });

        child.stdin?.end(options.prompt);
    });

    return { stdout, stderr };
}

async function executeCodexRequest(
    messages: ResponseInput,
    model: string,
    agent: AgentDefinition,
    requestId?: string
): Promise<string> {
    if (agent.tools?.length || agent.getTools || agent.processToolCall || agent.params || agent.processParams) {
        throw new Error('Codex provider v1 does not support tool requests.');
    }

    const settings = agent.modelSettings;
    const { model: codexModel, effort } = resolveCodexModel(model, settings);
    const codexHome = resolveCodexHome(settings);
    const cwd = agent.cwd || process.cwd();
    const { instructions, prompt } = buildCodexInput(messages, agent);
    const tempDir = await mkdtemp(path.join(tmpdir(), 'ensemble-codex-'));
    const instructionsPath = path.join(tempDir, 'instructions.md');
    const lastMessagePath = path.join(tempDir, 'last-message.json');
    const schemaPath = settings?.json_schema?.schema ? path.join(tempDir, 'schema.json') : undefined;

    try {
        await writeFile(instructionsPath, instructions, 'utf8');
        if (schemaPath) {
            await writeFile(schemaPath, JSON.stringify(settings!.json_schema!.schema, null, 2), 'utf8');
        }

        const commandArgs = [
            'exec',
            '--ephemeral',
            '--ignore-user-config',
            '--ignore-rules',
            ...CODEX_DISABLED_FEATURES.flatMap(feature => ['--disable', feature]),
            '-m',
            codexModel,
            '-c',
            `model_reasoning_effort=${JSON.stringify(effort)}`,
            '-c',
            `model_instructions_file=${JSON.stringify(instructionsPath)}`,
            ...(schemaPath ? ['--output-schema', schemaPath] : []),
            '--output-last-message',
            lastMessagePath,
            '--cd',
            cwd,
            '-',
        ];

        const loggedRequestId = log_llm_request(
            agent.agent_id || 'default',
            'codex',
            codexModel,
            {
                command: 'codex',
                args: commandArgs,
                cwd,
                prompt,
                schema: settings?.json_schema?.schema,
            },
            new Date(),
            requestId,
            agent.tags
        );

        await runCodexExec({
            commandArgs,
            cwd,
            env: {
                ...process.env,
                CODEX_HOME: codexHome,
            },
            prompt,
            abortSignal: agent.abortSignal,
        });

        let rawLastMessage: string;
        try {
            rawLastMessage = await readFile(lastMessagePath, 'utf8');
        } catch (error) {
            throw new Error(
                `Codex CLI did not write the expected --output-last-message file: ${
                    error instanceof Error ? error.message : String(error)
                }`,
                { cause: error }
            );
        }

        const content = normalizeLastMessageContent(rawLastMessage, Boolean(schemaPath));
        log_llm_response(loggedRequestId, { content });
        return content;
    } catch (error) {
        log_llm_error(requestId, error);
        throw error;
    } finally {
        await rm(tempDir, { recursive: true, force: true });
    }
}

export class CodexProvider extends BaseModelProvider {
    constructor() {
        super('codex');
    }

    async *createResponseStream(
        messages: ResponseInput,
        model: string,
        agent: AgentDefinition,
        requestId?: string
    ): AsyncGenerator<ProviderStreamEvent> {
        try {
            const content = await executeCodexRequest(messages, model, agent, requestId);
            const messageId = `codex-${Date.now()}`;
            if (content) {
                yield {
                    type: 'message_delta',
                    content,
                    message_id: messageId,
                };
            }
            yield {
                type: 'message_complete',
                content,
                message_id: messageId,
            };
        } catch (error) {
            yield {
                type: 'error',
                error: error instanceof Error ? error.message : String(error),
                recoverable: false,
            };
        }
    }
}

export const codexProvider = new CodexProvider();
