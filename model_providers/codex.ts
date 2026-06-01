import { spawn } from 'child_process';
import { randomUUID } from 'crypto';
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir, homedir } from 'os';
import path from 'path';
import { setTimeout as sleep } from 'timers/promises';
import { BaseModelProvider } from './base_provider.js';
import {
    AgentDefinition,
    ImageGenerationOpts,
    ModelSettings,
    ModelUsage,
    ProviderStreamEvent,
    ResponseInput,
    ResponseInputItem,
    ResponseJSONSchema,
    ToolCall,
    ToolFunction,
} from '../types/types.js';
import { costTracker } from '../utils/cost_tracker.js';
import { log_llm_error, log_llm_request, log_llm_response } from '../utils/llm_logger.js';
import {
    CodexImageAttachmentWriter,
    extractExistingCodexImagePaths,
    listCodexGeneratedImages,
    listCodexOutputImages,
    newestFirst,
    readCodexImageFiles,
} from './codex_assets.js';
import { prepareIsolatedCodexHome } from './codex_home.js';

type CodexReasoningEffort = 'low' | 'medium' | 'high' | 'xhigh';
type CodexReasoningEffortInput = 'none' | 'minimal' | CodexReasoningEffort;

const CODEX_MODEL_PREFIX = 'codex-';
const CODEX_GPT_IMAGE_MODEL = 'codex-gpt-image-2';
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

type CodexToolTransport = 'structured' | 'filesystem' | 'workspace-files';

type CodexProviderModelSettings = ModelSettings & {
    codex_tool_transport?: CodexToolTransport;
    codex_workspace_files?: Record<string, string>;
    codex_workspace_instructions?: string;
    codex_workspace_final_files?: string[];
};

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

    return path.join(homedir(), '.codex');
}

async function serializeMessageForCodex(
    message: ResponseInputItem,
    imageWriter: CodexImageAttachmentWriter
): Promise<{ instruction?: string; prompt?: string; images: string[] }> {
    if (message.type === 'message') {
        const { text: content, images } = await imageWriter.collectContent(message.content, `${message.role} message`);
        if (message.role === 'system' || message.role === 'developer') {
            return { instruction: content, images };
        }
        return { prompt: `${message.role.toUpperCase()}:\n${content}`, images };
    }

    if (message.type === 'thinking') {
        const { text: content, images } = await imageWriter.collectContent(message.content, 'thinking message');
        return {
            prompt: `ASSISTANT THINKING SUMMARY:\n${content}`,
            images,
        };
    }

    if (message.type === 'function_call') {
        return {
            prompt: `ASSISTANT TOOL CALL ${message.name}:\n${message.arguments}`,
            images: [],
        };
    }

    if (message.type === 'function_call_output') {
        return {
            prompt: `TOOL OUTPUT ${message.name ?? message.call_id}:\n${message.output}`,
            images: [],
        };
    }

    return { prompt: JSON.stringify(message), images: [] };
}

async function buildCodexInput(
    messages: ResponseInput,
    agent: AgentDefinition,
    imageWriter: CodexImageAttachmentWriter
): Promise<{ instructions: string; prompt: string; images: string[] }> {
    const instructions: string[] = [];
    const prompt: string[] = [];
    const images: string[] = [];

    if (agent.instructions?.trim()) {
        instructions.push(agent.instructions.trim());
    }

    for (const message of messages) {
        const serialized = await serializeMessageForCodex(message, imageWriter);
        images.push(...serialized.images);
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
        images,
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

function isBrokenPipeError(error: unknown): boolean {
    return error instanceof Error && (error as NodeJS.ErrnoException).code === 'EPIPE';
}

type CodexExecStreamSummary = {
    text: string;
    length: number;
    truncated: boolean;
};

type CodexExecDiagnostics = {
    command: 'codex';
    args: string[];
    cwd: string;
    pid: number | null;
    started_at: string;
    closed_at: string | null;
    duration_ms: number | null;
    exit_code: number | null;
    signal: NodeJS.Signals | null;
    stdout: CodexExecStreamSummary;
    stderr: CodexExecStreamSummary;
};

type CodexCliUsage = {
    input_tokens?: number;
    cached_input_tokens?: number;
    output_tokens?: number;
    reasoning_output_tokens?: number;
    total_tokens?: number;
};

type CodexExecError = Error & {
    codex_exec?: CodexExecDiagnostics;
};

type CodexRequestOptions = {
    extraInstructions?: string;
    jsonSchema?: ResponseJSONSchema;
    allowShellTool?: boolean;
    filesystemTools?: ToolFunction[];
    useTempCwd?: boolean;
};

type CodexToolAction =
    | {
          action: 'tool_calls';
          toolCalls: ToolCall[];
      }
    | {
          action: 'final_response';
          content: string;
      };

const MAX_CODEX_EXEC_STREAM_LOG_CHARS = 20_000;

function summarizeCodexExecStream(value: string): CodexExecStreamSummary {
    if (value.length <= MAX_CODEX_EXEC_STREAM_LOG_CHARS) {
        return {
            text: value,
            length: value.length,
            truncated: false,
        };
    }

    const half = Math.floor(MAX_CODEX_EXEC_STREAM_LOG_CHARS / 2);
    return {
        text: `${value.slice(0, half)}\n...[truncated ${value.length - MAX_CODEX_EXEC_STREAM_LOG_CHARS} chars]...\n${value.slice(-half)}`,
        length: value.length,
        truncated: true,
    };
}

function codexUsageFromJsonl(
    stdout: string,
    model: string,
    requestId?: string,
    metadata?: Record<string, unknown>
): ModelUsage | undefined {
    let latestUsage: CodexCliUsage | undefined;
    for (const line of stdout.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        let parsed: unknown;
        try {
            parsed = JSON.parse(trimmed);
        } catch {
            continue;
        }
        if (!isRecord(parsed) || parsed.type !== 'turn.completed' || !isRecord(parsed.usage)) continue;
        const usage = parsed.usage;
        latestUsage = {
            input_tokens: finiteNumber(usage.input_tokens),
            cached_input_tokens: finiteNumber(usage.cached_input_tokens),
            output_tokens: finiteNumber(usage.output_tokens),
            reasoning_output_tokens: finiteNumber(usage.reasoning_output_tokens),
            total_tokens: finiteNumber(usage.total_tokens),
        };
    }

    if (!latestUsage) return undefined;
    const inputTokens = latestUsage.input_tokens ?? 0;
    const outputTokens = latestUsage.output_tokens ?? 0;
    if (inputTokens === 0 && outputTokens === 0) return undefined;
    return {
        model,
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        total_tokens: latestUsage.total_tokens ?? inputTokens + outputTokens,
        cached_tokens: latestUsage.cached_input_tokens,
        request_id: requestId,
        metadata: {
            ...metadata,
            source: 'codex_cli_json',
            reasoning_output_tokens: latestUsage.reasoning_output_tokens ?? 0,
        },
    };
}

function finiteNumber(value: unknown): number | undefined {
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function getCodexProviderSettings(settings?: ModelSettings): CodexProviderModelSettings | undefined {
    return settings as CodexProviderModelSettings | undefined;
}

function compactJson(value: unknown): string {
    return JSON.stringify(value);
}

function getToolNames(tools: ToolFunction[]): string[] {
    return tools.map(tool => tool.definition.function.name);
}

function getTerminalToolNameSet(agent: AgentDefinition): Set<string> {
    return new Set(
        (agent.terminalToolNames ?? []).filter(
            (name): name is string => typeof name === 'string' && name.trim().length > 0
        )
    );
}

function getAvailableTerminalToolNames(tools: ToolFunction[], agent: AgentDefinition): string[] {
    const terminalNames = getTerminalToolNameSet(agent);
    if (terminalNames.size === 0) return [];
    return getToolNames(tools).filter(name => terminalNames.has(name));
}

function createCodexToolOutputSchema(tools: ToolFunction[], agent: AgentDefinition): ResponseJSONSchema {
    const requiresTerminalTool = getAvailableTerminalToolNames(tools, agent).length > 0;
    return {
        name: 'codex_tool_action',
        type: 'json_schema',
        description: 'A simulated Ensemble tool action for Codex CLI provider requests.',
        schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
                action: {
                    type: 'string',
                    enum: requiresTerminalTool ? ['tool_calls'] : ['tool_calls', 'final_response'],
                    description: requiresTerminalTool
                        ? 'Use tool_calls. This request is only complete after calling a terminal tool.'
                        : 'Use tool_calls when requesting Ensemble tool execution; use final_response only when no tool is needed.',
                },
                toolCalls: {
                    type: 'array',
                    description:
                        'Tool calls to execute in parallel for this turn. Empty when action is final_response.',
                    items: {
                        type: 'object',
                        additionalProperties: false,
                        properties: {
                            name: {
                                type: 'string',
                                enum: getToolNames(tools),
                            },
                            argumentsJson: {
                                type: 'string',
                                description:
                                    'A compact JSON string containing the complete arguments object for the named tool.',
                            },
                        },
                        required: ['name', 'argumentsJson'],
                    },
                },
                finalResponse: {
                    type: 'string',
                    description: 'Final assistant response. Use an empty string when action is tool_calls.',
                },
            },
            required: ['action', 'toolCalls', 'finalResponse'],
        },
    };
}

function describeCodexToolChoice(settings?: ModelSettings): string {
    const toolChoice = settings?.tool_choice;
    if (toolChoice === 'required') {
        return 'This turn requires at least one tool call.';
    }
    if (toolChoice === 'none') {
        return 'This turn forbids tool calls; return final_response.';
    }
    if (typeof toolChoice === 'object' && toolChoice?.type === 'function' && toolChoice.function?.name) {
        return `This turn requires the ${toolChoice.function.name} tool.`;
    }
    return 'Use tool_calls when a tool result is needed; otherwise use final_response.';
}

function buildCodexToolInstructions(tools: ToolFunction[], agent: AgentDefinition): string {
    const settings = agent.modelSettings;
    const terminalToolNames = getAvailableTerminalToolNames(tools, agent);
    const toolDescriptions = tools
        .map(tool => {
            const fn = tool.definition.function;
            return [
                `Tool: ${fn.name}`,
                `Description: ${fn.description}`,
                `Parameters JSON schema: ${compactJson(fn.parameters)}`,
            ].join('\n');
        })
        .join('\n\n');

    return [
        'You are using Ensemble simulated tool mode.',
        'You cannot execute these tools yourself. Instead, respond only with JSON matching the provided output schema.',
        describeCodexToolChoice(settings),
        'For action "tool_calls", include one or more entries in toolCalls and set finalResponse to an empty string.',
        terminalToolNames.length > 0
            ? `This request is not complete until you call one of these terminal tools: ${terminalToolNames.join(', ')}. Do not use final_response.`
            : 'For action "final_response", set toolCalls to an empty array and put the final answer in finalResponse.',
        'Use exact tool names.',
        'Set argumentsJson to a compact JSON string containing the complete arguments object for the named tool.',
        'For example, the arguments object {"label":"ok"} must be encoded as "{\\"label\\":\\"ok\\"}".',
        '',
        'Available tools:',
        toolDescriptions,
    ].join('\n');
}

function validateCodexWorkspaceRelativePath(filePath: string): string {
    const normalized = filePath.replace(/\\/g, '/').replace(/^\.\/+/, '');
    if (
        !normalized ||
        path.isAbsolute(normalized) ||
        normalized.split('/').some(part => part === '..' || part === '')
    ) {
        throw new Error(`Invalid Codex workspace file path: ${filePath}`);
    }
    return normalized;
}

async function writeCodexWorkspaceFiles(tempDir: string, files?: Record<string, string>): Promise<string[]> {
    const written: string[] = [];
    for (const [rawPath, content] of Object.entries(files ?? {})) {
        const relativePath = validateCodexWorkspaceRelativePath(rawPath);
        const targetPath = path.join(tempDir, relativePath);
        await mkdir(path.dirname(targetPath), { recursive: true });
        const dataUrlMatch = /^data:[^;,]+;base64,([\s\S]*)$/i.exec(content);
        if (dataUrlMatch) {
            await writeFile(targetPath, Buffer.from(dataUrlMatch[1] ?? '', 'base64'));
        } else {
            await writeFile(targetPath, content, 'utf8');
        }
        written.push(relativePath);
    }
    return written.sort();
}

function normalizeCodexWorkspaceFinalFiles(files?: string[]): string[] {
    return [...new Set((files ?? []).map(validateCodexWorkspaceRelativePath))].sort();
}

async function readCodexWorkspaceFinalFiles(tempDir: string, files?: string[]): Promise<Record<string, string>> {
    const output: Record<string, string> = {};
    for (const relativePath of normalizeCodexWorkspaceFinalFiles(files)) {
        const filePath = path.join(tempDir, relativePath);
        output[relativePath] = await readFile(filePath, 'utf8');
    }
    return output;
}

function appendCodexWorkspaceFinalFiles(content: string, files: Record<string, string>): string {
    const entries = Object.entries(files);
    if (entries.length === 0) return content;
    return [
        content,
        '',
        '<codex_workspace_files_json>',
        JSON.stringify(Object.fromEntries(entries), null, 2),
        '</codex_workspace_files_json>',
    ].join('\n');
}

function buildCodexWorkspaceFileInstructions(files: string[], extra?: string): string {
    if (files.length === 0 && !extra?.trim()) return '';
    return [
        'A disposable Codex workspace has been prepared for this request.',
        files.length > 0
            ? `Workspace files available in the current directory:\n${files.map(file => `- ${file}`).join('\n')}`
            : undefined,
        extra?.trim() || undefined,
    ]
        .filter(Boolean)
        .join('\n');
}

function shellIdentifier(value: string): string {
    if (!/^[A-Za-z0-9_.:-]+$/.test(value)) {
        throw new Error(`Codex filesystem tool name is not shell-safe: ${value}`);
    }
    return value;
}

function buildCodexFilesystemToolInstructions(tools: ToolFunction[], agent: AgentDefinition): string {
    const terminalToolNames = getAvailableTerminalToolNames(tools, agent);
    const toolDescriptions = tools
        .map(tool => {
            const fn = tool.definition.function;
            return [
                `Command: ./tools/${fn.name} <arguments-json-file>`,
                `Description: ${fn.description}`,
                `Arguments JSON schema: ${compactJson(fn.parameters)}`,
            ].join('\n');
        })
        .join('\n\n');

    return [
        'You are using Codex filesystem tool mode.',
        'Work in the current directory. Read the provided JSON files, write candidate JSON files, and run the executable commands in ./tools.',
        'Each ./tools command takes one path to a JSON arguments file. The command prints the real tool result to stdout.',
        'When a layered document argument would otherwise be a large JSON string, you may put candidateLayeredDocumentPath or repairedLayeredDocumentPath in the arguments file; the wrapper will read that file and pass the required JSON string to the real tool.',
        terminalToolNames.length > 0
            ? `This request is not complete until you run one of these terminal tool commands: ${terminalToolNames.map(name => `./tools/${name}`).join(', ')}.`
            : undefined,
        terminalToolNames.length > 0
            ? 'After the terminal tool command succeeds, respond with a brief completion note. Do not invent tool outputs; use the command output.'
            : 'Run the commands you need, then respond with a brief completion note. Do not invent command outputs; use stdout from the commands.',
        '',
        'Available filesystem tools:',
        toolDescriptions,
    ]
        .filter(Boolean)
        .join('\n');
}

type CodexFilesystemToolBroker = {
    instructions: string;
    stop: () => Promise<void>;
};

async function startCodexFilesystemToolBroker(
    tempDir: string,
    tools: ToolFunction[],
    agent: AgentDefinition
): Promise<CodexFilesystemToolBroker> {
    const toolsDir = path.join(tempDir, 'tools');
    const requestDir = path.join(tempDir, '.codex-tool-requests');
    const responseDir = path.join(tempDir, '.codex-tool-responses');
    await Promise.all([
        mkdir(toolsDir, { recursive: true }),
        mkdir(requestDir, { recursive: true }),
        mkdir(responseDir, { recursive: true }),
    ]);

    for (const tool of tools) {
        const toolName = shellIdentifier(tool.definition.function.name);
        const toolPath = path.join(toolsDir, toolName);
        await writeFile(
            toolPath,
            buildCodexFilesystemToolWrapperScript({
                toolName,
                workspaceDir: tempDir,
                requestDir,
                responseDir,
            }),
            'utf8'
        );
        await chmod(toolPath, 0o755);
    }

    const toolByName = new Map(tools.map(tool => [tool.definition.function.name, tool]));
    const seen = new Set<string>();
    const inFlight = new Set<Promise<void>>();
    let stopped = false;

    const serviceRequest = async (fileName: string): Promise<void> => {
        const requestPath = path.join(requestDir, fileName);
        let request: Record<string, unknown>;
        try {
            request = JSON.parse(await readFile(requestPath, 'utf8')) as Record<string, unknown>;
        } catch (error) {
            await writeFile(
                path.join(responseDir, fileName),
                JSON.stringify({
                    ok: false,
                    error: `Could not read Codex filesystem tool request: ${
                        error instanceof Error ? error.message : String(error)
                    }`,
                }),
                'utf8'
            );
            return;
        }

        const toolName = typeof request.toolName === 'string' ? request.toolName : '';
        const tool = toolByName.get(toolName);
        if (!tool) {
            await writeFile(
                path.join(responseDir, fileName),
                JSON.stringify({ ok: false, error: `Unknown Codex filesystem tool: ${toolName || '<missing>'}` }),
                'utf8'
            );
            return;
        }

        try {
            const argumentsJson = typeof request.argumentsJson === 'string' ? request.argumentsJson : '{}';
            const parsedArguments = JSON.parse(argumentsJson);
            const result = await tool.function(parsedArguments);
            const output = typeof result === 'string' ? result : JSON.stringify(result);
            await writeFile(path.join(responseDir, fileName), JSON.stringify({ ok: true, output }), 'utf8');
        } catch (error) {
            await writeFile(
                path.join(responseDir, fileName),
                JSON.stringify({
                    ok: false,
                    error: error instanceof Error ? error.message : String(error),
                }),
                'utf8'
            );
        }
    };

    const loop = (async () => {
        while (!stopped) {
            const entries = await readdir(requestDir).catch(() => []);
            for (const fileName of entries) {
                if (!fileName.endsWith('.json') || seen.has(fileName)) continue;
                seen.add(fileName);
                const task = serviceRequest(fileName).finally(() => {
                    inFlight.delete(task);
                });
                inFlight.add(task);
            }
            await sleep(50);
        }
        await Promise.allSettled([...inFlight]);
    })();

    return {
        instructions: buildCodexFilesystemToolInstructions(tools, agent),
        stop: async () => {
            stopped = true;
            await loop;
        },
    };
}

function buildCodexFilesystemToolWrapperScript(args: {
    toolName: string;
    workspaceDir: string;
    requestDir: string;
    responseDir: string;
}): string {
    return `#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const toolName = ${JSON.stringify(args.toolName)};
const workspaceDir = ${JSON.stringify(args.workspaceDir)};
const requestDir = ${JSON.stringify(args.requestDir)};
const responseDir = ${JSON.stringify(args.responseDir)};

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function readText(filePath) {
  return fs.readFileSync(path.resolve(process.cwd(), filePath), 'utf8');
}

function readArgumentsJson() {
  const argsPath = process.argv[2];
  const raw = argsPath ? readText(argsPath) : fs.readFileSync(0, 'utf8');
  if (!raw.trim()) {
    throw new Error('Expected a JSON arguments file path or JSON on stdin.');
  }
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Tool arguments must be a JSON object.');
  }
  if (parsed.candidateLayeredDocumentPath && !parsed.candidateLayeredDocumentJson) {
    parsed.candidateLayeredDocumentJson = readText(parsed.candidateLayeredDocumentPath);
    delete parsed.candidateLayeredDocumentPath;
  }
  if (parsed.repairedLayeredDocumentPath && !parsed.repairedLayeredDocumentJson) {
    parsed.repairedLayeredDocumentJson = readText(parsed.repairedLayeredDocumentPath);
    delete parsed.repairedLayeredDocumentPath;
  }
  return { parsedArguments: parsed, argumentsJson: JSON.stringify(parsed) };
}

function defaultOutputPath(toolName, id, key) {
  const suffix = key === 'renderPngBase64' ? 'render.png' : key === 'diffPngBase64' ? 'diff.png' : key.replace(/Base64$/, '');
  return path.join('tool-output', toolName + '-' + id + '-' + suffix);
}

function writeBase64Image(output, key, targetPath, toolName, id) {
  if (!output || typeof output !== 'object' || typeof output[key] !== 'string') {
    return;
  }
  const outputPath = typeof targetPath === 'string' && targetPath.trim()
    ? targetPath
    : defaultOutputPath(toolName, id, key);
  const resolved = path.resolve(process.cwd(), outputPath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, Buffer.from(output[key], 'base64'));
  output[key.replace(/Base64$/, 'Path')] = outputPath;
  delete output[key];
}

function materializeOutputFiles(rawOutput, parsedArguments, id) {
  let output;
  try {
    output = JSON.parse(String(rawOutput || ''));
  } catch {
    return String(rawOutput || '');
  }
  writeBase64Image(output, 'renderPngBase64', parsedArguments.renderPngPath, toolName, id);
  writeBase64Image(output, 'diffPngBase64', parsedArguments.diffPngPath, toolName, id);
  return JSON.stringify(output, null, 2);
}

async function main() {
  process.chdir(workspaceDir);
  fs.mkdirSync(requestDir, { recursive: true });
  fs.mkdirSync(responseDir, { recursive: true });
  const id = String(Date.now()) + '-' + String(process.pid) + '-' + Math.random().toString(16).slice(2);
  const fileName = id + '.json';
  const toolArguments = readArgumentsJson();
  fs.writeFileSync(
    path.join(requestDir, fileName),
    JSON.stringify({ id, toolName, argumentsJson: toolArguments.argumentsJson }),
    'utf8'
  );

  const responsePath = path.join(responseDir, fileName);
  const deadline = Date.now() + 300000;
  while (Date.now() < deadline) {
    if (fs.existsSync(responsePath)) {
      const response = JSON.parse(fs.readFileSync(responsePath, 'utf8'));
      if (!response.ok) {
        console.error(response.error || 'Tool failed.');
        process.exit(1);
      }
      const output = materializeOutputFiles(response.output, toolArguments.parsedArguments, id);
      process.stdout.write(output);
      if (!output.endsWith('\\n')) process.stdout.write('\\n');
      return;
    }
    sleep(50);
  }
  console.error('Timed out waiting for tool result.');
  process.exit(1);
}

main().catch(error => {
  console.error(error && error.message ? error.message : String(error));
  process.exit(1);
});
`;
}

function normalizeCodexToolArguments(value: unknown, toolName: string): string {
    if (typeof value !== 'string') {
        throw new Error(`Codex tool call ${toolName} must provide argumentsJson as a JSON string.`);
    }
    const parsed = JSON.parse(value);
    if (!isRecord(parsed)) {
        throw new Error(`Codex tool call ${toolName} argumentsJson must decode to a JSON object.`);
    }
    return JSON.stringify(parsed);
}

function parseCodexToolAction(
    content: string,
    tools: ToolFunction[],
    settings?: ModelSettings,
    terminalToolNames: string[] = []
): CodexToolAction {
    const parsed = JSON.parse(content);
    if (!isRecord(parsed)) {
        throw new Error('Codex tool response must be a JSON object.');
    }

    const toolChoice = settings?.tool_choice;
    const toolNames = new Set(getToolNames(tools));
    const action = parsed.action;

    if (action === 'final_response') {
        if (terminalToolNames.length > 0) {
            throw new Error(
                `Codex returned final_response when terminal tool ${terminalToolNames.join(' or ')} was required.`
            );
        }
        if (toolChoice === 'required') {
            throw new Error('Codex returned final_response when tool_choice required a tool call.');
        }
        if (typeof toolChoice === 'object' && toolChoice?.type === 'function' && toolChoice.function?.name) {
            throw new Error(`Codex returned final_response when ${toolChoice.function.name} was required.`);
        }
        return {
            action: 'final_response',
            content: typeof parsed.finalResponse === 'string' ? parsed.finalResponse : '',
        };
    }

    if (action !== 'tool_calls') {
        throw new Error(`Codex tool response action must be tool_calls or final_response; received ${String(action)}.`);
    }
    if (toolChoice === 'none') {
        throw new Error('Codex returned tool_calls when tool_choice forbids tool use.');
    }
    if (!Array.isArray(parsed.toolCalls) || parsed.toolCalls.length === 0) {
        throw new Error('Codex tool response must include at least one tool call.');
    }

    const requiredToolName =
        typeof toolChoice === 'object' && toolChoice?.type === 'function' && toolChoice.function?.name
            ? toolChoice.function.name
            : undefined;

    const toolCalls: ToolCall[] = parsed.toolCalls.map((rawCall, index) => {
        if (!isRecord(rawCall)) {
            throw new Error(`Codex tool call at index ${index} must be an object.`);
        }
        const name = rawCall.name;
        if (typeof name !== 'string' || !toolNames.has(name)) {
            throw new Error(`Codex requested unknown tool ${String(name)}.`);
        }
        if (requiredToolName && name !== requiredToolName) {
            throw new Error(`Codex requested ${name}, but ${requiredToolName} was required.`);
        }
        const id = `codex_tool_${randomUUID()}`;
        return {
            id,
            call_id: id,
            type: 'function',
            function: {
                name,
                arguments: normalizeCodexToolArguments(rawCall.argumentsJson, name),
            },
        };
    });

    return {
        action: 'tool_calls',
        toolCalls,
    };
}

async function readOptionalUtf8File(filePath: string): Promise<string | null> {
    try {
        return await readFile(filePath, 'utf8');
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            return null;
        }
        throw error;
    }
}

function serializeCodexExecError(error: unknown): unknown {
    if (!(error instanceof Error)) return error;
    return {
        name: error.name,
        message: error.message,
        stack: error.stack,
        codex_exec: (error as CodexExecError).codex_exec,
    };
}

async function runCodexExec(options: {
    commandArgs: string[];
    cwd: string;
    env: NodeJS.ProcessEnv;
    prompt: string;
    abortSignal?: AbortSignal;
}): Promise<{ stdout: string; stderr: string; diagnostics: CodexExecDiagnostics }> {
    if (options.abortSignal?.aborted) {
        throw createAbortError();
    }

    let stdout = '';
    let stderr = '';
    const startedMs = Date.now();
    const diagnostics: CodexExecDiagnostics = {
        command: 'codex',
        args: [...options.commandArgs],
        cwd: options.cwd,
        pid: null,
        started_at: new Date(startedMs).toISOString(),
        closed_at: null,
        duration_ms: null,
        exit_code: null,
        signal: null,
        stdout: summarizeCodexExecStream(''),
        stderr: summarizeCodexExecStream(''),
    };

    const refreshDiagnostics = (code: number | null = null, signal: NodeJS.Signals | null = null): void => {
        const closedMs = Date.now();
        diagnostics.closed_at = new Date(closedMs).toISOString();
        diagnostics.duration_ms = closedMs - startedMs;
        diagnostics.exit_code = code;
        diagnostics.signal = signal;
        diagnostics.stdout = summarizeCodexExecStream(stdout);
        diagnostics.stderr = summarizeCodexExecStream(stderr);
    };

    await new Promise<void>((resolve, reject) => {
        let settled = false;
        let abortError: Error | undefined;

        const child = spawn('codex', options.commandArgs, {
            cwd: options.cwd,
            env: options.env,
            stdio: ['pipe', 'pipe', 'pipe'],
        });
        diagnostics.pid = child.pid ?? null;

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
                (error as CodexExecError).codex_exec = diagnostics;
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
        child.stdout?.once('error', error => {
            if (isBrokenPipeError(error)) {
                return;
            }
            finish(error);
        });
        child.stderr?.once('error', error => {
            if (isBrokenPipeError(error)) {
                return;
            }
            finish(error);
        });
        child.stdin?.once('error', error => {
            if (isBrokenPipeError(error)) {
                return;
            }
            finish(error);
        });

        child.once('error', error => {
            refreshDiagnostics();
            finish(error);
        });

        child.once('close', (code, signal) => {
            refreshDiagnostics(code, signal);
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

        try {
            child.stdin?.end(options.prompt);
        } catch (error) {
            if (!isBrokenPipeError(error)) {
                finish(error instanceof Error ? error : new Error(String(error)));
            }
        }
    });

    return { stdout, stderr, diagnostics };
}

function disabledFeatureArgs(options: { allowImageGeneration?: boolean; allowShellTool?: boolean } = {}): string[] {
    return CODEX_DISABLED_FEATURES.filter(feature => {
        if (options.allowImageGeneration && feature === 'image_generation') return false;
        if (options.allowShellTool && feature === 'shell_tool') return false;
        return true;
    }).flatMap(feature => ['--disable', feature]);
}

async function executeCodexRequest(
    messages: ResponseInput,
    model: string,
    agent: AgentDefinition,
    requestId?: string,
    options: CodexRequestOptions = {}
): Promise<string> {
    if (agent.params || agent.processParams) {
        throw new Error('Codex provider v1 does not support params requests.');
    }

    const settings = agent.modelSettings;
    const codexSettings = getCodexProviderSettings(settings);
    const requestJsonSchema = options.jsonSchema ?? settings?.json_schema;
    const { model: codexModel, effort } = resolveCodexModel(model, settings);
    const codexHome = resolveCodexHome(settings);
    const tempDir = await mkdtemp(path.join(tmpdir(), 'ensemble-codex-'));
    const cwd = options.useTempCwd ? tempDir : agent.cwd || process.cwd();
    const imageWriter = new CodexImageAttachmentWriter(tempDir, cwd);
    let filesystemToolBroker: CodexFilesystemToolBroker | null = null;
    const workspaceFileNames = await writeCodexWorkspaceFiles(tempDir, codexSettings?.codex_workspace_files);
    if (options.filesystemTools?.length) {
        filesystemToolBroker = await startCodexFilesystemToolBroker(tempDir, options.filesystemTools, agent);
    }
    const extraInstructions = [
        buildCodexWorkspaceFileInstructions(workspaceFileNames, codexSettings?.codex_workspace_instructions),
        filesystemToolBroker?.instructions,
        options.extraInstructions,
    ]
        .map(value => value?.trim() ?? '')
        .filter(Boolean)
        .join('\n\n');
    const requestAgent = extraInstructions
        ? {
              ...agent,
              instructions: [agent.instructions, extraInstructions]
                  .map(value => value?.trim() ?? '')
                  .filter(Boolean)
                  .join('\n\n'),
          }
        : agent;
    const { instructions, prompt, images } = await buildCodexInput(messages, requestAgent, imageWriter);
    const hasInstructions = instructions.trim().length > 0;
    const instructionsPath = path.join(tempDir, 'instructions.md');
    const lastMessagePath = path.join(tempDir, 'last-message.json');
    const schemaPath = requestJsonSchema?.schema ? path.join(tempDir, 'schema.json') : undefined;

    try {
        if (hasInstructions) {
            await writeFile(instructionsPath, instructions, 'utf8');
        }
        if (schemaPath) {
            await writeFile(schemaPath, JSON.stringify(requestJsonSchema!.schema, null, 2), 'utf8');
        }

        const commandArgs = [
            'exec',
            '--json',
            '--ephemeral',
            '--ignore-user-config',
            '--ignore-rules',
            '--skip-git-repo-check',
            ...disabledFeatureArgs({ allowShellTool: options.allowShellTool }),
            '-m',
            codexModel,
            '-c',
            `model_reasoning_effort=${JSON.stringify(effort)}`,
            ...(hasInstructions ? ['-c', `model_instructions_file=${JSON.stringify(instructionsPath)}`] : []),
            ...(schemaPath ? ['--output-schema', schemaPath] : []),
            ...(images.length > 0 ? ['--image', images.join(',')] : []),
            ...(options.allowShellTool ? ['--sandbox', 'workspace-write', '--add-dir', tempDir] : []),
            '--output-last-message',
            lastMessagePath,
            '--cd',
            cwd,
            '-',
        ];

        const loggedRequestId = log_llm_request(
            agent.agent_id || 'default',
            'codex',
            model,
            {
                command: 'codex',
                args: commandArgs,
                cwd,
                prompt,
                images,
                codex_model: codexModel,
                schema: requestJsonSchema?.schema,
            },
            new Date(),
            requestId,
            agent.tags
        );

        let codexExecDiagnostics: CodexExecDiagnostics;
        try {
            const codexExecResult = await runCodexExec({
                commandArgs,
                cwd,
                env: {
                    ...process.env,
                    CODEX_HOME: codexHome,
                },
                prompt,
                abortSignal: agent.abortSignal,
            });
            codexExecDiagnostics = codexExecResult.diagnostics;
            const usage = codexUsageFromJsonl(codexExecResult.stdout, model, loggedRequestId, {
                codex_cli_model: codexModel,
            });
            if (usage) costTracker.addUsage(usage);
        } catch (error) {
            log_llm_error(loggedRequestId, {
                error: serializeCodexExecError(error),
                codex_exec: error instanceof Error ? (error as CodexExecError).codex_exec : undefined,
            });
            throw error;
        }

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

        const finalFiles = await readCodexWorkspaceFinalFiles(tempDir, codexSettings?.codex_workspace_final_files);
        const content = appendCodexWorkspaceFinalFiles(
            normalizeLastMessageContent(rawLastMessage, Boolean(schemaPath)),
            finalFiles
        );
        log_llm_response(loggedRequestId, { content, codex_exec: codexExecDiagnostics });
        return content;
    } catch (error) {
        log_llm_error(requestId, error);
        throw error;
    } finally {
        await filesystemToolBroker?.stop();
        await rm(tempDir, { recursive: true, force: true });
    }
}

async function* executeCodexToolRequest(
    messages: ResponseInput,
    model: string,
    agent: AgentDefinition,
    tools: ToolFunction[],
    requestId?: string
): AsyncGenerator<ProviderStreamEvent> {
    if (agent.modelSettings?.json_schema?.schema) {
        throw new Error('Codex provider cannot combine simulated tool calls with a caller-supplied json_schema.');
    }
    const content = await executeCodexRequest(messages, model, agent, requestId, {
        extraInstructions: buildCodexToolInstructions(tools, agent),
        jsonSchema: createCodexToolOutputSchema(tools, agent),
    });
    const action = parseCodexToolAction(
        content,
        tools,
        agent.modelSettings,
        getAvailableTerminalToolNames(tools, agent)
    );

    if (action.action === 'final_response') {
        const messageId = `codex-${Date.now()}`;
        yield {
            type: 'message_complete',
            content: action.content,
            message_id: messageId,
        };
        return;
    }

    for (const toolCall of action.toolCalls) {
        yield {
            type: 'tool_start',
            tool_call: toolCall,
        };
    }
}

async function* executeCodexFilesystemToolRequest(
    messages: ResponseInput,
    model: string,
    agent: AgentDefinition,
    tools: ToolFunction[],
    requestId?: string
): AsyncGenerator<ProviderStreamEvent> {
    if (agent.modelSettings?.json_schema?.schema) {
        throw new Error('Codex provider cannot combine filesystem tool mode with a caller-supplied json_schema.');
    }
    const content = await executeCodexRequest(messages, model, agent, requestId, {
        allowShellTool: true,
        filesystemTools: tools,
        useTempCwd: true,
    });
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
}

async function* executeCodexWorkspaceFileRequest(
    messages: ResponseInput,
    model: string,
    agent: AgentDefinition,
    tools: ToolFunction[],
    requestId?: string
): AsyncGenerator<ProviderStreamEvent> {
    if (agent.modelSettings?.json_schema?.schema) {
        throw new Error('Codex provider cannot combine workspace file mode with a caller-supplied json_schema.');
    }
    const content = await executeCodexRequest(messages, model, agent, requestId, {
        allowShellTool: true,
        filesystemTools: tools,
        useTempCwd: true,
    });
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
}

function buildCodexImagePrompt(prompt: string, opts: ImageGenerationOpts = {}): string {
    const count = opts.n && opts.n > 0 ? Math.floor(opts.n) : 1;
    const details = [
        '$imagegen',
        `Generate exactly ${count} image${count === 1 ? '' : 's'} for this request.`,
        'Actually invoke the image generation tool. Do not invent or predict file paths.',
        'After generation completes, return only the generated local image file path(s), one per line.',
        opts.source_images
            ? 'Use the attached image input(s) as reference material for the generation or edit.'
            : undefined,
        opts.size ? `Requested size or aspect ratio: ${opts.size}.` : undefined,
        opts.quality ? `Requested quality: ${opts.quality}.` : undefined,
        opts.background ? `Requested background: ${opts.background}.` : undefined,
        opts.input_fidelity ? `Requested input fidelity: ${opts.input_fidelity}.` : undefined,
        '',
        prompt,
    ].filter(Boolean);

    return details.join('\n');
}

type CodexImagePromptModelAttempt = (ReturnType<typeof resolveCodexModel> & { requested: string }) | null;

const imagePromptModelCapabilityFailures = new Map<string, Set<string>>();

function resolveCodexImagePromptModelAttempts(
    opts: ImageGenerationOpts,
    settings?: ModelSettings
): CodexImagePromptModelAttempt[] {
    const requestedModels = [opts.prompt_model, ...(opts.prompt_model_fallbacks ?? [])]
        .map(model => model?.trim() ?? '')
        .filter((model, index, models): model is string => model.length > 0 && models.indexOf(model) === index);
    if (requestedModels.length === 0) return [null];
    return requestedModels.map(requested => ({
        requested,
        ...resolveCodexModel(requested, settings),
    }));
}

function hasCachedImagePromptModelCapabilityFailure(codexHome: string, requested: string): boolean {
    return imagePromptModelCapabilityFailures.get(codexHome)?.has(requested) ?? false;
}

function cacheImagePromptModelCapabilityFailure(codexHome: string, requested: string): void {
    const failures = imagePromptModelCapabilityFailures.get(codexHome) ?? new Set<string>();
    failures.add(requested);
    imagePromptModelCapabilityFailures.set(codexHome, failures);
}

function isImagePromptModelCapabilityFailure(message: string): boolean {
    const normalized = message.toLowerCase();
    return (
        normalized.includes('no callable image generation tool') ||
        (normalized.includes('cannot fulfill') && normalized.includes('image generation tool'))
    );
}

async function executeCodexImageGeneration(
    prompt: string,
    model: string,
    agent: AgentDefinition,
    opts: ImageGenerationOpts = {}
): Promise<string[]> {
    if (model !== CODEX_GPT_IMAGE_MODEL) {
        throw new Error(`Codex image generation only supports ${CODEX_GPT_IMAGE_MODEL}.`);
    }
    if (opts.mask) {
        throw new Error('Codex image generation does not support mask inputs through Ensemble.');
    }

    const settings = agent.modelSettings;
    const codexHome = resolveCodexHome(settings);
    const cwd = agent.cwd || process.cwd();
    const tempDir = await mkdtemp(path.join(tmpdir(), 'ensemble-codex-image-'));
    const inputDir = path.join(tempDir, 'input');
    const outputDir = path.join(tempDir, 'output');
    const isolatedCodexHome = await prepareIsolatedCodexHome(codexHome, tempDir);
    const imageWriter = new CodexImageAttachmentWriter(inputDir, cwd);
    const lastMessagePath = path.join(tempDir, 'last-message.json');
    const expectedImageCount = opts.n && opts.n > 0 ? Math.floor(opts.n) : 1;

    try {
        await mkdir(inputDir, { recursive: true });
        await mkdir(outputDir, { recursive: true });

        const images = await imageWriter.materializeSourceImages(opts.source_images);
        const promptModelAttempts = resolveCodexImagePromptModelAttempts(opts, settings);
        const promptModelErrors: string[] = [];

        for (const promptModelAttempt of promptModelAttempts) {
            if (
                promptModelAttempt &&
                hasCachedImagePromptModelCapabilityFailure(codexHome, promptModelAttempt.requested)
            ) {
                promptModelErrors.push(
                    `${promptModelAttempt.requested}: skipped after this Codex home already proved the prompt model cannot call image generation.`
                );
                continue;
            }

            try {
                const commandArgs = [
                    'exec',
                    '--ephemeral',
                    '--ignore-user-config',
                    '--ignore-rules',
                    '--skip-git-repo-check',
                    '--enable',
                    'image_generation',
                    ...disabledFeatureArgs({ allowImageGeneration: true }),
                    ...(promptModelAttempt
                        ? [
                              '-m',
                              promptModelAttempt.model,
                              '-c',
                              `model_reasoning_effort=${JSON.stringify(promptModelAttempt.effort)}`,
                          ]
                        : []),
                    ...(images.length > 0 ? ['--image', images.join(',')] : []),
                    '--output-last-message',
                    lastMessagePath,
                    '--cd',
                    outputDir,
                    '-',
                ];
                const codexPrompt = buildCodexImagePrompt(prompt, opts);
                const loggedRequestId = log_llm_request(
                    agent.agent_id || 'default',
                    'codex',
                    model,
                    {
                        command: 'codex',
                        args: commandArgs,
                        cwd: outputDir,
                        caller_cwd: cwd,
                        codex_home: isolatedCodexHome,
                        prompt: codexPrompt,
                        images,
                        prompt_model: promptModelAttempt,
                        image_model: model,
                        expected_image_count: expectedImageCount,
                    },
                    new Date(),
                    opts.request_id,
                    agent.tags
                );

                let codexExecDiagnostics: CodexExecDiagnostics;
                try {
                    codexExecDiagnostics = (
                        await runCodexExec({
                            commandArgs,
                            cwd: outputDir,
                            env: {
                                ...process.env,
                                CODEX_HOME: isolatedCodexHome,
                            },
                            prompt: codexPrompt,
                            abortSignal: agent.abortSignal,
                        })
                    ).diagnostics;
                } catch (error) {
                    log_llm_error(loggedRequestId, {
                        error: serializeCodexExecError(error),
                        codex_exec: error instanceof Error ? (error as CodexExecError).codex_exec : undefined,
                    });
                    throw error;
                }

                const rawLastMessage = await readOptionalUtf8File(lastMessagePath);
                const lastMessageContent = rawLastMessage ?? '';
                const responseImagePaths = rawLastMessage
                    ? await extractExistingCodexImagePaths(rawLastMessage, outputDir)
                    : [];
                const outputImagePaths = await newestFirst(await listCodexOutputImages(outputDir));
                const generatedImagePaths = await newestFirst(await listCodexGeneratedImages(isolatedCodexHome));
                const selectedImagePaths: string[] = [];
                for (const filePath of [...responseImagePaths, ...outputImagePaths, ...generatedImagePaths]) {
                    if (selectedImagePaths.includes(filePath)) continue;
                    selectedImagePaths.push(filePath);
                    if (selectedImagePaths.length >= expectedImageCount) break;
                }
                if (selectedImagePaths.length < expectedImageCount) {
                    const lastMessage = lastMessageContent.trim();
                    const lastMessageNote =
                        rawLastMessage === null ? ' Codex CLI did not write --output-last-message.' : '';
                    throw new Error(
                        `Codex image generation resolved ${selectedImagePaths.length} image artifact${
                            selectedImagePaths.length === 1 ? '' : 's'
                        }, expected ${expectedImageCount}.${lastMessageNote}${
                            lastMessage ? ` Last message: ${lastMessage}` : ''
                        }`
                    );
                }
                const generatedImages = await readCodexImageFiles(selectedImagePaths);
                log_llm_response(loggedRequestId, {
                    image_count: generatedImages.length,
                    generated_image_paths: selectedImagePaths,
                    response_image_paths: responseImagePaths,
                    output_image_paths: outputImagePaths,
                    codex_home_image_paths: generatedImagePaths,
                    last_message: lastMessageContent.trim(),
                    last_message_missing: rawLastMessage === null,
                    codex_exec: codexExecDiagnostics,
                });
                costTracker.addUsage({
                    model,
                    image_count: generatedImages.length,
                    request_id: opts.request_id,
                    metadata: {
                        source: 'codex',
                        billing: 'codex_usage',
                        prompt_model: promptModelAttempt?.requested ?? null,
                    },
                });
                return generatedImages;
            } catch (error) {
                const label = promptModelAttempt?.requested ?? 'default Codex image prompt model';
                const message = error instanceof Error ? error.message : String(error);
                if (promptModelAttempt && isImagePromptModelCapabilityFailure(message)) {
                    cacheImagePromptModelCapabilityFailure(codexHome, promptModelAttempt.requested);
                }
                promptModelErrors.push(`${label}: ${message}`);
            }
        }

        throw new Error(`Codex image generation failed for every prompt model.\n${promptModelErrors.join('\n')}`);
    } catch (error) {
        log_llm_error(opts.request_id, error);
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
            const { getToolsFromAgent } = await import('../utils/agent.js');
            const tools = agent ? await getToolsFromAgent(agent) : [];
            if (tools.length > 0) {
                const codexToolTransport = getCodexProviderSettings(agent.modelSettings)?.codex_tool_transport;
                if (codexToolTransport === 'workspace-files') {
                    yield* executeCodexWorkspaceFileRequest(messages, model, agent, tools, requestId);
                    return;
                }
                if (codexToolTransport === 'filesystem') {
                    yield* executeCodexFilesystemToolRequest(messages, model, agent, tools, requestId);
                    return;
                }
                yield* executeCodexToolRequest(messages, model, agent, tools, requestId);
                return;
            }

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

    async createImage(
        prompt: string,
        model: string,
        agent: AgentDefinition,
        opts: ImageGenerationOpts = {}
    ): Promise<string[]> {
        return executeCodexImageGeneration(prompt, model, agent, opts);
    }
}

export const codexProvider = new CodexProvider();
