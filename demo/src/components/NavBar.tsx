import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import './glassmorphism.css';

const NavBar: React.FC = () => {
    const location = useLocation();

    const navItems = [
        { path: '/', label: 'Home', icon: '🏠' },
        { path: '/request', label: 'Request', icon: '💬' },
        { path: '/embed', label: 'Embed', icon: '🧮' },
        { path: '/voice', label: 'Voice', icon: '🎵' },
        { path: '/listen', label: 'Listen', icon: '🎤' },
    ];

    return (
        <nav className="glass-nav sticky top-0 z-50">
            <div className="container mx-auto px-4 py-4 flex justify-between items-center">
                <div className="flex items-center gap-2">
                    <div className="w-8 h-8 bg-gradient-to-br from-blue-400 to-purple-600 rounded-lg"></div>
                    <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>
                        Ensemble Demo
                    </h1>
                </div>
                <div className="flex gap-2">
                    {navItems.map(item => (
                        <Link
                            key={item.path}
                            to={item.path}
                            className={location.pathname === item.path ? 'glass-button-active' : 'glass-button'}>
                            <span className="mr-2">{item.icon}</span> {item.label}
                        </Link>
                    ))}
                </div>
            </div>
        </nav>
    );
};

export default NavBar;
