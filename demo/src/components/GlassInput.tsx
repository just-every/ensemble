import React from 'react';
import './style.scss';

interface GlassInputProps {
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
    type?: 'text' | 'number' | 'email' | 'password';
    disabled?: boolean;
    className?: string;
}

export const GlassInput: React.FC<GlassInputProps> = ({
    value,
    onChange,
    placeholder,
    type = 'text',
    disabled = false,
    className = '',
}) => {
    return (
        <input
            type={type}
            value={value}
            onChange={e => onChange(e.target.value)}
            placeholder={placeholder}
            disabled={disabled}
            className={`glass-input ${className}`}
        />
    );
};

interface GlassTextareaProps {
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
    disabled?: boolean;
    className?: string;
    rows?: number;
    onKeyDown?: (e: React.KeyboardEvent) => void;
    style?: React.CSSProperties;
}

export const GlassTextarea = React.forwardRef<HTMLTextAreaElement, GlassTextareaProps>(
    ({ value, onChange, placeholder, disabled = false, className = '', rows = 4, onKeyDown, style }, ref) => {
        return (
            <textarea
                ref={ref}
                value={value}
                onChange={e => onChange(e.target.value)}
                placeholder={placeholder}
                disabled={disabled}
                rows={rows}
                onKeyDown={onKeyDown}
                style={style}
                className={`glass-textarea ${className}`}
            />
        );
    }
);

interface GlassSelectProps {
    value: string;
    onChange: (value: string) => void;
    options: { value: string; label: string }[];
    disabled?: boolean;
    className?: string;
}

export const GlassSelect: React.FC<GlassSelectProps> = ({
    value,
    onChange,
    options,
    disabled = false,
    className = '',
}) => {
    return (
        <select
            value={value}
            onChange={e => onChange(e.target.value)}
            disabled={disabled}
            className={`glass-select ${className}`}>
            {options.map(option => (
                <option key={option.value} value={option.value}>
                    {option.label}
                </option>
            ))}
        </select>
    );
};
