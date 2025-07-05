import React from 'react';

interface ErrorMessageProps {
    error: string | null;
}

const ErrorMessage: React.FC<ErrorMessageProps> = ({ error }) => {
    if (!error) return null;

    return (
        <div className="error-message glass-card">
            <span className="error-icon">⚠️</span>
            {error}
        </div>
    );
};

export default ErrorMessage;
