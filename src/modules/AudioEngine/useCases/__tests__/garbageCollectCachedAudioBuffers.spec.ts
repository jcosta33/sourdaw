import { beforeEach, describe, expect, it, vi } from 'vitest';

import { garbageCollectCachedAudioBuffersByAge } from '../garbageCollectCachedAudioBuffersByAge';
import { garbageCollectCachedAudioBuffersBySize } from '../garbageCollectCachedAudioBuffersBySize';
import { garbageCollectFreezeAudioBuffers } from '../garbageCollectFreezeAudioBuffers';

import type { withProjectAudioStorageLock } from '#/infra/storage/withProjectAudioStorageLock';

const mocks = vi.hoisted(() => ({
    audioBufferCacheGarbageCollectFreezeFiles: vi
        .fn<(input: { activeIds: Set<string>; projectId: number }) => Promise<void>>()
        .mockResolvedValue(),
    audioBufferCacheGarbageCollectByAge: vi.fn<(maxAgeDays: number) => Promise<number>>().mockResolvedValue(0),
    garbageCollectAudioBufferCacheBySize: vi
        .fn<(maxSizeBytes: number, scope: object, retainedBufferIds: ReadonlySet<string>) => Promise<number>>()
        .mockResolvedValue(0),
    checkpointCollectCensus: vi.fn<() => Promise<{ immutableBytes: number; retainedBufferIds: ReadonlySet<string> }>>(),
    createCheckpointAudioRetentionRepository: vi.fn<
        (input: { openDatabase: () => Promise<IDBDatabase> }) => {
            collectCensus: () => Promise<{ immutableBytes: number; retainedBufferIds: ReadonlySet<string> }>;
        }
    >(),
    openAudioBufferCacheDatabase: vi.fn<() => Promise<IDBDatabase>>(),
    withProjectAudioStorageLock: vi.fn<typeof withProjectAudioStorageLock>(),
}));

vi.mock('../../stores/audioBufferCache', () => ({
    audioBufferCache: {
        garbageCollectFreezeFiles: mocks.audioBufferCacheGarbageCollectFreezeFiles,
        garbageCollectByAge: mocks.audioBufferCacheGarbageCollectByAge,
    },
    garbageCollectAudioBufferCacheBySize: mocks.garbageCollectAudioBufferCacheBySize,
    openAudioBufferCacheDatabase: mocks.openAudioBufferCacheDatabase,
}));

vi.mock('../../repositories/checkpointAudioRetention', () => ({
    createCheckpointAudioRetentionRepository: mocks.createCheckpointAudioRetentionRepository,
}));

vi.mock('#/infra/storage/withProjectAudioStorageLock', () => ({
    withProjectAudioStorageLock: mocks.withProjectAudioStorageLock,
}));

describe('garbage collect cached audio buffers use cases', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.withProjectAudioStorageLock.mockImplementation(async (operation) => operation({}));
        mocks.checkpointCollectCensus.mockResolvedValue({ immutableBytes: 0, retainedBufferIds: new Set() });
        mocks.createCheckpointAudioRetentionRepository.mockReturnValue({
            collectCensus: mocks.checkpointCollectCensus,
        });
    });

    it('should delegate freeze garbage collection to the private audio buffer cache', async () => {
        const activeBufferIds = new Set(['freeze-track-1', 'freeze-track-2']);

        await garbageCollectFreezeAudioBuffers({ activeBufferIds, projectId: 200 });

        expect(mocks.audioBufferCacheGarbageCollectFreezeFiles).toHaveBeenCalledWith({
            activeIds: activeBufferIds,
            projectId: 200,
        });
    });

    it('should delegate age garbage collection to the private audio buffer cache', async () => {
        mocks.audioBufferCacheGarbageCollectByAge.mockResolvedValueOnce(3);

        const deletedCount = await garbageCollectCachedAudioBuffersByAge({ maxAgeDays: 30 });

        expect(deletedCount).toBe(3);
        expect(mocks.audioBufferCacheGarbageCollectByAge).toHaveBeenCalledWith(30);
    });

    it.each([
        { maxSizeBytes: 1024, expectedMutableBudget: 768 },
        { maxSizeBytes: 128, expectedMutableBudget: 0 },
    ])(
        'collects the immutable census before delegating a $expectedMutableBudget-byte mutable budget',
        async ({ maxSizeBytes, expectedMutableBudget }) => {
            const scope = {};
            const retainedBufferIds = new Set(['retained']);
            const sequence: string[] = [];
            let lockActive = false;
            mocks.withProjectAudioStorageLock.mockImplementationOnce(async (operation) => {
                lockActive = true;
                try {
                    return await operation(scope);
                } finally {
                    lockActive = false;
                }
            });
            mocks.checkpointCollectCensus.mockImplementationOnce(async () => {
                expect(lockActive).toBe(true);
                sequence.push('census');
                return { immutableBytes: 256, retainedBufferIds };
            });
            mocks.garbageCollectAudioBufferCacheBySize.mockImplementationOnce(async () => {
                expect(lockActive).toBe(true);
                sequence.push('mutable-collection');
                return 4;
            });

            const deletedCount = await garbageCollectCachedAudioBuffersBySize({ maxSizeBytes });

            expect(deletedCount).toBe(4);
            expect(sequence).toEqual(['census', 'mutable-collection']);
            expect(mocks.withProjectAudioStorageLock).toHaveBeenCalledOnce();
            expect(mocks.createCheckpointAudioRetentionRepository).toHaveBeenCalledWith({
                openDatabase: mocks.openAudioBufferCacheDatabase,
            });
            expect(mocks.garbageCollectAudioBufferCacheBySize).toHaveBeenCalledWith(
                expectedMutableBudget,
                scope,
                retainedBufferIds
            );
            const collectionCall = mocks.garbageCollectAudioBufferCacheBySize.mock.calls[0];
            expect(collectionCall?.[1]).toBe(scope);
            expect(collectionCall?.[2]).toBe(retainedBufferIds);
        }
    );

    it('does not delete mutable PCM when the immutable census fails', async () => {
        const scope = {};
        let lockActive = false;
        mocks.withProjectAudioStorageLock.mockImplementationOnce(async (operation) => {
            lockActive = true;
            try {
                return await operation(scope);
            } finally {
                lockActive = false;
            }
        });
        mocks.checkpointCollectCensus.mockImplementationOnce(async () => {
            expect(lockActive).toBe(true);
            throw new Error('immutable census unavailable');
        });

        const deletedCount = await garbageCollectCachedAudioBuffersBySize({ maxSizeBytes: 1024 });

        expect(deletedCount).toBe(0);
        expect(mocks.withProjectAudioStorageLock).toHaveBeenCalledOnce();
        expect(mocks.garbageCollectAudioBufferCacheBySize).not.toHaveBeenCalled();
    });
});
