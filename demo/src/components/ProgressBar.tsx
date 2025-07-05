import React from 'react';
import './style.scss';

interface ProgressBarProps {
    progress: number; // 0-100
    className?: string;
}

export const ProgressBar: React.FC<ProgressBarProps> = ({ progress, className = '' }) => {
    return (
        <div className={`progress-bar ${className}`}>
            <div className="progress-bar-fill" style={{ width: `${Math.max(0, Math.min(100, progress))}%` }} />
        </div>
    );
};
