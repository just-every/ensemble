# Multi-Logger Support

The ensemble package now supports multiple loggers that can all receive logging events simultaneously. This is useful when you want to log to multiple destinations (e.g., console, file, remote service) without replacing the existing logger.

## Basic Usage

### Adding Multiple Loggers

```typescript
import { setEnsembleLogger, addEnsembleLogger } from '@just-every/ensemble';

// Create your loggers
const consoleLogger = {
    log_llm_request(agentId, providerName, model, requestData, timestamp) {
        console.log(`[REQUEST] ${providerName}/${model}:`, requestData);
        return `console-${Date.now()}`;
    },
    log_llm_response(requestId, responseData, timestamp) {
        console.log(`[RESPONSE] ${requestId}:`, responseData);
    },
    log_llm_error(requestId, errorData, timestamp) {
        console.error(`[ERROR] ${requestId}:`, errorData);
    }
};

const fileLogger = {
    log_llm_request(agentId, providerName, model, requestData, timestamp) {
        // Write to file
        fs.appendFileSync('llm.log', `${timestamp} REQUEST ${model}\n`);
        return `file-${Date.now()}`;
    },
    log_llm_response(requestId, responseData, timestamp) {
        fs.appendFileSync('llm.log', `${timestamp} RESPONSE ${requestId}\n`);
    },
    log_llm_error(requestId, errorData, timestamp) {
        fs.appendFileSync('llm.log', `${timestamp} ERROR ${requestId}\n`);
    }
};

// Add both loggers - they will both receive all events
setEnsembleLogger(consoleLogger);
setEnsembleLogger(fileLogger);  // Does NOT replace consoleLogger

// Or use the explicit addEnsembleLogger function
addEnsembleLogger(remoteLogger);
```

### Managing Loggers

```typescript
import { 
    setEnsembleLogger, 
    removeEnsembleLogger, 
    getAllEnsembleLoggers 
} from '@just-every/ensemble';

// Add loggers
setEnsembleLogger(logger1);
setEnsembleLogger(logger2);

// Remove a specific logger
removeEnsembleLogger(logger1);

// Get all active loggers
const activeLoggers = getAllEnsembleLoggers();
console.log(`Active loggers: ${activeLoggers.length}`);

// Clear all loggers
setEnsembleLogger(null);
```

## Backward Compatibility

The API is fully backward compatible:

```typescript
// Old code still works
setEnsembleLogger(myLogger);  // Adds logger
setEnsembleLogger(null);       // Clears all loggers

// getEnsembleLogger returns the first logger for compatibility
const logger = getEnsembleLogger();
```

## Error Handling

Each logger is called in a try-catch block, so if one logger fails, the others will still receive the events:

```typescript
const unreliableLogger = {
    log_llm_request() {
        if (Math.random() > 0.5) {
            throw new Error('Network error');
        }
        return 'request-id';
    },
    // ...
};

const reliableLogger = {
    log_llm_request() {
        // This will still be called even if unreliableLogger throws
        return 'request-id';
    },
    // ...
};

setEnsembleLogger(unreliableLogger);
setEnsembleLogger(reliableLogger);
```

## Request ID Handling

When multiple loggers are active, `log_llm_request` returns the request ID from the first logger (for backward compatibility). Each logger can return its own request ID, but only the first one is returned to the caller.

```typescript
// Logger 1 returns 'req-123'
// Logger 2 returns 'req-456'
// Logger 3 returns 'req-789'

const requestId = log_llm_request(...);  // Returns 'req-123'
```

All loggers will receive the same request ID in subsequent `log_llm_response` and `log_llm_error` calls.