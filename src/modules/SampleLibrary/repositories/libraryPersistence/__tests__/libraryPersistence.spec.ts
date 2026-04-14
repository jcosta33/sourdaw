import { describe, it, expect, vi, beforeEach } from 'vitest';
import { persistLibraryRoots } from '../persistLibraryRoots';
import { persistSamples } from '../persistSamples';
import { requestPermission } from '../requestPermission';
import { restoreLibrary } from '../restoreLibrary';

import { libraryStore } from '../../../stores/libraryStore';
import * as helpers from '../helpers';

vi.mock('../../../stores/libraryStore', () => ({
    libraryStore: { value: { roots: [], samples: [] } },
    addLibraryRoot: vi.fn(),
    addSamples: vi.fn(),
    updateLibraryRootStatus: vi.fn(),
}));

vi.mock('../../../useCases/buildFolderTree', () => ({
    buildFolderTree: vi.fn(),
}));

describe('Library Persistence', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('persistLibraryRoots', () => {
        it('should do nothing if state is missing', async () => {
            vi.spyOn(helpers, 'openDb').mockRejectedValue(new Error('no db'));
            vi.mocked(libraryStore).value = null as any;
            await persistLibraryRoots();
            expect(helpers.openDb).not.toHaveBeenCalled();
        });
    });

    describe('persistSamples', () => {
        it('should do nothing if state is missing', async () => {
            vi.spyOn(helpers, 'openDb').mockRejectedValue(new Error('no db'));
            vi.mocked(libraryStore).value = null as any;
            await persistSamples();
            expect(helpers.openDb).not.toHaveBeenCalled();
        });
    });

    describe('requestPermission', () => {
        it('should return false if root or handle missing', async () => {
            vi.mocked(libraryStore).value = { roots: [] } as any;
            const res = await requestPermission('r1');
            expect(res).toBe(false);
        });

        it('should return true and update status if granted', async () => {
            const handle = { requestPermission: vi.fn().mockResolvedValue('granted') };
            vi.mocked(libraryStore).value = { roots: [{ id: 'r1', handle }] } as any;
            
            const res = await requestPermission('r1');
            expect(res).toBe(true);
            expect(handle.requestPermission).toHaveBeenCalledWith({ mode: 'read' });
        });
    });

    describe('restoreLibrary', () => {
        it('should catch errors silently if DB fails to open', async () => {
            vi.spyOn(helpers, 'openDb').mockRejectedValue(new Error('no db'));
            await restoreLibrary();
            expect(helpers.openDb).toHaveBeenCalled();
        });
    });
});
