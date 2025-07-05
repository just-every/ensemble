import React from 'react';
import { GlassButton } from './GlassButton';
import './style.scss';

interface HeaderProps {
    title: string;
    onShowCode?: () => void;
    showCodeButton?: boolean;
}

export const Header: React.FC<HeaderProps> = ({ title, onShowCode, showCodeButton = true }) => {
    return (
        <div
            style={{
                background: 'none',
                border: 'none',
                borderRadius: 0,
                padding: '40px 0 20px',
                boxShadow: 'none',
                backdropFilter: 'none',
                WebkitBackdropFilter: 'none',
            }}>
            <div
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    marginBottom: '20px',
                }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <h1
                        style={{
                            fontSize: '28px',
                            fontWeight: '600',
                            color: 'var(--text)',
                            margin: 0,
                        }}>
                        <span style={{ color: 'var(--accent-primary)' }}>ensemble</span>
                    </h1>
                    <span
                        style={{
                            fontSize: '24px',
                            color: 'var(--text-secondary)',
                            fontWeight: '300',
                        }}>
                        /
                    </span>
                    <h2
                        style={{
                            fontSize: '24px',
                            fontWeight: '500',
                            color: 'var(--text)',
                            margin: 0,
                        }}>
                        {title}
                    </h2>
                </div>
                {showCodeButton && onShowCode && (
                    <GlassButton onClick={onShowCode} variant="primary" className="generate-code-btn">
                        <span>📋</span>
                        Show Code
                    </GlassButton>
                )}
            </div>
        </div>
    );
};
