/**
 * Agent framework for the MAGI system.
 *
 * This module defines the Agent class
 */

import {
    ToolCall,
    ResponseInput,
    ResponseThinkingMessage,
    ResponseOutputMessage,
    ModelSettings,
    ToolFunction,
    ResponseJSONSchema,
    ModelClassID,
    AgentDefinition,
    AgentExportDefinition,
    WorkerFunction,
    ToolParameterMap,
    ProviderStreamEvent,
    type ToolCallResult,
} from '../types/types.js';

import { createToolFunction, ensembleRequest } from '../index.js';

import { v4 as uuid } from 'uuid';
// Import removed to fix lint error

// Per-agent cache of custom tools
// Keys are agent_ids, values are arrays of custom tool functions
export const agentToolCache = new Map<string, ToolFunction[]>();

export function exportAgent(agent: any, model?: string): AgentExportDefinition {
    const agentExport =
        typeof agent.export === 'function'
            ? agent.export()
            : {
                  agent_id: agent.agent_id,
                  name: agent.name,
                  model: agent.model,
                  modelClass: agent.modelClass,
                  parent_id: agent.parent_id,
                  cwd: agent.cwd,
              };

    if (model) agentExport.model = model;
    return agentExport;
}

/**
 * Get agent-specific tools for a particular agent
 *
 * @param agent_id The ID of the agent to get tools for
 * @returns Array of tool functions specific to this agent
 */
export function getAgentSpecificTools(agent_id: string): ToolFunction[] {
    const tools: ToolFunction[] = [];

    // Add modify_tool only if this agent has custom tools
    /*
    if (
        agentToolCache.has(agent_id) &&
        agentToolCache.get(agent_id)!.length > 0
    ) {
        tools.push(
            createToolFunction(
                modify_tool,
                'Modify an existing custom tool. This will create a new version of the tool with the changes.',
                {
                    name: {
                        type: 'string',
                        description: 'The name of the existing tool to modify.',
                    },
                    modification_request: {
                        type: 'string',
                        description:
                            'Description of the changes to make to the tool.',
                    },
                },
                'The modified tool with the requested changes.'
            )
        );
    }
    */

    // Add any cached tools for this agent
    if (agentToolCache.has(agent_id)) {
        tools.push(...agentToolCache.get(agent_id)!);
    }

    return tools;
}

/**
 * Create a clone of an agent instance that properly handles functions
 * @param agent The agent to clone
 * @returns A new agent instance with copied properties and preserved function references
 */
export function cloneAgent(agent: Agent): AgentDefinition {
    // Create a new object with the same prototype
    const copy = Object.create(Object.getPrototypeOf(agent)) as Agent;

    // Copy own enumerable properties
    Object.entries(agent).forEach(([key, value]) => {
        // Keep original function references, don't try to duplicate them
        if (typeof value === 'function') {
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-ignore - we know the index type here
            copy[key] = value;
        } else if (key === 'parent' && value instanceof Agent) {
            // For parent, keep the reference intact to preserve prototype chain
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-ignore
            copy[key] = value;
        } else if (Array.isArray(value)) {
            // Shallow copy array (its elements can include functions - we keep refs)
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-ignore
            copy[key] = [...value];
        } else if (value && typeof value === 'object') {
            // Shallow copy object (deep copy is rarely needed for config objects)
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-ignore
            copy[key] = { ...value };
        } else {
            // Copy primitive
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-ignore
            copy[key] = value;
        }
    });

    return copy;
}

/**
 * Agent class representing an LLM agent with tools
 */
export class Agent implements AgentDefinition {
    agent_id?: string;
    name?: string;
    description?: string;
    instructions?: string;
    parent_id?: string;
    workers?: WorkerFunction[];
    tools?: ToolFunction[];
    model?: string;
    modelClass?: ModelClassID;
    modelSettings?: ModelSettings;
    intelligence?: 'low' | 'standard' | 'high'; // Used to select the model
    maxToolCalls?: number; // Maximum total number of tool calls allowed (default: 200)
    maxToolCallRoundsPerTurn?: number; // Maximum number of sequential tool call rounds per turn. Each round can have multiple parallel tool calls. Default: Infinity (no limit)
    verifier?: AgentDefinition;
    maxVerificationAttempts?: number;
    args?: any;
    jsonSchema?: ResponseJSONSchema; // JSON schema for structured output
    historyThread?: ResponseInput | undefined;
    cwd?: string; // Working directory for the agent (used by model providers that need a real shell)
    modelScores?: Record<string, number>; // Model-specific scores for weighted selection (0-100)
    disabledModels?: string[]; // Models to exclude from selection

    /** Optional callback for processing tool calls */
    onToolCall?: (toolCall: ToolCall) => Promise<void>;
    processToolCall?: (toolCalls: ToolCall[]) => Promise<Record<string, any>>;
    onToolResult?: (toolCallResult: ToolCallResult) => Promise<void>;
    onToolError?: (toolCallResult: ToolCallResult) => Promise<void>;
    onRequest?: (
        agent: AgentDefinition, // Reverted back to AgentInterface
        messages: ResponseInput
    ) => Promise<[any, ResponseInput]>; // Reverted back to AgentInterface
    onResponse?: (message: ResponseOutputMessage) => Promise<void>;
    onThinking?: (message: ResponseThinkingMessage) => Promise<void>;
    onEvent?: (event: ProviderStreamEvent) => void | Promise<void>;
    onToolEvent?: (event: ProviderStreamEvent) => void | Promise<void>;

    params?: ToolParameterMap; // Map of parameter names to their definitions
    processParams?: (
        agent: AgentDefinition,
        params: Record<string, any>
    ) => Promise<{
        prompt: string;
        intelligence?: 'low' | 'standard' | 'high';
    }>;

    constructor(definition: AgentDefinition) {
        // Validate that we received a proper AgentDefinition
        if (!definition || typeof definition !== 'object') {
            throw new Error(
                `Agent constructor expects an AgentDefinition object, but received: ${typeof definition}`
            );
        }

        this.agent_id = definition.agent_id || uuid();
        this.name = definition.name.replaceAll(' ', '_');
        this.description = definition.description;
        this.instructions = definition.instructions;
        this.tools = definition.tools || [];

        // Ensure agent-specific tools are attached once ID is assigned
        this.model = definition.model;
        this.modelClass = definition.modelClass;
        this.jsonSchema = definition.jsonSchema;
        this.params = definition.params;
        this.modelSettings = definition.modelSettings || {};
        this.maxToolCalls = definition.maxToolCalls ?? 200; // Default to 200 if not specified
        this.maxToolCallRoundsPerTurn = definition.maxToolCallRoundsPerTurn; // No default, undefined means no limit
        this.maxVerificationAttempts = definition.maxVerificationAttempts ?? 2;
        this.processParams = definition.processParams;
        this.historyThread = definition.historyThread;
        this.cwd = definition.cwd; // Working directory for model providers that need a real shell

        if (definition.verifier) {
            this.verifier = new Agent({
                ...definition.verifier,
                verifier: undefined,
            });
            this.verifier.parent_id = this.agent_id;
        }

        this.onToolCall = definition.onToolCall;
        this.onToolResult = definition.onToolResult;

        // Assert the type to match the class property
        this.onRequest = definition.onRequest as (
            agent: Agent,
            messages: ResponseInput
        ) => Promise<[Agent, ResponseInput]>;
        this.onThinking = definition.onThinking;
        this.onResponse = definition.onResponse;
        this.onEvent = definition.onEvent;
        this.onToolEvent = definition.onToolEvent;

        // Configure JSON formatting if schema is provided
        if (this.jsonSchema) {
            if (!this.modelSettings) this.modelSettings = {};
            this.modelSettings.json_schema = this.jsonSchema;
        }

        if (definition.workers) {
            this.workers = definition.workers.map(
                (createAgentFn: WorkerFunction): WorkerFunction => {
                    return () => {
                        // Call the function with no arguments or adjust based on what ExecutableFunction expects
                        const agent = createAgentFn() as Agent;
                        agent.parent_id = this.agent_id;
                        return agent;
                    };
                }
            );
            this.tools = this.tools.concat(
                this.workers.map((createAgentFn: WorkerFunction) => {
                    // Call the function with no arguments or adjust based on what ExecutableFunction expects
                    const agent = createAgentFn() as Agent;

                    // Set parent relationship and pass the parent's onEvent to the worker agent
                    agent.parent_id = this.agent_id;
                    if (this.onEvent) {
                        agent.onEvent = this.onEvent;
                    }

                    return agent.asTool();
                })
            );
        }
    }

    /**
     * Create a tool from this agent that can be used by other agents
     */
    asTool(): ToolFunction {
        let description = `An agent called ${this.name}.\n\n${this.description}`;
        if (this.tools) {
            description += `\n\n${this.name} has access to the following tools:\n`;
            this.tools.forEach(tool => {
                description += `- ${tool.definition.function.name}\n`;
            });
            description +=
                '\nUse this as a guide when to call the agent, but let the agent decide which tools to use.';
        }
        return createToolFunction(
            async (...args: any[]) => {
                // Create a copy of the agent for this particular tool run with a unique ID
                const agent = cloneAgent(this);
                agent.agent_id = uuid();

                // Set up parent relationship and event forwarding
                // 'this' refers to the worker agent, which already has parent_id set
                agent.parent_id = this.parent_id;

                // If the parent has an onEvent handler, pass it to the child
                if (this.onEvent) {
                    agent.onEvent = this.onEvent;
                }

                if (agent.processParams) {
                    let paramsObj: Record<string, any>;

                    // Handle single object argument vs positional arguments
                    if (
                        args.length === 1 &&
                        typeof args[0] === 'object' &&
                        args[0] !== null
                    ) {
                        // Already using named parameters
                        paramsObj = args[0] as Record<string, any>;
                    } else {
                        // Convert positional arguments to named parameters based on agent.params keys
                        paramsObj = {};
                        const paramKeys = Object.keys(agent.params || {});
                        paramKeys.forEach((key, idx) => {
                            if (idx < args.length) paramsObj[key] = args[idx];
                        });
                    }

                    const { prompt, intelligence } = await agent.processParams(
                        agent,
                        paramsObj
                    );
                    return runAgentTool(agent, prompt, intelligence);
                }

                // If we have standard positional arguments, convert them to a parameters object
                let task: string = typeof args[0] === 'string' ? args[0] : '';
                let context: string | undefined =
                    typeof args[1] === 'string' ? args[1] : undefined;
                let warnings: string | undefined =
                    typeof args[2] === 'string' ? args[2] : undefined;
                let goal: string | undefined =
                    typeof args[3] === 'string' ? args[3] : undefined;
                let intelligence: ('low' | 'standard' | 'high') | undefined =
                    args[4] as any;

                // If we have a single object argument with named parameters (from createToolFunction's validation),
                // extract the parameters
                if (
                    args.length === 1 &&
                    typeof args[0] === 'object' &&
                    args[0] !== null
                ) {
                    const params = args[0] as Record<string, any>;
                    task = params.task || task;
                    context = params.context || context;
                    warnings = params.warnings || warnings;
                    goal = params.goal || goal;
                    intelligence = params.intelligence || intelligence;
                }

                let prompt = `**Task:** ${task}`;
                if (context) {
                    prompt += `\n\n**Context:** ${context}`;
                }
                if (warnings) {
                    prompt += `\n\n**Warnings:** ${warnings}`;
                }
                if (goal) {
                    prompt += `\n\n**Goal:** ${goal}`;
                }

                // Standard parameter passing
                return runAgentTool(agent, prompt, intelligence);
            },
            description,
            this.params || {
                task: {
                    type: 'string',
                    description: `What should ${this.name} work on? Generally you should leave the way the task is performed up to the agent unless the agent previously failed. Agents are expected to work mostly autonomously.`,
                },
                context: {
                    type: 'string',
                    description: `What else might the ${this.name} need to know? Explain why you are asking for this - summarize the task you were given or the project you are working on. Please make it comprehensive. A couple of paragraphs is ideal.`,
                    optional: true,
                },
                warnings: {
                    type: 'string',
                    description: `Is there anything the ${this.name} should avoid or be aware of? You can leave this as a blank string if there's nothing obvious.`,
                    optional: true,
                },
                goal: {
                    type: 'string',
                    description: `This is the final goal/output or result you expect from the task. Try to focus on the overall goal and allow the ${this.name} to make it's own decisions on how to get there. One sentence is ideal.`,
                    optional: true,
                },
                intelligence: {
                    type: 'string',
                    description: `What level of intelligence do you recommend for this task?
					- low: (under 90 IQ) Mini model used.
					- standard: (90 - 110 IQ)
					- high: (110+ IQ) Reasoning used.`,
                    enum: ['low', 'standard', 'high'],
                    optional: true,
                },
            },
            undefined,
            this.name
        );
    }

    /**
     * Get the complete set of tools available to this agent
     * Combines statically assigned tools with tools from agentToolCache
     * Processes dynamic tool parameter values (descriptions and enums)
     */
    public async getTools(): Promise<ToolFunction[]> {
        const combinedTools = new Map<string, ToolFunction>();

        // 1. Add statically assigned tools (from this.tools) or common tools as a base
        const baseTools = this.tools && this.tools.length > 0 ? this.tools : [];
        for (const tool of baseTools) {
            if (
                tool &&
                tool.definition &&
                tool.definition.function &&
                tool.definition.function.name
            ) {
                // Clone the tool to avoid modifying the original
                const clonedTool = { ...tool };
                clonedTool.definition = { ...tool.definition };
                clonedTool.definition.function = {
                    ...tool.definition.function,
                };
                clonedTool.definition.function.parameters = {
                    ...tool.definition.function.parameters,
                };
                clonedTool.definition.function.parameters.properties = {
                    ...tool.definition.function.parameters.properties,
                };

                // Process dynamic properties in parameters
                await this.processDynamicToolParameters(clonedTool);

                combinedTools.set(
                    clonedTool.definition.function.name,
                    clonedTool
                );
            } else {
                console.warn(
                    '[Agent.getTools] Encountered a base tool with missing definition or name:',
                    tool
                );
            }
        }

        // 2. Add/override with tools from agentToolCache (via getAgentSpecificTools)
        if (this.agent_id) {
            const cachedAgentTools = getAgentSpecificTools(this.agent_id);
            for (const tool of cachedAgentTools) {
                if (
                    tool &&
                    tool.definition &&
                    tool.definition.function &&
                    tool.definition.function.name
                ) {
                    // Clone the tool to avoid modifying the original
                    const clonedTool = { ...tool };
                    clonedTool.definition = { ...tool.definition };
                    clonedTool.definition.function = {
                        ...tool.definition.function,
                    };
                    clonedTool.definition.function.parameters = {
                        ...tool.definition.function.parameters,
                    };
                    clonedTool.definition.function.parameters.properties = {
                        ...tool.definition.function.parameters.properties,
                    };

                    // Process dynamic properties in parameters
                    await this.processDynamicToolParameters(clonedTool);

                    combinedTools.set(
                        clonedTool.definition.function.name,
                        clonedTool
                    ); // Overwrites if name exists
                } else {
                    console.warn(
                        '[Agent.getTools] Encountered a cached tool with missing definition or name:',
                        tool
                    );
                }
            }
        }
        return Array.from(combinedTools.values());
    }

    /**
     * Process dynamic tool parameters (descriptions and enums)
     * @param tool The tool to process
     */
    private async processDynamicToolParameters(
        tool: ToolFunction
    ): Promise<void> {
        const properties = tool.definition.function.parameters.properties;

        for (const paramName in properties) {
            const param = properties[paramName];

            // Process dynamic description
            if (typeof param.description === 'function') {
                param.description = param.description();
            }

            // Process dynamic enum
            if (typeof param.enum === 'function') {
                param.enum = await param.enum();
            }

            // Handle nested parameters in objects
            if (param.properties) {
                for (const nestedParamName in param.properties) {
                    const nestedParam = param.properties[nestedParamName];

                    // Process nested dynamic description
                    if (typeof nestedParam.description === 'function') {
                        nestedParam.description = nestedParam.description();
                    }

                    // Process nested dynamic enum
                    if (typeof nestedParam.enum === 'function') {
                        nestedParam.enum = await nestedParam.enum();
                    }
                }
            }

            // Handle items for array types
            if (param.items) {
                const items = param.items as any;
                if (typeof items.description === 'function') {
                    items.description = items.description();
                }
                if (typeof items.enum === 'function') {
                    items.enum = await items.enum();
                }
            }
        }
    }

    export(): AgentExportDefinition {
        // Return a simplified representation of the agent
        const agentExport: AgentExportDefinition = {
            agent_id: this.agent_id,
            name: this.name,
        };
        if (this.model) {
            agentExport.model = this.model;
        }
        if (this.modelClass) {
            agentExport.modelClass = this.modelClass;
        }
        if (this.parent_id) {
            // Make sure parent is an Agent with an export method
            agentExport.parent_id = this.parent_id;
        }
        if (this.cwd) {
            agentExport.cwd = this.cwd;
        }
        return agentExport;
    }
}

/**
 * Run an agent and capture its response, emitting events through onEvent if available
 */
async function runAgentTool(
    agent: AgentDefinition,
    prompt: string,
    intelligence?: 'low' | 'standard' | 'high'
): Promise<string> {
    // Ensure these values are set to undefined if not provided
    agent.intelligence = intelligence || undefined;

    const modelClass = agent.modelClass || 'standard';
    switch (agent.intelligence) {
        case 'low':
            if (['standard'].includes(modelClass)) {
                agent.modelClass = 'mini';
            }
            if (['code', 'reasoning'].includes(modelClass)) {
                agent.modelClass = 'standard';
            }
            break;
        case 'standard':
            // No change needed?
            break;
        case 'high':
            if (['mini'].includes(modelClass)) {
                agent.modelClass = 'standard';
            }
            if (['standard'].includes(modelClass)) {
                agent.modelClass = 'reasoning';
            }
            break;
    }

    const messages: ResponseInput = [];
    messages.push({
        type: 'message',
        role: 'user',
        content: prompt,
    });

    try {
        const stream = ensembleRequest(messages, agent);
        let fullResponse = '';

        // Forward all events from the sub-agent
        for await (const event of stream) {
            if (agent.onToolEvent) {
                await agent.onToolEvent(event);
            }

            if (event.type === 'message_complete' && 'content' in event) {
                fullResponse = event.content;
            }
        }

        return fullResponse;
    } catch (error) {
        console.error(`Error in ${agent.name}: ${error}`);
        return `Error in ${agent.name}: ${error}`;
    }
}

/**
 * Helper function to safely get tools from an agent or agent definition
 * Handles both Agent instances (with getTools method) and plain AgentDefinition objects
 *
 * @param agent The agent or agent definition to get tools from
 * @returns Promise resolving to an array of tools
 */
export async function getToolsFromAgent(
    agent: AgentDefinition | Agent
): Promise<ToolFunction[]> {
    // Check if it's an Agent instance with getTools method
    if (agent && typeof (agent as Agent).getTools === 'function') {
        return await (agent as Agent).getTools();
    }

    // Otherwise, it's a plain AgentDefinition object
    // Return the tools array or empty array if not defined
    return agent?.tools || [];
}
