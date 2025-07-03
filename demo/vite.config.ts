import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
    plugins: [react()],
    server: {
        port: 3000,
        proxy: {
            '/api/request': 'http://localhost:3005',
            '/api/voice': 'http://localhost:3004',
            '/api/embed': 'http://localhost:3006',
            '/api/listen': 'http://localhost:3003',
        },
    },
    build: {
        outDir: 'dist-react',
        rollupOptions: {
            input: {
                main: 'index.html',
                request: 'src/request/index.html',
            },
        },
    },
});
