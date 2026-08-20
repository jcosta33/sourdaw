import { beforeEach, describe, expect, it, vi } from 'vitest';

import { injectDependencies } from '#/infra/di/testing/injectDependencies';

import { readVerifiedModel } from '../readVerifiedModel';

const artifact = {
    family: 'kokoro',
    modelId: 'kokoro-82m',
    sha256: 'a'.repeat(64),
    sizeBytes: 3,
};

describe('readVerifiedModel', () => {
    const deleteModel = vi.fn<() => Promise<void>>();
    const readModel = vi.fn<() => Promise<ArrayBuffer | null>>();
    const sha256ArrayBuffer = vi.fn<() => Promise<string>>();

    beforeEach(() => {
        deleteModel.mockReset().mockResolvedValue(undefined);
        readModel.mockReset().mockResolvedValue(Uint8Array.from([1, 2, 3]).buffer);
        sha256ArrayBuffer.mockReset().mockResolvedValue(artifact.sha256);
        injectDependencies(readVerifiedModel, { deleteModel, readModel, sha256ArrayBuffer });
    });

    it('returns an artifact only after its size and digest match', async () => {
        await expect(readVerifiedModel(artifact)).resolves.toEqual(Uint8Array.from([1, 2, 3]).buffer);
        expect(deleteModel).not.toHaveBeenCalled();
    });

    it('returns null when the artifact is absent', async () => {
        readModel.mockResolvedValue(null);

        await expect(readVerifiedModel(artifact)).resolves.toBeNull();
        expect(sha256ArrayBuffer).not.toHaveBeenCalled();
        expect(deleteModel).not.toHaveBeenCalled();
    });

    it('deletes an artifact whose byte count is wrong', async () => {
        readModel.mockResolvedValue(new ArrayBuffer(2));

        await expect(readVerifiedModel(artifact)).resolves.toBeNull();
        expect(sha256ArrayBuffer).not.toHaveBeenCalled();
        expect(deleteModel).toHaveBeenCalledWith({ family: artifact.family, modelId: artifact.modelId });
    });

    it('deletes an artifact whose digest is wrong', async () => {
        sha256ArrayBuffer.mockResolvedValue('0'.repeat(64));

        await expect(readVerifiedModel(artifact)).resolves.toBeNull();
        expect(deleteModel).toHaveBeenCalledWith({ family: artifact.family, modelId: artifact.modelId });
    });
});
