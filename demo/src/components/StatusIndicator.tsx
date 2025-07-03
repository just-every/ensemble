import React from 'react';
import './glassmorphism.css';

interface StatusIndicatorProps {
    status: 'connected' | 'connecting' | 'disconnected' | 'processing';
    label?: string;
    showDot?: boolean;
}

export const StatusIndicator: React.FC<StatusIndicatorProps> = ({ status, label, showDot = true }) => {
    const getStatusText = () => {
        switch (status) {
            case 'connected':
                return label || 'Connected';
            case 'connecting':
                return label || 'Connecting';
            case 'disconnected':
                return label || 'Disconnected';
            case 'processing':
                return label || 'Processing';
            default:
                return label || 'Unknown';
        }
    };

    return (
        <div className={`status-indicator ${status}`}>
            {showDot && <div className={`pulse-dot ${status}`} />}
            {getStatusText()}
        </div>
    );
};
