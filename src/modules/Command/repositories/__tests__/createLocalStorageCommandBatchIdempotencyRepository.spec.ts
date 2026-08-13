import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createLocalStorageCommandBatchIdempotencyRepository } from '../createLocalStorageCommandBatchIdempotencyRepository';

const STORAGE_KEY = 'sourdaw:command-batch-idempotency:v1';
const HASH_ONE = `sha256:${'1'.repeat(64)}`;
const HASH_TWO = `sha256:${'2'.repeat(64)}`;

type RequestExclusiveLock = NonNullable<
    NonNullable<Parameters<typeof createLocalStorageCommandBatchIdempotencyRepository>[0]>['requestExclusiveLock']
>;

async function requestImmediately<TResult>(task: () => TResult | Promise<TResult>): Promise<TResult> {
    return task();
}

function createSerializedExclusiveLock(): RequestExclusiveLock {
    let tail = Promise.resolve();
    return async function requestExclusiveLock<TResult>(task: () => TResult | Promise<TResult>): Promise<TResult> {
        const previous = tail;
        let release!: () => void;
        tail = new Promise<void>((resolve) => {
            release = resolve;
        });
        await previous;
        try {
            return await task();
        } finally {
            release();
        }
    };
}

function createRepository(requestExclusiveLock: RequestExclusiveLock = requestImmediately) {
    return createLocalStorageCommandBatchIdempotencyRepository({
        requestExclusiveLock,
    });
}

describe('createLocalStorageCommandBatchIdempotencyRepository', () => {
    beforeEach(() => {
        localStorage.removeItem(STORAGE_KEY);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('claims through an origin-wide exclusive Web Lock', async () => {
        const request = vi.fn((_name: string, _options: LockOptions, task: () => unknown) => Promise.resolve(task()));
        vi.stubGlobal('navigator', { ...navigator, locks: { request } });
        const repository = createLocalStorageCommandBatchIdempotencyRepository();

        await expect(
            repository.claim({
                projectId: 'project-1',
                idempotencyKey: 'request-1',
                contentHash: HASH_ONE,
            })
        ).resolves.toEqual({ status: 'claimed' });
        expect(request).toHaveBeenCalledExactlyOnceWith(
            'sourdaw:command-batch-idempotency',
            { mode: 'exclusive' },
            expect.any(Function)
        );
    });

    it('survives repository recreation and returns the exact completed receipt', async () => {
        const firstRepository = createRepository();
        await expect(
            firstRepository.claim({
                projectId: 'project-1',
                idempotencyKey: 'request-1',
                contentHash: HASH_ONE,
            })
        ).resolves.toEqual({ status: 'claimed' });

        const serializedReceipt = JSON.stringify({
            schemaVersion: 1,
            runId: 'run-1',
            batchId: 'batch-1',
            outcome: 'committed',
            commandOutcomes: [],
            affectedIds: [],
            warnings: [],
            errors: [],
        });
        await firstRepository.complete({
            projectId: 'project-1',
            idempotencyKey: 'request-1',
            contentHash: HASH_ONE,
            serializedReceipt,
        });

        const restartedRepository = createRepository();
        await expect(
            restartedRepository.lookup({
                projectId: 'project-1',
                idempotencyKey: 'request-1',
                contentHash: HASH_ONE,
            })
        ).resolves.toEqual({ status: 'complete', serializedReceipt });
        await expect(
            restartedRepository.claim({
                projectId: 'project-1',
                idempotencyKey: 'request-1',
                contentHash: HASH_ONE,
            })
        ).resolves.toEqual({ status: 'complete', serializedReceipt });
    });

    it('rejects different content under the same project and idempotency key', async () => {
        const repository = createRepository();
        await expect(
            repository.claim({
                projectId: 'project-1',
                idempotencyKey: 'request-1',
                contentHash: HASH_ONE,
            })
        ).resolves.toEqual({ status: 'claimed' });

        await expect(
            repository.claim({
                projectId: 'project-1',
                idempotencyKey: 'request-1',
                contentHash: HASH_TWO,
            })
        ).resolves.toEqual({ status: 'conflict' });
    });

    it('keeps project identities independent and leaves an unfinished claim pending', async () => {
        const repository = createRepository();
        await expect(
            repository.claim({
                projectId: 'project-1',
                idempotencyKey: 'request-1',
                contentHash: HASH_ONE,
            })
        ).resolves.toEqual({ status: 'claimed' });

        await expect(
            repository.claim({
                projectId: 'project-1',
                idempotencyKey: 'request-1',
                contentHash: HASH_ONE,
            })
        ).resolves.toEqual({ status: 'pending' });
        await expect(
            repository.claim({
                projectId: 'project-2',
                idempotencyKey: 'request-1',
                contentHash: HASH_ONE,
            })
        ).resolves.toEqual({ status: 'claimed' });
    });

    it('serializes concurrent clients so only one can claim a project and key', async () => {
        const requestExclusiveLock = createSerializedExclusiveLock();
        const firstRepository = createRepository(requestExclusiveLock);
        const secondRepository = createRepository(requestExclusiveLock);

        const claims = await Promise.all([
            firstRepository.claim({
                projectId: 'project-1',
                idempotencyKey: 'request-concurrent',
                contentHash: HASH_ONE,
            }),
            secondRepository.claim({
                projectId: 'project-1',
                idempotencyKey: 'request-concurrent',
                contentHash: HASH_ONE,
            }),
        ]);

        expect(claims).toEqual([{ status: 'claimed' }, { status: 'pending' }]);
    });

    it('fails closed when durable records are malformed', async () => {
        localStorage.setItem(STORAGE_KEY, JSON.stringify([{ schemaVersion: 1 }]));
        const repository = createRepository();

        await expect(
            repository.claim({
                projectId: 'project-1',
                idempotencyKey: 'request-1',
                contentHash: HASH_ONE,
            })
        ).rejects.toThrow('The durable idempotency store contains an invalid record');
    });
});
