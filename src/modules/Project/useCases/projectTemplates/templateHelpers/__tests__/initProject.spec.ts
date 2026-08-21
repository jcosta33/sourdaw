import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    createTrack: vi.fn(() => ({ id: 'master', name: 'Master', kind: 'master' })),
    resetArrangementStoresForProject: vi.fn(),
    replaceChordTrackState: vi.fn(),
    hydrateGrooveTemplates: vi.fn(),
    transportSet: vi.fn(),
    projectSet: vi.fn(),
}));

vi.mock('#/modules/Arrangement/useCases', () => ({
    createTrack: mocks.createTrack,
    resetArrangementStoresForProject: mocks.resetArrangementStoresForProject,
}));
vi.mock('#/modules/MIDI/useCases', () => ({
    replaceChordTrackState: mocks.replaceChordTrackState,
    hydrateGrooveTemplates: mocks.hydrateGrooveTemplates,
}));
vi.mock('#/modules/Transport/stores', () => ({
    transportStore: { set: mocks.transportSet },
    defaultTransportState: {},
}));
vi.mock('#/modules/Project/stores/projectStore', () => ({
    projectStore: { set: mocks.projectSet },
}));

import { isCanonicalProjectId } from '../../../../models/ProjectData';
import { initProject } from '../initProject';

describe('initProject', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('does not signal workspace-ready — the async template build has not settled yet', () => {
        // Red-first (CC-10, ready-before-settle): initProject runs at the START of
        // an async template build, before finalizeTemplate commits the tracks and
        // selection. If it latched `initialized` (workspace-ready) here, the
        // launch overlay would exit while those writes are still in flight, and the
        // template's late-landing setTrackState would clobber whatever track the
        // user clicked in that window (see devices.spec.ts:11 under contention).
        // The ready latch belongs to createFromTemplate, after the action commits.
        initProject({ name: 'EDM', bpm: 128 });

        expect(mocks.projectSet).toHaveBeenCalledOnce();
        const published = mocks.projectSet.mock.calls[0]?.[0] as { initialized: boolean; loading: boolean };
        expect(published.initialized).toBe(false);
        expect(published.loading).toBe(true);
        // The project metadata IS published (name/tempo) — only the ready signal is withheld.
        expect(published).toMatchObject({ name: 'EDM' });
    });

    it('gives same-tick template projects distinct canonical identities', () => {
        vi.useFakeTimers();
        vi.setSystemTime(1_700_000_000_000);

        initProject({ name: 'First', bpm: 120 });
        initProject({ name: 'Second', bpm: 120 });

        const first = mocks.projectSet.mock.calls[0]?.[0] as { createdAt: number; projectId?: string };
        const second = mocks.projectSet.mock.calls[1]?.[0] as { createdAt: number; projectId?: string };
        expect(first.createdAt).toBe(second.createdAt);
        expect(isCanonicalProjectId(first.projectId)).toBe(true);
        expect(isCanonicalProjectId(second.projectId)).toBe(true);
        expect(first.projectId).not.toBe(second.projectId);

        vi.useRealTimers();
    });
});
