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
    const readModel = vi.fn();

    beforeEach(() => {
        readModel.mockReset();
        injectDependencies(readVerifiedModel, { readModel });
    });

    it('delegates exact release verification to the storage worker and returns its transfer port', async () => {
        const port = new MessageChannel().port1;
        readModel.mockResolvedValue(port);

        await expect(readVerifiedModel(artifact)).resolves.toBe(port);
        expect(readModel).toHaveBeenCalledWith({
            family: artifact.family,
            modelId: artifact.modelId,
            expectedSha256: artifact.sha256,
            expectedSizeBytes: artifact.sizeBytes,
        });
    });

    it('returns null when the verified artifact is absent', async () => {
        readModel.mockResolvedValue(null);

        await expect(readVerifiedModel(artifact)).resolves.toBeNull();
    });
});
