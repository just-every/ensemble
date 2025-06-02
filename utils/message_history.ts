/**
 * Simplified message history management
 */

import { ResponseInput } from '../types.js';

export interface MessageHistoryOptions {
    maxMessages?: number;
    maxTokens?: number;
    preserveSystemMessages?: boolean;
    compactToolCalls?: boolean;
}

export class MessageHistory {
    private messages: ResponseInput;
    private options: MessageHistoryOptions;
    
    constructor(initialMessages: ResponseInput = [], options: MessageHistoryOptions = {}) {
        this.messages = [...initialMessages];
        this.options = {
            maxMessages: options.maxMessages,
            maxTokens: options.maxTokens,
            preserveSystemMessages: options.preserveSystemMessages ?? true,
            compactToolCalls: options.compactToolCalls ?? true
        };
    }
    
    /**
     * Add a message to history
     */
    add(message: any): void {
        this.messages.push(message);
        this.trim();
    }
    
    /**
     * Add multiple messages
     */
    addMany(messages: any[]): void {
        this.messages.push(...messages);
        this.trim();
    }
    
    /**
     * Add an assistant message with optional tool calls
     */
    addAssistantResponse(content: string, toolCalls?: any[]): void {
        // Always add assistant message (even if empty) when there are tool calls
        if (content || toolCalls?.length) {
            this.add({
                type: 'message',
                role: 'assistant',
                content: content || '',
                status: 'completed'
            });
        }
        
        // Add tool calls and their results
        if (toolCalls) {
            for (const toolCall of toolCalls) {
                this.add({
                    type: 'function_call',
                    id: toolCall.id,
                    call_id: toolCall.call_id || toolCall.id,
                    name: toolCall.function.name,
                    arguments: toolCall.function.arguments
                });
                
                if (toolCall.result) {
                    this.add({
                        type: 'function_call_output',
                        id: toolCall.id,
                        call_id: toolCall.call_id || toolCall.id,
                        name: toolCall.function.name,
                        output: toolCall.result
                    });
                }
            }
        }
    }
    
    /**
     * Get current messages
     */
    getMessages(): ResponseInput {
        return [...this.messages];
    }
    
    /**
     * Get message count
     */
    count(): number {
        return this.messages.length;
    }
    
    /**
     * Clear history
     */
    clear(): void {
        const systemMessages = this.options.preserveSystemMessages 
            ? this.messages.filter(m => m.type === 'message' && m.role === 'system')
            : [];
        this.messages = systemMessages;
    }
    
    /**
     * Trim history based on options
     */
    private trim(): void {
        if (this.options.maxMessages && this.messages.length > this.options.maxMessages) {
            const systemMessages = this.options.preserveSystemMessages
                ? this.messages.filter(m => m.type === 'message' && m.role === 'system')
                : [];
            
            const nonSystemMessages = this.messages.filter(m => !(m.type === 'message' && m.role === 'system'));
            const trimmedMessages = nonSystemMessages.slice(-this.options.maxMessages);
            
            this.messages = [...systemMessages, ...trimmedMessages];
        }
        
        // Compact consecutive tool calls if enabled
        if (this.options.compactToolCalls) {
            this.compactToolCalls();
        }
    }
    
    /**
     * Compact consecutive tool calls from the same assistant turn
     */
    private compactToolCalls(): void {
        const compacted: ResponseInput = [];
        let i = 0;
        
        while (i < this.messages.length) {
            const msg = this.messages[i];
            
            // Look for assistant message followed by tool calls
            if (msg.type === 'message' && msg.role === 'assistant') {
                compacted.push(msg);
                i++;
                
                // Collect all following tool calls
                const toolCalls = [];
                while (i < this.messages.length && 
                       (this.messages[i].type === 'function_call' || 
                        this.messages[i].type === 'function_call_output')) {
                    toolCalls.push(this.messages[i]);
                    i++;
                }
                
                // Add tool calls
                compacted.push(...toolCalls);
            } else {
                compacted.push(msg);
                i++;
            }
        }
        
        this.messages = compacted;
    }
    
    /**
     * Get a summary of the history
     */
    getSummary(): string {
        const counts = {
            user: 0,
            assistant: 0,
            system: 0,
            toolCalls: 0,
            toolOutputs: 0
        };
        
        for (const msg of this.messages) {
            if (msg.type === 'message' && msg.role) {
                const role = msg.role as keyof typeof counts;
                if (role in counts) {
                    counts[role]++;
                }
            } else if (msg.type === 'function_call') {
                counts.toolCalls++;
            } else if (msg.type === 'function_call_output') {
                counts.toolOutputs++;
            }
        }
        
        return `Messages: ${this.messages.length} (User: ${counts.user}, Assistant: ${counts.assistant}, System: ${counts.system}, Tools: ${counts.toolCalls}/${counts.toolOutputs})`;
    }
    
    /**
     * Find the last message of a specific type/role
     */
    findLast(predicate: (msg: any) => boolean): any | undefined {
        for (let i = this.messages.length - 1; i >= 0; i--) {
            if (predicate(this.messages[i])) {
                return this.messages[i];
            }
        }
        return undefined;
    }
    
    /**
     * Check if the last assistant message had tool calls
     */
    lastAssistantHadToolCalls(): boolean {
        let foundAssistant = false;
        
        for (let i = this.messages.length - 1; i >= 0; i--) {
            const msg = this.messages[i];
            
            if (msg.type === 'function_call' && !foundAssistant) {
                // Found tool call, check if there's an assistant message before it
                for (let j = i - 1; j >= 0; j--) {
                    const msg = this.messages[j];
                    if (msg.type === 'message' && msg.role === 'assistant') {
                        return true;
                    }
                    if (msg.type === 'message' && msg.role === 'user') {
                        // Hit a user message, stop looking
                        break;
                    }
                }
            }
            
            if (msg.type === 'message' && msg.role === 'assistant') {
                foundAssistant = true;
            }
        }
        
        return false;
    }
}