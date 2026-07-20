import { describe, it, expect, vi, beforeEach } from 'vitest';

import { type SampleRecord } from '../../../models/LibraryTypes';
import { type LibraryState } from '../../../stores/libraryStore';
import { reconcileScannedRoot } from '../reconcileScannedRoot';

const mocks = vi.hoisted(() => ({
    addSamples: vi.fn<(samples: SampleRecord[]) => void>(),
    removeSamples: vi.fn<(sampleIds: string[]) => void>(),
    storeValue: { value: null as LibraryState | null },
}));

vi.mock('../../../stores/libraryStore', () => ({
    addSamples: mocks.addSamples,
    get libraryStore() {
        return mocks.storeValue;
    },
    removeSamples: mocks.removeSamples,
}));

function createSample(overrides: Partial<SampleRecord> & { id: string; libraryRootId: string }): SampleRecord {
    return {
        relativePath: `${overrides.id}.wav`,
        displayName: overrides.id,
        ext: 'wav',
        folder: '',
        sync: { exists: true, status: 'discovered' },
        format: {},
        tags: [],
        favorite: false,
        ...overrides,
    };
}

function seedSamples(samples: SampleRecord[]): void {
    mocks.storeValue.value = { roots: [], samples } as unknown as LibraryState;
}

describe('reconcileScannedRoot', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.storeValue.value = null;
    });

    it('no-ops on an incomplete scan even when orphans are present', () => {
        const stale = createSample({ id: 's1', libraryRootId: 'root-1' });
        seedSamples([stale]);

        reconcileScannedRoot('root-1', new Map(), false);

        expect(mocks.removeSamples).not.toHaveBeenCalled();
        expect(mocks.addSamples).not.toHaveBeenCalled();
    });

    it('no-ops when the store has no state', () => {
        mocks.storeValue.value = null;

        reconcileScannedRoot('root-1', new Map(), true);

        expect(mocks.removeSamples).not.toHaveBeenCalled();
        expect(mocks.addSamples).not.toHaveBeenCalled();
    });

    it('removes a stored sample whose backing file is gone from the completed scan', () => {
        const orphan = createSample({ id: 'orphan', libraryRootId: 'root-1' });
        seedSamples([orphan]);

        reconcileScannedRoot('root-1', new Map(), true);

        expect(mocks.removeSamples).toHaveBeenCalledWith(['orphan']);
        expect(mocks.addSamples).not.toHaveBeenCalled();
    });

    it('leaves samples belonging to other roots untouched', () => {
        const otherRoot = createSample({ id: 'foreign', libraryRootId: 'root-2' });
        seedSamples([otherRoot]);

        reconcileScannedRoot('root-1', new Map(), true);

        expect(mocks.removeSamples).not.toHaveBeenCalled();
        expect(mocks.addSamples).not.toHaveBeenCalled();
    });

    it('replaces a sample whose mtime changed since the last scan', () => {
        const stored = createSample({
            id: 's1',
            libraryRootId: 'root-1',
            sync: { exists: true, status: 'indexed', mtimeMs: 100 },
        });
        const fresh = createSample({
            id: 's1',
            libraryRootId: 'root-1',
            sync: { exists: true, status: 'discovered', mtimeMs: 200 },
        });
        seedSamples([stored]);

        reconcileScannedRoot('root-1', new Map([['s1', fresh]]), true);

        expect(mocks.removeSamples).toHaveBeenCalledWith(['s1']);
        expect(mocks.addSamples).toHaveBeenCalledWith([fresh]);
    });

    it('does not treat an unchanged mtime as an edit', () => {
        const stored = createSample({
            id: 's1',
            libraryRootId: 'root-1',
            sync: { exists: true, status: 'indexed', mtimeMs: 100 },
        });
        const fresh = createSample({
            id: 's1',
            libraryRootId: 'root-1',
            sync: { exists: true, status: 'discovered', mtimeMs: 100 },
        });
        seedSamples([stored]);

        reconcileScannedRoot('root-1', new Map([['s1', fresh]]), true);

        expect(mocks.removeSamples).not.toHaveBeenCalled();
        expect(mocks.addSamples).not.toHaveBeenCalled();
    });

    it('does not treat a missing mtime on either side as a change signal', () => {
        const storedNoMtime = createSample({
            id: 's1',
            libraryRootId: 'root-1',
            sync: { exists: true, status: 'indexed' },
        });
        const freshWithMtime = createSample({
            id: 's1',
            libraryRootId: 'root-1',
            sync: { exists: true, status: 'discovered', mtimeMs: 200 },
        });
        seedSamples([storedNoMtime]);

        reconcileScannedRoot('root-1', new Map([['s1', freshWithMtime]]), true);

        expect(mocks.removeSamples).not.toHaveBeenCalled();
        expect(mocks.addSamples).not.toHaveBeenCalled();
    });

    it('handles an orphan and a changed record together in one reconcile', () => {
        const orphan = createSample({ id: 'gone', libraryRootId: 'root-1' });
        const stored = createSample({
            id: 's1',
            libraryRootId: 'root-1',
            sync: { exists: true, status: 'indexed', mtimeMs: 1 },
        });
        const fresh = createSample({
            id: 's1',
            libraryRootId: 'root-1',
            sync: { exists: true, status: 'discovered', mtimeMs: 2 },
        });
        seedSamples([orphan, stored]);

        reconcileScannedRoot('root-1', new Map([['s1', fresh]]), true);

        expect(mocks.removeSamples).toHaveBeenNthCalledWith(1, ['gone']);
        expect(mocks.removeSamples).toHaveBeenNthCalledWith(2, ['s1']);
        expect(mocks.addSamples).toHaveBeenCalledWith([fresh]);
    });
});
