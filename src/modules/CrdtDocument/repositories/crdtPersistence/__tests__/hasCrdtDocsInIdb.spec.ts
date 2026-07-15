import { beforeEach, describe, expect, it, vi } from 'vitest';

import { hasCrdtDocsInIdb } from '../hasCrdtDocsInIdb';

type DocumentBundle = Map<string, Uint8Array>;

const mocks = vi.hoisted(() => ({
    loadAllFromIdb: vi.fn<() => Promise<DocumentBundle | null>>(),
    validateAll: vi.fn<(input: { bundle: DocumentBundle }) => Promise<boolean>>(),
}));

vi.mock('../loadAllFromIdb', () => ({
    loadAllFromIdb: mocks.loadAllFromIdb,
}));
vi.mock('../../automergeRepository', () => ({
    automergeRepository: {
        validateAll: mocks.validateAll,
    },
}));

describe('hasCrdtDocsInIdb', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.loadAllFromIdb.mockResolvedValue(new Map());
        mocks.validateAll.mockResolvedValue(false);
    });

    it('returns false when IndexedDB contains no persisted bundle', async () => {
        mocks.loadAllFromIdb.mockResolvedValue(null);
        await expect(hasCrdtDocsInIdb()).resolves.toBe(false);
        expect(mocks.validateAll).not.toHaveBeenCalled();
    });

    it('validates the complete bundle without committing it', async () => {
        const bundle = new Map([
            ['root', new Uint8Array([1])],
            ['child', new Uint8Array([2])],
            ['root:incremental:10-0', new Uint8Array([3])],
        ]);
        mocks.loadAllFromIdb.mockResolvedValue(bundle);
        mocks.validateAll.mockResolvedValue(true);

        await expect(hasCrdtDocsInIdb()).resolves.toBe(true);
        expect(mocks.validateAll).toHaveBeenCalledWith({ bundle });
    });

    it('returns false when the repository rejects the bundle as not a project', async () => {
        mocks.loadAllFromIdb.mockResolvedValue(new Map([['child', new Uint8Array([1])]]));
        mocks.validateAll.mockResolvedValue(false);

        await expect(hasCrdtDocsInIdb()).resolves.toBe(false);
    });

    it('propagates persisted decode failures instead of treating corruption as absence', async () => {
        const corruption = new Error('corrupt persisted root');
        mocks.loadAllFromIdb.mockResolvedValue(new Map([['root', new Uint8Array([1, 2, 3])]]));
        mocks.validateAll.mockRejectedValue(corruption);

        await expect(hasCrdtDocsInIdb()).rejects.toBe(corruption);
    });
});
