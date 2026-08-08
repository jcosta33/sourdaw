/**
 * An interrupted project open must not disable dirty tracking for the session.
 *
 * `replaceProjectData` claims `loading: true` before anything can go wrong, and
 * `markDirty` treats `loading` as "this write is hydration, not an edit". So
 * every path that leaves the flag set silently kills dirty tracking for the
 * rest of the session: no unsaved-changes indicator, no 30 s autosave (it is
 * gated on `dirty === true`), and `pickAndImportProjectFile`'s save-before-
 * import guard reads a permanently clean project and discards the user's work.
 *
 * Two families of interruption are covered:
 *   - the eight abort returns, which must hand the previous session's transient
 *     flags back the way `newProject`'s `failNewProjectActivation` does;
 *   - a throwing notification flush on the committed path, which must still
 *     reach `finishProjectLoading`.
 *
 * The wiring is the real one: `initProjectDirtyTracking` is the subscription the
 * composition root installs, both stores are the real singletons, and
 * `batchStoreUpdates` is the real implementation (wrapped only so a flush
 * failure can be injected). Only the audio graph, CRDT durability and transport
 * edges are stubbed, because they reach IndexedDB and an AudioContext.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
    mockLogger,
    mockGetAudioContext,
    mockImportCachedAudioBuffers,
    mockPrepareCachedAudioBuffersFromIdb,
    mockResetAudioGraph,
    mockClearUndoHistory,
    mockCompactProject,
    mockProjectActionHistoryToStore,
    mockResetCrdtProjectAuthority,
    mockStartCrdtAutoSave,
    mockClearLoadedExternalPlugins,
    mockEnsureTrackStrips,
    mockStopPlayback,
    mockNotifyUser,
    mockStopActiveAutoSave,
    mockSetAutoSaveHandle,
    batchFlushFailure,
} = vi.hoisted(() => ({
    mockLogger: { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() },
    mockGetAudioContext: vi.fn(() => ({ sampleRate: 44_100 })),
    mockImportCachedAudioBuffers: vi.fn(() =>
        Promise.resolve({ publish: vi.fn(), persist: () => Promise.resolve(true) })
    ),
    mockPrepareCachedAudioBuffersFromIdb: vi.fn(() => Promise.resolve({ publish: vi.fn() })),
    mockResetAudioGraph: vi.fn(),
    mockClearUndoHistory: vi.fn(),
    mockCompactProject: vi.fn(() => Promise.resolve()),
    mockProjectActionHistoryToStore: vi.fn(),
    mockResetCrdtProjectAuthority: vi.fn(),
    mockStartCrdtAutoSave: vi.fn(() => () => {}),
    mockClearLoadedExternalPlugins: vi.fn(),
    mockEnsureTrackStrips: vi.fn(),
    mockStopPlayback: vi.fn(() => Promise.resolve()),
    mockNotifyUser: vi.fn(),
    mockStopActiveAutoSave: vi.fn(),
    mockSetAutoSaveHandle: vi.fn(),
    // The real `notify()` wraps every subscriber in its own try/catch, so a
    // flush cannot be made to throw from a subscriber. The production code
    // nevertheless models it as fallible (it carries a catch for exactly that),
    // and this is the seam that lets the guard exercise that model.
    batchFlushFailure: { error: null as Error | null },
}));

vi.mock('#/infra/logger/appLogger', () => ({ logger: mockLogger }));
vi.mock('#/infra/store/createStore', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/infra/store/createStore')>();
    return {
        ...actual,
        batchStoreUpdates: <TResult>(update: () => TResult): TResult => {
            const result = actual.batchStoreUpdates(update);
            if (batchFlushFailure.error) {
                throw batchFlushFailure.error;
            }
            return result;
        },
    };
});
vi.mock('#/modules/AudioEngine/useCases', () => ({
    getAudioContext: mockGetAudioContext,
    importCachedAudioBuffers: mockImportCachedAudioBuffers,
    prepareCachedAudioBuffersFromIdb: mockPrepareCachedAudioBuffersFromIdb,
    resetAudioGraph: mockResetAudioGraph,
}));
vi.mock('#/modules/Command/useCases', () => ({ clearUndoHistory: mockClearUndoHistory }));
vi.mock('#/modules/CrdtDocument/useCases', () => ({
    compactProject: mockCompactProject,
    projectActionHistoryToStore: mockProjectActionHistoryToStore,
    resetCrdtProjectAuthority: mockResetCrdtProjectAuthority,
    startCrdtAutoSave: mockStartCrdtAutoSave,
}));
vi.mock('#/modules/PluginHost/useCases', () => ({ clearLoadedExternalPlugins: mockClearLoadedExternalPlugins }));
vi.mock('#/modules/Transport/useCases', () => ({
    ensureTrackStrips: mockEnsureTrackStrips,
    stopPlayback: mockStopPlayback,
}));
vi.mock('#/utils/Notification/notifyUser', () => ({ notifyUser: mockNotifyUser }));
vi.mock('../../helpers/autoSaveHandle', () => ({ setAutoSaveHandle: mockSetAutoSaveHandle }));
vi.mock('../../helpers/stopActiveAutoSave', () => ({ stopActiveAutoSave: mockStopActiveAutoSave }));

import { defaultTrackState, trackStore } from '#/modules/Arrangement/stores';

import { projectStore } from '../../../../stores/projectStore';
import { replaceProjectData } from '../../helpers/replaceProjectData';
import { initProjectDirtyTracking } from '../initProjectDirtyTracking';

import type { HydratableProjectData } from '../../helpers/isHydratableProjectData';
import type { ProjectLoadTransaction } from '../../helpers/runProjectLoadTransaction';

const OPEN_PROJECT_NAME = 'Session In Progress';
const OPEN_TRACK_ID = 'track-the-user-is-working-on';
const OPEN_TRACK_NAME = 'Vocals';
const INCOMING_PROJECT_NAME = 'Project That Fails To Open';
const INCOMING_TRACK_NAME = 'Never Arrives';

function projectData({ name, trackId, trackName }: { name: string; trackId: string; trackName: string }) {
    return {
        version: 1,
        meta: {
            name,
            createdAt: 1_700_000_000_000,
            updatedAt: 1_700_000_100_000,
            keyRoot: 5,
            scaleName: 'minor',
            tuning: { name: 'Equal Temperament', frequencies: [440] },
        },
        arrangement: {
            tracks: [{ id: trackId, name: trackName, kind: 'audio', clips: [] }],
        },
    } satisfies HydratableProjectData;
}

const transactionControls = {
    prepare: (): Promise<boolean> => Promise.resolve(true),
    activate: (): boolean => true,
    /** A newer load has claimed the store; this one no longer owns any of it. */
    superseded: false,
};

function loadTransaction(): ProjectLoadTransaction {
    return {
        prepare: () => transactionControls.prepare(),
        activate: () => transactionControls.activate(),
        canActivate: () => !transactionControls.superseded,
        isCurrent: () => !transactionControls.superseded,
    };
}

function openProject(name: string, trackId: string, trackName: string) {
    return replaceProjectData({
        context: 'loadRecentProject',
        data: projectData({ name, trackId, trackName }),
        transaction: loadTransaction(),
    });
}

function editTheArrangement(): void {
    const current = trackStore.value ?? defaultTrackState;
    trackStore.set({
        ...current,
        tracks: current.tracks.map((track) =>
            track.id === OPEN_TRACK_ID ? { ...track, name: 'Vocals (renamed by the user)' } : track
        ),
    });
}

/**
 * Every abort return in `replaceProjectData`, by the failure a user could
 * actually hit there. The two supersession-only returns are exercised
 * separately, below, because handing the flags back is the wrong move once
 * another load owns the store.
 */
const restoringAborts: Array<{ label: string; arrange: () => void }> = [
    {
        label: 'the transaction declines to prepare (a boot restore standing down)',
        arrange: () => {
            transactionControls.prepare = () => Promise.resolve(false);
        },
    },
    {
        label: 'the transaction declines to activate',
        arrange: () => {
            transactionControls.activate = () => false;
        },
    },
    {
        label: 'preparation throws while leaving the collaboration session',
        arrange: () => {
            transactionControls.prepare = () => Promise.reject(new Error('leave session failed'));
        },
    },
    {
        label: 'the embedded audio buffers are unreadable',
        arrange: () => {
            mockImportCachedAudioBuffers.mockResolvedValue(null as never);
        },
    },
    {
        label: 'decoding the embedded audio buffers throws',
        arrange: () => {
            mockImportCachedAudioBuffers.mockRejectedValue(new Error('decode failed'));
        },
    },
    {
        label: 'the stored audio buffers cannot be read back from IndexedDB',
        arrange: () => {
            mockPrepareCachedAudioBuffersFromIdb.mockResolvedValue(null as never);
        },
    },
    {
        label: 'tearing the previous audio graph down throws',
        arrange: () => {
            mockStopPlayback.mockRejectedValue(new Error('stopPlayback failed'));
        },
    },
    {
        label: 'handing CRDT authority to the incoming project throws',
        arrange: () => {
            mockResetCrdtProjectAuthority.mockImplementation(() => {
                throw new Error('authority reset failed');
            });
        },
    },
];

describe('interrupted project load dirty tracking', () => {
    let stopDirtyTracking: () => void = () => {};

    beforeEach(() => {
        vi.clearAllMocks();
        stopDirtyTracking();
        batchFlushFailure.error = null;
        transactionControls.prepare = () => Promise.resolve(true);
        transactionControls.activate = () => true;
        transactionControls.superseded = false;
        mockImportCachedAudioBuffers.mockResolvedValue({ publish: vi.fn(), persist: () => Promise.resolve(true) });
        mockPrepareCachedAudioBuffersFromIdb.mockResolvedValue({ publish: vi.fn() });
        mockStopPlayback.mockResolvedValue(undefined);
        mockCompactProject.mockResolvedValue(undefined);
        mockResetCrdtProjectAuthority.mockImplementation(() => {});
        mockStartCrdtAutoSave.mockReturnValue(() => {});
        trackStore.set(structuredClone(defaultTrackState));
        projectStore.set({
            name: 'Cold Start',
            createdAt: 1,
            updatedAt: 2,
            dirty: false,
            loading: true,
            keyRoot: 0,
            scaleName: 'chromatic',
            tuning: { name: 'Equal Temperament', frequencies: [440] },
            initialized: false,
        });
        stopDirtyTracking = initProjectDirtyTracking();
    });

    describe('an aborted open leaves the session it interrupted editable', () => {
        for (const { label, arrange } of restoringAborts) {
            it(`when ${label}`, async () => {
                const opened = await openProject(OPEN_PROJECT_NAME, OPEN_TRACK_ID, OPEN_TRACK_NAME);
                expect(opened.status).toBe('committed');
                expect(projectStore.value?.dirty).toBe(false);

                arrange();
                const aborted = await replaceProjectData({
                    context: 'applyImportedProjectData',
                    data: projectData({
                        name: INCOMING_PROJECT_NAME,
                        trackId: 'incoming-track',
                        trackName: INCOMING_TRACK_NAME,
                    }),
                    transaction: loadTransaction(),
                });

                expect(aborted.status).toBe('aborted');
                // The session the user was in is still the one on screen: their
                // arrangement, their project, not a wedged loading overlay.
                expect(trackStore.value?.tracks.map((track) => track.name)).toContain(OPEN_TRACK_NAME);
                expect(projectStore.value?.name).toBe(OPEN_PROJECT_NAME);
                expect(projectStore.value?.loading).toBe(false);
                expect(projectStore.value?.initialized).toBe(true);
                expect(projectStore.value?.dirty).toBe(false);

                // The consequence that matters: the next edit is still tracked,
                // so the indicator, the autosave and the save-before-import
                // guard all still see the user's unsaved work.
                editTheArrangement();

                expect(projectStore.value?.dirty).toBe(true);
            });
        }
    });

    describe('an aborted open that a newer load superseded leaves the newer load alone', () => {
        it('does not hand the older load transient flags back over the newer load', async () => {
            const opened = await openProject(OPEN_PROJECT_NAME, OPEN_TRACK_ID, OPEN_TRACK_NAME);
            expect(opened.status).toBe('committed');

            // A second open starts while this one waits on the transport: it
            // takes the transaction and writes its own loading state, exactly
            // as `replaceProjectData` does on entry.
            mockStopPlayback.mockImplementation(() => {
                transactionControls.superseded = true;
                const current = projectStore.value;
                if (current) {
                    projectStore.set({ ...current, name: 'The Newer Load', loading: true, initialized: false });
                }
                return Promise.resolve();
            });

            const aborted = await replaceProjectData({
                context: 'applyImportedProjectData',
                data: projectData({
                    name: INCOMING_PROJECT_NAME,
                    trackId: 'incoming-track',
                    trackName: INCOMING_TRACK_NAME,
                }),
                transaction: loadTransaction(),
            });

            expect(aborted.status).toBe('aborted');
            // The newer load owns the store now, and its own commit is what
            // clears these. Restoring here would clear `loading` mid-hydration
            // and mark the newer project dirty the moment it hydrates.
            expect(projectStore.value?.name).toBe('The Newer Load');
            expect(projectStore.value?.loading).toBe(true);
            expect(projectStore.value?.initialized).toBe(false);
        });

        it('leaves a superseded load unable to mark the arrangement dirty under the newer load', async () => {
            await openProject(OPEN_PROJECT_NAME, OPEN_TRACK_ID, OPEN_TRACK_NAME);
            mockStopPlayback.mockImplementation(() => {
                transactionControls.superseded = true;
                const current = projectStore.value;
                if (current) {
                    projectStore.set({ ...current, loading: true, initialized: false });
                }
                return Promise.resolve();
            });

            await replaceProjectData({
                context: 'applyImportedProjectData',
                data: projectData({
                    name: INCOMING_PROJECT_NAME,
                    trackId: 'incoming-track',
                    trackName: INCOMING_TRACK_NAME,
                }),
                transaction: loadTransaction(),
            });

            // The newer load is still hydrating; its writes are not user edits.
            editTheArrangement();

            expect(projectStore.value?.dirty).toBe(false);
        });
    });

    describe('a committed open', () => {
        it('ends with loading cleared and the next edit tracked', async () => {
            const opened = await openProject(OPEN_PROJECT_NAME, OPEN_TRACK_ID, OPEN_TRACK_NAME);

            expect(opened.status).toBe('committed');
            expect(trackStore.value?.tracks.map((track) => track.name)).toContain(OPEN_TRACK_NAME);
            expect(projectStore.value?.loading).toBe(false);
            // Pins the negative: "never set loading" is not a fix. The load must
            // still suppress its own hydration writes.
            expect(projectStore.value?.dirty).toBe(false);

            editTheArrangement();

            expect(projectStore.value?.dirty).toBe(true);
        });

        it('still clears loading when the notification flush throws', async () => {
            const opened = await openProject(OPEN_PROJECT_NAME, OPEN_TRACK_ID, OPEN_TRACK_NAME);
            expect(opened.status).toBe('committed');

            batchFlushFailure.error = new Error('subscriber notification flush failed');
            const reopened = await replaceProjectData({
                context: 'loadRecentProject',
                data: projectData({ name: 'Reopened', trackId: OPEN_TRACK_ID, trackName: OPEN_TRACK_NAME }),
                transaction: loadTransaction(),
            });
            batchFlushFailure.error = null;

            expect(reopened.status).toBe('committed');
            expect(projectStore.value?.loading).toBe(false);

            editTheArrangement();

            expect(projectStore.value?.dirty).toBe(true);
        });
    });
});
