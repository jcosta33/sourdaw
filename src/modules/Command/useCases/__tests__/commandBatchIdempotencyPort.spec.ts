import { describe, expect, it, vi } from 'vitest';

import { commandBatchIdempotencyPort } from '../commandBatchIdempotencyPort';

const REGISTRAR_CALL = 'call configureCommandBatchIdempotency() from #/app/bootstrap';
const key = { projectId: 'project-1', idempotencyKey: 'key-1', contentHash: 'hash-1' };
const lookup = vi.fn(() => Promise.resolve({ status: 'missing' as const }));
const repository = {
    lookup,
    claim: vi.fn(() => Promise.resolve({ status: 'claimed' as const })),
    complete: vi.fn(() => Promise.resolve()),
    tryAcquireRecoveryLease: vi.fn(() => Promise.resolve(true)),
    release: vi.fn(() => Promise.resolve()),
};

// Vitest gives each spec file a fresh module graph, so the cases below run in
// order: the unfilled reads first, then the fill.
describe('commandBatchIdempotencyPort', () => {
    it('throws on each read before registration, naming the registrar', () => {
        expect(() => commandBatchIdempotencyPort.lookup(key)).toThrow(REGISTRAR_CALL);
        expect(() => commandBatchIdempotencyPort.claim(key)).toThrow(REGISTRAR_CALL);
        expect(() => commandBatchIdempotencyPort.release(key)).toThrow(REGISTRAR_CALL);
        expect(() => commandBatchIdempotencyPort.complete({ ...key, serializedReceipt: '{}' })).toThrow(REGISTRAR_CALL);
        expect(() => commandBatchIdempotencyPort.tryAcquireRecoveryLease(key)).toThrow(REGISTRAR_CALL);
    });

    it('serves the registered repository', async () => {
        commandBatchIdempotencyPort.setRepository(repository);

        await expect(commandBatchIdempotencyPort.lookup(key)).resolves.toEqual({ status: 'missing' });
        expect(lookup).toHaveBeenCalledWith(key);
        const reclaim = { ...key, reclaimPending: true };
        await expect(commandBatchIdempotencyPort.claim(reclaim)).resolves.toEqual({ status: 'claimed' });
        expect(repository.claim).toHaveBeenCalledWith(reclaim);
        const receipt = { ...key, serializedReceipt: '{}' };
        await commandBatchIdempotencyPort.complete(receipt);
        expect(repository.complete).toHaveBeenCalledWith(receipt);
        await expect(commandBatchIdempotencyPort.tryAcquireRecoveryLease(key)).resolves.toBe(true);
        expect(repository.tryAcquireRecoveryLease).toHaveBeenCalledWith(key);
        const released = commandBatchIdempotencyPort.release(key);
        expect(released).not.toBeNull();
        await released;
        expect(repository.release).toHaveBeenCalledWith(key);
    });

    it('answers null for the optional methods a repository lacks', () => {
        commandBatchIdempotencyPort.setRepository({ lookup, claim: repository.claim, complete: repository.complete });

        expect(commandBatchIdempotencyPort.tryAcquireRecoveryLease(key)).toBeNull();
        expect(commandBatchIdempotencyPort.release(key)).toBeNull();
    });

    it('answers from the second repository after a second fill', async () => {
        const secondLookup = vi.fn(() => Promise.resolve({ status: 'pending' as const }));
        commandBatchIdempotencyPort.setRepository({ ...repository, lookup: secondLookup });

        await expect(commandBatchIdempotencyPort.lookup(key)).resolves.toEqual({ status: 'pending' });
    });
});
