import { access, mkdir, symlink } from 'fs/promises';
import path from 'path';

const SHARED_CODEX_HOME_FILES = [
    'auth.json',
    'installation_id',
] as const;

async function linkIfPresent(source: string, target: string): Promise<void> {
    try {
        await access(source);
    } catch {
        return;
    }
    await symlink(source, target);
}

export async function prepareIsolatedCodexHome(baseCodexHome: string, tempDir: string): Promise<string> {
    const isolatedCodexHome = path.join(tempDir, 'codex-home');
    await mkdir(isolatedCodexHome, { recursive: true });
    await Promise.all(
        SHARED_CODEX_HOME_FILES.map(fileName => (
            linkIfPresent(path.join(baseCodexHome, fileName), path.join(isolatedCodexHome, fileName))
        ))
    );
    return isolatedCodexHome;
}
