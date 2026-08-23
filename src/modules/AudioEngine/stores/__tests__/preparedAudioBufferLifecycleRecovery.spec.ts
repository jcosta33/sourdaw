import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { flushIndexedDbTasks, installFakeAudioIndexedDb } from './fakeAudioBufferIndexedDb';
import { createAudioBuffer, createTestContext } from './preparedAudioBufferTestSupport';

let audioBufferCache: typeof import('../audioBufferCache').audioBufferCache;
let reclaimPreparedBufferOrphans: typeof import('../audioBufferCache').reclaimPreparedBufferOrphans;

beforeEach(async () => {
    vi.resetModules();
    ({ audioBufferCache, reclaimPreparedBufferOrphans } = await import('../audioBufferCache'));
});

afterEach(() => {
    audioBufferCache.clear();
    vi.unstubAllGlobals();
});

describe('prepared audio-buffer recovery and project admission', () => {
    it.each(['age', 'size'] as const)(
        'pins a buffer promoted after non-lease preparation through %s collection',
        async (collector) => {
            const controls = installFakeAudioIndexedDb();
            const id = `delayed-pin-${collector}`;
            const leaseId = `delayed-pin-${collector}-lease`;
            await audioBufferCache.persistPreparedBuffer({
                id,
                buffer: createAudioBuffer({ length: 1, sampleRate: 48_000 }),
                leaseId,
            });
            const prepared = await audioBufferCache.prepareFromIdb({
                context: createTestContext(
                    vi.fn((_channels: number, length: number, sampleRate: number) =>
                        createAudioBuffer({ length, sampleRate })
                    )
                ),
                ids: [id],
            });
            await expect(
                audioBufferCache.releasePreparedBuffer({ id, leaseId, disposition: 'project-owned' })
            ).resolves.toEqual({ status: 'released', disposition: 'project-owned' });

            expect(prepared?.publish()).toBe(0);
            if (collector === 'age') {
                await audioBufferCache.garbageCollectByAge(-1);
            } else {
                await audioBufferCache.garbageCollectBySize(0);
            }

            expect(controls.committed.has(id)).toBe(true);
            expect(controls.committedMeta.get(id)?.preparedOwner?.status).toBe('project-owned');
            expect(audioBufferCache.has(id)).toBe(true);
        }
    );

    it.each(['age', 'size'] as const)(
        'preserves crash-left promotion recovery through %s collection while collecting ordinary PCM',
        async (collector) => {
            const controls = installFakeAudioIndexedDb();
            const id = `crash-left-promotion-${collector}`;
            const leaseId = `${id}-lease`;
            const ordinaryId = `ordinary-collection-${collector}`;
            const invalidOwnerId = `invalid-owner-collection-${collector}`;
            const storedBuffer = (sample: number) => ({
                sampleRate: 48_000,
                numberOfChannels: 1,
                channelData: [new Float32Array([sample])],
                lastAccessed: 1,
                sizeInBytes: 4,
            });
            controls.committed.set(id, storedBuffer(0.25));
            controls.committedMeta.set(id, {
                lastAccessed: 1,
                preparedOwner: {
                    schemaVersion: 1,
                    createdAtMs: 1,
                    leaseId,
                    promotionRevision: `${id}-promotion`,
                    status: 'project-owned',
                },
                sizeInBytes: 4,
            });
            controls.committed.set(ordinaryId, storedBuffer(0.5));
            controls.committedMeta.set(ordinaryId, { lastAccessed: 1, sizeInBytes: 4 });
            controls.committed.set(invalidOwnerId, storedBuffer(0.75));
            controls.committedMeta.set(invalidOwnerId, {
                lastAccessed: 1,
                preparedOwner: {
                    schemaVersion: 1,
                    leaseId: `${invalidOwnerId}-lease`,
                    promotionRevision: 42 as unknown as string,
                    status: 'project-owned',
                },
                sizeInBytes: 4,
            });

            vi.spyOn(Date, 'now').mockReturnValue(10_000_000_000);
            const deleted =
                collector === 'age'
                    ? await audioBufferCache.garbageCollectByAge(1)
                    : await audioBufferCache.garbageCollectBySize(8);

            expect(deleted).toBe(1);
            expect(controls.committed.has(ordinaryId)).toBe(false);
            expect(controls.committedMeta.has(ordinaryId)).toBe(false);
            expect(controls.committed.has(id)).toBe(true);
            expect(controls.committedMeta.get(id)?.preparedOwner).toMatchObject({
                leaseId,
                promotionRevision: `${id}-promotion`,
                status: 'project-owned',
            });
            expect(controls.committed.has(invalidOwnerId)).toBe(true);
            expect(controls.committedMeta.has(invalidOwnerId)).toBe(true);

            await expect(
                audioBufferCache.reopenPreparedBuffer({
                    id,
                    leaseId,
                    context: createTestContext(
                        vi.fn((_channels: number, length: number, sampleRate: number) =>
                            createAudioBuffer({ length, sampleRate })
                        )
                    ),
                })
            ).resolves.toEqual({ status: 'reopened', bufferId: id, ownership: 'temporary' });
            expect(controls.committed.get(id)?.channelData[0]?.[0]).toBe(0.25);
            expect(controls.committedMeta.get(id)?.preparedOwner).toMatchObject({
                leaseId,
                status: 'temporary',
            });
            expect(controls.committedMeta.get(id)?.preparedOwner?.promotionRevision).toBeUndefined();
            expect(audioBufferCache.has(id)).toBe(true);
        }
    );

    it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
        'rejects non-finite orphan cutoff %s before opening storage',
        async (createdBeforeMs) => {
            const controls = installFakeAudioIndexedDb();
            await expect(reclaimPreparedBufferOrphans({ createdBeforeMs, liveLeaseIds: [] })).resolves.toEqual({
                status: 'failed',
                reason: 'Prepared audio orphan cutoff is invalid.',
            });
            expect(controls.openRequestCount()).toBe(0);
        }
    );

    it('treats whitespace-only durable lease metadata as invalid and never reclaims it', async () => {
        const controls = installFakeAudioIndexedDb();
        controls.committed.set('invalid-whitespace-owner', {
            sampleRate: 48_000,
            numberOfChannels: 1,
            channelData: [new Float32Array([0.25])],
            lastAccessed: 1,
            sizeInBytes: 4,
        });
        controls.committedMeta.set('invalid-whitespace-owner', {
            lastAccessed: 1,
            preparedOwner: { schemaVersion: 1, createdAtMs: 1, leaseId: '   ', status: 'temporary' },
            sizeInBytes: 4,
        });

        await expect(reclaimPreparedBufferOrphans({ createdBeforeMs: 2, liveLeaseIds: [] })).resolves.toEqual({
            status: 'reclaimed',
            count: 0,
        });
        await expect(
            audioBufferCache.reopenPreparedBuffer({
                id: 'invalid-whitespace-owner',
                leaseId: '   ',
                context: createTestContext(vi.fn()),
            })
        ).resolves.toMatchObject({ status: 'failed' });
        expect(controls.committed.has('invalid-whitespace-owner')).toBe(true);
    });

    it('aborts an orphan reclaim when the project admits the exact ID before commit', async () => {
        const controls = installFakeAudioIndexedDb();
        controls.committed.set('reclaim-project-race', {
            sampleRate: 48_000,
            numberOfChannels: 1,
            channelData: [new Float32Array([0.25])],
            lastAccessed: 1,
            sizeInBytes: 4,
        });
        controls.committedMeta.set('reclaim-project-race', {
            lastAccessed: 1,
            preparedOwner: {
                schemaVersion: 1,
                createdAtMs: 1,
                leaseId: 'reclaim-project-lease',
                status: 'temporary',
            },
            sizeInBytes: 4,
        });
        controls.pauseWriteSettlements();
        const reclaim = reclaimPreparedBufferOrphans({ createdBeforeMs: 2, liveLeaseIds: [] });
        while (controls.pendingWriteSettlementCount() === 0) {
            await flushIndexedDbTasks(1);
        }

        const project = audioBufferCache.importBuffers({
            buffers: {},
            cacheIds: ['reclaim-project-race'],
            context: createTestContext(vi.fn()),
        });
        expect(project?.publish()).toBe(0);
        controls.releaseNextWriteSettlement();

        await expect(reclaim).resolves.toMatchObject({ status: 'failed' });
        expect(controls.committed.has('reclaim-project-race')).toBe(true);
        expect(controls.committedMeta.has('reclaim-project-race')).toBe(true);
    });
});
