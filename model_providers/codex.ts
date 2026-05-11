import { spawn } from 'child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir, homedir } from 'os';
import path from 'path';
import { BaseModelProvider } from './base_provider.js';
import {
    AgentDefinition,
    ImageGenerationOpts,
    ModelSettings,
    ProviderStreamEvent,
    ResponseInput,
    ResponseInputItem,
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

        try {
            child.stdin?.end(options.prompt);
        } catch (error) {
            if (!isBrokenPipeError(error)) {
                finish(error instanceof Error ? error : new Error(String(error)));
            }
        }
    });

    return { stdout, stderr };
}

function disabledFeatureArgs(allowImageGeneration = false): string[] {
    return CODEX_DISABLED_FEATURES.filter(feature => !(allowImageGeneration && feature === 'image_generation')).flatMap(
        feature => ['--disable', feature]
    );
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
    const tempDir = await mkdtemp(path.join(tmpdir(), 'ensemble-codex-'));
    const imageWriter = new CodexImageAttachmentWriter(tempDir, cwd);
    const { instructions, prompt, images } = await buildCodexInput(messages, agent, imageWriter);
    const hasInstructions = instructions.trim().length > 0;
    const instructionsPath = path.join(tempDir, 'instructions.md');
    const lastMessagePath = path.join(tempDir, 'last-message.json');
    const schemaPath = settings?.json_schema?.schema ? path.join(tempDir, 'schema.json') : undefined;

    try {
        if (hasInstructions) {
            await writeFile(instructionsPath, instructions, 'utf8');
        }
        if (schemaPath) {
            await writeFile(schemaPath, JSON.stringify(settings!.json_schema!.schema, null, 2), 'utf8');
        }

        const commandArgs = [
            'exec',
            '--ephemeral',
            '--ignore-user-config',
            '--ignore-rules',
            '--skip-git-repo-check',
            ...disabledFeatureArgs(),
            '-m',
            codexModel,
            '-c',
            `model_reasoning_effort=${JSON.stringify(effort)}`,
            ...(hasInstructions ? ['-c', `model_instructions_file=${JSON.stringify(instructionsPath)}`] : []),
            ...(schemaPath ? ['--output-schema', schemaPath] : []),
            ...(images.length > 0 ? ['--image', images.join(',')] : []),
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
                images,
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

function buildCodexImagePrompt(prompt: string, opts: ImageGenerationOpts = {}): string {
    const count = opts.n && opts.n > 0 ? Math.floor(opts.n) : 1;
    const details = [
        '$imagegen',
        `Generate exactly ${count} image${count === 1 ? '' : 's'} for this request.`,
        'Actually invoke the image generation tool. Do not invent or predict file paths.',
        'After generation completes, return only the generated local image file path(s), one per line.',
        opts.source_images ? 'Use the attached image input(s) as reference material for the generation or edit.' : undefined,
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
        normalized.includes('no callable image generation tool')
        || (
            normalized.includes('cannot fulfill')
            && normalized.includes('image generation tool')
        )
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
                promptModelAttempt
                && hasCachedImagePromptModelCapabilityFailure(codexHome, promptModelAttempt.requested)
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
                    ...disabledFeatureArgs(true),
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

                await runCodexExec({
                    commandArgs,
                    cwd: outputDir,
                    env: {
                        ...process.env,
                        CODEX_HOME: isolatedCodexHome,
                    },
                    prompt: codexPrompt,
                    abortSignal: agent.abortSignal,
                });

                const rawLastMessage = await readFile(lastMessagePath, 'utf8');
                const responseImagePaths = await extractExistingCodexImagePaths(rawLastMessage, outputDir);
                const outputImagePaths = await newestFirst(await listCodexOutputImages(outputDir));
                const generatedImagePaths = await newestFirst(await listCodexGeneratedImages(isolatedCodexHome));
                const selectedImagePaths: string[] = [];
                for (const filePath of [...responseImagePaths, ...outputImagePaths, ...generatedImagePaths]) {
                    if (selectedImagePaths.includes(filePath)) continue;
                    selectedImagePaths.push(filePath);
                    if (selectedImagePaths.length >= expectedImageCount) break;
                }
                if (selectedImagePaths.length < expectedImageCount) {
                    const lastMessage = rawLastMessage.trim();
                    throw new Error(
                        `Codex image generation resolved ${selectedImagePaths.length} image artifact${
                            selectedImagePaths.length === 1 ? '' : 's'
                        }, expected ${expectedImageCount}.${
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
                    last_message: rawLastMessage.trim(),
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
