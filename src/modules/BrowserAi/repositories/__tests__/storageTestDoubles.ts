import { vi } from 'vitest';

export type FakeFile = { kind: 'file'; size: number };
export type FakeDir = {
    kind: 'directory';
    entries: Map<string, FakeFile | FakeDir>;
};

export function file(size: number): FakeFile {
    return { kind: 'file', size };
}

export function dir(entries: Record<string, FakeFile | FakeDir> = {}): FakeDir {
    return { kind: 'directory', entries: new Map(Object.entries(entries)) };
}

export function notFound(): DOMException {
    return new DOMException('not found', 'NotFoundError');
}

function fileHandleFor(size: number): FileSystemFileHandle {
    return {
        kind: 'file',
        getFile(): Promise<{ size: number }> {
            return Promise.resolve({ size });
        },
    } as unknown as FileSystemFileHandle;
}

export function asHandle(node: FakeDir): FileSystemDirectoryHandle {
    const handle = {
        kind: 'directory' as const,
        getDirectoryHandle(name: string, opts?: { create?: boolean }): Promise<FileSystemDirectoryHandle> {
            const existing = node.entries.get(name);
            if (existing?.kind === 'directory') {
                return Promise.resolve(asHandle(existing));
            }
            if (opts?.create) {
                const created = dir();
                node.entries.set(name, created);
                return Promise.resolve(asHandle(created));
            }
            return Promise.reject(notFound());
        },
        getFileHandle(name: string, opts?: { create?: boolean }): Promise<FileSystemFileHandle> {
            const existing = node.entries.get(name);
            if (existing?.kind === 'file') {
                return Promise.resolve(fileHandleFor(existing.size));
            }
            if (opts?.create) {
                const created = file(0);
                node.entries.set(name, created);
                return Promise.resolve(fileHandleFor(0));
            }
            return Promise.reject(notFound());
        },
        async *[Symbol.asyncIterator](): AsyncIterableIterator<
            [string, FileSystemFileHandle | FileSystemDirectoryHandle]
        > {
            await Promise.resolve();
            for (const [name, child] of node.entries) {
                yield [name, child.kind === 'file' ? fileHandleFor(child.size) : asHandle(child)];
            }
        },
    };
    return handle as unknown as FileSystemDirectoryHandle;
}

export function installStorage(root: FakeDir, overrides?: Partial<StorageManager>): void {
    Object.defineProperty(globalThis.navigator, 'storage', {
        configurable: true,
        value: {
            getDirectory: vi.fn(() => Promise.resolve(asHandle(root))),
            estimate: vi.fn(() => Promise.resolve({ quota: 0, usage: 0 })),
            persisted: vi.fn(() => Promise.resolve(false)),
            persist: vi.fn(() => Promise.resolve(false)),
            ...overrides,
        },
    });
}
