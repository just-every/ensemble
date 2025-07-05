import { useState, useEffect } from 'react';
import { ReadyState } from 'react-use-websocket';
import './style.scss';

interface ConnectionWarningProps {
    readyState: ReadyState;
    port: number;
    delay?: number;
}

export default function ConnectionWarning({ readyState, port, delay = 1000 }: ConnectionWarningProps) {
    const [showWarning, setShowWarning] = useState(false);

    useEffect(() => {
        if (readyState === ReadyState.OPEN) {
            setShowWarning(false);
            return;
        }

        const timer = setTimeout(() => {
            if (readyState !== ReadyState.OPEN) {
                setShowWarning(true);
            }
        }, delay);

        return () => clearTimeout(timer);
    }, [readyState, delay]);

    if (!showWarning) return null;

    return (
        <div className="connection-warning">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                <path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z" />
            </svg>
            Unable to connect to server. Please ensure the server is running on port {port}.
        </div>
    );
}
