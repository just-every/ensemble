import { useState, useEffect, useRef, useCallback } from 'react';

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected';

export interface WebSocketMessage {
    type: string;
    [key: string]: any;
}

export interface UseWebSocketOptions {
    url: string;
    onMessage?: (message: WebSocketMessage) => void;
    onConnect?: () => void;
    onDisconnect?: () => void;
    onError?: (error: Event) => void;
    reconnectAttempts?: number;
    reconnectDelay?: number;
    autoConnect?: boolean;
}

export const useWebSocket = ({
    url,
    onMessage,
    onConnect,
    onDisconnect,
    onError,
    reconnectAttempts = 3,
    reconnectDelay = 1000,
    autoConnect = true,
}: UseWebSocketOptions) => {
    const [status, setStatus] = useState<ConnectionStatus>('disconnected');
    const [lastMessage, setLastMessage] = useState<WebSocketMessage | null>(null);
    const wsRef = useRef<WebSocket | null>(null);
    const reconnectCountRef = useRef(0);
    const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);

    const connect = useCallback(() => {
        if (wsRef.current?.readyState === WebSocket.OPEN) return;

        setStatus('connecting');

        try {
            const ws = new WebSocket(url);
            wsRef.current = ws;

            ws.onopen = () => {
                setStatus('connected');
                reconnectCountRef.current = 0;
                onConnect?.();
            };

            ws.onmessage = event => {
                try {
                    const message = JSON.parse(event.data);
                    setLastMessage(message);
                    onMessage?.(message);
                } catch (error) {
                    console.error('Failed to parse WebSocket message:', error);
                }
            };

            ws.onclose = () => {
                setStatus('disconnected');
                wsRef.current = null;
                onDisconnect?.();

                // Attempt reconnection if we haven't exceeded the limit
                if (reconnectCountRef.current < reconnectAttempts) {
                    reconnectCountRef.current++;
                    reconnectTimeoutRef.current = setTimeout(() => {
                        connect();
                    }, reconnectDelay * reconnectCountRef.current);
                }
            };

            ws.onerror = error => {
                onError?.(error);
            };
        } catch (error) {
            setStatus('disconnected');
            console.error('Failed to create WebSocket connection:', error);
        }
    }, [url, onMessage, onConnect, onDisconnect, onError, reconnectAttempts, reconnectDelay]);

    const disconnect = useCallback(() => {
        if (reconnectTimeoutRef.current) {
            clearTimeout(reconnectTimeoutRef.current);
            reconnectTimeoutRef.current = null;
        }

        if (wsRef.current) {
            wsRef.current.close();
            wsRef.current = null;
        }

        setStatus('disconnected');
        reconnectCountRef.current = reconnectAttempts; // Prevent further reconnection
    }, [reconnectAttempts]);

    const sendMessage = useCallback((message: any) => {
        if (wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify(message));
            return true;
        }
        return false;
    }, []);

    useEffect(() => {
        if (autoConnect) {
            connect();
        }

        return () => {
            disconnect();
        };
    }, [connect, disconnect, autoConnect]);

    return {
        status,
        lastMessage,
        connect,
        disconnect,
        sendMessage,
        isConnected: status === 'connected',
    };
};
