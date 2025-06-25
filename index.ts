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
    isExternalModel,
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
export { AudioStreamPlayer } from './utils/audio_stream_player.js';

// Export pause controller
export {
    getPauseController,
    isPaused,
    pause,
    resume,
    waitWhilePaused,
    type PauseController,
} from './utils/pause_controller.js';

// Export event controller
export {
    getEventController,
    setEventHandler,
    emitEvent,
    hasEventHandler,
    type EventController,
    type EventHandler,
} from './utils/event_controller.js';

// Export image validation utilities
export { isValidBase64, detectImageType } from './utils/image_validation.js';

// Export citation tracking utilities
export {
    createCitationTracker,
    formatCitation,
    generateFootnotes,
    type CitationTracker,
    type Citation,
} from './utils/citation_tracker.js';

// Export error types
export {
    EnsembleError,
    ProviderError,
    ToolExecutionError,
    AbortError,
    PauseAbortError,
    QuotaExceededError,
    ModelNotFoundError,
    ConfigurationError,
} from './types/errors.js';

// Export new tool execution utilities
export {
    runningToolTracker,
    RunningToolTracker,
    RunningTool,
    ToolCompletionEvent,
} from './utils/running_tool_tracker.js';
export { sequentialQueue, SequentialQueue, runSequential } from './utils/sequential_queue.js';
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
    clearSummaryCache,
    getSummaryCacheStats,
} from './utils/tool_result_processor.js';

// Export summary utilities for expandable summaries
export { getSummaryTools, hasExpansionTools, read_source, write_source } from './utils/summary_utils.js';
export * from './config/tool_execution.js';

// Export verification utilities
export { verifyOutput, VerificationResult } from './utils/verification.js';

// Export mergeHistoryThread utility
export { mergeHistoryThread } from './core/ensemble_request.js';

// Export Agent class and utilities
export { Agent, cloneAgent, getAgentSpecificTools, agentToolCache } from './utils/agent.js';

// Export model configuration utilities
export {
    getModelClass,
    getModelClassNames,
    overrideModelClass,
    setModelClassModels,
    addModelToClass,
    removeModelFromClass,
    setModelClassRandom,
    resetModelClass,
    getAllModelClasses,
    updateModelClasses,
} from './utils/model_class_config.js';

// Re-export singleton instances
import { costTracker as _costTracker } from './utils/cost_tracker.js';
import { quotaTracker as _quotaTracker } from './utils/quota_tracker.js';
export const costTracker = _costTracker;
export const quotaTracker = _quotaTracker;

// Export core ensemble functions
export { ensembleRequest } from './core/ensemble_request.js';
export { ensembleEmbed } from './core/ensemble_embed.js';
export { ensembleImage } from './core/ensemble_image.js';
export { ensembleVoice } from './core/ensemble_voice.js';
export { ensembleListen, createAudioStreamFromMediaStream } from './core/ensemble_listen.js';
export { ensembleLive, ensembleLiveAudio, ensembleLiveText } from './core/ensemble_live.js';

// Export ensemble result aggregator
export { ensembleResult, type EnsembleResult } from './utils/ensemble_result.js';
