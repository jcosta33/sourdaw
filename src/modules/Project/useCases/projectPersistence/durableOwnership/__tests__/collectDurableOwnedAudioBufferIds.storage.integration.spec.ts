import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createControlledLockManager } from '#/infra/testing/createControlledLockManager';
import {
    installTransactionalIndexedDb,
    type TransactionalIndexedDbInstallation,
} from '#/infra/testing/installTransactionalIndexedDb';

import { CURRENT_PROJECT_VERSION } from '../../../../models/ProjectData';
import { getProjectSnapshotKey } from '../../getProjectSnapshotKey';

type SubjectModules = {
    collectDurableOwnedAudioBufferIds: typeof import('../collectDurableOwnedAudioBufferIds').collectDurableOwnedAudioBufferIds;
    readNamedProjectJson: typeof import('../../../../repositories/project/readNamedProjectJson').readNamedProjectJson;
    writeNamedProjectJsonByKey: typeof import('../../../../repositories/project/writeNamedProjectJsonByKey').writeNamedProjectJsonByKey;
    storageSupport: typeof import('../../../../repositories/project/storageSupport').storageSupport;
};

const PROJECT_DATABASE_NAME = 'sourdaw-projects';
const PROJECT_STORE_NAME = 'projects';
const CREATED_AT = 1_700_000_000_000;

function currentFormatSnapshot(bufferId: string): string {
    return JSON.stringify({
        version: CURRENT_PROJECT_VERSION,
        meta: {
            projectId: crypto.randomUUID(),
            name: 'Unreadable owner',
            createdAt: CREATED_AT,
            updatedAt: CREATED_AT,
            keyRoot: 0,
            scaleName: 'major',
            tuning: { name: '12-TET', frequencies: [] },
        },
        arrangement: {
            tracks: [
                {
                    id: 'track-1',
                    name: 'Audio',
                    kind: 'audio',
                    clips: [
                        {
                            id: 'clip-1',
                            trackId: 'track-1',
                            name: 'Audio clip',
                            type: 'audio',
                            startBeat: 0,
                            endBeat: 4,
                            fadeInBeats: 0,
                            fadeOutBeats: 0,
                            gain: 1,
                            locked: false,
                            muted: false,
                            color: '#000000',
                            bufferId,
                        },
                    ],
                    alternatives: [],
                    freezeState: { status: 'unfrozen' },
                },
            ],
        },
    });
}

function makeAudioBuffer(sample: number): AudioBuffer {
    const channel = new Float32Array([sample]);
    return {
        copyFromChannel: () => undefined,
        copyToChannel: () => undefined,
        duration: 1 / 48_000,
        getChannelData: () => channel,
        length: 1,
        numberOfChannels: 1,
        sampleRate: 48_000,
    };
}

async function importSubjectModules(): Promise<SubjectModules> {
    const [subject, readNamed, writeNamed, storage] = await Promise.all([
        import('../collectDurableOwnedAudioBufferIds'),
        import('../../../../repositories/project/readNamedProjectJson'),
        import('../../../../repositories/project/writeNamedProjectJsonByKey'),
        import('../../../../repositories/project/storageSupport'),
    ]);
    return {
        collectDurableOwnedAudioBufferIds: subject.collectDurableOwnedAudioBufferIds,
        readNamedProjectJson: readNamed.readNamedProjectJson,
        writeNamedProjectJsonByKey: writeNamed.writeNamedProjectJsonByKey,
        storageSupport: storage.storageSupport,
    };
}

function writeRawProjectRecord(database: IDBDatabase, key: string, value: unknown): Promise<void> {
    return new Promise((resolve, reject) => {
        const transaction = database.transaction(PROJECT_STORE_NAME, 'readwrite');
        transaction.objectStore(PROJECT_STORE_NAME).put(value, key);
        transaction.addEventListener('complete', () => resolve(), { once: true });
        transaction.addEventListener(
            'abort',
            () => reject(transaction.error ?? new Error('Raw project record transaction aborted')),
            { once: true }
        );
        transaction.addEventListener(
            'error',
            () => reject(transaction.error ?? new Error('Raw project record transaction failed')),
            { once: true }
        );
    });
}

function captureProjectDatabase(): () => IDBDatabase | undefined {
    const open = indexedDB.open.bind(indexedDB);
    let projectDatabase: IDBDatabase | undefined;
    vi.spyOn(indexedDB, 'open').mockImplementation((name, version) => {
        const request = version === undefined ? open(name) : open(name, version);
        if (name === PROJECT_DATABASE_NAME) {
            request.addEventListener(
                'success',
                () => {
                    projectDatabase = request.result;
                },
                { once: true }
            );
        }
        return request;
    });
    return () => projectDatabase;
}

function abortNextReadonlyTransaction(database: IDBDatabase): {
    abortObserved: Promise<void>;
    restore: () => void;
} {
    const originalTransaction = database.transaction.bind(database);
    let abort!: () => void;
    const abortObserved = new Promise<void>((resolve) => {
        abort = resolve;
    });
    let armed = true;

    database.transaction = (storeNames, mode, options) => {
        const transaction = originalTransaction(storeNames, mode, options);
        if (!armed || mode !== 'readonly') {
            return transaction;
        }
        armed = false;
        transaction.addEventListener('abort', abort, { once: true });
        queueMicrotask(() => transaction.abort());
        return transaction;
    };

    return {
        abortObserved,
        restore: () => {
            database.transaction = originalTransaction;
        },
    };
}

describe('collectDurableOwnedAudioBufferIds storage integration', () => {
    let installation: TransactionalIndexedDbInstallation;
    let modules: SubjectModules;
    let getProjectDatabase: () => IDBDatabase | undefined;
    let resetAudioOwnership: (() => void) | undefined;

    beforeEach(async () => {
        vi.resetModules();
        resetAudioOwnership = undefined;
        window.localStorage.clear();
        vi.stubGlobal('navigator', { ...navigator, locks: createControlledLockManager().locks });
        installation = installTransactionalIndexedDb();
        getProjectDatabase = captureProjectDatabase();
        modules = await importSubjectModules();
    });

    afterEach(async () => {
        resetAudioOwnership?.();
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
        await installation.dispose();
        window.localStorage.clear();
        vi.resetModules();
    });

    it('rejects when a real durable-owner read transaction aborts while the record remains', async () => {
        const key = getProjectSnapshotKey(CREATED_AT);
        const snapshot = currentFormatSnapshot('buffer-unreadable-owner');
        await modules.writeNamedProjectJsonByKey(key, snapshot);
        await modules.storageSupport.initializeIndexedDb();
        await expect(modules.collectDurableOwnedAudioBufferIds()).resolves.toEqual(['buffer-unreadable-owner']);

        const projectDatabase = getProjectDatabase();
        if (!projectDatabase) {
            throw new Error('Expected the real project IndexedDB connection after the durable write.');
        }
        const fault = abortNextReadonlyTransaction(projectDatabase);
        const outcome = modules.collectDurableOwnedAudioBufferIds().then(
            (value) => ({ status: 'fulfilled' as const, value }),
            (error: unknown) => ({ status: 'rejected' as const, error })
        );

        await fault.abortObserved;
        fault.restore();
        await expect(modules.readNamedProjectJson(key)).resolves.toBe(snapshot);
        await expect(outcome).resolves.toEqual({ status: 'rejected', error: expect.any(Error) });
    });

    it('a real provider storage abort makes the size collector delete no primary PCM', async () => {
        const key = getProjectSnapshotKey(CREATED_AT);
        const bufferId = 'buffer-provider-abort';
        await modules.writeNamedProjectJsonByKey(key, currentFormatSnapshot(bufferId));
        await expect(modules.collectDurableOwnedAudioBufferIds()).resolves.toEqual([bufferId]);

        const [audio, { audioBufferCache }] = await Promise.all([
            import('#/modules/AudioEngine/useCases'),
            import('#/modules/AudioEngine/stores'),
        ]);
        audio.configureDurableAudioBufferOwnership(modules.collectDurableOwnedAudioBufferIds);
        resetAudioOwnership = () => audio.configureDurableAudioBufferOwnership(null);
        audioBufferCache.set(bufferId, makeAudioBuffer(0.5));
        const before = await audioBufferCache.ensureDurable([bufferId]);
        expect(before.status).toBe('durable');
        if (before.status === 'durable') {
            before.release();
        }

        const projectDatabase = getProjectDatabase();
        if (!projectDatabase) {
            throw new Error('Expected the real project IndexedDB connection after the durable write.');
        }
        const fault = abortNextReadonlyTransaction(projectDatabase);
        const collection = audio.garbageCollectCachedAudioBuffersBySize({ maxSizeBytes: 0 });
        await fault.abortObserved;
        fault.restore();

        await expect(collection).resolves.toBe(0);
        const after = await audioBufferCache.ensureDurable([bufferId]);
        expect(after.status).toBe('durable');
        if (after.status === 'durable') {
            after.release();
        }
    });

    it('rejects when a named durable record does not contain JSON text', async () => {
        await modules.storageSupport.initializeIndexedDb();
        const projectDatabase = getProjectDatabase();
        if (!projectDatabase) {
            throw new Error('Expected the real project IndexedDB connection after initialization.');
        }
        await writeRawProjectRecord(projectDatabase, getProjectSnapshotKey(CREATED_AT), { version: 2 });

        await expect(modules.collectDurableOwnedAudioBufferIds()).rejects.toThrow('does not contain JSON text');
    });
});
