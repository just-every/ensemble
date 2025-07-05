import React from 'react';
import { GlassButton } from './GlassButton';

interface DemoHeaderProps {
    icon: string;
    title: string;
    subtitle: string;
    onShowCode: () => void;
}

const DemoHeader: React.FC<DemoHeaderProps> = ({ icon, title, subtitle, onShowCode }) => {
    return (
        <div className="header-card glass-card">
            <div>
                <h1>
                    <span className="emoji">{icon}</span> {title}
                </h1>
                <p>{subtitle}</p>
            </div>
            <GlassButton onClick={onShowCode} variant="default">
                Show Code
            </GlassButton>
        </div>
    );
};

export default DemoHeader;
