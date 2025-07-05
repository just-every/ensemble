import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
    plugins: [react()],
    css: {
        preprocessorOptions: {
            scss: {
                api: 'modern-compiler', // Use the modern Sass API
            },
        },
    },
    server: {
        port: 3000,
    },
    build: {
        outDir: 'dist-react',
        rollupOptions: {
            input: {
                main: 'index.html',
            },
        },
    },
});
