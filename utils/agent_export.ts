/**
 * Agent export utilities to avoid circular dependencies
 */

import { AgentExportDefinition } from '../types/types.js';

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
