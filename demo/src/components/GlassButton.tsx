import React from 'react';
import './style.scss';

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
    // Map variants to actual button classes
    const getButtonClass = () => {
        switch (variant) {
            case 'primary':
                return 'primary-btn';
            case 'danger':
                return 'danger-btn';
            case 'success':
                return 'success-btn';
            case 'warning':
                return 'warning-btn';
            default:
                return 'glass-button';
        }
    };

    return (
        <button
            type={type}
            onClick={onClick}
            disabled={disabled}
            className={`${getButtonClass()} ${className}`}
            style={style}>
            {children}
        </button>
    );
};
