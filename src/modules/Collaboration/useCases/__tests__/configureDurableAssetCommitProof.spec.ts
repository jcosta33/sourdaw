import { describe, expect, it, vi } from 'vitest';

import { configureDurableAssetCommitProof, durableAssetCommitProof } from '../configureDurableAssetCommitProof';

import type { DurableAssetCommitProof } from '../../repositories/durableAssetRepository';

const proof: DurableAssetCommitProof = {
    projectId: 'project-1',
    idempotencyKey: 'key-1',
    contentHash: 'hash-1',
    runId: 'run-1',
    batchId: 'batch-1',
    baseRevision: 'revision-1',
    commands: [],
};

describe('durableAssetCommitProof', () => {
    it('refuses to answer a disposition before a provider is registered, naming the registrar', () => {
        expect(() => durableAssetCommitProof.getDisposition(proof)).toThrow(
            /configureDurableAssetCommitProof\(\) from #\/app\/bootstrap/
        );
    });

    it('answers through the registered provider', async () => {
        const getDisposition = vi.fn(() => 'committed' as const);
        configureDurableAssetCommitProof({ getDisposition });

        await expect(durableAssetCommitProof.getDisposition(proof)).resolves.toBe('committed');
        expect(getDisposition).toHaveBeenCalledExactlyOnceWith(proof);
    });

    it('replaces the registered provider on a second fill', async () => {
        configureDurableAssetCommitProof({ getDisposition: () => 'unknown' });

        await expect(durableAssetCommitProof.getDisposition(proof)).resolves.toBe('unknown');
    });
});
