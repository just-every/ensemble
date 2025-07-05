import React from 'react';

interface SettingsPanelProps {
    children?: React.ReactNode;
    title?: string;
}

interface SliderSettingProps {
    label: string;
    value: number;
    min: number;
    max: number;
    step: number;
    onChange: (value: number) => void;
    disabled?: boolean;
}

export const SliderSetting: React.FC<SliderSettingProps> = ({
    label,
    value,
    min,
    max,
    step,
    onChange,
    disabled = false,
}) => {
    return (
        <div className="form-group">
            <label>
                {label}: {value}
            </label>
            <input
                type="range"
                min={min}
                max={max}
                step={step}
                value={value}
                onChange={e => onChange(parseFloat(e.target.value))}
                disabled={disabled}
                className="glass-slider"
            />
        </div>
    );
};

interface ToggleSettingProps {
    label: string;
    value: boolean;
    onChange: (value: boolean) => void;
    disabled?: boolean;
}

export const ToggleSetting: React.FC<ToggleSettingProps> = ({ label, value, onChange, disabled = false }) => {
    return (
        <div className="form-group">
            <label className="toggle-label">
                <input type="checkbox" checked={value} onChange={e => onChange(e.target.checked)} disabled={disabled} />
                <span className="toggle-text">{label}</span>
            </label>
        </div>
    );
};

const SettingsPanel: React.FC<SettingsPanelProps> = ({ children, title }) => {
    return (
        <div className="settings-panel glass-card">
            {title && <h3>{title}</h3>}
            {children}
        </div>
    );
};

export default SettingsPanel;
