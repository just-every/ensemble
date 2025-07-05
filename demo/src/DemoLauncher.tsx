import { Link } from 'react-router-dom';

export default function DemoLauncher() {
    return (
        <div
            style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: '100%',
                height: '100%',
                position: 'absolute',
            }}>
            <div style={{ maxWidth: '600px', textAlign: 'center', padding: '40px' }}>
                <h1
                    style={{
                        fontSize: '36px',
                        marginBottom: '16px',
                        color: 'var(--accent-primary)',
                        textShadow: '0 0 30px var(--accent-primary-glow)',
                    }}>
                    Welcome to Ensemble Demos
                </h1>
                <p
                    style={{
                        fontSize: '18px',
                        color: 'var(--text-secondary)',
                        marginBottom: '40px',
                        textShadow: '0 2px 4px rgba(0,0,0,0.5)',
                    }}>
                    Explore the capabilities of the Ensemble AI library through interactive demonstrations.
                </p>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '24px', marginTop: '40px' }}>
                    <Link to="/request" className="demo-card">
                        <div className="demo-icon">
                            <svg
                                xmlns="http://www.w3.org/2000/svg"
                                width="48"
                                height="48"
                                viewBox="0 0 512 512"
                                fill="var(--primary)">
                                <path d="M288 64l0 96-64 0c-35.3 0-64 28.7-64 64l0 64-96 0L64 64l224 0zM64 352l96 0 0 96c0 35.3 28.7 64 64 64l224 0c35.3 0 64-28.7 64-64l0-224c0-35.3-28.7-64-64-64l-96 0 0-96c0-35.3-28.7-64-64-64L64 0C28.7 0 0 28.7 0 64L0 288c0 35.3 28.7 64 64 64zM448 224l0 224-224 0 0-96 64 0c35.3 0 64-28.7 64-64l0-64 96 0z" />
                            </svg>
                        </div>
                        <div className="demo-title">Request Demo</div>
                        <div className="demo-description">
                            Streaming AI responses with tool calling and multi-model support
                        </div>
                    </Link>

                    <Link to="/embed" className="demo-card">
                        <div className="demo-icon">
                            <svg
                                xmlns="http://www.w3.org/2000/svg"
                                width="48"
                                height="48"
                                viewBox="0 0 448 512"
                                fill="var(--primary)">
                                <path d="M160 64c0-17.7-14.3-32-32-32s-32 14.3-32 32l0 64-64 0c-17.7 0-32 14.3-32 32s14.3 32 32 32l96 0c17.7 0 32-14.3 32-32l0-96zM32 320c-17.7 0-32 14.3-32 32s14.3 32 32 32l64 0 0 64c0 17.7 14.3 32 32 32s32-14.3 32-32l0-96c0-17.7-14.3-32-32-32l-96 0zM352 64c0-17.7-14.3-32-32-32s-32 14.3-32 32l0 96c0 17.7 14.3 32 32 32l96 0c17.7 0 32-14.3 32-32s-14.3-32-32-32l-64 0 0-64zM320 320c-17.7 0-32 14.3-32 32l0 96c0 17.7 14.3 32 32 32s32-14.3 32-32l0-64 64 0c17.7 0 32-14.3 32-32s-14.3-32-32-32l-96 0z" />
                            </svg>
                        </div>
                        <div className="demo-title">Embed Demo</div>
                        <div className="demo-description">Generate vector embeddings and perform similarity search</div>
                    </Link>

                    <Link to="/voice" className="demo-card">
                        <div className="demo-icon">
                            <svg
                                xmlns="http://www.w3.org/2000/svg"
                                width="48"
                                height="48"
                                viewBox="0 0 640 512"
                                fill="var(--primary)">
                                <path d="M320 0c12 0 22.1 8.8 23.8 20.7l42 304.4L424.3 84.2c1.9-11.7 12-20.3 23.9-20.2s21.9 8.9 23.6 20.6l28.2 197.3 20.5-102.6c2.2-10.8 11.3-18.7 22.3-19.3s20.9 6.4 24.2 16.9L593.7 264l22.3 0c13.3 0 24 10.7 24 24s-10.7 24-24 24l-40 0c-10.5 0-19.8-6.9-22.9-16.9l-4.1-13.4-29.4 147c-2.3 11.5-12.5 19.6-24.2 19.3s-21.4-9-23.1-20.6L446.7 248.3l-39 243.5c-1.9 11.7-12.1 20.3-24 20.2s-21.9-8.9-23.5-20.7L320 199.6 279.8 491.3c-1.6 11.8-11.6 20.6-23.5 20.7s-22.1-8.5-24-20.2l-39-243.5L167.8 427.4c-1.7 11.6-11.4 20.3-23.1 20.6s-21.9-7.8-24.2-19.3l-29.4-147-4.1 13.4C83.8 305.1 74.5 312 64 312l-40 0c-13.3 0-24-10.7-24-24s10.7-24 24-24l22.3 0 26.8-87.1c3.2-10.5 13.2-17.5 24.2-16.9s20.2 8.5 22.3 19.3l20.5 102.6L168.2 84.6c1.7-11.7 11.7-20.5 23.6-20.6s22 8.5 23.9 20.2l38.5 240.9 42-304.4C297.9 8.8 308 0 320 0z" />
                            </svg>
                        </div>
                        <div className="demo-title">Voice Generation</div>
                        <div className="demo-description">
                            Convert text to natural-sounding speech with multiple voices and providers
                        </div>
                    </Link>

                    <Link to="/listen" className="demo-card">
                        <div className="demo-icon">
                            <svg
                                xmlns="http://www.w3.org/2000/svg"
                                width="48"
                                height="48"
                                viewBox="0 0 24 24"
                                fill="var(--primary)">
                                <path d="M12 15c1.66 0 3-1.34 3-3V6c0-1.66-1.34-3-3-3S9 4.34 9 6v6c0 1.66 1.34 3 3 3z" />
                                <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z" />
                            </svg>
                        </div>
                        <div className="demo-title">Listen Demo</div>
                        <div className="demo-description">Real-time speech-to-text with streaming audio processing</div>
                    </Link>
                </div>

                <p style={{ marginTop: '40px', color: 'var(--text-secondary)' }}>
                    Click on any demo above or use the navigation tabs to get started.
                </p>
            </div>
        </div>
    );
}
