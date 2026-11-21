import { describe, expect, it, vi } from 'vitest';

import { commandBatchIdempotencyPort } from '../commandBatchIdempotencyPort';

const key = { projectId: 'project-1', idempotencyKey: 'key-1', contentHash: 'hash-1' };
const lookup = vi.fn(() => Promise.resolve({ status: 'missing' as const }));
const repository = {
    lookup,
    claim: vi.fn(() => Promise.resolve({ status: 'claimed' as const })),
    complete: vi.fn(() => Promise.resolve()),
};

// Vitest gives each spec file a fresh module graph, so the cases below run in
// order: the unfilled reads first, then the fill.
describe('commandBatchIdempotencyPort', () => {
    it('throws on each read before registration, naming the registrar', () => {
        expect(() => commandBatchIdempotencyPort.lookup(key)).toThrow('configureCommandBatchIdempotency');
        expect(() => commandBatchIdempotencyPort.claim(key)).toThrow('configureCommandBatchIdempotency');
        expect(() => commandBatchIdempotencyPort.release(key)).toThrow('configureCommandBatchIdempotency');
        expect(() => commandBatchIdempotencyPort.complete({ ...key, serializedReceipt: '{}' })).toThrow(
            'configureCommandBatchIdempotency'
        );
        expect(() => commandBatchIdempotencyPort.tryAcquireRecoveryLease(key)).toThrow(
            'configureCommandBatchIdempotency'
        );
    });

    it('reports no repository before registration', () => {
        expect(commandBatchIdempotencyPort.isConfigured()).toBe(false);
    });

    it('serves the registered repository', async () => {
        commandBatchIdempotencyPort.setRepository(repository);
        expect(commandBatchIdempotencyPort.isConfigured()).toBe(true);

        await expect(commandBatchIdempotencyPort.lookup(key)).resolves.toEqual({ status: 'missing' });
        expect(lookup).toHaveBeenCalledWith(key);
        expect(commandBatchIdempotencyPort.release(key)).toBeNull();
    });

    it('answers from the second repository after a second fill', async () => {
        const secondLookup = vi.fn(() => Promise.resolve({ status: 'pending' as const }));
        commandBatchIdempotencyPort.setRepository({ ...repository, lookup: secondLookup });

        await expect(commandBatchIdempotencyPort.lookup(key)).resolves.toEqual({ status: 'pending' });
    });
});
