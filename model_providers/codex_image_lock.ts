const codexImageArtifactLocks = new Map<string, Promise<void>>();

export async function runWithCodexImageArtifactLock<T>(codexHome: string, task: () => Promise<T>): Promise<T> {
    const previous = codexImageArtifactLocks.get(codexHome) || Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>(resolve => {
        release = resolve;
    });
    codexImageArtifactLocks.set(
        codexHome,
        previous.then(
            () => current,
            () => current
        )
    );

    await previous;
    try {
        return await task();
    } finally {
        release();
        if (codexImageArtifactLocks.get(codexHome) === current) {
            codexImageArtifactLocks.delete(codexHome);
        }
    }
}
