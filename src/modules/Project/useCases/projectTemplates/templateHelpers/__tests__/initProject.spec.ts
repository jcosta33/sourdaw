import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { preferencesStore } from '#/modules/Preferences/stores';
import { defaultPreferences } from '#/modules/Preferences/useCases';

const mocks = vi.hoisted(() => ({
    createTrack: vi.fn(() => ({ id: 'master', name: 'Master', kind: 'master' })),
    resetArrangementStoresForProject: vi.fn(),
    getAllTracks: vi.fn(() => []),
    replaceChordTrackState: vi.fn(),
    hydrateGrooveTemplates: vi.fn(),
    transportSet: vi.fn(),
    projectSet: vi.fn(),
}));

vi.mock('#/modules/Arrangement/useCases', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/Arrangement/useCases')>();
    return {
        ...actual,
        createTrack: mocks.createTrack,
        resetArrangementStoresForProject: mocks.resetArrangementStoresForProject,
    };
});
vi.mock('#/modules/MIDI/useCases', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/MIDI/useCases')>();
    return {
        ...actual,
        replaceChordTrackState: mocks.replaceChordTrackState,
        hydrateGrooveTemplates: mocks.hydrateGrooveTemplates,
    };
});
// Real stores with only the write spied, so the real Transport useCases barrel —
// and with it the real `preferencesSeededTransportState` — loads and runs below.
vi.mock('#/modules/Transport/stores', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/Transport/stores')>();
    return {
        ...actual,
        transportStore: { ...actual.transportStore, set: mocks.transportSet },
    };
});
vi.mock('#/modules/Project/stores/projectStore', () => ({
    projectStore: { set: mocks.projectSet },
}));

import { isCanonicalProjectId } from '../../../../models/ProjectData';
import { initProject } from '../initProject';

describe('initProject', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    afterEach(() => {
        preferencesStore.set(defaultPreferences);
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

    it('seeds the template transport from non-default Recording preferences', () => {
        // Every shipped template builds its transport through initProject, so
        // the full-state replace here is the one place the preference seed
        // would be silently dropped (#4673): non-default Recording preferences
        // must survive the template's tempo/time-signature overrides.
        preferencesStore.set({ ...defaultPreferences, recordCountIn: 2, preRollEnabled: true, preRollBars: 1 });

        initProject({ name: 'EDM', bpm: 128 });

        expect(mocks.transportSet).toHaveBeenCalledWith(
            expect.objectContaining({
                tempo: 128,
                timeSignatureNumerator: 4,
                timeSignatureDenominator: 4,
                loopEnd: 64,
                isLooping: true,
                countInEnabled: true,
                countInBars: 2,
                preRollEnabled: true,
                preRollBars: 1,
            })
        );
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
