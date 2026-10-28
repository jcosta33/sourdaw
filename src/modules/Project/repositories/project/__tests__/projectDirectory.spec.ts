import { describe, expect, it } from 'vitest';

import { readProjectDirectory, writeProjectDirectory, type ProjectDirectoryHandle } from '../projectDirectory';

class MemoryDirectory implements ProjectDirectoryHandle {
    readonly files = new Map<string, Uint8Array>();
    readonly directories = new Map<string, MemoryDirectory>();
    failCloseName: string | null = null;
    corruptCloseName: string | null = null;

    async getFileHandle(name: string, options?: { create?: boolean }) {
        if (!this.files.has(name) && !options?.create) {
            throw new DOMException('Missing file', 'NotFoundError');
        }
        return {
            getFile: async () => ({
                arrayBuffer: async () => Uint8Array.from(this.files.get(name) ?? []).buffer,
            }),
            createWritable: async () => {
                let pending: Uint8Array | null = null;
                return {
                    write: async (bytes: Uint8Array) => {
                        pending = Uint8Array.from(bytes);
                    },
                    close: async () => {
                        if (name === this.failCloseName) {
                            throw new DOMException('Quota', 'QuotaExceededError');
                        }
                        if (pending) {
                            this.files.set(name, name === this.corruptCloseName ? new Uint8Array([0]) : pending);
                        }
                    },
                    abort: async () => {
                        pending = null;
                    },
                };
            },
        };
    }

    async getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<MemoryDirectory> {
        const existing = this.directories.get(name);
        if (existing) {
            return existing;
        }
        if (!options?.create) {
            throw new DOMException('Missing directory', 'NotFoundError');
        }
        const directory = new MemoryDirectory();
        this.directories.set(name, directory);
        return directory;
    }
}

async function hash(bytes: Uint8Array): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return `sha256:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

async function write(
    directory: MemoryDirectory,
    projectId: string,
    document: string,
    media: ReadonlyMap<string, Blob> = new Map(),
    pcm: ReadonlyMap<string, AudioBuffer> = new Map()
) {
    return writeProjectDirectory({
        directory,
        projectId,
        document: new TextEncoder().encode(document),
        snapshot: JSON.stringify({ name: document }),
        media,
        unavailableOriginals: [],
        pcm,
        isCurrent: () => true,
    });
}

function makePcm(): AudioBuffer {
    const samples = new Float32Array([0.25, -0.5]);
    return {
        duration: samples.length / 48_000,
        length: samples.length,
        numberOfChannels: 1,
        sampleRate: 48_000,
        getChannelData: () => samples,
        copyFromChannel: (target) => target.set(samples),
        copyToChannel: (source) => samples.set(source),
    };
}

describe('project directory manifest commit', () => {
    const projectId = '00000000-0000-4000-8000-000000000001';

    it('commits exact raw bytes, immutable document content and a cold readable manifest', async () => {
        const directory = new MemoryDirectory();
        const raw = new TextEncoder().encode('original compressed media');
        const assetHash = await hash(raw);
        const manifest = await write(directory, projectId, 'first', new Map([[assetHash, new Blob([raw])]]));
        const cold = await readProjectDirectory(directory, projectId);
        expect(cold.manifest).toEqual(manifest);
        expect(Array.from(cold.media.get(assetHash) ?? [])).toEqual(Array.from(raw));
        expect(new TextDecoder().decode(cold.document)).toBe('first');
        expect(directory.files.has(manifest.document.path)).toBe(true);
    });

    it('retains the previous valid generation when the manifest close fails', async () => {
        const directory = new MemoryDirectory();
        const first = await write(directory, projectId, 'first');
        directory.failCloseName = 'manifest.json';
        await expect(write(directory, projectId, 'second')).rejects.toThrow('Quota');
        const cold = await readProjectDirectory(directory, projectId);
        expect(cold.manifest.generation).toBe(first.generation);
        expect(new TextDecoder().decode(cold.document)).toBe('first');
    });

    it('retains the previous generation when a new original is quota blocked or written incorrectly', async () => {
        const directory = new MemoryDirectory();
        const first = await write(directory, projectId, 'first');
        const raw = new TextEncoder().encode('second original');
        const assetHash = await hash(raw);
        const media = new Map([[assetHash, new Blob([raw])]]);
        const mediaDirectory = await directory.getDirectoryHandle('media');
        const name = `asset.${assetHash.slice(7)}.bin`;
        mediaDirectory.failCloseName = name;
        await expect(write(directory, projectId, 'second', media)).rejects.toThrow('Quota');
        mediaDirectory.failCloseName = null;
        mediaDirectory.corruptCloseName = name;
        await expect(write(directory, projectId, 'second', media)).rejects.toThrow('failed verification');
        const cold = await readProjectDirectory(directory, projectId);
        expect(cold.manifest.generation).toBe(first.generation);
        expect(new TextDecoder().decode(cold.document)).toBe('first');
    });

    it('rejects a missing or changed original even when the document and PCM are present', async () => {
        const directory = new MemoryDirectory();
        const raw = new TextEncoder().encode('original compressed media');
        const assetHash = await hash(raw);
        await write(
            directory,
            projectId,
            'first',
            new Map([[assetHash, new Blob([raw])]]),
            new Map([['buffer-1', makePcm()]])
        );
        expect((await readProjectDirectory(directory, projectId)).pcm.has('buffer-1')).toBe(true);
        const mediaDirectory = directory.directories.get('media');
        const name = `asset.${assetHash.slice(7)}.bin`;
        mediaDirectory?.files.set(name, new TextEncoder().encode('wrong'));
        await expect(readProjectDirectory(directory, projectId)).rejects.toThrow('No valid project manifest');
    });
});
