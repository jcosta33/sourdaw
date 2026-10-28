import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Container } from '#/infra/di/Container';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { createControlledLockManager } from '#/infra/testing/createControlledLockManager';
import { clearHandlerRegistry, registerHandlerMap } from '#/modules/Command/stores';
import { notifyUser } from '#/utils/Notification/notifyUser';

import type { ProjectDirectoryHandle } from '../../../../repositories/project/projectDirectory';

class MemoryDirectory implements ProjectDirectoryHandle {
    readonly files = new Map<string, Uint8Array>();
    readonly directories = new Map<string, MemoryDirectory>();

    constructor(readonly name: string) {}

    async getFileHandle(name: string, options?: { create?: boolean }) {
        if (!this.files.has(name) && !options?.create) {
            throw new DOMException('Missing file', 'NotFoundError');
        }
        return {
            getFile: async () => ({ arrayBuffer: async () => Uint8Array.from(this.files.get(name) ?? []).buffer }),
            createWritable: async () => {
                let pending: Uint8Array | null = null;
                return {
                    write: async (bytes: Uint8Array) => {
                        pending = Uint8Array.from(bytes);
                    },
                    close: async () => {
                        if (pending) {
                            this.files.set(name, pending);
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
        const next = new MemoryDirectory(name);
        this.directories.set(name, next);
        return next;
    }
}

const folder = vi.hoisted(() => ({
    root: null as MemoryDirectory | null,
    bound: new Map<string, { projectId: string; recentKey: string; root: MemoryDirectory }>(),
    permission: true,
    bindFail: false,
}));

vi.mock('../../../../repositories/project/projectDirectoryBinding', () => ({
    projectDirectoryBinding: {
        beginProjectDirectorySelection: () => Promise.resolve(folder.root),
        cachedProjectDirectoryRoot: (projectId: string) => folder.bound.get(projectId)?.root ?? null,
        loadProjectDirectoryRoot: async (projectId: string) => folder.bound.get(projectId)?.root ?? null,
        loadProjectDirectoryBinding: async (key: string) => folder.bound.get(key) ?? null,
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

describe('project directory save and cold Recent open', () => {
    beforeEach(() => {
        folder.root = new MemoryDirectory('selected-root');
        folder.bound.clear();
        folder.permission = true;
        folder.bindFail = false;
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
    });

    afterEach(async () => {
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

        const { decodeSdawFile } = await import('#/modules/CrdtDocument/useCases/sdawFileFormat/decodeSdawFile');
        const { encodeSdawFile } = await import('#/modules/CrdtDocument/useCases/sdawFileFormat/encodeSdawFile');
        const originalMedia = new Map<string, Blob>(
            Array.from(committed.media, ([hash, bytes]): [string, Blob] => [hash, new Blob([bytes])])
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
        const writeAlteredDocument = async (changeRoot: (root: MediaRoot) => void): Promise<void> => {
            const bundle = decodeSdawFile(committed.document);
            const alteredRoot = automerge.change(automerge.clone(savedRoot as MediaRoot), changeRoot);
            bundle.set(crdt.DOC_PREFIX_ROOT, automerge.save(alteredRoot));
            await projectDirectory.write({
                directory,
                projectId,
                document: encodeSdawFile(bundle),
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
        const expectMismatchRejected = async (changeRoot: (root: MediaRoot) => void): Promise<void> => {
            await writeAlteredDocument(changeRoot);
            expect(await project.loadRecentProject(project.getProjectSnapshotKey(createdAt))).toBe('failed');
            expect(projectStores.projectStore.value?.projectId).toBe(blankProjectId);
            expect(arrangementStores.trackStore.value?.tracks).toEqual(blankTracks);
            expect(crdt.captureProjectRootIdentity()).toBe(blankRootIdentity);
            expect(actionHistoryStore.value).toEqual(blankUndo);
            expect(audio.getCachedAudioBuffer({ bufferId: outgoingBufferId })).toBe(blankAudio);
        };
        await expectMismatchRejected((root) => {
            root.tracks.tracks[0]!.clips[0]!.audioBufferId = 'unmanifested-audio-buffer';
        });
        await expectMismatchRejected((root) => {
            root.tracks.tracks[0]!.clips[0]!.audioBufferId = secondClip.audioBufferId;
        });
        await expectMismatchRejected((root) => {
            root.tracks.tracks[0]!.clips[0]!.assetHash = `sha256:${'0'.repeat(64)}`;
        });
        await expectMismatchRejected((root) => {
            root.tracks.tracks[0]!.alternatives[0]!.clips.push({
                ...structuredClone(clip),
                id: 'unmanifested-alternative',
            });
        });
        await expectMismatchRejected((root) => {
            root.tracks.tracks[0]!.freezeState.frozenBufferId = secondClip.audioBufferId;
        });
        await expectMismatchRejected((root) => {
            root.arrangements.arrangements[0]!.tracks.tracks.push({
                ...savedTrack,
                id: 'unmanifested-dormant-track',
            });
        });
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
});
