import React, { useState } from 'react';
import { Modal } from './Modal';
import { GlassButton } from './GlassButton';

interface CodeModalProps {
    isOpen: boolean;
    onClose: () => void;
    serverCode: string;
    clientCode: string;
}

const CodeModal: React.FC<CodeModalProps> = ({ isOpen, onClose, serverCode, clientCode }) => {
    const [activeTab, setActiveTab] = useState<'server' | 'client'>('server');

    const copyToClipboard = (code: string) => {
        navigator.clipboard.writeText(code).then(() => {
            alert('Code copied to clipboard!');
        });
    };

    return (
        <Modal isOpen={isOpen} onClose={onClose}>
            <div className="modal-content">
                <div className="tabs">
                    <GlassButton
                        onClick={() => setActiveTab('server')}
                        variant={activeTab === 'server' ? 'primary' : 'default'}>
                        Server Code
                    </GlassButton>
                    <GlassButton
                        onClick={() => setActiveTab('client')}
                        variant={activeTab === 'client' ? 'primary' : 'default'}>
                        Client Code
                    </GlassButton>
                </div>
                <div className="code-content">
                    <pre>
                        <code>{activeTab === 'server' ? serverCode : clientCode}</code>
                    </pre>
                    <GlassButton
                        onClick={() => copyToClipboard(activeTab === 'server' ? serverCode : clientCode)}
                        variant="default"
                        className="copy-button">
                        Copy Code
                    </GlassButton>
                </div>
            </div>
        </Modal>
    );
};

export default CodeModal;
