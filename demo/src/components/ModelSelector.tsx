import React from 'react';

interface ModelSelectorProps {
    label: string;
    value: string;
    options: string[];
    onChange: (value: string) => void;
    disabled?: boolean;
}

const ModelSelector: React.FC<ModelSelectorProps> = ({ label, value, options, onChange, disabled = false }) => {
    return (
        <div className="form-group">
            <label>{label}</label>
            <select value={value} onChange={e => onChange(e.target.value)} disabled={disabled} className="glass-select">
                {options.map(option => (
                    <option key={option} value={option}>
                        {option}
                    </option>
                ))}
            </select>
        </div>
    );
};

export default ModelSelector;
