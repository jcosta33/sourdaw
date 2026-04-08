import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMock } from '#/infra/di/testing/createMock';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import {
    addToRecentProjects,
    removeFromRecentProjects,
    getRecentProjects,
    loadRecentProject,
} from './recentProjects';
import { readNamedProjectJson } from '../repositories/project/storageOperations';
import { type Logger } from '#/helpers/Logger/Logger';

type RecentEntry = { name: string; key: string; updatedAt: number };

const storageMocks = vi.hoisted(() => {
    /** null so getRecentProjects() treats storage as empty (see recentProjectsStorage.get() ?? []). */
    const mockGet = vi.fn(() => null as RecentEntry[] | null);
    const mockSet = vi.fn();
    return { mockGet, mockSet };
});

/** Avoid loading playheadScheduler → scheduleAudioClips → sessionManagement → branchStore (needs real storage shape). */
vi.mock('#/modules/Transport/useCases/playheadScheduler', () => ({
    startPlayheadScheduler: vi.fn(),
    stopPlayheadScheduler: vi.fn(),
}));

vi.mock('#/modules/Project/repositories/project/storageOperations', () => ({
    readNamedProjectJson: vi.fn(),
    writeProjectJson: vi.fn(),
}));

vi.mock('#/infra/store/storage/createLocalStorage', () => ({
    createLocalStorage: vi.fn(() => ({
        get: storageMocks.mockGet,
        set: storageMocks.mockSet,
        clear: vi.fn(),
        isSupported: () => true,
    })),
}));

describe('recentProjects injectables', () => {
    beforeEach(() => {
        storageMocks.mockGet.mockReturnValue(null);
        storageMocks.mockSet.mockClear();
        vi.mocked(readNamedProjectJson).mockReset();
    });

    it('should prepend entry on addToRecentProjects', () => {
        const logger = createMock<Logger>();
        injectDependencies(addToRecentProjects, { logger });

        addToRecentProjects('My Song', 'key-a');

        expect(storageMocks.mockSet).toHaveBeenCalledWith([
            { name: 'My Song', key: 'key-a', updatedAt: expect.any(Number) },
        ]);
    });

    it('should filter key on removeFromRecentProjects', () => {
        storageMocks.mockGet.mockReturnValue([
            { name: 'A', key: 'k1', updatedAt: 1 },
            { name: 'B', key: 'k2', updatedAt: 2 },
        ]);

        const logger = createMock<Logger>();
        injectDependencies(removeFromRecentProjects, { logger });

        removeFromRecentProjects('k1');

        expect(storageMocks.mockSet).toHaveBeenCalledWith([{ name: 'B', key: 'k2', updatedAt: 2 }]);
    });

    it('should expose getRecentProjects from storage', () => {
        storageMocks.mockGet.mockReturnValue([{ name: 'X', key: 'kx', updatedAt: 3 }]);
        expect(getRecentProjects()).toEqual([{ name: 'X', key: 'kx', updatedAt: 3 }]);
    });

    it('should return false and warn when loadRecentProject finds no stored JSON', async () => {
        vi.mocked(readNamedProjectJson).mockReturnValue(null);

        const logger = createMock<Logger>();
        const stopPlaybackMock = vi.fn();
        injectDependencies(loadRecentProject, {
            logger,
            stopPlayback: stopPlaybackMock,
            resetAudioGraph: vi.fn(),
            getAudioContext: vi.fn(),
            hydrateModuleStoresFromProjectData: vi.fn(),
            clearUndoHistory: vi.fn(),
            verifyAudioBufferReferences: vi.fn(),
            audioBufferCache: { restoreFromIdb: vi.fn().mockResolvedValue(undefined) },
        });

        const ok = await loadRecentProject('missing-key');

        expect(ok).toBe(false);
        expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('No project data found'));
        expect(stopPlaybackMock).not.toHaveBeenCalled();
    });
});
