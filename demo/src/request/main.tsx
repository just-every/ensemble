import ReactDOM from 'react-dom/client';

const App = () => {
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

const root = ReactDOM.createRoot(document.getElementById('root')!);
root.render(<App />);
