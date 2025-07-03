import React from 'react';

const TestApp: React.FC = () => {
    return (
        <div
            style={{
                color: 'white',
                background: '#0f0f0f',
                minHeight: '100vh',
                padding: '20px',
                fontFamily: 'Arial, sans-serif',
            }}>
            <h1>React Test App</h1>
            <p>If you can see this, React is working!</p>
        </div>
    );
};

export default TestApp;
