import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createLocalStorageCommandBatchIdempotencyRepository } from '../createLocalStorageCommandBatchIdempotencyRepository';

const STORAGE_KEY = 'sourdaw:command-batch-idempotency:v1';
const HASH_ONE = `sha256:${'1'.repeat(64)}`;
const HASH_TWO = `sha256:${'2'.repeat(64)}`;

type RequestExclusiveLock = NonNullable<
    NonNullable<Parameters<typeof createLocalStorageCommandBatchIdempotencyRepository>[0]>['requestExclusiveLock']
>;
type ClaimLease = { release: () => void };
type TryAcquireClaimLease = (name: string) => Promise<ClaimLease | null>;
type ExtendedRepositoryInput = NonNullable<
    Parameters<typeof createLocalStorageCommandBatchIdempotencyRepository>[0]
> & {
    tryAcquireClaimLease?: TryAcquireClaimLease;
};

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

function createRepository(
    requestExclusiveLock: RequestExclusiveLock = requestImmediately,
    tryAcquireClaimLease?: TryAcquireClaimLease
) {
    const createRepositoryWithLease = createLocalStorageCommandBatchIdempotencyRepository as (
        input: ExtendedRepositoryInput
    ) => ReturnType<typeof createLocalStorageCommandBatchIdempotencyRepository>;
    return createRepositoryWithLease({
        requestExclusiveLock,
        tryAcquireClaimLease: tryAcquireClaimLease ?? (() => Promise.resolve({ release: vi.fn() })),
    });
}

function createClaimLeaseManager() {
    let activeRelease: (() => void) | null = null;
    const tryAcquireClaimLease = vi.fn<TryAcquireClaimLease>(() => {
        if (activeRelease) {
            return Promise.resolve(null);
        }
        const release = vi.fn(() => {
            if (activeRelease === release) {
                activeRelease = null;
            }
        });
        activeRelease = release;
        return Promise.resolve({ release });
    });
    return {
        crashOwner: () => {
            activeRelease = null;
        },
        tryAcquireClaimLease,
    };
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
        const claimInput = {
            projectId: 'project-1',
            idempotencyKey: 'request-1',
            contentHash: HASH_ONE,
        };

        await expect(repository.claim(claimInput)).resolves.toEqual({ status: 'claimed' });
        expect(request).toHaveBeenNthCalledWith(
            1,
            expect.stringContaining('sourdaw:command-batch-idempotency:claim:'),
            { mode: 'exclusive', ifAvailable: true },
            expect.any(Function)
        );
        expect(request).toHaveBeenNthCalledWith(
            2,
            'sourdaw:command-batch-idempotency',
            { mode: 'exclusive' },
            expect.any(Function)
        );
        await repository.release?.(claimInput);
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

    it('keeps a live origin-wide claimant exclusive but reclaims its orphaned pre-commit record after restart', async () => {
        const claimLeaseManager = createClaimLeaseManager();
        const firstRepository = createRepository(requestImmediately, claimLeaseManager.tryAcquireClaimLease);
        const retryInput = {
            projectId: 'project-1',
            idempotencyKey: 'request-restart',
            contentHash: HASH_ONE,
            reclaimPending: true,
        };

        await expect(firstRepository.claim(retryInput)).resolves.toEqual({ status: 'claimed' });
        const concurrentRepository = createRepository(requestImmediately, claimLeaseManager.tryAcquireClaimLease);
        await expect(concurrentRepository.claim(retryInput)).resolves.toEqual({ status: 'pending' });

        claimLeaseManager.crashOwner();
        const restartedRepository = createRepository(requestImmediately, claimLeaseManager.tryAcquireClaimLease);
        await expect(restartedRepository.claim(retryInput)).resolves.toEqual({ status: 'claimed' });
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
