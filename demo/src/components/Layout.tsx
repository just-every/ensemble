import { Link, useLocation } from 'react-router-dom';
import './style.scss';

interface LayoutProps {
    children: React.ReactNode;
}

export default function Layout({ children }: LayoutProps) {
    const location = useLocation();

    const isActive = (path: string) => {
        return location.pathname === path ? 'active' : '';
    };

    return (
        <div
            style={{
                fontFamily:
                    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
                color: 'var(--text)',
                lineHeight: '1.6',
                minHeight: '100vh',
                display: 'flex',
                flexDirection: 'column',
                position: 'relative',
            }}>
            {/* Header */}
            <div
                style={{
                    background: 'var(--surface-glass)',
                    backdropFilter: 'var(--blur-glass)',
                    WebkitBackdropFilter: 'var(--blur-glass)',
                    borderBottom: '1px solid var(--border-glass)',
                    boxShadow: '0 2px 16px rgba(0,0,0,0.3)',
                    padding: '16px 24px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '24px',
                    flexShrink: 0,
                    zIndex: 100,
                    position: 'relative',
                }}>
                <div
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '12px',
                        fontSize: '24px',
                        fontWeight: '600',
                        color: 'var(--accent-primary)',
                        textShadow: '0 0 20px var(--accent-primary-glow)',
                    }}>
                    <svg
                        xmlns="http://www.w3.org/2000/svg"
                        viewBox="0 0 576 512"
                        width="32"
                        height="32"
                        fill="currentColor">
                        <path d="M264.5 5.2c14.9-6.9 32.1-6.9 47 0l218.6 101c8.5 3.9 13.9 12.4 13.9 21.8s-5.4 17.9-13.9 21.8l-218.6 101c-14.9 6.9-32.1 6.9-47 0L45.9 149.8C37.4 145.8 32 137.3 32 128s5.4-17.9 13.9-21.8L264.5 5.2zM476.9 209.6l53.2 24.6c8.5 3.9 13.9 12.4 13.9 21.8s-5.4 17.9-13.9 21.8l-218.6 101c-14.9 6.9-32.1 6.9-47 0L45.9 277.8C37.4 273.8 32 265.3 32 256s5.4-17.9 13.9-21.8l53.2-24.6 152 70.2c23.4 10.8 50.4 10.8 73.8 0l152-70.2zm-152 198.2l152-70.2 53.2 24.6c8.5 3.9 13.9 12.4 13.9 21.8s-5.4 17.9-13.9 21.8l-218.6 101c-14.9 6.9-32.1 6.9-47 0L45.9 405.8C37.4 401.8 32 393.3 32 384s5.4-17.9 13.9-21.8l53.2-24.6 152 70.2c23.4 10.8 50.4 10.8 73.8 0z" />
                    </svg>
                    Ensemble Demo
                </div>

                <nav style={{ display: 'flex', gap: '8px', marginLeft: 'auto' }}>
                    <Link to="/" className={`nav-tab ${isActive('/')}`}>
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z" />
                        </svg>
                        Home
                    </Link>
                    <Link to="/request" className={`nav-tab ${isActive('/request')}`}>
                        <svg width="20" height="20" viewBox="0 0 512 512" fill="currentColor">
                            <path d="M288 64l0 96-64 0c-35.3 0-64 28.7-64 64l0 64-96 0L64 64l224 0zM64 352l96 0 0 96c0 35.3 28.7 64 64 64l224 0c35.3 0 64-28.7 64-64l0-224c0-35.3-28.7-64-64-64l-96 0 0-96c0-35.3-28.7-64-64-64L64 0C28.7 0 0 28.7 0 64L0 288c0 35.3 28.7 64 64 64zM448 224l0 224-224 0 0-96 64 0c35.3 0 64-28.7 64-64l0-64 96 0z" />
                        </svg>
                        Request
                    </Link>
                    <Link to="/embed" className={`nav-tab ${isActive('/embed')}`}>
                        <svg width="20" height="20" viewBox="0 0 448 512" fill="currentColor">
                            <path d="M160 64c0-17.7-14.3-32-32-32s-32 14.3-32 32l0 64-64 0c-17.7 0-32 14.3-32 32s14.3 32 32 32l96 0c17.7 0 32-14.3 32-32l0-96zM32 320c-17.7 0-32 14.3-32 32s14.3 32 32 32l64 0 0 64c0 17.7 14.3 32 32 32s32-14.3 32-32l0-96c0-17.7-14.3-32-32-32l-96 0zM352 64c0-17.7-14.3-32-32-32s-32 14.3-32 32l0 96c0 17.7 14.3 32 32 32l96 0c17.7 0 32-14.3 32-32s-14.3-32-32-32l-64 0 0-64zM320 320c-17.7 0-32 14.3-32 32l0 96c0 17.7 14.3 32 32 32s32-14.3 32-32l0-64 64 0c17.7 0 32-14.3 32-32s-14.3-32-32-32l-96 0z" />
                        </svg>
                        Embed
                    </Link>
                    <Link to="/voice" className={`nav-tab ${isActive('/voice')}`}>
                        <svg width="20" height="20" viewBox="0 0 640 512" fill="currentColor">
                            <path d="M320 0c12 0 22.1 8.8 23.8 20.7l42 304.4L424.3 84.2c1.9-11.7 12-20.3 23.9-20.2s21.9 8.9 23.6 20.6l28.2 197.3 20.5-102.6c2.2-10.8 11.3-18.7 22.3-19.3s20.9 6.4 24.2 16.9L593.7 264l22.3 0c13.3 0 24 10.7 24 24s-10.7 24-24 24l-40 0c-10.5 0-19.8-6.9-22.9-16.9l-4.1-13.4-29.4 147c-2.3 11.5-12.5 19.6-24.2 19.3s-21.4-9-23.1-20.6L446.7 248.3l-39 243.5c-1.9 11.7-12.1 20.3-24 20.2s-21.9-8.9-23.5-20.7L320 199.6 279.8 491.3c-1.6 11.8-11.6 20.6-23.5 20.7s-22.1-8.5-24-20.2l-39-243.5L167.8 427.4c-1.7 11.6-11.4 20.3-23.1 20.6s-21.9-7.8-24.2-19.3l-29.4-147-4.1 13.4C83.8 305.1 74.5 312 64 312l-40 0c-13.3 0-24-10.7-24-24s10.7-24 24-24l22.3 0 26.8-87.1c3.2-10.5 13.2-17.5 24.2-16.9s20.2 8.5 22.3 19.3l20.5 102.6L168.2 84.6c1.7-11.7 11.7-20.5 23.6-20.6s22 8.5 23.9 20.2l38.5 240.9 42-304.4C297.9 8.8 308 0 320 0z" />
                        </svg>
                        Voice
                    </Link>
                    <Link to="/listen" className={`nav-tab ${isActive('/listen')}`}>
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M12 15c1.66 0 2.99-1.34 2.99-3L15 6c0-1.66-1.34-3-3-3S9 4.34 9 6v6c0 1.66 1.34 3 3 3zm5.3-3c0 3-2.54 5.1-5.3 5.1S6.7 15 6.7 12H5c0 3.42 2.72 6.23 6 6.72V22h2v-3.28c3.28-.48 6-3.3 6-6.72h-1.7z" />
                        </svg>
                        Listen
                    </Link>
                </nav>
            </div>

            {/* Content */}
            <div style={{ flex: 1, position: 'relative' }}>{children}</div>
        </div>
    );
}
