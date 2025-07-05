import { useState, useCallback, useEffect } from 'react';

export const useError = (timeout = 5000) => {
    const [error, setError] = useState<string | null>(null);

    const showError = useCallback((message: string) => {
        setError(message);
    }, []);

    const clearError = useCallback(() => {
        setError(null);
    }, []);

    useEffect(() => {
        if (error && timeout > 0) {
            const timer = setTimeout(() => {
                clearError();
            }, timeout);
            return () => clearTimeout(timer);
        }
    }, [error, timeout, clearError]);

    return {
        error,
        showError,
        clearError,
    };
};
