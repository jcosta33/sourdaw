import { desktopInvoke } from '#/utils/desktopBridge';

type NativeDirectoryEntry = {
    name: string;
    isDirectory: boolean;
};

type ReadNativeDirectoryInput = {
    path: string;
};

type ReadNativeDirectoryOutput = Promise<NativeDirectoryEntry[]>;

type NativeDirectoryEntryCandidate = {
    name?: unknown;
    is_directory?: unknown;
};

function parseNativeDirectoryEntry(rawEntry: unknown): NativeDirectoryEntry {
    if (typeof rawEntry !== 'object' || rawEntry === null) {
        throw new TypeError('list_directory returned a non-object entry');
    }

    const entry = rawEntry as NativeDirectoryEntryCandidate;
    if (typeof entry.name !== 'string' || typeof entry.is_directory !== 'boolean') {
        throw new TypeError('list_directory returned an invalid entry payload');
    }

    return {
        name: entry.name,
        isDirectory: entry.is_directory,
    };
}

export async function readNativeDirectory({ path }: ReadNativeDirectoryInput): ReadNativeDirectoryOutput {
    const entries: unknown = await desktopInvoke('list_directory', { path });

    if (!Array.isArray(entries)) {
        throw new TypeError('list_directory returned a non-array payload');
    }

    return entries.map((entry) => parseNativeDirectoryEntry(entry));
}
