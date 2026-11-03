import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

class SelectedDirectory implements FileSystemDirectoryHandle {
    readonly kind = 'directory' as const;
    private readonly children = new Map<string, SelectedDirectory>();

    constructor(readonly name: string) {}

    async getDirectoryHandle(name: string, options?: FileSystemGetDirectoryOptions): Promise<SelectedDirectory> {
        const existing = this.children.get(name);
        if (existing) {
            return existing;
        }
        if (!options?.create) {
            throw new DOMException('Missing directory', 'NotFoundError');
        }
        const child = new SelectedDirectory(name);
        this.children.set(name, child);
        return child;
    }

    getFileHandle(): Promise<FileSystemFileHandle> {
        return Promise.reject(new DOMException('This directory contains no files', 'NotFoundError'));
    }

    isSameEntry(other: FileSystemHandle): Promise<boolean> {
        return Promise.resolve(other === this);
    }

    queryPermission(): Promise<PermissionState> {
        return Promise.resolve('granted');
    }

    requestPermission(): Promise<PermissionState> {
        return this.queryPermission();
    }

    async *entries(): AsyncGenerator<[string, FileSystemDirectoryHandle], undefined, unknown> {
        yield* this.children;
        return undefined;
    }

    [Symbol.asyncIterator]() {
        return this.entries();
    }

    async *keys(): AsyncGenerator<string, undefined, unknown> {
        yield* this.children.keys();
        return undefined;
    }

    async *values(): AsyncGenerator<FileSystemDirectoryHandle, undefined, unknown> {
        yield* this.children.values();
        return undefined;
    }

    async resolve(other: FileSystemHandle): Promise<string[] | null> {
        if (other === this) {
            return [];
        }
        for (const [name, child] of this.children) {
            const path = await child.resolve(other);
            if (path) {
                return [name, ...path];
            }
        }
        return null;
    }

    async removeEntry(name: string, options?: FileSystemRemoveOptions): Promise<void> {
        const child = this.children.get(name);
        if (!child) {
            throw new DOMException('Missing directory', 'NotFoundError');
        }
        if (!options?.recursive && child.children.size > 0) {
            throw new DOMException('Directory is not empty', 'InvalidModificationError');
        }
        this.children.delete(name);
    }
}

describe('private project directory binding cache', () => {
    beforeEach(() => {
        vi.resetModules();
        vi.stubGlobal('indexedDB', new IDBFactory());
        const clone = structuredClone;
        // Node cannot serialize native FSA handles. Preserve this platform value
        // across fake IDB's clone boundary without changing its event scheduling.
        vi.stubGlobal('structuredClone', (value: unknown): unknown => {
            if (value instanceof SelectedDirectory) {
                return value;
            }
            if (
                typeof value === 'object' &&
                value !== null &&
                'root' in value &&
                value.root instanceof SelectedDirectory
            ) {
                return { ...value, root: value.root };
            }
            return clone(value);
        });
        Object.defineProperty(window, 'showDirectoryPicker', {
            configurable: true,
            value: async () => new SelectedDirectory('picker'),
        });
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        Reflect.deleteProperty(window, 'showDirectoryPicker');
    });

    it('keeps a newer selected folder when an earlier uncached root read completes', async () => {
        const first = new SelectedDirectory('A');
        const selected = new SelectedDirectory('B');
        const initial = (await import('../projectDirectoryBinding')).projectDirectoryBinding;
        await initial.bindProjectDirectoryRoot('P', first, 'saved-P');
        vi.resetModules();
        const binding = (await import('../projectDirectoryBinding')).projectDirectoryBinding;
        expect(binding.cachedProjectDirectoryRoot('P')).toBeNull();

        const earlierRead = binding.loadProjectDirectoryRoot('P');
        const newerSelection = binding.bindProjectDirectoryRoot('P', selected, 'saved-P');
        await Promise.all([earlierRead, newerSelection]);

        expect((await binding.loadProjectDirectoryBinding('last'))?.root).toBe(selected);
        vi.resetModules();
        const cold = (await import('../projectDirectoryBinding')).projectDirectoryBinding;
        expect(await cold.loadProjectDirectoryRoot('P')).toBe(selected);
        expect(binding.cachedProjectDirectoryRoot('P')).toBe(selected);
        expect(await binding.loadProjectDirectoryRoot('P')).toBe(selected);
    });

    it('does not repopulate a cleared project from an earlier uncached read', async () => {
        const initial = (await import('../projectDirectoryBinding')).projectDirectoryBinding;
        await initial.bindProjectDirectoryRoot('P', new SelectedDirectory('A'), 'saved-P');
        vi.resetModules();
        const binding = (await import('../projectDirectoryBinding')).projectDirectoryBinding;
        const earlierRead = binding.loadProjectDirectoryRoot('P');
        const clear = binding.clearLastProjectDirectoryBinding('P');
        const [readRoot] = await Promise.all([earlierRead, clear]);
        expect(readRoot).toBeNull();
        expect(binding.cachedProjectDirectoryRoot('P')).toBeNull();
        expect(await binding.loadProjectDirectoryRoot('P')).toBeNull();
        expect(await binding.loadProjectDirectoryBinding('last')).toBeNull();
    });

    it('does not revive an older root when the selected folder bookmark fails', async () => {
        const first = new SelectedDirectory('A');
        const initial = (await import('../projectDirectoryBinding')).projectDirectoryBinding;
        await initial.bindProjectDirectoryRoot('P', first, 'saved-P');
        vi.resetModules();
        const binding = (await import('../projectDirectoryBinding')).projectDirectoryBinding;
        const earlierRead = binding.loadProjectDirectoryRoot('P');
        const failure = new Error('Private bookmark unavailable');
        vi.spyOn(indexedDB, 'open').mockImplementationOnce(() => {
            throw failure;
        });
        await expect(binding.bindProjectDirectoryRoot('P', new SelectedDirectory('B'), 'saved-P')).rejects.toBe(
            failure
        );
        await expect(earlierRead).resolves.toBeNull();
        expect(binding.cachedProjectDirectoryRoot('P')).toBeNull();
        await expect(binding.loadProjectDirectoryRoot('P')).resolves.toBeNull();
        vi.resetModules();
        const cold = (await import('../projectDirectoryBinding')).projectDirectoryBinding;
        expect(await cold.loadProjectDirectoryRoot('P')).toBe(first);
    });

    it('caches a current durable read and exposes database open failures', async () => {
        const selected = new SelectedDirectory('current');
        const initial = (await import('../projectDirectoryBinding')).projectDirectoryBinding;
        await initial.bindProjectDirectoryRoot('P', selected, 'saved-P');
        vi.resetModules();
        const binding = (await import('../projectDirectoryBinding')).projectDirectoryBinding;
        expect(await binding.loadProjectDirectoryRoot('P')).toBe(selected);
        expect(binding.cachedProjectDirectoryRoot('P')).toBe(selected);
        vi.stubGlobal('indexedDB', undefined);
        await expect(binding.loadProjectDirectoryRoot('unknown')).rejects.toThrow(
            'Project directory bindings are unavailable'
        );
    });
});
