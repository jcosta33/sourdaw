import { describe, it, expect, vi, beforeEach } from 'vitest';

import { logger } from '#/infra/logger/appLogger';
import { resetAudioGraph } from '#/modules/AudioEngine/useCases';
import { stopPlayback } from '#/modules/Transport/useCases';

import { readNamedProjectJson } from '../../repositories/project/storageOperations';
import { addToRecentProjects } from '../recentProjects/addToRecentProjects';
import { getRecentProjects } from '../recentProjects/helpers';
import { loadRecentProject } from '../recentProjects/loadRecentProject';
import { removeFromRecentProjects } from '../recentProjects/removeFromRecentProjects';

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

vi.mock('#/infra/logger/appLogger', () => ({
    logger: {
        warn: vi.fn(),
        error: vi.fn(),
        info: vi.fn(),
    },
}));

vi.mock('#/modules/Transport/useCases', () => ({
    stopPlayback: vi.fn(),
}));

vi.mock('#/modules/AudioEngine/useCases', () => ({
    resetAudioGraph: vi.fn(),
    getAudioContext: vi.fn(),
}));

vi.mock('../projectPersistence/helpers/hydrateModuleStoresFromProjectData', () => ({
    hydrateModuleStoresFromProjectData: vi.fn(),
}));

vi.mock('#/modules/Command/useCases', () => ({
    clearUndoHistory: vi.fn(),
}));

vi.mock('../projectPersistence/helpers/verifyAudioBufferReferences', () => ({
    verifyAudioBufferReferences: vi.fn(),
}));

vi.mock('#/modules/AudioEngine/stores', () => ({
    audioBufferCache: { restoreFromIdb: vi.fn().mockResolvedValue(undefined) },
}));

describe('recentProjects injectables', () => {
    beforeEach(() => {
        storageMocks.mockGet.mockReturnValue(null);
        storageMocks.mockSet.mockClear();
        vi.mocked(readNamedProjectJson).mockReset();
        vi.clearAllMocks();
    });

    it('should prepend entry on addToRecentProjects', () => {
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

        removeFromRecentProjects('k1');

        expect(storageMocks.mockSet).toHaveBeenCalledWith([{ name: 'B', key: 'k2', updatedAt: 2 }]);
    });

    it('should expose getRecentProjects from storage', () => {
        storageMocks.mockGet.mockReturnValue([{ name: 'X', key: 'kx', updatedAt: 3 }]);
        expect(getRecentProjects()).toEqual([{ name: 'X', key: 'kx', updatedAt: 3 }]);
    });

    it('should return false and warn when loadRecentProject finds no stored JSON', async () => {
        vi.mocked(readNamedProjectJson).mockReturnValue(null);

        const ok = await loadRecentProject('missing-key');

        expect(ok).toBe(false);
        expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('No project data found'));
        expect(stopPlayback).not.toHaveBeenCalled();
    });
});
