import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Container } from '#/infra/di/Container';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { flushAutomergeStorageWrites } from '#/infra/store/storage/createAutomergeStorage';
import { clearHandlerRegistry, registerHandlerMap } from '#/modules/Command/stores';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { installMultiDatabaseIndexedDb } from './multiDatabaseIndexedDb';

import type { ProjectData } from '../../../../models/ProjectData';

const CREATED_AT = 1_700_000_000_000;
const IMPORTED_CREATED_AT = CREATED_AT + 100;
const PCM = new Float32Array([0, 1, -1, 0]);
const IMPORTED_SOURCE_PCM = new Float32Array([0.8]);
const PREVIOUS_PCM = new Float32Array([0.2]);
const IMPORTED_BUFFER_ID = 'imported-replacement';

function makeMonoWave(samples: Float32Array, sampleRate = 48_000): File {
    const bytesPerSample = Int16Array.BYTES_PER_ELEMENT;
    const bytes = new ArrayBuffer(44 + samples.length * bytesPerSample);
    const view = new DataView(bytes);
    const writeAscii = (offset: number, value: string): void => {
        for (let index = 0; index < value.length; index++) {
            view.setUint8(offset + index, value.charCodeAt(index));
        }
    };
    writeAscii(0, 'RIFF');
    view.setUint32(4, bytes.byteLength - 8, true);
    writeAscii(8, 'WAVE');
    writeAscii(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * bytesPerSample, true);
    view.setUint16(32, bytesPerSample, true);
    view.setUint16(34, 16, true);
    writeAscii(36, 'data');
    view.setUint32(40, samples.length * bytesPerSample, true);
    for (let index = 0; index < samples.length; index++) {
        view.setInt16(44 + index * bytesPerSample, Math.round(samples[index]! * 0x7fff), true);
    }
    const file = new File([bytes], 'durability.wav', { type: 'audio/wav' });
    Object.defineProperty(file, 'arrayBuffer', {
        value: () => Promise.resolve(bytes.slice(0)),
    });
    return file;
}

function decodeMonoWave(bytes: ArrayBuffer): AudioBuffer {
    const view = new DataView(bytes);
    const sampleRate = view.getUint32(24, true);
    const sampleCount = view.getUint32(40, true) / Int16Array.BYTES_PER_ELEMENT;
    const channel = new Float32Array(sampleCount);
    for (let index = 0; index < sampleCount; index++) {
        channel[index] = view.getInt16(44 + index * Int16Array.BYTES_PER_ELEMENT, true) / 0x7fff;
    }
    return {
        copyFromChannel: (destination: Float32Array, _channelNumber: number, startInChannel = 0) => {
            destination.set(channel.subarray(startInChannel, startInChannel + destination.length));
        },
        copyToChannel: (source: Float32Array, _channelNumber: number, startInChannel = 0) => {
            channel.set(source, startInChannel);
        },
        duration: sampleCount / sampleRate,
        getChannelData: () => channel,
        length: sampleCount,
        numberOfChannels: 1,
        sampleRate,
    };
}

function createAudioBuffer(numberOfChannels: number, length: number, sampleRate: number): AudioBuffer {
    const channels = Array.from({ length: numberOfChannels }, () => new Float32Array(length));
    return {
        copyFromChannel: (destination: Float32Array, channel: number, startInChannel = 0) => {
            destination.set(channels[channel]!.subarray(startInChannel, startInChannel + destination.length));
        },
        copyToChannel: (source: Float32Array, channel: number, startInChannel = 0) => {
            channels[channel]!.set(source, startInChannel);
        },
        duration: length / sampleRate,
        getChannelData: (channel: number) => channels[channel]!,
        length,
        numberOfChannels,
        sampleRate,
    };
}

function readStoredFirstSample(value: unknown): number | undefined {
    if (value === null || typeof value !== 'object') {
        return undefined;
    }
    const channelData = Reflect.get(value, 'channelData');
    if (!Array.isArray(channelData) || channelData[0] === null || typeof channelData[0] !== 'object') {
        return undefined;
    }
    const sample = Reflect.get(channelData[0], '0');
    return typeof sample === 'number' ? sample : undefined;
}

function encodeFloat32(values: Float32Array): string {
    const bytes = new Uint8Array(values.buffer, values.byteOffset, values.byteLength);
    let binary = '';
    for (const byte of bytes) {
        binary += String.fromCharCode(byte);
    }
    return btoa(binary);
}

describe('saveProject audio durability integration', () => {
    beforeEach(() => {
        clearHandlerRegistry();
        localStorage.clear();
        injectDependencies(notifyUser, { eventBus: { emit: vi.fn(() => Promise.resolve()) } });
    });

    afterEach(async () => {
        const { stopActiveAutoSave } = await import('../../helpers/stopActiveAutoSave');
        stopActiveAutoSave();
        clearHandlerRegistry();
        Container.clear();
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it('refuses failed PCM writes, retries exact sources, and reopens both save paths', async () => {
        const indexedDb = installMultiDatabaseIndexedDb();
        const buildProjectDataModule = await import('../../fileIO/buildProjectData');
        const realBuildProjectData = buildProjectDataModule.buildProjectData;
        let queuedSnapshotEdit: (() => void) | undefined;
        vi.spyOn(buildProjectDataModule, 'buildProjectData').mockImplementation((...args) => {
            const built = realBuildProjectData(...args);
            const edit = queuedSnapshotEdit;
            if (edit) {
                queuedSnapshotEdit = undefined;
                queueMicrotask(edit);
            }
            return built;
        });
        const [
            { audioEngine, clearRuntimeCachedAudioBuffers, getCachedAudioBuffer, restoreCachedAudioBuffersFromIdb },
            { getArrangementHandlers, importAudioFile, renameTrack, setArrangementEventBus },
            project,
            { projectStore },
            { trackStore },
            { captureProjectRevision, registerCrdtStorageRuntime, resetCrdtProjectAuthority },
            { resetModuleStoresToDefault },
            { createFreshProjectMetadata },
            { configureCollaborationAssetOwner },
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
        ]);
        const context = audioEngine.context as AudioContext & {
            createBuffer: typeof createAudioBuffer;
            decodeAudioData: (bytes: ArrayBuffer) => Promise<AudioBuffer>;
        };
        context.createBuffer = createAudioBuffer;
        context.decodeAudioData = (bytes) => Promise.resolve(decodeMonoWave(bytes));
        await restoreCachedAudioBuffersFromIdb({ audioContext: context });
        setArrangementEventBus({ emit: vi.fn(() => Promise.resolve()) });
        registerHandlerMap(getArrangementHandlers());

        registerCrdtStorageRuntime();
        configureCollaborationAssetOwner({ captureOwnerId: project.getDurableProjectOwnerId });
        project.setProjectIdentityTransitionDependencies({ leaveCollaborationSession: () => Promise.resolve() });
        resetCrdtProjectAuthority('Durability');
        resetModuleStoresToDefault();
        projectStore.set({
            ...createFreshProjectMetadata({
                name: 'Durability',
                loading: false,
                initialized: true,
            }),
            createdAt: CREATED_AT,
            updatedAt: CREATED_AT,
            dirty: true,
        });

        indexedDb.pauseAudioWriteSettlements();
        await importAudioFile(makeMonoWave(PCM), { shouldContinue: () => true });

        const importedClip = trackStore.value?.tracks.flatMap((track) => track.clips)[0];
        expect(importedClip).toBeDefined();
        await vi.waitFor(() => expect(indexedDb.pendingAudioWriteSettlements()).toBe(1));
        indexedDb.abortAudioWrites();
        indexedDb.releaseNextAudioWriteSettlement();
        await vi.waitFor(() => expect(indexedDb.rejectedAudioWriteCount()).toBe(1));
        indexedDb.resumeAudioWriteSettlements();

        const bufferId = importedClip?.audioBufferId;
        if (!bufferId) {
            throw new Error('expected the real import path to publish an audio clip');
        }
        const saved = await project.saveProject();
        const dirtyAfterSave = projectStore.value?.dirty;
        const workingSamples = getCachedAudioBuffer({ bufferId })?.getChannelData(0);

        expect(indexedDb.get('sourdaw-audio', 'buffers', bufferId)).toBeUndefined();
        expect(saved).toBe(false);
        expect(dirtyAfterSave).toBe(true);
        expect(workingSamples).toEqual(PCM);

        indexedDb.allowAudioWrites();
        const importedTrack = trackStore.value?.tracks.find((track) =>
            track.clips.some((clip) => clip.id === importedClip?.id)
        );
        if (!importedTrack) {
            throw new Error('expected the imported clip to belong to a live track');
        }
        const queuedTrackName = 'Edited after snapshot construction';
        queuedSnapshotEdit = () => renameTrack(importedTrack.id, queuedTrackName);
        expect(await project.saveProject()).toBe(false);
        expect(projectStore.value?.dirty).toBe(true);
        expect(trackStore.value?.tracks.find((track) => track.id === importedTrack.id)?.name).toBe(queuedTrackName);
        expect(
            indexedDb.get('sourdaw-projects', 'projects', project.getProjectSnapshotKey(CREATED_AT))
        ).toBeUndefined();

        expect(await project.saveProject()).toBe(true);
        expect(projectStore.value?.dirty).toBe(false);
        expect(indexedDb.get('sourdaw-audio', 'buffers', bufferId)).toBeDefined();

        const pendingFrames = new Map<number, FrameRequestCallback>();
        let nextFrameId = 1;
        vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback): number => {
            const frameId = nextFrameId++;
            pendingFrames.set(frameId, callback);
            return frameId;
        });
        vi.stubGlobal('cancelAnimationFrame', (frameId: number): void => {
            pendingFrames.delete(frameId);
        });
        indexedDb.pauseNamedProjectWriteSettlements();
        const savingBeforeRename = project.saveProject();
        await vi.waitFor(() => expect(indexedDb.pendingNamedProjectWriteSettlements()).toBe(1));

        const revisionBeforeRename = captureProjectRevision();
        project.renameProject('Renamed during save');
        expect(projectStore.value?.name).toBe('Renamed during save');
        expect(captureProjectRevision()).toBe(revisionBeforeRename);
        expect(pendingFrames.size).toBeGreaterThan(0);

        indexedDb.releaseNextNamedProjectWriteSettlement();
        const saveBeforeRename = await savingBeforeRename;
        const dirtyAfterRename = projectStore.value?.dirty;
        const staleJson = indexedDb.get('sourdaw-projects', 'projects', project.getProjectSnapshotKey(CREATED_AT));
        flushAutomergeStorageWrites();

        expect(saveBeforeRename).toBe(false);
        expect(dirtyAfterRename).toBe(true);
        expect(typeof staleJson === 'string' ? (JSON.parse(staleJson) as ProjectData).meta.name : undefined).toBe(
            'Durability'
        );

        indexedDb.resumeNamedProjectWriteSettlements();
        expect(await project.saveProject()).toBe(true);
        expect(projectStore.value?.dirty).toBe(false);

        clearRuntimeCachedAudioBuffers();
        resetCrdtProjectAuthority('Blank project');
        resetModuleStoresToDefault();
        projectStore.set({
            ...createFreshProjectMetadata({
                name: 'Blank project',
                loading: false,
                initialized: true,
            }),
            createdAt: CREATED_AT + 1,
            updatedAt: CREATED_AT + 1,
            dirty: false,
        });
        expect(getCachedAudioBuffer({ bufferId })).toBeNull();
        expect(trackStore.value?.tracks).toEqual([]);

        await expect(project.loadRecentProject(project.getProjectSnapshotKey(CREATED_AT))).resolves.toBe('committed');
        const reopenedClip = trackStore.value?.tracks.flatMap((track) => track.clips)[0];
        expect(reopenedClip?.audioBufferId).toBe(bufferId);
        expect(getCachedAudioBuffer({ bufferId })?.getChannelData(0)).toEqual(PCM);
        expect(projectStore.value).toMatchObject({
            createdAt: CREATED_AT,
            dirty: false,
            name: 'Renamed during save',
        });

        const savedJson = indexedDb.get('sourdaw-projects', 'projects', project.getProjectSnapshotKey(CREATED_AT));
        if (typeof savedJson !== 'string') {
            throw new TypeError('expected the first real save to provide a current-format project snapshot');
        }
        const importedProject = JSON.parse(savedJson) as ProjectData;
        const sourceTrack = importedProject.arrangement.tracks[0];
        const sourceClip = sourceTrack?.clips[0];
        if (!sourceTrack || !sourceClip) {
            throw new Error('expected the first saved project to provide a valid audio track fixture');
        }
        importedProject.meta = {
            ...importedProject.meta,
            name: 'Imported replacement',
            createdAt: IMPORTED_CREATED_AT,
            updatedAt: IMPORTED_CREATED_AT,
        };
        importedProject.arrangement = {
            tracks: [
                {
                    ...sourceTrack,
                    clips: [
                        {
                            ...sourceClip,
                            bufferId: IMPORTED_BUFFER_ID,
                        },
                    ],
                },
            ],
        };
        importedProject.arrangements = undefined;
        importedProject.activeArrangementId = undefined;
        importedProject.audioBuffers = {
            [IMPORTED_BUFFER_ID]: {
                sampleRate: 48_000,
                numberOfChannels: 1,
                channelData: [encodeFloat32(IMPORTED_SOURCE_PCM)],
            },
        };
        const importedProjectKey = project.getProjectSnapshotKey(IMPORTED_CREATED_AT);
        indexedDb.seed('sourdaw-projects', 'projects', importedProjectKey, JSON.stringify(importedProject));
        indexedDb.seed('sourdaw-audio', 'buffers', IMPORTED_BUFFER_ID, {
            sampleRate: 48_000,
            numberOfChannels: 1,
            channelData: [PREVIOUS_PCM],
            lastAccessed: 1,
            sizeInBytes: PREVIOUS_PCM.byteLength,
        });
        indexedDb.seed('sourdaw-audio', 'bufferMeta', IMPORTED_BUFFER_ID, {
            lastAccessed: 1,
            sizeInBytes: PREVIOUS_PCM.byteLength,
        });

        indexedDb.abortAudioWrites();
        await expect(project.loadRecentProject(importedProjectKey)).resolves.toBe('committed');
        expect(getCachedAudioBuffer({ bufferId: IMPORTED_BUFFER_ID })?.getChannelData(0)).toEqual(IMPORTED_SOURCE_PCM);
        expect(readStoredFirstSample(indexedDb.get('sourdaw-audio', 'buffers', IMPORTED_BUFFER_ID))).toBeCloseTo(0.2);

        expect(await project.saveProject()).toBe(false);
        expect(projectStore.value?.dirty).toBe(true);
        expect(readStoredFirstSample(indexedDb.get('sourdaw-audio', 'buffers', IMPORTED_BUFFER_ID))).toBeCloseTo(0.2);

        indexedDb.allowAudioWrites();
        const metadataOnlyProject = structuredClone(importedProject);
        delete metadataOnlyProject.audioBuffers;
        metadataOnlyProject.meta = {
            ...metadataOnlyProject.meta,
            name: 'Retained metadata-only project',
            createdAt: IMPORTED_CREATED_AT + 50,
            updatedAt: IMPORTED_CREATED_AT + 50,
        };
        const metadataOnlyKey = project.getProjectSnapshotKey(metadataOnlyProject.meta.createdAt);
        indexedDb.seed('sourdaw-projects', 'projects', metadataOnlyKey, JSON.stringify(metadataOnlyProject));

        await expect(project.loadRecentProject(metadataOnlyKey)).resolves.toBe('committed');
        expect(getCachedAudioBuffer({ bufferId: IMPORTED_BUFFER_ID })?.getChannelData(0)).toEqual(IMPORTED_SOURCE_PCM);
        expect(readStoredFirstSample(indexedDb.get('sourdaw-audio', 'buffers', IMPORTED_BUFFER_ID))).toBeCloseTo(0.2);

        expect(await project.saveProject()).toBe(true);
        expect(projectStore.value?.dirty).toBe(false);
        expect(readStoredFirstSample(indexedDb.get('sourdaw-audio', 'buffers', IMPORTED_BUFFER_ID))).toBeCloseTo(0.8);
        const retriedSavedJson = indexedDb.get('sourdaw-projects', 'projects', metadataOnlyKey);
        if (typeof retriedSavedJson !== 'string') {
            throw new TypeError('expected the successful retry to persist the metadata-only project snapshot');
        }
        expect((JSON.parse(retriedSavedJson) as ProjectData).audioBuffers).toBeUndefined();

        clearRuntimeCachedAudioBuffers();
        resetCrdtProjectAuthority('Second blank project');
        resetModuleStoresToDefault();
        projectStore.set({
            ...createFreshProjectMetadata({
                name: 'Second blank project',
                loading: false,
                initialized: true,
            }),
            createdAt: IMPORTED_CREATED_AT + 1,
            updatedAt: IMPORTED_CREATED_AT + 1,
            dirty: false,
        });
        expect(getCachedAudioBuffer({ bufferId: IMPORTED_BUFFER_ID })).toBeNull();
        await expect(project.loadRecentProject(metadataOnlyKey)).resolves.toBe('committed');
        const reopenedImportedClip = trackStore.value?.tracks.flatMap((track) => track.clips)[0];
        expect(reopenedImportedClip?.audioBufferId).toBe(IMPORTED_BUFFER_ID);
        expect(getCachedAudioBuffer({ bufferId: IMPORTED_BUFFER_ID })?.getChannelData(0)).toEqual(IMPORTED_SOURCE_PCM);
    }, 20_000);
});
