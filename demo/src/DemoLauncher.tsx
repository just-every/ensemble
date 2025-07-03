import { Link } from 'react-router-dom';
import './components/glassmorphism.css';

export default function DemoLauncher() {
    return (
        <div className="min-h-screen" style={{ background: 'var(--bg-primary)' }}>
            <nav className="glass-nav sticky top-0 z-50">
                <div className="container mx-auto px-4 py-4 flex justify-between items-center">
                    <div className="flex items-center gap-2">
                        <div className="w-8 h-8 bg-gradient-to-br from-blue-400 to-purple-600 rounded-lg"></div>
                        <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>
                            Ensemble Demo
                        </h1>
                    </div>
                    <div className="flex gap-2">
                        <Link to="/" className="glass-button-active">
                            <span className="mr-2">🏠</span> Home
                        </Link>
                        <Link to="/request" className="glass-button">
                            <span className="mr-2">💬</span> Request
                        </Link>
                        <Link to="/embed" className="glass-button">
                            <span className="mr-2">🧮</span> Embed
                        </Link>
                        <Link to="/voice" className="glass-button">
                            <span className="mr-2">🎵</span> Voice
                        </Link>
                        <Link to="/listen" className="glass-button">
                            <span className="mr-2">🎤</span> Listen
                        </Link>
                    </div>
                </div>
            </nav>

            <div className="container mx-auto px-4 py-16">
                <div className="text-center mb-12">
                    <h2 className="text-5xl font-bold mb-4" style={{ color: 'var(--text-primary)' }}>
                        Welcome to Ensemble Demos
                    </h2>
                    <p className="text-xl" style={{ color: 'var(--text-secondary)' }}>
                        Explore the capabilities of the Ensemble AI library through interactive demonstrations.
                    </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-8 max-w-4xl mx-auto">
                    <Link
                        to="/request"
                        className="glass-card hover:scale-105 transition-transform cursor-pointer no-underline">
                        <div className="text-center">
                            <div className="text-4xl mb-4">💬</div>
                            <h3 className="text-2xl font-bold mb-2" style={{ color: 'var(--text-primary)' }}>
                                Request Demo
                            </h3>
                            <p style={{ color: 'var(--text-secondary)' }}>
                                Streaming AI responses with tool calling and multi-model support
                            </p>
                        </div>
                    </Link>

                    <Link
                        to="/embed"
                        className="glass-card hover:scale-105 transition-transform cursor-pointer no-underline">
                        <div className="text-center">
                            <div className="text-4xl mb-4">🧮</div>
                            <h3 className="text-2xl font-bold mb-2" style={{ color: 'var(--text-primary)' }}>
                                Embed Demo
                            </h3>
                            <p style={{ color: 'var(--text-secondary)' }}>
                                Generate vector embeddings and perform similarity search
                            </p>
                        </div>
                    </Link>

                    <Link
                        to="/voice"
                        className="glass-card hover:scale-105 transition-transform cursor-pointer no-underline">
                        <div className="text-center">
                            <div className="text-4xl mb-4">🎵</div>
                            <h3 className="text-2xl font-bold mb-2" style={{ color: 'var(--text-primary)' }}>
                                Voice Generation
                            </h3>
                            <p style={{ color: 'var(--text-secondary)' }}>
                                Convert text to natural-sounding speech with multiple voices and providers
                            </p>
                        </div>
                    </Link>

                    <Link
                        to="/listen"
                        className="glass-card hover:scale-105 transition-transform cursor-pointer no-underline">
                        <div className="text-center">
                            <div className="text-4xl mb-4">🎤</div>
                            <h3 className="text-2xl font-bold mb-2" style={{ color: 'var(--text-primary)' }}>
                                Listen Demo
                            </h3>
                            <p style={{ color: 'var(--text-secondary)' }}>
                                Real-time speech-to-text with streaming audio processing
                            </p>
                        </div>
                    </Link>
                </div>

                <p className="text-center mt-12" style={{ color: 'var(--text-tertiary)' }}>
                    Click on any demo above or use the navigation tabs to get started.
                </p>
            </div>
        </div>
    );
}
