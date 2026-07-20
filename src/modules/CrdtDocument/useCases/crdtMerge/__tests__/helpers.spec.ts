import { describe, it, expect, vi, beforeEach } from 'vitest';

import { type DocumentBundle, type MergeResult } from '../../../models/CrdtDocumentTypes';
import { automergeRepository } from '../../../repositories/automergeRepository';
import { mergeDocumentBundleFromRepo } from '../helpers';

vi.mock('../../../repositories/automergeRepository', () => ({
    automergeRepository: {
        mergeBundle: vi.fn(),
    },
}));

describe('mergeDocumentBundleFromRepo', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('delegates the bundle to the repository and returns its merge result', async () => {
        const bundle: DocumentBundle = new Map([['root', new Uint8Array([1])]]);
        const mergeResult: MergeResult = { mergedDocIds: ['root'], newDocIds: ['child'] };
        vi.mocked(automergeRepository.mergeBundle).mockResolvedValue(mergeResult);

        const result = await mergeDocumentBundleFromRepo(bundle);

        expect(automergeRepository.mergeBundle).toHaveBeenCalledWith(bundle);
        expect(result).toBe(mergeResult);
    });
});
