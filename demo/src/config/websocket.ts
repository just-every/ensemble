/**
 * WebSocket configuration for demo clients
 *
 * Each service connects to its own port
 */

// WebSocket URLs for each service
export const WS_URLS = {
    voice: 'ws://localhost:3004',
    listen: 'ws://localhost:3003',
    request: 'ws://localhost:3005',
    embed: 'ws://localhost:3006',
};

// Export individual URLs for backward compatibility
export const VOICE_WS_URL = WS_URLS.voice;
export const LISTEN_WS_URL = WS_URLS.listen;
export const REQUEST_WS_URL = WS_URLS.request;
export const EMBED_WS_URL = WS_URLS.embed;
