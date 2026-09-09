import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    BUFFER_STORE,
    CHECKPOINT_AUDIO_VERSION_META_STORE,
    CHECKPOINT_AUDIO_VERSION_STORE,
    CHECKPOINT_RETENTION_STORE,
    installFakeAudioIndexedDb,
    META_STORE,
    RECOVERY_STORE,
    type FakeAudioIndexedDbControls,
} from '../../stores/__tests__/fakeAudioBufferIndexedDb';
import {
    createAudioBuffer,
    createTestContext,
    installTestAudioBufferConstructor,
} from '../../stores/__tests__/preparedAudioBufferTestSupport';
import { createCheckpointAudioRetentionRepository } from '../checkpointAudioRetention';

const CURRENT_STORES = [
    BUFFER_STORE,
    META_STORE,
    RECOVERY_STORE,
    CHECKPOINT_RETENTION_STORE,
    CHECKPOINT_AUDIO_VERSION_STORE,
    CHECKPOINT_AUDIO_VERSION_META_STORE,
] as const;

function openDatabase(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open('sourdaw-audio', 5);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed'));
    });
}

function audioContext(): BaseAudioContext {
    return createTestContext(
        vi.fn((_numberOfChannels: number, length: number, sampleRate: number) =>
            createAudioBuffer({ length, sampleRate })
        )
    );
}

function authority() {
    return {
        bufferIds: ['shared'],
        expectedPersistenceRevisionById: new Map([['shared', 'shared-revision']]),
        isCurrent: () => true,
    };
}

describe('checkpoint audio retention repository', () => {
    let controls: FakeAudioIndexedDbControls;

    beforeEach(() => {
        vi.restoreAllMocks();
        installTestAudioBufferConstructor();
        controls = installFakeAudioIndexedDb({ existingStores: CURRENT_STORES });
        controls.committed.set('shared', {
            sampleRate: 48_000,
            numberOfChannels: 1,
            channelData: [new Float32Array([0.25])],
            lastAccessed: 1,
            sizeInBytes: 4,
        });
        controls.committedMeta.set('shared', {
            lastAccessed: 1,
            persistenceRevision: 'shared-revision',
            sizeInBytes: 4,
        });
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it('serializes last release with a new acquisition on another connection', async () => {
        const firstRepository = createCheckpointAudioRetentionRepository({ openDatabase });
        const secondRepository = createCheckpointAudioRetentionRepository({ openDatabase });
        const first = await firstRepository.acquire({
            checkpointId: 'checkpoint-a',
            projectOwnerId: 'project-owner',
            authority: authority(),
        });
        expect(first.status).toBe('retained');
        if (first.status !== 'retained') {
            throw new Error('Expected initial retention');
        }

        const probeDatabase = await openDatabase();
        const store = probeDatabase.transaction(CHECKPOINT_RETENTION_STORE).objectStore(CHECKPOINT_RETENTION_STORE);
        const prototype = Object.getPrototypeOf(store) as IDBObjectStore;
        probeDatabase.close();
        const originalGetAll = prototype.getAll;
        let secondAcquisition: ReturnType<typeof secondRepository.acquire> | undefined;
        vi.spyOn(prototype, 'getAll').mockImplementation(function (
            this: IDBObjectStore,
            ...args: Parameters<IDBObjectStore['getAll']>
        ) {
            const request = originalGetAll.apply(this, args);
            if (this.name !== CHECKPOINT_RETENTION_STORE || secondAcquisition !== undefined) {
                return request;
            }
            let success = request.onsuccess;
            Object.defineProperty(request, 'onsuccess', {
                configurable: true,
                get: () => success,
                set: (listener: typeof request.onsuccess) => {
                    success =
                        listener === null
                            ? null
                            : function (this: IDBRequest, event: Event) {
                                  listener.call(this, event);
                                  secondAcquisition = secondRepository.acquire({
                                      checkpointId: 'checkpoint-b',
                                      projectOwnerId: 'project-owner',
                                      authority: authority(),
                                  });
                              };
                },
            });
            return request;
        });

        await expect(
            firstRepository.release({
                checkpointId: 'checkpoint-a',
                projectOwnerId: 'project-owner',
                ownershipToken: first.ownershipToken,
            })
        ).resolves.toBe(true);
        await vi.waitFor(() => expect(secondAcquisition).toBeDefined());
        const second = await secondAcquisition!;
        expect(second.status).toBe('retained');
        if (second.status !== 'retained') {
            throw new Error('Expected serialized replacement retention');
        }
        const versionKey = JSON.stringify(['shared', 'shared-revision']);
        expect(controls.committedCheckpointAudioVersions.has(versionKey)).toBe(true);
        expect(controls.committedCheckpointAudioVersionMeta.has(versionKey)).toBe(true);
        await expect(
            secondRepository.read({
                checkpointId: 'checkpoint-b',
                projectOwnerId: 'project-owner',
                ownershipToken: second.ownershipToken,
                expectedBufferIds: ['shared'],
                audioContext: audioContext(),
            })
        ).resolves.toMatchObject({ status: 'read' });
    });
});
