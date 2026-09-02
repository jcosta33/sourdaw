import { describe, it, expect, vi, beforeEach } from 'vitest';

import { logger } from '#/infra/logger/appLogger';
import { stopPlayback } from '#/modules/Transport/useCases';

import { readNamedProjectJson } from '../../repositories/project/readNamedProjectJson';
import { setProjectIdentityTransitionDependencies } from '../projectPersistence/projectIdentityTransitionDependencies';
import { addToRecentProjects } from '../recentProjects/addToRecentProjects';
import { getRecentProjects, recentProjectChanges } from '../recentProjects/helpers';
import { loadRecentProject } from '../recentProjects/loadRecentProject';
import { removeFromRecentProjects } from '../recentProjects/removeFromRecentProjects';

type RecentEntry = { name: string; key: string; updatedAt: number };

const storageMocks = vi.hoisted(() => {
    /** null so getRecentProjects() treats storage as empty through the sanitizer. */
    const mockGet = vi.fn(() => null as RecentEntry[] | null);
    const mockSet = vi.fn<(entries: RecentEntry[]) => void>();
    return { mockGet, mockSet };
});

const loadMocks = vi.hoisted(() => ({
    replaceProjectData: vi.fn(),
    runProjectLoadTransaction: vi.fn(),
}));

// replaceProjectData and runProjectLoadTransaction are mocked so loadRecentProject's
// not-found test does not walk the full project-replacement graph (AudioEngine, etc.).
vi.mock('../projectPersistence/helpers/replaceProjectData', () => ({
    replaceProjectData: loadMocks.replaceProjectData,
}));

vi.mock('../projectPersistence/helpers/runProjectLoadTransaction', () => ({
    runProjectLoadTransaction: loadMocks.runProjectLoadTransaction,
}));

vi.mock('#/modules/Project/repositories/project/readNamedProjectJson', () => ({
    readNamedProjectJson: vi.fn(),
}));

vi.mock('#/modules/Project/repositories/project/writeProjectJson', () => ({
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
    defaultTransportState: { masterGain: 75, isPlaying: false },
    ensureTrackStrips: vi.fn(),
    restoreTimelineMapSnapshot: vi.fn(),
}));

describe('recentProjects injectables', () => {
    beforeEach(() => {
        storageMocks.mockGet.mockReturnValue(null);
        storageMocks.mockSet.mockClear();
        vi.mocked(readNamedProjectJson).mockReset();
        loadMocks.runProjectLoadTransaction.mockReturnValue({
            prepare: vi.fn().mockResolvedValue(true),
            activate: vi.fn().mockReturnValue(true),
            canActivate: vi.fn().mockReturnValue(true),
            isCurrent: vi.fn().mockReturnValue(true),
            signal: new AbortController().signal,
        });
        vi.clearAllMocks();
        setProjectIdentityTransitionDependencies({ leaveCollaborationSession: async () => undefined });
    });

    it('should prepend entry on addToRecentProjects', () => {
        addToRecentProjects('My Song', 'key-a');

        expect(storageMocks.mockSet).toHaveBeenCalledTimes(1);
        const first_call = storageMocks.mockSet.mock.calls[0];
        if (!first_call) {
            throw new Error('Expected recent-projects storage write');
        }
        const [entries] = first_call;
        expect(entries).toHaveLength(1);
        const entry = entries[0];
        if (!entry) {
            throw new Error('Expected written recent-project entry');
        }
        expect(entry.name).toBe('My Song');
        expect(entry.key).toBe('key-a');
        expect(Number.isFinite(entry.updatedAt)).toBe(true);
    });

    it('should filter key on removeFromRecentProjects', () => {
        storageMocks.mockGet.mockReturnValue([
            { name: 'A', key: 'k1', updatedAt: 1 },
            { name: 'B', key: 'k2', updatedAt: 2 },
        ]);

        removeFromRecentProjects('k1');

        expect(storageMocks.mockSet).toHaveBeenCalledWith([{ name: 'B', key: 'k2', updatedAt: 2 }]);
    });

    it('notifies Project-owned recent-list subscribers after a storage write', () => {
        const listener = vi.fn();
        const unsubscribe = recentProjectChanges.subscribe(listener);

        addToRecentProjects('My Song', 'key-a');
        unsubscribe();
        removeFromRecentProjects('key-a');

        expect(listener).toHaveBeenCalledTimes(1);
    });

    it('should expose getRecentProjects from storage', () => {
        storageMocks.mockGet.mockReturnValue([{ name: 'X', key: 'kx', updatedAt: 3 }]);
        expect(getRecentProjects()).toEqual([{ name: 'X', key: 'kx', updatedAt: 3 }]);
    });

    it('should return false and warn when loadRecentProject finds no stored JSON', async () => {
        vi.mocked(readNamedProjectJson).mockResolvedValue(null);

        const ok = await loadRecentProject('missing-key');

        expect(ok).toBe('not-found');
        expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('No project data found'));
        expect(stopPlayback).not.toHaveBeenCalled();
        expect(loadMocks.replaceProjectData).not.toHaveBeenCalled();
    });
});
