// Export all types
export * from './types/types.js';

// Export specific functions from model_providers to avoid conflicts
export {
    getModelProvider,
    getProviderFromModel,
    getModelFromAgent,
    getModelFromClass,
    isProviderKeyValid,
    ModelProvider, // This is the extended interface from model_provider.ts
} from './model_providers/model_provider.js';

// Export utility classes and types
export * from './utils/message_history.js';

// Export external model registration functions
export {
    registerExternalModel,
    getExternalModel,
    getExternalProvider,
    overrideModelClass,
} from './utils/external_models.js';

// Export all model data (excluding ModelClassID to avoid conflict)
export {
    MODEL_REGISTRY,
    MODEL_CLASSES,
    findModel,
    ModelProviderID,
    ModelUsage,
    TieredPrice,
    TimeBasedPrice,
    ModelEntry,
} from './data/model_data.js';

// Export all utils
export * from './utils/delta_buffer.js';
export * from './utils/cost_tracker.js';
export * from './utils/quota_tracker.js';
export * from './utils/image_utils.js';
export * from './utils/llm_logger.js';
export { createToolFunction } from './utils/create_tool_function.js';

// Export new tool execution utilities
export {
    runningToolTracker,
    RunningToolTracker,
    RunningTool,
    ToolCompletionEvent,
} from './utils/running_tool_tracker.js';
export {
    sequentialQueue,
    SequentialQueue,
    runSequential,
} from './utils/sequential_queue.js';
export {
    executeToolWithLifecycle,
    handleToolCall,
    timeoutPromise,
    agentHasStatusTracking,
    prepareToolArguments,
} from './utils/tool_execution_manager.js';
export {
    createSummary,
    processToolResult,
    shouldSummarizeResult,
    getTruncationMessage,
} from './utils/tool_result_processor.js';
export * from './config/tool_execution.js';

// Export verification utilities
export {
    verifyOutput,
    VerificationResult,
} from './utils/verification.js';

// Export mergeHistoryThread utility
export { mergeHistoryThread } from './core/ensemble_request.js';

// Export Agent class and utilities
export {
    Agent,
    cloneAgent,
    getAgentSpecificTools,
    agentToolCache,
} from './utils/agent.js';

// Re-export singleton instances
import { costTracker as _costTracker } from './utils/cost_tracker.js';
import { quotaTracker as _quotaTracker } from './utils/quota_tracker.js';
export const costTracker = _costTracker;
export const quotaTracker = _quotaTracker;

// Export core ensemble functions
export { ensembleRequest } from './core/ensemble_request.js';
export { ensembleEmbed } from './core/ensemble_embed.js';
export { ensembleImage } from './core/ensemble_image.js';
