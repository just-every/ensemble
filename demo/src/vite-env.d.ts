/// <reference types="vite/client" />

interface ImportMetaEnv {
    readonly VITE_UNIFIED_SERVER: string;
    readonly VITE_UNIFIED_PORT: string;
}

interface ImportMeta {
    readonly env: ImportMetaEnv;
}
