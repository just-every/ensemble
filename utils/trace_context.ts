import { randomUUID } from 'crypto';
import { AgentDefinition } from '../types/types.js';
import { emitTraceEvent } from './trace_logger.js';

type TurnStatus = 'completed' | 'error';

/**
 * Shared trace context for top-level ensemble operations.
 * This keeps turn/request lifecycle emission consistent across chat, image, and other request types.
 */
export class TraceContext {
    readonly turnId: string;
    private requestCount = 0;
    private requestNumbers = new Map<string, number>();

    constructor(
        private readonly agent: AgentDefinition,
        private readonly operation: string,
        turnId?: string
    ) {
        this.turnId = turnId || randomUUID();
    }

    async emitTurnStart(data?: Record<string, unknown>): Promise<void> {
        await emitTraceEvent({
            type: 'turn_start',
            turn_id: this.turnId,
            data: {
                operation: this.operation,
                agent_id: this.agent.agent_id,
                name: this.agent.name,
                model: this.agent.model,
                model_class: this.agent.modelClass,
                ...data,
            },
        });
    }

    async emitRequestStart(requestId: string, data?: Record<string, unknown>): Promise<number> {
        this.requestCount += 1;
        this.requestNumbers.set(requestId, this.requestCount);

        await emitTraceEvent({
            type: 'request_start',
            turn_id: this.turnId,
            request_id: requestId,
            data: {
                request_number: this.requestCount,
                ...data,
            },
        });

        return this.requestCount;
    }

    async emitToolStart(requestId: string | undefined, toolCallId: string | undefined, data?: Record<string, unknown>) {
        await emitTraceEvent({
            type: 'tool_start',
            turn_id: this.turnId,
            request_id: requestId,
            tool_call_id: toolCallId,
            data,
        });
    }

    async emitToolDone(requestId: string | undefined, toolCallId: string | undefined, data?: Record<string, unknown>) {
        await emitTraceEvent({
            type: 'tool_done',
            turn_id: this.turnId,
            request_id: requestId,
            tool_call_id: toolCallId,
            data,
        });
    }

    async emitRequestEnd(requestId: string | undefined, data?: Record<string, unknown>): Promise<void> {
        const requestNumber = requestId ? this.requestNumbers.get(requestId) : undefined;
        await emitTraceEvent({
            type: 'request_end',
            turn_id: this.turnId,
            request_id: requestId,
            data: {
                request_number: requestNumber,
                ...data,
            },
        });
    }

    async emitTurnEnd(status: TurnStatus, reason: string, data?: Record<string, unknown>): Promise<void> {
        await emitTraceEvent({
            type: 'turn_end',
            turn_id: this.turnId,
            data: {
                status,
                reason,
                request_count: this.requestCount,
                ...data,
            },
        });
    }

    getRequestCount(): number {
        return this.requestCount;
    }
}

export function createTraceContext(agent: AgentDefinition, operation: string, turnId?: string): TraceContext {
    return new TraceContext(agent, operation, turnId);
}
