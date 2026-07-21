import { randomUUID } from 'node:crypto';
import type { AgentDefinition, VideoGenerationOpts } from '../types/types.js';
import { getModelFromAgent, getModelProvider } from '../model_providers/model_provider.js';
import { createTraceContext } from '../utils/trace_context.js';

/** Generate video through a provider's native asynchronous video API. */
export async function ensembleVideo(
    prompt: string,
    agent: AgentDefinition,
    options: VideoGenerationOpts = {}
): Promise<string[]> {
    const trace = createTraceContext(agent, 'video_generation');
    const requestId = options.request_id ?? randomUUID();
    await trace.emitTurnStart({ prompt, options });
    let requestStarted = false;
    try {
        const model = await getModelFromAgent(agent, 'video_generation');
        const provider = getModelProvider(model);
        if (!provider.createVideo) throw new Error(`Provider for model ${model} does not support video generation`);
        await trace.emitRequestStart(requestId, {
            agent_id: agent.agent_id,
            provider: provider.provider_id,
            model,
            payload: { prompt, options },
        });
        requestStarted = true;
        const videos = await provider.createVideo(prompt, model, agent, { ...options, request_id: requestId });
        await trace.emitRequestEnd(requestId, { status: 'completed', video_count: videos.length });
        await trace.emitTurnEnd('completed', 'completed');
        return videos;
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (requestStarted) await trace.emitRequestEnd(requestId, { status: 'error', error: message });
        await trace.emitTurnEnd('error', 'exception', { error: message });
        throw error;
    }
}
