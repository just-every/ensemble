/**
 * Simplified message history management
 */

import {
    ResponseInput,
    ResponseInputItem,
    ResponseInputMessage,
    ResponseInputFunctionCallOutput,
    // type ToolCallResult,
} from '../types/types.js';

export interface MessageHistoryOptions {
    maxMessages?: number;
    maxTokens?: number;
    preserveSystemMessages?: boolean;
    compactToolCalls?: boolean;
    compactionThreshold?: number; // Percentage of context to trigger compaction (default 0.7)
}

// Extended message type with pinning support
export type PinnableMessage = ResponseInputItem & {
    pinned?: boolean;
};

// Structure for storing extracted information during compaction
export interface ExtractedInfo {
    entities: Set<string>;
    decisions: string[];
    todos: string[];
    tools: Array<{ name: string; purpose: string }>;
}

// Structure for micro-log entries
export interface MicroLogEntry {
    timestamp?: number;
    role: string;
    summary: string;
}

export class MessageHistory {
    private messages: PinnableMessage[];
    private options: MessageHistoryOptions;
    private estimatedTokens: number = 0;
    private microLog: MicroLogEntry[] = [];
    private extractedInfo: ExtractedInfo = {
        entities: new Set(),
        decisions: [],
        todos: [],
        tools: [],
    };

    constructor(initialMessages: ResponseInput = [], options: MessageHistoryOptions = {}) {
        this.messages = initialMessages.map(msg => ({ ...msg }) as PinnableMessage);
        this.options = {
            maxMessages: options.maxMessages,
            maxTokens: options.maxTokens,
            preserveSystemMessages: options.preserveSystemMessages ?? true,
            compactToolCalls: options.compactToolCalls ?? true,
            compactionThreshold: options.compactionThreshold ?? 0.7,
        };

        // Pin the first system message by default
        const firstSystemMsg = this.messages.find(m => m.type === 'message' && m.role === 'system');
        if (firstSystemMsg) {
            (firstSystemMsg as PinnableMessage).pinned = true;
        }

        this.updateTokenEstimate();
    }

    /**
     * Add a message to history
     */
    async add(message: ResponseInputItem | PinnableMessage): Promise<void> {
        const pinnableMsg = message as PinnableMessage;
        this.messages.push(pinnableMsg);

        // Add to micro-log
        this.addToMicroLog(pinnableMsg);

        // Extract information from message
        this.extractInformation(pinnableMsg);

        this.updateTokenEstimate();
        this.trim();
    }

    /**
     * Add an assistant message with optional tool calls
     */
    /*async addAssistantResponse(
        content: string,
        toolCallResults?: ToolCallResult[]
    ): Promise<void> {
        // Always add assistant message (even if empty) when there are tool calls
        if (content || toolCallResults?.length) {
            await this.add({
                type: 'message',
                role: 'assistant',
                content: content || '',
                status: 'completed',
            });
        }

        // Add tool calls and their results
        if (toolCallResults) {
            for (const toolCallResult of toolCallResults) {
                const toolCall = toolCallResult.toolCall;
                await this.add({
                    type: 'function_call',
                    id: toolCall.id,
                    call_id: toolCall.call_id || toolCall.id,
                    name: toolCall.function.name,
                    arguments: toolCall.function.arguments,
                });

                await this.add({
                    type: 'function_call_output',
                    id: toolCall.id,
                    call_id: toolCall.call_id || toolCall.id,
                    name: toolCall.function.name,
                    output: toolCallResult.output,
                });
            }
        }
    }*/

    /**
     * Get current messages
     */
    async getMessages(model?: string): Promise<ResponseInput> {
        await this.checkAndCompact(model);
        // Ensure proper tool result sequencing before returning messages
        this.ensureToolResultSequence();
        return [...this.messages];
    }

    /**
     * Pin a message to prevent it from being compacted
     */
    pinMessage(index: number): void {
        if (index >= 0 && index < this.messages.length) {
            this.messages[index].pinned = true;
        }
    }

    /**
     * Get the micro-log of the conversation
     */
    getMicroLog(): MicroLogEntry[] {
        return [...this.microLog];
    }

    /**
     * Get extracted information
     */
    getExtractedInfo(): ExtractedInfo {
        return {
            entities: new Set(this.extractedInfo.entities),
            decisions: [...this.extractedInfo.decisions],
            todos: [...this.extractedInfo.todos],
            tools: [...this.extractedInfo.tools],
        };
    }

    /**
     * Add entry to micro-log
     */
    private addToMicroLog(msg: PinnableMessage): void {
        if (msg.type === 'message') {
            const content = this.getMessageContent(msg);
            const summary = this.createMicroLogSummary(msg.role, content);
            this.microLog.push({
                timestamp: msg.timestamp || Date.now(),
                role: msg.role,
                summary,
            });
        } else if (msg.type === 'function_call') {
            this.microLog.push({
                timestamp: msg.timestamp || Date.now(),
                role: 'tool',
                summary: `Called ${msg.name}()`,
            });
        }
    }

    /**
     * Create a one-line summary for micro-log
     */
    private createMicroLogSummary(role: string, content: string): string {
        // Extract first meaningful line or truncate
        const firstLine = content.split('\n')[0].trim();
        const maxLength = 80;

        if (firstLine.length <= maxLength) {
            return firstLine;
        }

        return firstLine.substring(0, maxLength - 3) + '...';
    }

    /**
     * Extract key information from messages
     */
    private extractInformation(msg: PinnableMessage): void {
        if (msg.type === 'message') {
            const content = this.getMessageContent(msg);

            // Extract entities (names, URLs, file paths, etc.)
            this.extractEntities(content);

            // Extract decisions and todos
            if (msg.role === 'assistant') {
                this.extractDecisions(content);
                this.extractTodos(content);
            }
        } else if (msg.type === 'function_call') {
            // Track tool usage
            const existingTool = this.extractedInfo.tools.find(t => t.name === msg.name);
            if (!existingTool) {
                this.extractedInfo.tools.push({
                    name: msg.name,
                    purpose: this.inferToolPurpose(msg.name, msg.arguments),
                });
            }
        }
    }

    /**
     * Extract entities from content
     */
    private extractEntities(content: string): void {
        // Extract file paths
        const filePathRegex = /(?:\/[\w.-]+)+(?:\.\w+)?/g;
        const filePaths = content.match(filePathRegex) || [];
        filePaths.forEach(path => this.extractedInfo.entities.add(path));

        // Extract URLs
        const urlRegex = /https?:\/\/[^\s]+/g;
        const urls = content.match(urlRegex) || [];
        urls.forEach(url => this.extractedInfo.entities.add(url));

        // Extract quoted strings (potential important terms)
        const quotedRegex = /["']([^"']+)["']/g;
        let match;
        while ((match = quotedRegex.exec(content)) !== null) {
            if (match[1].length > 3 && match[1].length < 50) {
                this.extractedInfo.entities.add(match[1]);
            }
        }
    }

    /**
     * Extract decisions from assistant messages
     */
    private extractDecisions(content: string): void {
        const decisionPatterns = [
            /I (?:will|'ll|am going to) ([^.!?]+)[.!?]/gi,
            /(?:Decided|Choosing|Selected) to ([^.!?]+)[.!?]/gi,
            /The (?:solution|approach|strategy) is to ([^.!?]+)[.!?]/gi,
        ];

        for (const pattern of decisionPatterns) {
            pattern.lastIndex = 0; // Reset regex state
            let match;
            while ((match = pattern.exec(content)) !== null) {
                const decision = match[1].trim();
                if (decision.length > 10 && decision.length < 200) {
                    this.extractedInfo.decisions.push(decision);
                }
            }
        }
    }

    /**
     * Extract todos from content
     */
    private extractTodos(content: string): void {
        const todoPatterns = [
            /(?:TODO|FIXME|NOTE):\s*([^.!?\n]+)/g,
            /(?:Need to|Should|Must) ([^.!?]+)[.!?]/g,
            /(?:Next step|Then).*?(?:is to|will be) ([^.!?]+)[.!?]/g,
        ];

        for (const pattern of todoPatterns) {
            let match;
            while ((match = pattern.exec(content)) !== null) {
                const todo = match[1].trim();
                if (todo.length > 10 && todo.length < 200) {
                    this.extractedInfo.todos.push(todo);
                }
            }
        }
    }

    /**
     * Infer the purpose of a tool based on its name and arguments
     */
    private inferToolPurpose(toolName: string, args: string): string {
        try {
            JSON.parse(args); // Validate JSON

            // Common patterns
            if (toolName.includes('read') || toolName.includes('get')) {
                return 'Information retrieval';
            } else if (toolName.includes('write') || toolName.includes('create')) {
                return 'Content creation';
            } else if (toolName.includes('search') || toolName.includes('find')) {
                return 'Search operation';
            } else if (toolName.includes('execute') || toolName.includes('run')) {
                return 'Code execution';
            }

            return 'General operation';
        } catch {
            return 'General operation';
        }
    }

    /**
     * Get message content as string
     */
    private getMessageContent(msg: ResponseInputItem): string {
        if (msg.type === 'message' && 'content' in msg) {
            if (typeof msg.content === 'string') {
                return msg.content;
            } else if (Array.isArray(msg.content)) {
                return msg.content.map(item => ('text' in item ? item.text : '')).join(' ');
            }
        }
        return '';
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
                while (
                    i < this.messages.length &&
                    (this.messages[i].type === 'function_call' || this.messages[i].type === 'function_call_output')
                ) {
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
            toolOutputs: 0,
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

    /**
     * Estimate token count for a message
     * Simple estimation: ~4 characters per token
     */
    private estimateMessageTokens(msg: ResponseInputItem): number {
        let charCount = 0;

        if (msg.type === 'message' && 'content' in msg) {
            if (typeof msg.content === 'string') {
                charCount += msg.content.length;
            } else if (Array.isArray(msg.content)) {
                // Handle array content
                for (const item of msg.content) {
                    if ('text' in item) {
                        charCount += item.text.length;
                    }
                }
            }
        } else if (msg.type === 'function_call') {
            charCount += msg.name.length + msg.arguments.length;
        } else if (msg.type === 'function_call_output') {
            charCount += msg.output.length;
        }

        // Rough estimation: 4 characters per token
        return Math.ceil(charCount / 4);
    }

    /**
     * Update the estimated token count
     */
    private updateTokenEstimate(): void {
        this.estimatedTokens = 0;
        for (const msg of this.messages) {
            this.estimatedTokens += this.estimateMessageTokens(msg);
        }
    }

    /**
     * Check if automatic compaction is needed based on model context
     */
    private async checkAndCompact(modelId?: string): Promise<void> {
        if (!modelId || this.options.compactionThreshold === 0) {
            return;
        }

        // Get model context length
        const { findModel } = await import('../data/model_data.js');
        const model = findModel(modelId);

        if (!model || !model.features?.context_length) {
            return;
        }

        const contextLength = model.features.context_length;
        const threshold = contextLength * this.options.compactionThreshold;

        // Check if we're approaching the threshold
        if (this.estimatedTokens > threshold) {
            await this.performCompaction(contextLength);
        }
    }

    /**
     * Perform automatic compaction using hybrid approach
     */
    private async performCompaction(contextLength: number): Promise<void> {
        await this.compactHistoryHybrid(contextLength);
    }

    /**
     * New hybrid compaction approach
     */
    private async compactHistoryHybrid(contextLength: number): Promise<void> {
        // 1. Separate pinned and unpinned messages
        const pinnedMessages = this.messages.filter(m => m.pinned);
        const unpinnedMessages = this.messages.filter(m => !m.pinned);

        if (unpinnedMessages.length < 4) {
            // Not enough messages to compact
            return;
        }

        // 2. Calculate token budget
        const targetTokens = contextLength * 0.7; // Target 70% usage after compaction
        let currentTokens = 0;

        // Account for pinned messages
        for (const msg of pinnedMessages) {
            currentTokens += this.estimateMessageTokens(msg);
        }

        // 3. Determine recent tail size (30% of remaining budget)
        const remainingBudget = targetTokens - currentTokens;
        const tailBudget = remainingBudget * 0.3;
        let tailTokens = 0;
        let tailStartIndex = unpinnedMessages.length;

        // Work backwards to find tail messages
        for (let i = unpinnedMessages.length - 1; i >= 0; i--) {
            const msgTokens = this.estimateMessageTokens(unpinnedMessages[i]);
            if (tailTokens + msgTokens > tailBudget) {
                tailStartIndex = i + 1;
                break;
            }
            tailTokens += msgTokens;
        }

        // Ensure we keep at least 2 recent messages
        tailStartIndex = Math.max(0, Math.min(tailStartIndex, unpinnedMessages.length - 2));

        const messagesToCompact = unpinnedMessages.slice(0, tailStartIndex);
        const tailMessages = unpinnedMessages.slice(tailStartIndex);

        if (messagesToCompact.length === 0) {
            return;
        }

        // 4. Create hybrid summary
        const hybridSummary = await this.createHybridSummary(messagesToCompact);

        // 5. Create summary message
        const summaryMessage: PinnableMessage = {
            type: 'message',
            role: 'system',
            content: hybridSummary,
            pinned: false,
        };

        // 6. Reconstruct message history
        this.messages = [...pinnedMessages, summaryMessage, ...tailMessages];

        // 7. Update micro-log to only include recent entries
        const recentTimestamp = tailMessages[0]?.timestamp || Date.now() - 3600000;
        this.microLog = this.microLog.filter(entry => (entry.timestamp || 0) >= recentTimestamp);

        this.updateTokenEstimate();

        console.log(
            `MessageHistory: Compacted ${messagesToCompact.length} messages using hybrid approach. New token estimate: ${this.estimatedTokens}`
        );
    }

    /**
     * Create a hybrid summary combining micro-log and structured info
     */
    private async createHybridSummary(messages: PinnableMessage[]): Promise<string> {
        const sections: string[] = [];

        // 1. Chronological micro-log section
        const microLogText = this.createMicroLogSection(messages);
        if (microLogText) {
            sections.push(`## Conversation Flow\n${microLogText}`);
        }

        // 2. Structured information section
        const structuredInfo = this.createStructuredInfoSection();
        if (structuredInfo) {
            sections.push(`## Key Information\n${structuredInfo}`);
        }

        // 3. If we have detailed content, use AI to create additional summary
        const detailedSummary = await this.createDetailedSummary(messages);
        if (detailedSummary) {
            sections.push(`## Detailed Summary\n${detailedSummary}`);
        }

        return `[Previous Conversation Summary]\n\n${sections.join('\n\n')}`;
    }

    /**
     * Create micro-log section for summary
     */
    private createMicroLogSection(messages: PinnableMessage[]): string {
        // Get timestamps from messages to filter micro-log
        const startTime = messages[0]?.timestamp || 0;
        const endTime = messages[messages.length - 1]?.timestamp || Date.now();

        const relevantLogs = this.microLog.filter(entry => {
            const timestamp = entry.timestamp || 0;
            return timestamp >= startTime && timestamp <= endTime;
        });

        if (relevantLogs.length === 0) {
            return '';
        }

        return relevantLogs.map(entry => `- ${entry.role}: ${entry.summary}`).join('\n');
    }

    /**
     * Create structured information section
     */
    private createStructuredInfoSection(): string {
        const parts: string[] = [];

        // Entities
        if (this.extractedInfo.entities.size > 0) {
            const entities = Array.from(this.extractedInfo.entities).slice(-20); // Keep last 20
            parts.push(`### Entities\n${entities.map(e => `- ${e}`).join('\n')}`);
        }

        // Recent decisions
        if (this.extractedInfo.decisions.length > 0) {
            const decisions = this.extractedInfo.decisions.slice(-10); // Keep last 10
            parts.push(`### Decisions\n${decisions.map(d => `- ${d}`).join('\n')}`);
        }

        // Pending todos
        if (this.extractedInfo.todos.length > 0) {
            const todos = this.extractedInfo.todos.slice(-10); // Keep last 10
            parts.push(`### Pending Tasks\n${todos.map(t => `- ${t}`).join('\n')}`);
        }

        // Tools used
        if (this.extractedInfo.tools.length > 0) {
            parts.push(`### Tools Used\n${this.extractedInfo.tools.map(t => `- ${t.name}: ${t.purpose}`).join('\n')}`);
        }

        return parts.join('\n\n');
    }

    /**
     * Create detailed summary using AI
     */
    private async createDetailedSummary(messages: PinnableMessage[]): Promise<string> {
        // Create a condensed representation for AI summarization
        let conversationText = '';
        let tokenCount = 0;
        const maxTokensForSummary = 2000; // Limit input to AI

        for (const msg of messages) {
            if (msg.type === 'message') {
                const content = this.getMessageContent(msg);
                const preview = content.substring(0, 500);
                const msgText = `${msg.role.toUpperCase()}: ${preview}${content.length > 500 ? '...' : ''}\n\n`;
                const msgTokens = this.estimateTextTokens(msgText);

                if (tokenCount + msgTokens > maxTokensForSummary) {
                    break;
                }

                conversationText += msgText;
                tokenCount += msgTokens;
            } else if (msg.type === 'function_call') {
                const msgText = `TOOL: ${msg.name}()\n`;
                conversationText += msgText;
                tokenCount += this.estimateTextTokens(msgText);
            }
        }

        if (!conversationText.trim()) {
            return '';
        }

        try {
            const { createSummary } = await import('./tool_result_processor.js');
            const summaryPrompt = `Create a concise summary of this conversation, focusing on:
1. Main objectives and goals
2. Key decisions and outcomes
3. Current status and context
4. Any unresolved issues or next steps

Keep the summary focused and relevant for continuing the conversation.`;

            return await createSummary(conversationText, summaryPrompt);
        } catch (error) {
            console.error('Error creating AI summary:', error);
            return '';
        }
    }

    /**
     * Estimate tokens for a text string
     */
    private estimateTextTokens(text: string): number {
        // Simple estimation: ~4 characters per token
        return Math.ceil(text.length / 4);
    }

    /**
     * Ensures proper message sequencing where tool results immediately follow tool calls.
     * This fixes the issue where assistant text messages can be inserted between
     * tool_use blocks and their corresponding tool_result blocks.
     */
    public ensureToolResultSequence(): void {
        const reorderedMessages: PinnableMessage[] = [];
        let i = 0;

        while (i < this.messages.length) {
            const currentMsg = this.messages[i];

            if (currentMsg.type === 'function_call') {
                // Add the function call
                reorderedMessages.push(currentMsg);

                // Look for the corresponding function_call_output
                const callId = currentMsg.call_id;
                let foundOutput = false;

                // Search for the output in the remaining messages
                for (let j = i + 1; j < this.messages.length; j++) {
                    const potentialOutput = this.messages[j];
                    if (potentialOutput.type === 'function_call_output' && potentialOutput.call_id === callId) {
                        // Found the output, add it immediately after the call
                        reorderedMessages.push(potentialOutput);
                        // Remove the output from its original position
                        this.messages.splice(j, 1);
                        foundOutput = true;
                        break;
                    }
                }

                if (!foundOutput) {
                    // No matching output found, create an error output
                    console.warn(
                        `[MessageHistory] No matching output found for tool call ${callId}. Creating error output.`
                    );
                    const errorOutput: ResponseInputFunctionCallOutput = {
                        type: 'function_call_output',
                        call_id: callId,
                        name: currentMsg.name,
                        output: JSON.stringify({
                            error: 'Tool call did not complete or output was missing.',
                        }),
                        status: 'incomplete',
                        model: currentMsg.model,
                    };
                    reorderedMessages.push(errorOutput);
                }

                i++;
            } else if (currentMsg.type === 'function_call_output') {
                // Check if this is an orphaned output (no preceding function_call)
                const callId = currentMsg.call_id;
                let hasMatchingCall = false;

                // Check if we already processed its matching call
                for (let j = reorderedMessages.length - 1; j >= 0; j--) {
                    const msg = reorderedMessages[j];
                    if (msg.type === 'function_call' && msg.call_id === callId) {
                        hasMatchingCall = true;
                        break;
                    }
                }

                if (!hasMatchingCall) {
                    // This is an orphaned output, convert to regular message
                    console.warn(
                        `[MessageHistory] Found orphaned function_call_output with call_id ${callId}. Converting to regular message.`
                    );
                    const regularMessage: ResponseInputMessage = {
                        type: 'message',
                        role: 'user',
                        content: `Tool result (${currentMsg.name || 'unknown_tool'}): ${currentMsg.output}`,
                        status: 'completed',
                        model: currentMsg.model,
                    };
                    reorderedMessages.push(regularMessage);
                }
                // If it has a matching call, it was already added, so skip it
                i++;
            } else {
                // Regular message, just add it
                reorderedMessages.push(currentMsg);
                i++;
            }
        }

        // Replace messages with reordered array
        this.messages = reorderedMessages;
    }
}
