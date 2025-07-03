import React from 'react';
import './glassmorphism.css';

interface GlassCardProps {
    children: React.ReactNode;
    className?: string;
    padding?: boolean;
    style?: React.CSSProperties;
}

export const GlassCard: React.FC<GlassCardProps> = ({ children, className = '', padding = true, style = {} }) => {
    const defaultStyle = padding ? { padding: '24px', ...style } : style;

    return (
        <div className={`glass ${className}`} style={defaultStyle}>
            {children}
        </div>
    );
};
