import { describe, it, expect, vi, beforeEach } from 'vitest';

import { compactProject } from '../compactProject';
import { crdtProjectCompactionState } from '../crdtProjectCompactionState';

const mocks = vi.hoisted(() => ({
    saveAll: vi.fn(() => new Map()),
    saveAllToIdb: vi.fn(),
}));

vi.mock('../../repositories/automergeRepository', () => ({
    automergeRepository: {
        saveAll: mocks.saveAll,
    },
}));
vi.mock('../../repositories/crdtPersistence/saveAllToIdb', () => ({ saveAllToIdb: mocks.saveAllToIdb }));

describe('compactProject', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        crdtProjectCompactionState.incrementalSaveCount = 0;
    });

    it('should write the full bundle and reset the incremental count', async () => {
        const mockBundle = new Map([['doc1', new Uint8Array([4, 5, 6])]]);
        mocks.saveAll.mockReturnValue(mockBundle);
        crdtProjectCompactionState.incrementalSaveCount = 3;

        await compactProject();

        expect(mocks.saveAllToIdb).toHaveBeenCalledWith(mockBundle);
        expect(crdtProjectCompactionState.incrementalSaveCount).toBe(0);
    });

    it('should preserve an incremental created after the full snapshot', async () => {
        const mockBundle = new Map([['root', new Uint8Array([4, 5, 6])]]);
        const records = new Set(['root:incremental:before-snapshot']);
        let releaseFullSave!: () => void;
        let signalFullSnapshot!: () => void;
        const fullSaveReleased = new Promise<void>((resolve) => {
            releaseFullSave = resolve;
        });
        const fullSnapshotReady = new Promise<void>((resolve) => {
            signalFullSnapshot = resolve;
        });
        const postSnapshotIncremental = 'root:incremental:after-snapshot';

        mocks.saveAll.mockReturnValue(mockBundle);
        mocks.saveAllToIdb.mockImplementation(async (bundle: Map<string, Uint8Array>) => {
            records.clear();
            for (const id of bundle.keys()) {
                records.add(id);
            }
            signalFullSnapshot();
            await fullSaveReleased;
        });

        const compaction = compactProject();
        await fullSnapshotReady;
        records.add(postSnapshotIncremental);
        releaseFullSave();
        await compaction;

        expect(records).toContain(postSnapshotIncremental);
        expect(crdtProjectCompactionState.incrementalSaveCount).toBe(0);
    });

    it('should propagate full-save failures without resetting the incremental count', async () => {
        const failure = new Error('full save failed');
        crdtProjectCompactionState.incrementalSaveCount = 7;
        mocks.saveAllToIdb.mockRejectedValue(failure);

        await expect(compactProject()).rejects.toBe(failure);
        expect(crdtProjectCompactionState.incrementalSaveCount).toBe(7);
    });
});
