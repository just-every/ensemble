import { useCallback } from 'react';
import useWebSocket, { ReadyState } from 'react-use-websocket';

interface UseEnsembleWebSocketOptions {
    port: number;
    onOpen?: () => void;
    onClose?: () => void;
    onError?: (event: Event) => void;
}

export const useEnsembleWebSocket = (options: UseEnsembleWebSocketOptions) => {
    const { port, onOpen, onClose, onError } = options;

    const {
        sendMessage: wsSend,
        lastMessage,
        readyState,
    } = useWebSocket(`ws://localhost:${port}`, {
        shouldReconnect: () => true,
        reconnectAttempts: 10,
        reconnectInterval: 3000,
        onOpen: () => {
            console.log(`🟢 WebSocket connected to port ${port}`);
            onOpen?.();
        },
        onClose: () => {
            console.log(`🔴 WebSocket disconnected from port ${port}`);
            onClose?.();
        },
        onError: event => {
            console.error('❌ WebSocket error:', event);
            onError?.(event);
        },
    });

    const sendMessage = useCallback(
        (message: any) => {
            if (readyState === ReadyState.OPEN) {
                wsSend(JSON.stringify(message));
            } else {
                console.error('WebSocket is not connected');
            }
        },
        [readyState, wsSend]
    );

    const isConnected = readyState === ReadyState.OPEN;
    const isConnecting = readyState === ReadyState.CONNECTING;

    return {
        sendMessage,
        lastMessage,
        readyState,
        isConnected,
        isConnecting,
    };
};
