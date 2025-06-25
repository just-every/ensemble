/**
 * Centralized configuration management for the ensemble system
 */

import { ConfigurationError } from '../types/errors.js';

export interface EnsembleConfig {
    /** Default timeout for tool execution (ms) */
    defaultToolTimeout: number;

    /** Maximum number of concurrent tool executions */
    maxConcurrentTools: number;

    /** Default pause check interval (ms) */
    pauseCheckInterval: number;

    /** Default message history compaction threshold */
    historyCompactionThreshold: number;

    /** API keys for various providers */
    apiKeys: {
        openai?: string;
        anthropic?: string;
        google?: string;
        deepseek?: string;
        xai?: string;
        openrouter?: string;
    };
}

const DEFAULT_CONFIG: EnsembleConfig = {
    defaultToolTimeout: 300000, // 5 minutes
    maxConcurrentTools: 10,
    pauseCheckInterval: 100,
    historyCompactionThreshold: 0.7,
    apiKeys: {},
};

class ConfigManager {
    private config: EnsembleConfig;
    private isLoaded = false;

    constructor() {
        this.config = { ...DEFAULT_CONFIG };
    }

    /**
     * Load configuration from environment variables and validate
     */
    loadConfig(): void {
        if (this.isLoaded) return;

        // Load API keys from environment
        this.config.apiKeys = {
            openai: process.env.OPENAI_API_KEY,
            anthropic: process.env.ANTHROPIC_API_KEY,
            google: process.env.GOOGLE_API_KEY,
            deepseek: process.env.DEEPSEEK_API_KEY,
            xai: process.env.XAI_API_KEY,
            openrouter: process.env.OPENROUTER_API_KEY,
        };

        // Load other config from environment with defaults
        if (process.env.ENSEMBLE_TOOL_TIMEOUT) {
            const timeout = parseInt(process.env.ENSEMBLE_TOOL_TIMEOUT, 10);
            if (isNaN(timeout) || timeout <= 0) {
                throw new ConfigurationError('ENSEMBLE_TOOL_TIMEOUT must be a positive number', {
                    value: process.env.ENSEMBLE_TOOL_TIMEOUT,
                });
            }
            this.config.defaultToolTimeout = timeout;
        }

        if (process.env.ENSEMBLE_MAX_CONCURRENT_TOOLS) {
            const maxTools = parseInt(process.env.ENSEMBLE_MAX_CONCURRENT_TOOLS, 10);
            if (isNaN(maxTools) || maxTools <= 0) {
                throw new ConfigurationError('ENSEMBLE_MAX_CONCURRENT_TOOLS must be a positive number', {
                    value: process.env.ENSEMBLE_MAX_CONCURRENT_TOOLS,
                });
            }
            this.config.maxConcurrentTools = maxTools;
        }

        if (process.env.ENSEMBLE_PAUSE_CHECK_INTERVAL) {
            const interval = parseInt(process.env.ENSEMBLE_PAUSE_CHECK_INTERVAL, 10);
            if (isNaN(interval) || interval <= 0) {
                throw new ConfigurationError('ENSEMBLE_PAUSE_CHECK_INTERVAL must be a positive number', {
                    value: process.env.ENSEMBLE_PAUSE_CHECK_INTERVAL,
                });
            }
            this.config.pauseCheckInterval = interval;
        }

        if (process.env.ENSEMBLE_HISTORY_COMPACTION_THRESHOLD) {
            const threshold = parseFloat(process.env.ENSEMBLE_HISTORY_COMPACTION_THRESHOLD);
            if (isNaN(threshold) || threshold <= 0 || threshold > 1) {
                throw new ConfigurationError('ENSEMBLE_HISTORY_COMPACTION_THRESHOLD must be a number between 0 and 1', {
                    value: process.env.ENSEMBLE_HISTORY_COMPACTION_THRESHOLD,
                });
            }
            this.config.historyCompactionThreshold = threshold;
        }

        this.isLoaded = true;
    }

    /**
     * Get the current configuration
     */
    getConfig(): EnsembleConfig {
        if (!this.isLoaded) {
            this.loadConfig();
        }
        return { ...this.config };
    }

    /**
     * Get a specific configuration value
     */
    get<K extends keyof EnsembleConfig>(key: K): EnsembleConfig[K] {
        return this.getConfig()[key];
    }

    /**
     * Update configuration (for testing purposes)
     */
    updateConfig(updates: Partial<EnsembleConfig>): void {
        this.config = { ...this.config, ...updates };
    }

    /**
     * Reset configuration to defaults
     */
    reset(): void {
        this.config = { ...DEFAULT_CONFIG };
        this.isLoaded = false;
    }

    /**
     * Check if a provider API key is available
     */
    hasApiKey(provider: keyof EnsembleConfig['apiKeys']): boolean {
        return !!this.getConfig().apiKeys[provider];
    }

    /**
     * Get API key for a provider
     */
    getApiKey(provider: keyof EnsembleConfig['apiKeys']): string | undefined {
        return this.getConfig().apiKeys[provider];
    }
}

// Singleton instance
let configManager: ConfigManager | null = null;

/**
 * Get the singleton ConfigManager instance
 */
export function getConfigManager(): ConfigManager {
    if (!configManager) {
        configManager = new ConfigManager();
    }
    return configManager;
}

/**
 * Convenience function to get configuration
 */
export function getConfig(): EnsembleConfig {
    return getConfigManager().getConfig();
}

/**
 * Convenience function to get a specific config value
 */
export function getConfigValue<K extends keyof EnsembleConfig>(key: K): EnsembleConfig[K] {
    return getConfigManager().get(key);
}
