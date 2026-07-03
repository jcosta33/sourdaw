import { describe, it, expect, vi, beforeEach } from 'vitest';

import { hasCrdtProject } from '../hasCrdtProject';

const mocks = vi.hoisted(() => ({
    hasCrdtDocsInIdb: vi.fn(),
}));

vi.mock('../../repositories/crdtPersistence/hasCrdtDocsInIdb', () => ({ hasCrdtDocsInIdb: mocks.hasCrdtDocsInIdb }));

describe('hasCrdtProject', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should check project existence through IDB persistence', async () => {
        mocks.hasCrdtDocsInIdb.mockResolvedValue(true);

        const result = await hasCrdtProject();

        expect(result).toBe(true);
        expect(mocks.hasCrdtDocsInIdb).toHaveBeenCalledOnce();
    });
});
