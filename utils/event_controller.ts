/**
 * Event Controller for managing global event handling across ensemble requests
 *
 * This module provides a centralized way to set an event handler that will
 * receive all events from all ensemble requests, similar to the pause controller.
 */

import { ProviderStreamEvent, AgentDefinition } from '../types/types.js';
import { exportAgent } from './agent_export.js';
import { setEventControllerFunctions } from './cost_tracker.js';

export type EventHandler = (event: ProviderStreamEvent) => void | Promise<void>;

export interface EventController {
    /**
     * Set the global event handler
     * @param handler - The event handler function or null to clear
     */
    setEventHandler(handler: EventHandler | null): void;

    /**
     * Get the current event handler
     */
    getEventHandler(): EventHandler | null;

    /**
     * Emit an event to the current handler
     * @param event - The event to emit
     */
    emit(event: ProviderStreamEvent): Promise<void>;

    /**
     * Check if an event handler is set
     */
    hasEventHandler(): boolean;
}

class EventControllerImpl implements EventController {
    private eventHandler: EventHandler | null = null;

    setEventHandler(handler: EventHandler | null): void {
        this.eventHandler = handler;
        if (handler) {
            console.log('[EventController] Event handler set');
        } else {
            console.log('[EventController] Event handler cleared');
        }
    }

    getEventHandler(): EventHandler | null {
        return this.eventHandler;
    }

    hasEventHandler(): boolean {
        return this.eventHandler !== null;
    }

    async emit(event: ProviderStreamEvent): Promise<void> {
        if (this.eventHandler) {
            try {
                await Promise.resolve(this.eventHandler(event));
            } catch (error) {
                console.error('[EventController] Error in event handler:', error);
            }
        }
    }
}

// Singleton instance
let eventControllerInstance: EventController | null = null;

/**
 * Get the singleton EventController instance
 */
export function getEventController(): EventController {
    if (!eventControllerInstance) {
        eventControllerInstance = new EventControllerImpl();
    }
    return eventControllerInstance;
}

/**
 * Convenience function to set the global event handler
 */
export function setEventHandler(handler: EventHandler | null): void {
    getEventController().setEventHandler(handler);
}

/**
 * Convenience function to emit an event
 * @param event - The event to emit
 * @param agent - Optional agent to add to the event
 * @param model - Optional model to use when exporting the agent
 */
export async function emitEvent(event: ProviderStreamEvent, agent?: AgentDefinition, model?: string): Promise<void> {
    let eventToEmit = event;

    // If agent is provided, add it to the event
    if (agent) {
        eventToEmit = {
            ...event,
            agent: exportAgent(agent, model),
        };
    }

    return getEventController().emit(eventToEmit);
}

/**
 * Convenience function to check if an event handler is set
 */
export function hasEventHandler(): boolean {
    return getEventController().hasEventHandler();
}

// Set the event controller functions in cost_tracker to avoid circular dependency
setEventControllerFunctions(emitEvent, hasEventHandler);
