import { describe, expect, it, vi } from 'vitest';

import { readBrowserLibrarySampleFile } from '../readBrowserLibrarySampleFile';

type TestFileHandle = {
    getFile: () => Promise<File>;
};

type TestDirectoryHandle = {
    getDirectoryHandle: (name: string) => Promise<TestDirectoryHandle>;
    getFileHandle: (name: string) => Promise<TestFileHandle>;
};

function createDirectoryHandle({
    directories = new Map<string, TestDirectoryHandle>(),
    files = new Map<string, File>(),
}: {
    directories?: Map<string, TestDirectoryHandle>;
    files?: Map<string, File>;
} = {}): TestDirectoryHandle {
    return {
        getDirectoryHandle: vi.fn(async (name: string) => {
            const handle = directories.get(name);
            if (!handle) {
                throw new DOMException('missing directory', 'NotFoundError');
            }
            return handle;
        }),
        getFileHandle: vi.fn(async (name: string) => {
            const file = files.get(name);
            if (!file) {
                throw new DOMException('missing file', 'NotFoundError');
            }
            return { getFile: vi.fn(async () => file) };
        }),
    };
}

describe('readBrowserLibrarySampleFile', () => {
    it('should walk nested directory handles and return the selected file', async () => {
        const file = new File(['audio'], 'Kick.wav', { type: 'audio/wav' });
        const kicksDirectory = createDirectoryHandle({ files: new Map([['Kick.wav', file]]) });
        const drumsDirectory = createDirectoryHandle({ directories: new Map([['Kicks', kicksDirectory]]) });
        const rootHandle = createDirectoryHandle({ directories: new Map([['Drums', drumsDirectory]]) });

        const result = await readBrowserLibrarySampleFile({
            rootHandle,
            relativePath: 'Drums/Kicks/Kick.wav',
        });

        expect(result).toBe(file);
        expect(rootHandle.getDirectoryHandle).toHaveBeenCalledWith('Drums');
        expect(drumsDirectory.getDirectoryHandle).toHaveBeenCalledWith('Kicks');
        expect(kicksDirectory.getFileHandle).toHaveBeenCalledWith('Kick.wav');
    });

    it('should resolve a root-level sample without walking subdirectories', async () => {
        const file = new File(['audio'], 'Snare.wav', { type: 'audio/wav' });
        const rootHandle = createDirectoryHandle({ files: new Map([['Snare.wav', file]]) });

        const result = await readBrowserLibrarySampleFile({
            rootHandle,
            relativePath: 'Snare.wav',
        });

        expect(result).toBe(file);
        expect(rootHandle.getDirectoryHandle).not.toHaveBeenCalled();
        expect(rootHandle.getFileHandle).toHaveBeenCalledWith('Snare.wav');
    });
});
