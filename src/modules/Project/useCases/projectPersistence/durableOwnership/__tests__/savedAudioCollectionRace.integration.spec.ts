import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Container } from '#/infra/di/Container';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { createControlledLockManager, type ControlledLockManager } from '#/infra/testing/createControlledLockManager';
import {
    installTransactionalIndexedDb,
    type TransactionalIndexedDbInstallation,
} from '#/infra/testing/installTransactionalIndexedDb';
import { clearHandlerRegistry, registerHandlerMap } from '#/modules/Command/stores';
import { notifyUser } from '#/utils/Notification/notifyUser';

const CREATED_AT = 1_700_000_000_000;
const PCM = new Float32Array([0, 1, -1, 0]);
const AUDIO_DATABASE_NAME = 'sourdaw-audio';
const AUDIO_BUFFER_STORE_NAME = 'buffers';

type Deferred<T> = {
    promise: Promise<T>;
    resolve: (value: T) => void;
};

function deferred<T>(): Deferred<T> {
    let settle!: (value: T) => void;
    const promise = new Promise<T>((resolve) => {
        settle = resolve;
    });
    return { promise, resolve: settle };
}

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

    const file = new File([bytes], 'collection-race.wav', { type: 'audio/wav' });
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

function captureOpenedDatabases(): (name: string) => IDBDatabase | undefined {
    const open = indexedDB.open.bind(indexedDB);
    const databases = new Map<string, IDBDatabase>();
    vi.spyOn(indexedDB, 'open').mockImplementation((name, version) => {
        const request = version === undefined ? open(name) : open(name, version);
        request.addEventListener(
            'success',
            () => {
                databases.set(name, request.result);
            },
            { once: true }
        );
        return request;
    });
    return (name) => databases.get(name);
}

function readStoredValue(database: IDBDatabase, storeName: string, key: IDBValidKey): Promise<unknown> {
    return new Promise((resolve, reject) => {
        const transaction = database.transaction(storeName, 'readonly');
        const request = transaction.objectStore(storeName).get(key) as IDBRequest<unknown>;
        let value: unknown;

        request.addEventListener('success', () => {
            value = request.result;
        });
        transaction.addEventListener('complete', () => resolve(value), { once: true });
        transaction.addEventListener(
            'abort',
            () => reject(transaction.error ?? new Error(`Reading ${storeName} was aborted`)),
            { once: true }
        );
        transaction.addEventListener(
            'error',
            () => reject(transaction.error ?? request.error ?? new Error(`Reading ${storeName} failed`)),
            { once: true }
        );
    });
}

function readFirstChannel(value: unknown): Float32Array | undefined {
    if (value === null || typeof value !== 'object') {
        return undefined;
    }
    const channelData = Reflect.get(value, 'channelData');
    const firstChannel = Array.isArray(channelData) ? channelData[0] : undefined;
    return isFloat32Array(firstChannel) ? Float32Array.from(firstChannel) : undefined;
}

function isFloat32Array(value: unknown): value is Float32Array {
    return Object.prototype.toString.call(value) === '[object Float32Array]';
}

function describeStoredValue(value: unknown): Record<string, unknown> {
    const record = value !== null && typeof value === 'object' ? value : undefined;
    const channelData = record ? Reflect.get(record, 'channelData') : undefined;
    const firstChannel = Array.isArray(channelData) ? channelData[0] : undefined;
    const constructor =
        firstChannel !== null && typeof firstChannel === 'object'
            ? Reflect.get(firstChannel, 'constructor')
            : undefined;
    return {
        present: value !== undefined,
        ownFieldNames: record ? Object.keys(record) : [],
        channelDataIsArray: Array.isArray(channelData),
        firstChannelIsView: ArrayBuffer.isView(firstChannel),
        firstChannelBrand: Object.prototype.toString.call(firstChannel),
        firstChannelConstructorName: typeof constructor === 'function' ? constructor.name : undefined,
        firstChannelSamples: isFloat32Array(firstChannel) ? Array.from(firstChannel) : undefined,
    };
}

function createStageReporter(): (stage: string) => void {
    const startedAt = performance.now();
    return (stage) => {
        console.info(`[savedAudioCollectionRace] ${stage} ${Math.round(performance.now() - startedAt)}ms`);
    };
}

describe('saved audio collection race', () => {
    let installation: TransactionalIndexedDbInstallation;
    let lockManager: ControlledLockManager;

    beforeEach(() => {
        clearHandlerRegistry();
        window.localStorage.clear();
        lockManager = createControlledLockManager();
        vi.stubGlobal('navigator', { ...navigator, locks: lockManager.locks });
        installation = installTransactionalIndexedDb();
        injectDependencies(notifyUser, { eventBus: { emit: vi.fn(() => Promise.resolve()) } });
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
        vi.restoreAllMocks();
        await installation.dispose();
        window.localStorage.clear();
    });

    it('never publishes a named snapshot without PCM when collection wins admission before the first save', async () => {
        const reportStage = createStageReporter();
        const getDatabase = captureOpenedDatabases();
        reportStage('imports:start');
        const [
            audio,
            arrangement,
            project,
            { projectStore },
            { trackStore },
            crdt,
            { resetModuleStoresToDefault },
            { createFreshProjectMetadata },
            { configureCollaborationAssetOwner },
            { readNamedProjectJson },
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
            import('../../../../repositories/project/readNamedProjectJson'),
        ]);
        reportStage('imports:done');
        const context = audio.audioEngine.context as AudioContext & {
            createBuffer: typeof createAudioBuffer;
            decodeAudioData: (bytes: ArrayBuffer) => Promise<AudioBuffer>;
        };
        context.createBuffer = createAudioBuffer;
        context.decodeAudioData = (bytes) => Promise.resolve(decodeMonoWave(bytes));
        reportStage('restore:start');
        await audio.restoreCachedAudioBuffersFromIdb({ audioContext: context });
        reportStage('restore:done');
        arrangement.setArrangementEventBus({ emit: vi.fn(() => Promise.resolve()) });
        registerHandlerMap(arrangement.getArrangementHandlers());

        crdt.registerCrdtStorageRuntime();
        configureCollaborationAssetOwner({ captureOwnerId: project.getDurableProjectOwnerId });
        project.setProjectIdentityTransitionDependencies({ leaveCollaborationSession: () => Promise.resolve() });
        crdt.resetCrdtProjectAuthority('Project A');
        resetModuleStoresToDefault();
        projectStore.set({
            ...createFreshProjectMetadata({ name: 'Project A', loading: false, initialized: true }),
            createdAt: CREATED_AT,
            updatedAt: CREATED_AT,
            dirty: true,
        });

        reportStage('importAudioFile:start');
        await expect(arrangement.importAudioFile(makeMonoWave(PCM), { shouldContinue: () => true })).resolves.toBe(
            'completed'
        );
        reportStage('importAudioFile:done');
        const importedClip = trackStore.value?.tracks.flatMap((track) => track.clips)[0];
        const bufferId = importedClip?.audioBufferId;
        if (!bufferId) {
            throw new Error('Expected the real import path to publish an audio clip.');
        }

        const censusObserved = deferred<readonly string[]>();
        const releaseCapturedCensus = deferred<void>();
        const milestones: string[] = [];
        audio.configureDurableAudioBufferOwnership(async () => {
            const realOwnedIds = await project.collectDurableOwnedAudioBufferIds();
            milestones.push(`census:${realOwnedIds.join(',')}`);
            censusObserved.resolve(realOwnedIds);
            await releaseCapturedCensus.promise;
            return realOwnedIds;
        });

        let collection: Promise<number> | undefined;
        let saving: Promise<boolean> | undefined;
        try {
            reportStage('census:start');
            collection = audio.garbageCollectCachedAudioBuffersBySize({ maxSizeBytes: 0 });
            await expect(censusObserved.promise).resolves.toEqual([]);
            reportStage('census:done');

            reportStage('save:queued');
            let saveSettled = false;
            saving = project.saveProject().then((result) => {
                saveSettled = true;
                return result;
            });
            await vi.waitFor(() => expect(lockManager.requestedNames).toHaveLength(2));
            expect(saveSettled).toBe(false);

            reportStage('collection:release');
            releaseCapturedCensus.resolve();
            const deletedCount = await collection;
            console.info('[savedAudioCollectionRace] collection:deletedCount', deletedCount);
            reportStage('collection:done');

            const saved = await saving;
            console.info('[savedAudioCollectionRace] save:result', saved);
            reportStage('save:done');
            const projectAKey = project.getProjectSnapshotKey(CREATED_AT);
            const namedJson = await readNamedProjectJson(projectAKey);

            const audioDatabase = getDatabase(AUDIO_DATABASE_NAME);
            if (!audioDatabase) {
                throw new Error('Expected the real audio IndexedDB connection after collection.');
            }
            reportStage('rawRead:start');
            const storedBeforeCollection = await readStoredValue(audioDatabase, AUDIO_BUFFER_STORE_NAME, bufferId);
            console.info('[savedAudioCollectionRace] rawRead:record', describeStoredValue(storedBeforeCollection));
            reportStage('rawRead:done');

            if (!saved) {
                expect(namedJson).toBeNull();
                expect(milestones).toEqual(['census:']);
                return;
            }

            milestones.push('save:Project A');
            expect(namedJson).toContain(bufferId);
            expect(readFirstChannel(storedBeforeCollection)).toEqual(PCM);

            reportStage('newProject:start');
            await expect(project.newProject('Project B')).resolves.toBe(true);
            reportStage('newProject:done');
            milestones.push('transition:Project B');
            expect(projectStore.value?.name).toBe('Project B');
            expect(
                trackStore.value?.tracks.flatMap((track) => track.clips).some((clip) => clip.audioBufferId === bufferId)
            ).toBe(false);
            expect(audio.getCachedAudioBuffer({ bufferId })).toBeNull();
            expect(milestones).toEqual(['census:', 'save:Project A', 'transition:Project B']);
            reportStage('postTransitionRawRead:start');
            const storedAfterTransition = await readStoredValue(audioDatabase, AUDIO_BUFFER_STORE_NAME, bufferId);
            console.info(
                '[savedAudioCollectionRace] postTransitionRawRead:record',
                describeStoredValue(storedAfterTransition)
            );
            expect(readFirstChannel(storedAfterTransition)).toEqual(PCM);
            reportStage('postTransitionRawRead:done');

            expect(await readNamedProjectJson(projectAKey)).toBe(namedJson);
            const storedAfterCollection = await readStoredValue(audioDatabase, AUDIO_BUFFER_STORE_NAME, bufferId);
            console.info(
                '[savedAudioCollectionRace] postCollectionRawRead:record',
                describeStoredValue(storedAfterCollection)
            );
            expect(readFirstChannel(storedAfterCollection)).toEqual(PCM);
        } finally {
            releaseCapturedCensus.resolve();
            await collection?.catch(() => undefined);
            await saving?.catch(() => undefined);
        }
    }, 30_000);
});
