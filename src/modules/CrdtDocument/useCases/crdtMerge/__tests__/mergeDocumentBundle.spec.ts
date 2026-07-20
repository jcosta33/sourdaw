import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
    mergeDocumentBundleFromRepo: vi.fn(),
    projectCrdtToStores: vi.fn(),
    persistCrdtProject: vi.fn(),
}));

vi.mock('../helpers', () => ({
    mergeDocumentBundleFromRepo: mocks.mergeDocumentBundleFromRepo,
}));

vi.mock('../../projection/projectProjection', () => ({
    projectCrdtToStores: mocks.projectCrdtToStores,
}));

vi.mock('../../persistCrdtProject', () => ({
    persistCrdtProject: mocks.persistCrdtProject,
}));

import { type DocumentBundle, type MergeResult } from '../../../models/CrdtDocumentTypes';
import { mergeDocumentBundle } from '../mergeDocumentBundle';

describe('mergeDocumentBundle', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.persistCrdtProject.mockResolvedValue(undefined);
    });

    it('merges the bundle through the repository, re-projects stores, and persists before resolving', async () => {
        const bundle: DocumentBundle = new Map([['root', new Uint8Array([1])]]);
        const mergeResult: MergeResult = { mergedDocIds: ['root'], newDocIds: [] };
        mocks.mergeDocumentBundleFromRepo.mockResolvedValue(mergeResult);

        const result = await mergeDocumentBundle(bundle);

        expect(mocks.mergeDocumentBundleFromRepo).toHaveBeenCalledWith(bundle);
        expect(result).toBe(mergeResult);
        expect(mocks.projectCrdtToStores).toHaveBeenCalledTimes(1);
        expect(mocks.persistCrdtProject).toHaveBeenCalledTimes(1);
    });

    it('propagates a repository merge failure without projecting or persisting', async () => {
        const bundle: DocumentBundle = new Map();
        const failure = new Error('merge failed');
        mocks.mergeDocumentBundleFromRepo.mockRejectedValue(failure);

        await expect(mergeDocumentBundle(bundle)).rejects.toBe(failure);
        expect(mocks.projectCrdtToStores).not.toHaveBeenCalled();
        expect(mocks.persistCrdtProject).not.toHaveBeenCalled();
    });
});
