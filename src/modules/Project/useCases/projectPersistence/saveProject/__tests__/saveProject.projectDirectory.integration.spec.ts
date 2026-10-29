import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Container } from '#/infra/di/Container';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { flushAutomergeStorageWrites } from '#/infra/store/storage/createAutomergeStorage';
import { createControlledLockManager } from '#/infra/testing/createControlledLockManager';
import { clearHandlerRegistry, registerHandlerMap } from '#/modules/Command/stores';
import { notifyUser } from '#/utils/Notification/notifyUser';

import type { ProjectDirectoryHandle } from '../../../../repositories/project/projectDirectory';

function filePosition(value: number | null | undefined): number {
    if (value === null || value === undefined || !Number.isSafeInteger(value) || value < 0) {
        throw new TypeError('Expected a nonnegative file position');
    }
    return value;
}

async function fileBytes(data: Blob | BufferSource | string): Promise<Uint8Array<ArrayBuffer>> {
    if (typeof data === 'string') {
        return new TextEncoder().encode(data);
    }
    if (data instanceof Blob) {
        const bytes = await new Promise<ArrayBuffer>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
                if (reader.result === null || typeof reader.result === 'string') {
                    reject(new TypeError('Expected file bytes'));
                    return;
                }
                resolve(reader.result);
            };
            reader.onerror = () => reject(reader.error);
            reader.readAsArrayBuffer(data);
        });
        return new Uint8Array(bytes);
    }
    if (ArrayBuffer.isView(data)) {
        return Uint8Array.from(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
    }
    return Uint8Array.from(new Uint8Array(data));
}

function createMemoryWritable(
    initial: Uint8Array,
    commit: (bytes: Uint8Array<ArrayBuffer>) => void
): FileSystemWritableFileStream {
    let pending = Uint8Array.from(initial);
    let position = 0;
    const resize = (size: number) => {
        const next = new Uint8Array(size);
        next.set(pending.subarray(0, size));
        pending = next;
    };
    const stream = new WritableStream<FileSystemWriteChunkType>({
        async write(chunk) {
            let data: Blob | BufferSource | string;
            if (typeof chunk === 'object' && !(chunk instanceof Blob) && 'type' in chunk) {
                if (chunk.type === 'seek') {
                    if (chunk.position === null || chunk.position === undefined) {
                        throw new TypeError('Expected a nonnegative file position');
                    }
                    position = filePosition(chunk.position);
                    return;
                }
                if (chunk.type === 'truncate') {
                    if (chunk.size === null || chunk.size === undefined) {
                        throw new TypeError('Expected a nonnegative file position');
                    }
                    const size = filePosition(chunk.size);
                    resize(size);
                    position = Math.min(position, size);
                    return;
                }
                if (chunk.data === undefined || chunk.data === null) {
                    throw new TypeError('A file write requires data');
                }
                if (chunk.position !== null && chunk.position !== undefined) {
                    position = filePosition(chunk.position);
                }
                data = chunk.data;
            } else if (
                typeof chunk === 'string' ||
                chunk instanceof Blob ||
                chunk instanceof ArrayBuffer ||
                ArrayBuffer.isView(chunk)
            ) {
                data = chunk;
            } else {
                throw new TypeError('Unsupported file write');
            }
            const bytes = await fileBytes(data);
            if (position + bytes.byteLength > pending.byteLength) {
                resize(position + bytes.byteLength);
            }
            pending.set(bytes, position);
            position += bytes.byteLength;
        },
        close: () => commit(Uint8Array.from(pending)),
    });
    const write = async (data: FileSystemWriteChunkType) => {
        const writer = stream.getWriter();
        try {
            await writer.write(data);
        } finally {
            writer.releaseLock();
        }
    };
    return Object.assign(stream, {
        write,
        seek: (position: number) => write({ type: 'seek', position }),
        truncate: (size: number) => write({ type: 'truncate', size }),
    });
}

class MemoryDirectory implements FileSystemDirectoryHandle, ProjectDirectoryHandle {
    readonly kind = 'directory' as const;
    readonly files = new Map<string, Uint8Array>();
    readonly directories = new Map<string, MemoryDirectory>();
    private readonly fileHandles = new Map<string, FileSystemFileHandle>();
    private removed = false;
    beforeRead: ((name: string) => Promise<void>) | undefined;

    constructor(readonly name: string) {}

    private requireEntry(): void {
        if (this.removed) {
            throw new DOMException('Missing directory', 'NotFoundError');
        }
    }

    async getFileHandle(name: string, options?: FileSystemGetFileOptions): Promise<FileSystemFileHandle> {
        this.requireEntry();
        if (this.directories.has(name)) {
            throw new DOMException('Entry is a directory', 'TypeMismatchError');
        }
        const existing = this.fileHandles.get(name);
        if (existing) {
            return existing;
        }
        if (!this.files.has(name) && !options?.create) {
            throw new DOMException('Missing file', 'NotFoundError');
        }
        const handle: FileSystemFileHandle = {
            kind: 'file',
            name,
            getFile: async () => {
                this.requireEntry();
                if (this.fileHandles.get(name) !== handle) {
                    throw new DOMException('Missing file', 'NotFoundError');
                }
                const file = new File([Uint8Array.from(this.files.get(name) ?? [])], name);
                Object.defineProperty(file, 'arrayBuffer', {
                    value: async () => {
                        await this.beforeRead?.(name);
                        return Uint8Array.from(this.files.get(name) ?? []).buffer;
                    },
                });
                return file;
            },
            createWritable: async (options) =>
                createMemoryWritable(
                    options?.keepExistingData ? (this.files.get(name) ?? new Uint8Array()) : new Uint8Array(),
                    (bytes) => this.files.set(name, bytes)
                ),
            createSyncAccessHandle: () =>
                Promise.reject(new DOMException('This fixture runs outside a worker', 'NotSupportedError')),
            isSameEntry: (other) => Promise.resolve(other === handle),
            queryPermission: () => this.queryPermission(),
            requestPermission: () => this.requestPermission(),
        };
        this.fileHandles.set(name, handle);
        return handle;
    }

    async getDirectoryHandle(name: string, options?: FileSystemGetDirectoryOptions): Promise<MemoryDirectory> {
        this.requireEntry();
        if (this.files.has(name) || this.fileHandles.has(name)) {
            throw new DOMException('Entry is a file', 'TypeMismatchError');
        }
        const existing = this.directories.get(name);
        if (existing) {
            return existing;
        }
        if (!options?.create) {
            throw new DOMException('Missing directory', 'NotFoundError');
        }
        const next = new MemoryDirectory(name);
        this.directories.set(name, next);
        return next;
    }

    isSameEntry(other: FileSystemHandle): Promise<boolean> {
        return Promise.resolve(other === this);
    }

    queryPermission(): Promise<PermissionState> {
        return Promise.resolve(folder.permission ? 'granted' : 'denied');
    }

    requestPermission(): Promise<PermissionState> {
        return this.queryPermission();
    }

    async *entries(): AsyncGenerator<[string, FileSystemDirectoryHandle | FileSystemFileHandle], undefined, unknown> {
        this.requireEntry();
        yield* this.directories;
        for (const name of new Set([...this.files.keys(), ...this.fileHandles.keys()])) {
            yield [name, await this.getFileHandle(name)];
        }
        return undefined;
    }

    [Symbol.asyncIterator]() {
        return this.entries();
    }

    async *keys(): AsyncGenerator<string, undefined, unknown> {
        for await (const [name] of this.entries()) {
            yield name;
        }
        return undefined;
    }

    async *values(): AsyncGenerator<FileSystemDirectoryHandle | FileSystemFileHandle, undefined, unknown> {
        for await (const [, entry] of this.entries()) {
            yield entry;
        }
        return undefined;
    }

    async resolve(possibleDescendant: FileSystemHandle): Promise<string[] | null> {
        if (possibleDescendant === this) {
            return [];
        }
        for await (const [name, entry] of this.entries()) {
            if (await entry.isSameEntry(possibleDescendant)) {
                return [name];
            }
            if (entry.kind === 'directory') {
                const nested = await entry.resolve(possibleDescendant);
                if (nested) {
                    return [name, ...nested];
                }
            }
        }
        return null;
    }

    async removeEntry(name: string, options?: FileSystemRemoveOptions): Promise<void> {
        this.requireEntry();
        const directory = this.directories.get(name);
        if (directory) {
            if (
                !options?.recursive &&
                (directory.directories.size > 0 || directory.files.size > 0 || directory.fileHandles.size > 0)
            ) {
                throw new DOMException('Directory is not empty', 'InvalidModificationError');
            }
            for await (const child of directory.keys()) {
                await directory.removeEntry(child, { recursive: true });
            }
            directory.removed = true;
            this.directories.delete(name);
            return;
        }
        if (!this.files.has(name) && !this.fileHandles.has(name)) {
            throw new DOMException('Missing entry', 'NotFoundError');
        }
        this.files.delete(name);
        this.fileHandles.delete(name);
    }
}

const folder = vi.hoisted(() => ({
    root: null as MemoryDirectory | null,
    bound: new Map<string, { projectId: string; recentKey: string; root: MemoryDirectory }>(),
    permission: true,
    bindFail: false,
    beforeBindingRead: null as (() => Promise<void>) | null,
}));

let stopHistoryMirror: (() => void) | undefined;

vi.mock('../../../../repositories/project/projectDirectoryBinding', () => ({
    projectDirectoryBinding: {
        beginProjectDirectorySelection: () => Promise.resolve(folder.root),
        cachedProjectDirectoryRoot: (projectId: string) => folder.bound.get(projectId)?.root ?? null,
        loadProjectDirectoryRoot: async (projectId: string) => folder.bound.get(projectId)?.root ?? null,
        loadProjectDirectoryBinding: async (key: string) => {
            const binding = folder.bound.get(key) ?? null;
            await folder.beforeBindingRead?.();
            return binding;
        },
        bindProjectDirectoryRoot: async (projectId: string, root: MemoryDirectory, recentKey: string) => {
            if (folder.bindFail) {
                throw new Error('Folder bookmark storage failed');
            }
            const binding = { projectId, recentKey, root };
            folder.bound.set(projectId, binding);
            folder.bound.set(`recent:${recentKey}`, binding);
            folder.bound.set('last', binding);
        },
        clearLastProjectDirectoryBinding: async () => {
            folder.bound.delete('last');
        },
        openProjectDirectory: async (root: MemoryDirectory, projectId: string, create: boolean) => {
            if (!folder.permission) {
                throw new Error('Project folder permission is unavailable');
            }
            if (root.name === projectId) {
                return root;
            }
            const projects = await root.getDirectoryHandle('projects', { create });
            return projects.getDirectoryHandle(projectId, { create });
        },
    },
}));

function makePcm(samples: Float32Array<ArrayBuffer>): AudioBuffer {
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

function makeWave(samples: Float32Array): File {
    const bytes = new ArrayBuffer(44 + samples.length * 2);
    const view = new DataView(bytes);
    const ascii = (offset: number, value: string) => {
        for (let index = 0; index < value.length; index++) {
            view.setUint8(offset + index, value.charCodeAt(index));
        }
    };
    ascii(0, 'RIFF');
    view.setUint32(4, bytes.byteLength - 8, true);
    ascii(8, 'WAVE');
    ascii(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, 48_000, true);
    view.setUint32(28, 96_000, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    ascii(36, 'data');
    view.setUint32(40, samples.length * 2, true);
    for (const [index, sample] of samples.entries()) {
        view.setInt16(44 + index * 2, Math.round(sample * 0x7fff), true);
    }
    const file = new File([bytes], 'original.wav', { type: 'audio/wav' });
    Object.defineProperty(file, 'arrayBuffer', { value: () => Promise.resolve(bytes.slice(0)) });
    return file;
}

async function createSavedDirectoryProject() {
    const [
        audio,
        arrangement,
        project,
        projectStores,
        arrangementStores,
        crdt,
        helpers,
        metadata,
        collaboration,
        command,
        plugins,
        automerge,
    ] = await Promise.all([
        import('#/modules/AudioEngine/useCases'),
        import('#/modules/Arrangement/useCases'),
        import('#/modules/Project/useCases'),
        import('#/modules/Project/stores'),
        import('#/modules/Arrangement/stores'),
        import('#/modules/CrdtDocument/useCases'),
        import('../../helpers/resetModuleStoresToDefault'),
        import('../../../createFreshProjectMetadata'),
        import('#/modules/Collaboration/useCases'),
        import('#/modules/Command/useCases'),
        import('#/modules/PluginHost/useCases'),
        import('@automerge/automerge'),
    ]);
    Object.assign(audio.audioEngine.context, {
        createBuffer: (_channels: number, length: number) => makePcm(new Float32Array(length)),
        decodeAudioData: async (bytes: ArrayBuffer) => {
            const view = new DataView(bytes);
            const samples = new Float32Array(view.getUint32(40, true) / 2);
            for (const [index] of samples.entries()) {
                samples[index] = view.getInt16(44 + index * 2, true) / 0x7fff;
            }
            return makePcm(samples);
        },
    });
    arrangement.setArrangementEventBus({ emit: () => Promise.resolve() });
    const { getProductionCommandHandlerMaps } = await import('#/app/getProductionCommandHandlerMaps');
    const handlerMaps = getProductionCommandHandlerMaps({ canMutateBranchMetadata: () => true });
    command.registerProductionCommandHandlers(handlerMaps);
    command.setActionHistoryMetadataPort({
        record: crdt.recordActionHistoryEntry,
        recordBatch: crdt.recordActionHistoryEntries,
        markReverted: crdt.markActionHistoryEntryReverted,
        clear: crdt.clearActionHistory,
    });
    crdt.sessionUndoWitnessStampPort.setProvider(command.stampSessionUndoWitness);
    const { actionHistoryStore } = await import('#/modules/CrdtDocument/stores');
    stopHistoryMirror = actionHistoryStore.subscribe((state) => command.syncActionReplayMetadata(state?.entries ?? []));
    crdt.registerCrdtStorageRuntime();
    collaboration.configureCollaborationAssetOwner({ captureOwnerId: project.getDurableProjectOwnerId });
    audio.configureDurableAudioBufferOwnership(project.collectDurableOwnedAudioBufferIds);
    const leave = vi.fn(() => Promise.resolve());
    project.setProjectIdentityTransitionDependencies({ leaveCollaborationSession: leave });
    crdt.resetCrdtProjectAuthority('Saved directory');
    helpers.resetModuleStoresToDefault();
    projectStores.projectStore.set({
        ...metadata.createFreshProjectMetadata({ name: 'Saved directory', loading: false, initialized: true }),
        createdAt: 1_700_000_000_000,
        updatedAt: 1_700_000_000_000,
        dirty: true,
    });
    await arrangement.importAudioFile(makeWave(new Float32Array([0, 0.5, -0.5, 0])), { shouldContinue: () => true });
    const clip = arrangementStores.trackStore.value?.tracks.flatMap((track) => track.clips)[0];
    if (!clip?.audioBufferId || !folder.root) {
        throw new Error('Expected real saved-directory audio');
    }
    command.reconcileSessionUndoForProject({
        projectId: projectStores.projectStore.value?.projectId,
        captureWitness: crdt.captureDurableDocumentWitness,
    });
    expect(await project.saveProject()).toBe(true);
    const projectId = projectStores.projectStore.value?.projectId;
    if (!projectId) {
        throw new Error('Expected saved directory identity');
    }
    const directory = await (await folder.root.getDirectoryHandle('projects')).getDirectoryHandle(projectId);
    const { runProjectLoadTransaction } = await import('../../helpers/runProjectLoadTransaction');
    return {
        audio,
        arrangement,
        project,
        projectStores,
        arrangementStores,
        crdt,
        helpers,
        metadata,
        command,
        plugins,
        automerge,
        leave,
        clip,
        projectId,
        directory,
        runProjectLoadTransaction,
        handlerMaps,
    };
}

async function createOutgoingDirectoryProject(runtime: Awaited<ReturnType<typeof createSavedDirectoryProject>>) {
    const { audio, arrangement, projectStores, crdt, helpers, metadata, command } = runtime;
    crdt.resetCrdtProjectAuthority('Outgoing');
    helpers.resetModuleStoresToDefault();
    command.clearUndoHistory();
    projectStores.projectStore.set({
        ...metadata.createFreshProjectMetadata({ name: 'Outgoing', loading: false, initialized: true }),
        createdAt: 1_700_000_000_001,
        updatedAt: 1_700_000_000_001,
        dirty: false,
    });
    await arrangement.importAudioFile(makeWave(new Float32Array([0.25, -0.25, 0.25, -0.25])), {
        shouldContinue: () => true,
    });
    const { trackStore } = await import('#/modules/Arrangement/stores');
    const clip = trackStore.value?.tracks.flatMap((track) => track.clips)[0];
    if (!clip?.audioBufferId) {
        throw new Error('Expected outgoing audio');
    }
    await command.executeAppAction({
        type: 'moveClip',
        payload: { clipId: clip.id, trackId: clip.trackId, startBeat: 4 },
    });
    expect(audio.getCachedAudioBuffer({ bufferId: clip.audioBufferId })).toBeTruthy();
    return clip.audioBufferId;
}

function captureDirectoryLoadBoundary(
    runtime: Awaited<ReturnType<typeof createSavedDirectoryProject>>,
    outgoingBufferId: string
) {
    flushAutomergeStorageWrites();
    const root = runtime.crdt.getCrdtDoc(runtime.crdt.DOC_PREFIX_ROOT);
    if (!root) {
        throw new Error('Expected a real project document at the held boundary');
    }
    return {
        root: runtime.automerge.toJS(root),
        identity: runtime.crdt.captureProjectRootIdentity(),
        project: structuredClone(runtime.projectStores.projectStore.value),
        owner: runtime.project.getDurableProjectOwnerId(),
        tracks: structuredClone(runtime.arrangementStores.trackStore.value),
        history: structuredClone(runtime.command.captureUndoHistory()),
        savedAudio: runtime.audio.getCachedAudioBuffer({ bufferId: runtime.clip.audioBufferId! }),
        outgoingAudio: runtime.audio.getCachedAudioBuffer({ bufferId: outgoingBufferId }),
    };
}

describe('project directory save and cold Recent open', () => {
    beforeEach(() => {
        folder.root = new MemoryDirectory('selected-root');
        folder.bound.clear();
        folder.permission = true;
        folder.bindFail = false;
        folder.beforeBindingRead = null;
        vi.stubGlobal('indexedDB', new IDBFactory());
        vi.stubGlobal('IDBKeyRange', IDBKeyRange);
        const nativeClone = structuredClone;
        vi.stubGlobal('structuredClone', (value: unknown) => {
            const cloned: unknown = nativeClone(value);
            if (
                typeof value === 'object' &&
                value !== null &&
                'blob' in value &&
                value.blob instanceof Blob &&
                typeof cloned === 'object' &&
                cloned !== null
            ) {
                Reflect.set(cloned, 'blob', value.blob.slice(0, value.blob.size, value.blob.type));
            }
            return cloned;
        });
        vi.stubGlobal('navigator', {
            ...navigator,
            locks: createControlledLockManager().locks,
            userActivation: { isActive: true },
        });
        Object.defineProperty(window, 'showDirectoryPicker', {
            configurable: true,
            value: () => Promise.resolve(folder.root),
        });
        injectDependencies(notifyUser, { eventBus: { emit: vi.fn(() => Promise.resolve()) } });
        clearHandlerRegistry();
        localStorage.clear();
        sessionStorage.clear();
    });

    afterEach(async () => {
        stopHistoryMirror?.();
        stopHistoryMirror = undefined;
        const [{ configureDurableAudioBufferOwnership }, { stopActiveAutoSave }] = await Promise.all([
            import('#/modules/AudioEngine/useCases'),
            import('../../helpers/stopActiveAutoSave'),
        ]);
        configureDurableAudioBufferOwnership(null);
        stopActiveAutoSave();
        clearHandlerRegistry();
        Container.clear();
        vi.unstubAllGlobals();
        Reflect.deleteProperty(window, 'showDirectoryPicker');
        Reflect.deleteProperty(window, 'showSaveFilePicker');
        vi.restoreAllMocks();
    });

    it('writes real document, PCM and original bytes; reopens them after session memory is removed', async () => {
        const [audio, arrangement, project, projectStores, arrangementStores, crdt, helpers, metadata, collaboration] =
            await Promise.all([
                import('#/modules/AudioEngine/useCases'),
                import('#/modules/Arrangement/useCases'),
                import('#/modules/Project/useCases'),
                import('#/modules/Project/stores'),
                import('#/modules/Arrangement/stores'),
                import('#/modules/CrdtDocument/useCases'),
                import('../../helpers/resetModuleStoresToDefault'),
                import('../../../createFreshProjectMetadata'),
                import('#/modules/Collaboration/useCases'),
            ]);
        Object.assign(audio.audioEngine.context, {
            createBuffer: (_channels: number, length: number) => makePcm(new Float32Array(length)),
            decodeAudioData: async (bytes: ArrayBuffer) => {
                const view = new DataView(bytes);
                const count = view.getUint32(40, true) / 2;
                const samples = new Float32Array(count);
                for (const [index] of samples.entries()) {
                    samples[index] = view.getInt16(44 + index * 2, true) / 0x7fff;
                }
                return makePcm(samples);
            },
        });
        arrangement.setArrangementEventBus({ emit: vi.fn(() => Promise.resolve()) });
        registerHandlerMap(arrangement.getArrangementHandlers());
        crdt.registerCrdtStorageRuntime();
        collaboration.configureCollaborationAssetOwner({ captureOwnerId: project.getDurableProjectOwnerId });
        audio.configureDurableAudioBufferOwnership(project.collectDurableOwnedAudioBufferIds);
        project.setProjectIdentityTransitionDependencies({ leaveCollaborationSession: () => Promise.resolve() });
        crdt.resetCrdtProjectAuthority('Folder');
        helpers.resetModuleStoresToDefault();
        const createdAt = 1_700_000_000_000;
        projectStores.projectStore.set({
            ...metadata.createFreshProjectMetadata({ name: 'Folder', loading: false, initialized: true }),
            createdAt,
            updatedAt: createdAt,
            dirty: true,
        });
        const original = makeWave(new Float32Array([0, 0.5, -0.5, 0]));
        await arrangement.importAudioFile(original, { shouldContinue: () => true });
        const clip = arrangementStores.trackStore.value?.tracks.flatMap((track) => track.clips)[0];
        await arrangement.importAudioFile(original, { shouldContinue: () => true });
        const secondClip = arrangementStores.trackStore.value?.tracks.flatMap((track) => track.clips)[1];
        expect(clip?.assetHash).toMatch(/^sha256:/);
        if (!clip?.assetHash) {
            throw new Error('Expected an imported original hash');
        }
        const residentTransfer = collaboration.getAssetTransfer();
        expect(await residentTransfer?.releaseDurableAsset(clip.assetHash)).toMatchObject({ status: 'released' });
        expect(residentTransfer?.getAsset(clip.assetHash)).toBeInstanceOf(Blob);
        expect(await project.saveProject()).toBe(true);
        const projectId = projectStores.projectStore.value?.projectId;
        if (!projectId || !folder.root || !clip?.assetHash || !clip.audioBufferId || !secondClip?.audioBufferId) {
            throw new Error('Expected a saved media-bearing project');
        }
        const { projectDirectory } = await import('../../../../repositories/project/projectDirectory');
        const directory = await (await folder.root.getDirectoryHandle('projects')).getDirectoryHandle(projectId);
        const committed = await projectDirectory.read(directory, projectId);
        expect(committed.media.has(clip.assetHash)).toBe(true);
        expect(committed.pcm.has(clip.audioBufferId)).toBe(true);
        expect(committed.pcm.has(secondClip.audioBufferId)).toBe(true);
        expect(secondClip.audioBufferId).not.toBe(clip.audioBufferId);
        expect(committed.document.byteLength).toBeGreaterThan(0);
        expect(Array.from(committed.document)).toEqual(
            Array.from(new Uint8Array(await crdt.exportSdawFile().arrayBuffer()))
        );
        const mediaDirectory = await directory.getDirectoryHandle('media');
        const mediaName = committed.manifest.media[0]?.path.slice('media/'.length);
        if (!mediaName) {
            throw new Error('Expected the original to be named in the manifest');
        }
        const originalBytes = mediaDirectory.files.get(mediaName);
        if (!originalBytes) {
            throw new Error('Expected the original bytes in the project folder');
        }
        const automerge = await import('@automerge/automerge');
        const savedRoot = crdt.getCrdtDoc(crdt.DOC_PREFIX_ROOT);
        if (!savedRoot) {
            throw new Error('Expected saved Automerge authority');
        }
        const savedChanges = automerge.getAllChanges(savedRoot).map((bytes) => Array.from(bytes));

        const originalMedia = new Map<string, Blob>(
            Array.from(committed.media, ([hash, bytes]): [string, Blob] => [hash, new Blob([Uint8Array.from(bytes)])])
        );
        const pcm = new Map<string, AudioBuffer>();
        for (const bufferId of committed.pcm.keys()) {
            const savedPcm = audio.getCachedAudioBuffer({ bufferId });
            if (!savedPcm) {
                throw new Error('Expected the saved PCM buffer');
            }
            pcm.set(bufferId, savedPcm);
        }
        type MediaClip = { id: string; audioBufferId?: string; assetHash?: string };
        type MediaTrack = {
            id: string;
            clips: MediaClip[];
            alternatives: Array<{ clips: MediaClip[] }>;
            freezeState: { frozenBufferId?: string };
        };
        type MediaRoot = {
            tracks: { tracks: MediaTrack[] };
            arrangements: { arrangements: Array<{ tracks: { tracks: MediaTrack[] } }> };
        };
        const savedTrack = (automerge.toJS(savedRoot) as MediaRoot).tracks.tracks[0]!;
        const changes: Array<(root: MediaRoot) => void> = [
            (root) => {
                root.tracks.tracks[0]!.clips[0]!.audioBufferId = 'unmanifested-audio-buffer';
            },
            (root) => {
                root.tracks.tracks[0]!.clips[0]!.audioBufferId = secondClip.audioBufferId;
            },
            (root) => {
                root.tracks.tracks[0]!.clips[0]!.assetHash = `sha256:${'0'.repeat(64)}`;
            },
            (root) => {
                root.tracks.tracks[0]!.alternatives[0]!.clips.push({
                    ...structuredClone(clip),
                    id: 'unmanifested-alternative',
                });
            },
            (root) => {
                root.tracks.tracks[0]!.freezeState.frozenBufferId = secondClip.audioBufferId;
            },
            (root) => {
                root.arrangements.arrangements[0]!.tracks.tracks.push({
                    ...savedTrack,
                    id: 'unmanifested-dormant-track',
                });
            },
        ];
        const alteredDocuments: Uint8Array[] = [];
        try {
            for (const changeRoot of changes) {
                const alteredRoot = automerge.change(automerge.clone(savedRoot as MediaRoot), changeRoot);
                crdt.replaceCrdtDoc({ id: crdt.DOC_PREFIX_ROOT, doc: alteredRoot });
                alteredDocuments.push(new Uint8Array(await crdt.exportSdawFile().arrayBuffer()));
            }
        } finally {
            crdt.replaceCrdtDoc({ id: crdt.DOC_PREFIX_ROOT, doc: savedRoot });
        }
        const writeAlteredDocument = async (document: Uint8Array): Promise<void> => {
            await projectDirectory.write({
                directory,
                projectId,
                document,
                snapshot: committed.snapshot,
                media: originalMedia,
                unavailableOriginals: committed.manifest.unavailableOriginals,
                pcm,
                isCurrent: () => true,
            });
        };

        const archiveCapture: { value: Blob | null } = { value: null };
        Object.defineProperty(window, 'showSaveFilePicker', {
            configurable: true,
            value: async () => ({
                createWritable: async () => ({
                    write: async (value: Blob) => {
                        archiveCapture.value = value;
                    },
                    close: async () => undefined,
                    abort: async () => undefined,
                }),
            }),
        });
        await project.exportProjectFile();
        const archiveBlob = archiveCapture.value;
        if (!archiveBlob) {
            throw new Error('Expected an archive to be exported');
        }
        const archiveText = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
                if (typeof reader.result !== 'string') {
                    reject(new Error('Expected a text project archive'));
                    return;
                }
                resolve(reader.result);
            };
            reader.onerror = () => reject(reader.error);
            reader.readAsText(archiveBlob);
        });
        const { readProjectOriginalMediaArchive } = await import('../../fileIO/readProjectOriginalMediaArchive');
        const archived = readProjectOriginalMediaArchive(JSON.parse(archiveText));
        expect(Array.from(archived?.media.get(clip.assetHash) ?? [])).toEqual(Array.from(originalBytes));

        audio.clearRuntimeCachedAudioBuffers();
        crdt.resetCrdtProjectAuthority('Blank');
        helpers.resetModuleStoresToDefault();
        projectStores.projectStore.set({
            ...metadata.createFreshProjectMetadata({ name: 'Blank', loading: false, initialized: true }),
            createdAt: createdAt + 1,
            updatedAt: createdAt + 1,
            dirty: false,
        });
        await arrangement.importAudioFile(makeWave(new Float32Array([0.25, -0.25, 0, 0])), {
            shouldContinue: () => true,
        });
        crdt.recordActionHistoryEntry({
            id: 'outgoing-undo',
            label: 'Outgoing edit',
            actionKind: 'test-edit',
            source: 'manual',
            timestamp: Date.now(),
            reverted: false,
        });
        projectStores.projectStore.set({ ...projectStores.projectStore.value!, dirty: false });
        const blankProjectId = projectStores.projectStore.value?.projectId;
        const blankRootIdentity = crdt.captureProjectRootIdentity();
        const { actionHistoryStore } = await import('#/modules/CrdtDocument/stores');
        const blankUndo = structuredClone(actionHistoryStore.value);
        const blankTracks = structuredClone(arrangementStores.trackStore.value?.tracks);
        const blankClip = blankTracks?.flatMap((track) => track.clips)[0];
        if (!blankClip?.audioBufferId) {
            throw new Error('Expected the outgoing audio clip');
        }
        const outgoingBufferId = blankClip.audioBufferId;
        const blankAudio = audio.getCachedAudioBuffer({ bufferId: outgoingBufferId });
        expect(blankAudio).toBeTruthy();
        expect(blankUndo?.entries.length).toBeGreaterThan(0);
        const expectMismatchRejected = async (document: Uint8Array): Promise<void> => {
            await writeAlteredDocument(document);
            expect(await project.loadRecentProject(project.getProjectSnapshotKey(createdAt))).toBe('failed');
            expect(projectStores.projectStore.value?.projectId).toBe(blankProjectId);
            expect(arrangementStores.trackStore.value?.tracks).toEqual(blankTracks);
            expect(crdt.captureProjectRootIdentity()).toBe(blankRootIdentity);
            expect(actionHistoryStore.value).toEqual(blankUndo);
            expect(audio.getCachedAudioBuffer({ bufferId: outgoingBufferId })).toBe(blankAudio);
        };
        for (const document of alteredDocuments) {
            await expectMismatchRejected(document);
        }
        await projectDirectory.write({
            directory,
            projectId,
            document: committed.document,
            snapshot: committed.snapshot,
            media: originalMedia,
            unavailableOriginals: committed.manifest.unavailableOriginals,
            pcm,
            isCurrent: () => true,
        });
        mediaDirectory.files.set(mediaName, new Uint8Array([1, 2, 3]));
        expect(await project.loadRecentProject(project.getProjectSnapshotKey(createdAt))).toBe('failed');
        expect(projectStores.projectStore.value?.projectId).toBe(blankProjectId);
        expect(arrangementStores.trackStore.value?.tracks).toEqual(blankTracks);
        mediaDirectory.files.set(mediaName, originalBytes);
        expect(await project.loadRecentProject(project.getProjectSnapshotKey(createdAt))).toBe('committed');
        const reopenedRoot = crdt.getCrdtDoc(crdt.DOC_PREFIX_ROOT);
        if (!reopenedRoot) {
            throw new Error('Expected reopened Automerge authority');
        }
        const reopenedChanges = automerge.getAllChanges(reopenedRoot).map((bytes) => Array.from(bytes));
        for (const change of savedChanges) {
            expect(reopenedChanges).toContainEqual(change);
        }
        const reopened = arrangementStores.trackStore.value?.tracks.flatMap((track) => track.clips)[0];
        expect(reopened?.audioBufferId).toBe(clip.audioBufferId);
        expect(audio.getCachedAudioBuffer({ bufferId: clip.audioBufferId })?.getChannelData(0)[1]).toBeCloseTo(0.5, 3);
        const asset = await collaboration.getAssetTransfer()?.reopenDurableAsset(clip.assetHash);
        expect(asset?.status).toBe('opened');

        audio.clearRuntimeCachedAudioBuffers();
        crdt.resetCrdtProjectAuthority('Boot blank');
        helpers.resetModuleStoresToDefault();
        projectStores.projectStore.set({
            ...metadata.createFreshProjectMetadata({ name: 'Boot blank', loading: false, initialized: true }),
            createdAt: createdAt + 2,
            updatedAt: createdAt + 2,
            dirty: false,
        });
        // A real boot starts in a fresh JS realm; the supplied transaction avoids
        // this test realm's intentional "boot loses to an earlier user choice" guard.
        const { runProjectLoadTransaction } = await import('../../helpers/runProjectLoadTransaction');
        expect(await project.loadProject({ transaction: runProjectLoadTransaction() })).toBe(true);
        expect(projectStores.projectStore.value?.projectId).toBe(projectId);

        audio.clearRuntimeCachedAudioBuffers();
        crdt.resetCrdtProjectAuthority('Picker blank');
        helpers.resetModuleStoresToDefault();
        projectStores.projectStore.set({
            ...metadata.createFreshProjectMetadata({ name: 'Picker blank', loading: false, initialized: true }),
            createdAt: createdAt + 3,
            updatedAt: createdAt + 3,
            dirty: false,
        });
        folder.root = directory;
        const { openProjectDirectoryFromPicker } = await import('../../openProjectDirectoryFromPicker');
        expect(await openProjectDirectoryFromPicker()).toBe(true);
        expect(projectStores.projectStore.value?.projectId).toBe(projectId);

        audio.clearRuntimeCachedAudioBuffers();
        crdt.resetCrdtProjectAuthority('Bookmark blank');
        helpers.resetModuleStoresToDefault();
        projectStores.projectStore.set({
            ...metadata.createFreshProjectMetadata({ name: 'Bookmark blank', loading: false, initialized: true }),
            createdAt: createdAt + 4,
            updatedAt: createdAt + 4,
            dirty: false,
        });
        folder.bindFail = true;
        expect(await openProjectDirectoryFromPicker()).toBe(true);
        expect(projectStores.projectStore.value?.projectId).toBe(projectId);
        folder.bindFail = false;

        folder.permission = false;
        projectStores.projectStore.set({ ...projectStores.projectStore.value!, dirty: true });
        expect(await project.saveProject()).toBe(false);
        expect(projectStores.projectStore.value?.dirty).toBe(true);
    }, 70_000);

    it.each(['binding', 'read', 'clear-runtime', 'unload', 'persist'] as const)(
        'withdraws a directory load held at %s without advancing the held state or blocking its successor',
        async (boundary) => {
            const runtime = await createSavedDirectoryProject();
            const outgoingBufferId = await createOutgoingDirectoryProject(runtime);
            const entered = Promise.withResolvers<void>();
            const release = Promise.withResolvers<void>();
            const hold = async () => {
                entered.resolve();
                await release.promise;
            };
            const compact = vi.spyOn(runtime.crdt, 'compactProject');
            let directory;
            if (boundary === 'unload') {
                const binding = folder.bound.get('last');
                if (!binding) {
                    throw new Error('Expected a real saved directory binding');
                }
                const { prepareProjectDirectoryRead } = await import('../../projectDirectoryRead');
                directory = await prepareProjectDirectoryRead(binding, () => true);
            }
            if (boundary === 'binding') {
                folder.beforeBindingRead = hold;
            } else if (boundary === 'read') {
                runtime.directory.beforeRead = async (name) => {
                    if (name === 'manifest.json') {
                        await hold();
                    }
                };
            } else if (boundary === 'clear-runtime') {
                const clearRuntime = runtime.audio.clearRuntimeCachedAudioBuffers;
                vi.spyOn(runtime.audio, 'clearRuntimeCachedAudioBuffers').mockImplementationOnce(async (input) => {
                    await clearRuntime(input);
                    await hold();
                });
            } else if (boundary === 'unload') {
                const unload = runtime.plugins.unloadPlugin;
                vi.spyOn(runtime.plugins, 'unloadPlugin').mockImplementationOnce(async (...args) => {
                    await unload(...args);
                    await hold();
                });
            } else {
                const importBuffers = runtime.audio.importCachedAudioBuffers;
                vi.spyOn(runtime.audio, 'importCachedAudioBuffers').mockImplementationOnce(async (input) => {
                    const candidate = await importBuffers(input);
                    if (!candidate) {
                        throw new Error('Expected a real directory audio candidate');
                    }
                    return {
                        ...candidate,
                        persist: async () => {
                            const persisted = await candidate.persist();
                            expect(persisted).toBe(true);
                            await hold();
                            return persisted;
                        },
                    };
                });
            }
            let live = true;
            runtime.leave.mockClear();
            const loading = runtime.project.loadProject({
                transaction: runtime.runProjectLoadTransaction(),
                directory,
                explicit: boundary === 'unload',
                shouldContinue: () => boundary === 'unload' || live,
                shouldProceed: () => boundary !== 'unload' || live,
            });
            try {
                await Promise.race([
                    entered.promise,
                    loading.then(() => {
                        throw new Error(`Directory load settled before the held ${boundary} boundary`);
                    }),
                ]);
                const held = captureDirectoryLoadBoundary(runtime, outgoingBufferId);
                live = false;
                release.resolve();
                const outcome = await loading.then(
                    (loaded) => ({ loaded }),
                    (error: unknown) => ({ error })
                );
                const withdrawn = captureDirectoryLoadBoundary(runtime, outgoingBufferId);
                expect(withdrawn).toEqual(held);
                expect(withdrawn.savedAudio).toBe(held.savedAudio);
                expect(withdrawn.outgoingAudio).toBe(held.outgoingAudio);
                expect(compact).not.toHaveBeenCalled();
                if (boundary === 'binding' || boundary === 'read') {
                    expect(runtime.leave).not.toHaveBeenCalled();
                }
                expect(outcome).toEqual({ loaded: false });
            } finally {
                release.resolve();
                folder.beforeBindingRead = null;
                runtime.directory.beforeRead = undefined;
                vi.restoreAllMocks();
            }
            await expect(
                runtime.project.loadProject({ transaction: runtime.runProjectLoadTransaction() })
            ).resolves.toBe(true);
            expect(runtime.project.getDurableProjectOwnerId()).toBe(runtime.projectId);
            expect(
                runtime.audio.getCachedAudioBuffer({ bufferId: runtime.clip.audioBufferId! })?.getChannelData(0)[1]
            ).toBeCloseTo(0.5, 3);
        },
        70_000
    );

    it('surfaces a corrupt current directory read and still admits a repaired current successor', async () => {
        const runtime = await createSavedDirectoryProject();
        const outgoingBufferId = await createOutgoingDirectoryProject(runtime);
        const held = captureDirectoryLoadBoundary(runtime, outgoingBufferId);
        const manifest = runtime.directory.files.get('manifest.json');
        if (!manifest) {
            throw new Error('Expected a real committed manifest');
        }
        runtime.directory.files.set('manifest.json', new TextEncoder().encode('{broken'));
        await expect(
            runtime.project.loadProject({
                transaction: runtime.runProjectLoadTransaction(),
                shouldContinue: () => true,
            })
        ).rejects.toThrow();
        expect(captureDirectoryLoadBoundary(runtime, outgoingBufferId)).toEqual(held);
        runtime.directory.files.set('manifest.json', manifest);
        await expect(runtime.project.loadProject({ transaction: runtime.runProjectLoadTransaction() })).resolves.toBe(
            true
        );
        expect(runtime.project.getDurableProjectOwnerId()).toBe(runtime.projectId);
    }, 70_000);

    it('surfaces a current PCM durability refusal without compacting and admits a current successor', async () => {
        const runtime = await createSavedDirectoryProject();
        await createOutgoingDirectoryProject(runtime);
        const importBuffers = runtime.audio.importCachedAudioBuffers;
        vi.spyOn(runtime.audio, 'importCachedAudioBuffers').mockImplementationOnce(async (input) => {
            const candidate = await importBuffers(input);
            if (!candidate) {
                throw new Error('Expected a real directory audio candidate');
            }
            return { ...candidate, persist: () => Promise.resolve(false) };
        });
        const compact = vi.spyOn(runtime.crdt, 'compactProject');
        await expect(
            runtime.project.loadProject({
                transaction: runtime.runProjectLoadTransaction(),
                shouldContinue: () => true,
            })
        ).rejects.toThrow('Project directory PCM could not be persisted');
        expect(compact).not.toHaveBeenCalled();
        vi.restoreAllMocks();
        await expect(runtime.project.loadProject({ transaction: runtime.runProjectLoadTransaction() })).resolves.toBe(
            true
        );
        expect(runtime.project.getDurableProjectOwnerId()).toBe(runtime.projectId);
    }, 70_000);

    it('roundtrips distinct frozen PCM and its raw reference through a directory cold reopen', async () => {
        const runtime = await createSavedDirectoryProject();
        const ordinarySamples = Array.from(
            runtime.audio.getCachedAudioBuffer({ bufferId: runtime.clip.audioBufferId! })!.getChannelData(0)
        );
        const render = await import('#/modules/Arrangement/useCases/freezeBounce/renderOffline');
        const frozenSamples = new Float32Array([0.125, -0.25, 0.75, -0.625]);
        const freezeId = 'freeze-directory-distinct';
        vi.spyOn(render, 'renderTrackOffline').mockResolvedValueOnce(makePcm(frozenSamples));
        expect(await runtime.arrangement.freezeTrack(runtime.clip.trackId, freezeId)).toBe(true);
        expect(freezeId).not.toBe(runtime.clip.audioBufferId);
        const readFrozenTrack = () =>
            runtime.arrangementStores.trackStore.value?.tracks.find((track) => track.id === runtime.clip.trackId);
        expect(readFrozenTrack()?.freezeState).toMatchObject({ status: 'frozen', frozenBufferId: freezeId });
        expect(await runtime.project.saveProject()).toBe(true);
        const { projectDirectory } = await import('../../../../repositories/project/projectDirectory');
        const saved = await projectDirectory.read(runtime.directory, runtime.projectId);
        expect(saved.pcm.has(runtime.clip.audioBufferId!)).toBe(true);
        expect(saved.pcm.has(freezeId)).toBe(true);
        const readRawFrozenReference = () => {
            const raw = runtime.crdt.getCrdtDoc<{
                tracks: { tracks: Array<{ id: string; freezeState: { frozenBufferId?: string } }> };
            }>(runtime.crdt.DOC_PREFIX_ROOT);
            if (!raw) throw new Error('Expected the actual raw project root');
            return runtime.automerge.toJS(raw).tracks.tracks.find((track) => track.id === runtime.clip.trackId)
                ?.freezeState.frozenBufferId;
        };
        expect(readRawFrozenReference()).toBe(freezeId);
        await runtime.audio.clearRuntimeCachedAudioBuffers();
        expect(runtime.audio.getCachedAudioBuffer({ bufferId: freezeId })).toBeNull();
        runtime.crdt.resetCrdtProjectAuthority('Cold boot');
        runtime.helpers.resetModuleStoresToDefault();
        await expect(runtime.project.loadProject({ transaction: runtime.runProjectLoadTransaction() })).resolves.toBe(
            true
        );
        expect(runtime.project.getDurableProjectOwnerId()).toBe(runtime.projectId);
        expect(readFrozenTrack()?.freezeState).toMatchObject({ status: 'frozen', frozenBufferId: freezeId });
        expect(readRawFrozenReference()).toBe(freezeId);
        expect(Array.from(runtime.audio.getCachedAudioBuffer({ bufferId: freezeId })!.getChannelData(0))).toEqual(
            Array.from(frozenSamples)
        );
        expect(
            Array.from(runtime.audio.getCachedAudioBuffer({ bufferId: runtime.clip.audioBufferId! })!.getChannelData(0))
        ).toEqual(ordinarySamples);
        const { audioBufferCache } = await import('#/modules/AudioEngine/stores');
        const exported = await audioBufferCache.exportBuffers([freezeId]);
        expect(exported[freezeId]?.freezeProjectId).toBe(runtime.projectStores.projectStore.value?.createdAt);
    }, 70_000);

    it('keeps real saved clip Undo and Redo executable after a directory boot reopen', async () => {
        const runtime = await createSavedDirectoryProject();
        const originalStart = runtime.clip.startBeat;
        await runtime.command.executeAppAction({
            type: 'moveClip',
            payload: { clipId: runtime.clip.id, trackId: runtime.clip.trackId, startBeat: 8 },
        });
        expect(await runtime.project.saveProject()).toBe(true);
        runtime.command.stampSessionUndoWitness();
        const mirror = sessionStorage.getItem('sourdaw-undo-session');
        expect(mirror).toBeTruthy();
        clearHandlerRegistry();
        runtime.command.registerProductionCommandHandlers(runtime.handlerMaps);
        await runtime.audio.clearRuntimeCachedAudioBuffers();
        runtime.crdt.resetCrdtProjectAuthority('Boot');
        runtime.helpers.resetModuleStoresToDefault();
        clearHandlerRegistry();
        runtime.command.registerProductionCommandHandlers(runtime.handlerMaps, {
            deferSessionRestore: true,
        });
        expect(runtime.command.captureUndoHistory().past).toEqual([]);
        await expect(runtime.project.loadProject({ transaction: runtime.runProjectLoadTransaction() })).resolves.toBe(
            true
        );
        expect(runtime.project.getDurableProjectOwnerId()).toBe(runtime.projectId);
        const readClip = () =>
            runtime.arrangementStores.trackStore.value?.tracks
                .flatMap((track) => track.clips)
                .find((clip) => clip.id === runtime.clip.id);
        expect(readClip()?.startBeat).toBe(8);
        expect(await runtime.command.undo()).toEqual({ headConsumed: true });
        expect(readClip()?.startBeat).toBe(originalStart);
        await runtime.command.redo();
        expect(readClip()?.startBeat).toBe(8);
        expect(runtime.project.getDurableProjectOwnerId()).toBe(runtime.projectId);
        expect(
            runtime.audio.getCachedAudioBuffer({ bufferId: runtime.clip.audioBufferId! })?.getChannelData(0)[1]
        ).toBeCloseTo(0.5, 3);
    }, 70_000);
});
