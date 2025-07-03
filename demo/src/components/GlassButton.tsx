import React from 'react';
import './glassmorphism.css';

interface GlassButtonProps {
    children: React.ReactNode;
    onClick?: () => void;
    type?: 'button' | 'submit' | 'reset';
    variant?: 'primary' | 'success' | 'danger' | 'warning' | 'default';
    disabled?: boolean;
    className?: string;
    style?: React.CSSProperties;
}

export const GlassButton: React.FC<GlassButtonProps> = ({
    children,
    onClick,
    type = 'button',
    variant = 'default',
    disabled = false,
    className = '',
    style = {},
}) => {
    const variantClass = variant !== 'default' ? ` ${variant}` : '';

    return (
        <button
            type={type}
            onClick={onClick}
            disabled={disabled}
            className={`glass-button${variantClass} ${className}`}
            style={style}>
            {children}
        </button>
    );
};
