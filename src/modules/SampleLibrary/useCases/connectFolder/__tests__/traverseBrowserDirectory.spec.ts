import { describe, expect, it, vi } from 'vitest';

import { traverseBrowserDirectory } from '../traverseBrowserDirectory';

type MockDirectoryEntry = MockFileEntry | MockFolderEntry;

type MockFileEntry = {
    kind: 'file';
    name: string;
    getFile: () => Promise<{ lastModified: number }>;
};

type MockFolderEntry = {
    kind: 'directory';
    name: string;
    values: () => AsyncIterable<MockDirectoryEntry>;
};

function createFileEntry({ name, lastModified }: { name: string; lastModified: number }): MockFileEntry {
    return {
        kind: 'file',
        name,
        getFile: vi.fn(async () => ({ lastModified })),
    };
}

function createUnreadableFileEntry(name: string): MockFileEntry {
    return {
        kind: 'file',
        name,
        getFile: vi.fn(async () => {
            throw new DOMException('lost permission', 'NotAllowedError');
        }),
    };
}

function createFolderEntry(name: string, entries: MockDirectoryEntry[]): MockFolderEntry {
    return {
        kind: 'directory',
        name,
        async *values() {
            yield* entries;
        },
    };
}

async function collectBrowserEntries(
    dir: FileSystemDirectoryHandle
): Promise<Array<{ path: string; name: string; mtimeMs?: number }>> {
    const entries: Array<{ path: string; name: string; mtimeMs?: number }> = [];
    for await (const entry of traverseBrowserDirectory(dir, '')) {
        entries.push({
            path: entry.path,
            name: entry.name,
            mtimeMs: entry.mtimeMs,
        });
    }
    return entries;
}

describe('traverseBrowserDirectory', () => {
    it('should recursively yield only audio files with relative paths and mtime', async () => {
        const kick = createFileEntry({ name: 'kick.WAV', lastModified: 100 });
        const notes = createFileEntry({ name: 'notes.txt', lastModified: 200 });
        const snare = createFileEntry({ name: 'snare.aiff', lastModified: 300 });
        const root = createFolderEntry('Samples', [kick, notes, createFolderEntry('Drums', [snare])]);

        const entries = await collectBrowserEntries(root as unknown as FileSystemDirectoryHandle);

        expect(entries).toEqual([
            { path: 'kick.WAV', name: 'kick.WAV', mtimeMs: 100 },
            { path: 'Drums/snare.aiff', name: 'snare.aiff', mtimeMs: 300 },
        ]);
        expect(kick.getFile).toHaveBeenCalledTimes(1);
        expect(snare.getFile).toHaveBeenCalledTimes(1);
        expect(notes.getFile).not.toHaveBeenCalled();
    });

    it('should still yield an audio file when mtime capture fails', async () => {
        const root = createFolderEntry('Samples', [createUnreadableFileEntry('locked.mp3')]);

        const entries = await collectBrowserEntries(root as unknown as FileSystemDirectoryHandle);

        expect(entries).toEqual([{ path: 'locked.mp3', name: 'locked.mp3', mtimeMs: undefined }]);
    });
});
