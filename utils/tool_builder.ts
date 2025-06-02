/**
 * Simplified tool building utilities
 */

import { EnhancedToolFunction } from '../types/tool_types.js';
import { ToolFunction } from '../types.js';

export interface ToolBuilderOptions {
    name: string;
    description?: string;
    category?: string;
    priority?: number;
    maxExecutions?: number;
    cooldown?: number;
    sideEffects?: boolean;
}

/**
 * Fluent tool builder for easier tool creation
 */
export class ToolBuilder {
    private options: ToolBuilderOptions;
    private parameters: Record<string, any> = {};
    private requiredParams: string[] = [];
    private implementation?: (...args: any[]) => any;
    
    constructor(name: string) {
        this.options = { name };
    }
    
    /**
     * Set tool description
     */
    description(desc: string): this {
        this.options.description = desc;
        return this;
    }
    
    /**
     * Set tool category
     */
    category(cat: string): this {
        this.options.category = cat;
        return this;
    }
    
    /**
     * Add a parameter
     */
    param(name: string, schema: any, required = false): this {
        this.parameters[name] = schema;
        if (required) {
            this.requiredParams.push(name);
        }
        return this;
    }
    
    /**
     * Add a string parameter
     */
    string(name: string, description?: string, required = true): this {
        return this.param(name, { 
            type: 'string', 
            description 
        }, required);
    }
    
    /**
     * Add a number parameter
     */
    number(name: string, description?: string, required = true): this {
        return this.param(name, { 
            type: 'number', 
            description 
        }, required);
    }
    
    /**
     * Add a boolean parameter
     */
    boolean(name: string, description?: string, required = true): this {
        return this.param(name, { 
            type: 'boolean', 
            description 
        }, required);
    }
    
    /**
     * Add an array parameter
     */
    array(name: string, itemType: string, description?: string, required = true): this {
        return this.param(name, { 
            type: 'array',
            items: { type: itemType },
            description 
        }, required);
    }
    
    /**
     * Add an object parameter
     */
    object(name: string, properties: Record<string, any>, description?: string, required = true): this {
        return this.param(name, { 
            type: 'object',
            properties,
            description 
        }, required);
    }
    
    /**
     * Add an enum parameter
     */
    enum(name: string, values: string[], description?: string, required = true): this {
        return this.param(name, { 
            type: 'string',
            enum: values,
            description 
        }, required);
    }
    
    /**
     * Set execution constraints
     */
    constraints(opts: {
        maxExecutions?: number;
        cooldown?: number;
        priority?: number;
    }): this {
        Object.assign(this.options, opts);
        return this;
    }
    
    /**
     * Mark tool as having side effects
     */
    hasSideEffects(): this {
        this.options.sideEffects = true;
        return this;
    }
    
    /**
     * Set the implementation
     */
    implement(fn: (...args: any[]) => any): this {
        this.implementation = fn;
        return this;
    }
    
    /**
     * Build the tool
     */
    build(): EnhancedToolFunction {
        if (!this.implementation) {
            throw new Error(`Tool ${this.options.name} has no implementation`);
        }
        
        // Create tool definition directly
        const baseTool: ToolFunction = {
            function: this.implementation,
            definition: {
                type: 'function',
                function: {
                    name: this.options.name,
                    description: this.options.description || `Tool for ${this.options.name}`,
                    parameters: {
                        type: 'object',
                        properties: this.parameters,
                        required: this.requiredParams
                    }
                }
            }
        };
        
        // Add enhanced properties
        const enhancedTool: EnhancedToolFunction = {
            ...baseTool,
            category: this.options.category,
            priority: this.options.priority,
            maxExecutions: this.options.maxExecutions,
            cooldown: this.options.cooldown,
            sideEffects: this.options.sideEffects
        };
        
        return enhancedTool;
    }
}

/**
 * Helper function to create a tool
 */
export function tool(name: string): ToolBuilder {
    return new ToolBuilder(name);
}

/**
 * Create a set of common control tools
 */
export function createControlTools(handlers: {
    onComplete?: (result: any) => void;
    onError?: (error: any) => void;
    onClarification?: (question: string, options?: string[]) => void;
}): EnhancedToolFunction[] {
    const tools: EnhancedToolFunction[] = [];
    
    // Task complete tool
    tools.push(
        tool('task_complete')
            .description('Mark the current task as complete')
            .category('control')
            .constraints({ priority: 1 })
            .hasSideEffects()
            .string('result', 'The task result')
            .number('confidence', 'Confidence score 0-1', false)
            .implement(async ({ result, confidence }: any) => {
                if (handlers.onComplete) {
                    handlers.onComplete({ result, confidence });
                }
                return `Task completed: ${result}`;
            })
            .build()
    );
    
    // Error reporting tool
    tools.push(
        tool('report_error')
            .description('Report an error that prevents task completion')
            .category('control')
            .constraints({ priority: 1 })
            .hasSideEffects()
            .string('error', 'Error description')
            .string('context', 'Error context', false)
            .implement(async ({ error, context }: any) => {
                if (handlers.onError) {
                    handlers.onError({ error, context });
                }
                return `Error reported: ${error}`;
            })
            .build()
    );
    
    // Clarification tool
    if (handlers.onClarification) {
        tools.push(
            tool('request_clarification')
                .description('Request clarification from the user')
                .category('control')
                .constraints({ priority: 2 })
                .string('question', 'Clarification question')
                .array('options', 'string', 'Suggested options', false)
                .implement(async ({ question, options }: any) => {
                    handlers.onClarification(question, options);
                    return 'Clarification requested';
                })
                .build()
        );
    }
    
    return tools;
}

/**
 * Create a batch of similar tools
 */
export function createToolBatch<T>(
    baseConfig: {
        category?: string;
        priority?: number;
        prefix?: string;
    },
    tools: Array<{
        name: string;
        description: string;
        params?: Record<string, any>;
        implement: (args: T) => Promise<any>;
    }>
): EnhancedToolFunction[] {
    return tools.map(toolConfig => {
        const builder = tool(
            baseConfig.prefix ? `${baseConfig.prefix}_${toolConfig.name}` : toolConfig.name
        )
            .description(toolConfig.description)
            .category(baseConfig.category || 'utility')
            .constraints({ priority: baseConfig.priority });
        
        // Add parameters
        if (toolConfig.params) {
            Object.entries(toolConfig.params).forEach(([name, schema]) => {
                builder.param(name, schema, true);
            });
        }
        
        return builder.implement(toolConfig.implement).build();
    });
}