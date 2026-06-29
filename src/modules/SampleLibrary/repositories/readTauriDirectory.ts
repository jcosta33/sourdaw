type TauriDirectoryEntry = {
    name: string;
    isDirectory: boolean;
};

type ReadTauriDirectoryInput = {
    path: string;
};

type ReadTauriDirectoryOutput = Promise<TauriDirectoryEntry[]>;

export async function readTauriDirectory({ path }: ReadTauriDirectoryInput): ReadTauriDirectoryOutput {
    const { readDir } = await import('@tauri-apps/plugin-fs');
    const entries = await readDir(path);

    return entries.map((entry) => ({
        name: entry.name,
        isDirectory: entry.isDirectory,
    }));
}
