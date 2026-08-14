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
 * All eight abort returns are covered, but they do not all want the same
 * answer. Five are genuine failures a transition can hit while it can still
 * activate: those must hand the previous session's transient flags back, the
 * way `newProject`'s `failNewProjectActivation` does. The other three
 * (`prepare()` false, `activate()` false, and the IndexedDB read returning
 * null) are only reachable by losing the ordering race, and on those the
 * successor owns the flags and nothing may be restored. Plus a throwing
 * notification flush on the committed path, which must still reach
 * `finishProjectLoading`.
 *
 * The wiring is the real one: `initProjectDirtyTracking` is the subscription the
 * composition root installs, both stores are the real singletons, and
 * `batchStoreUpdates` is the real implementation (wrapped only so a flush
 * failure can be injected). Only the audio graph, CRDT durability and transport
 * edges are stubbed, because they reach IndexedDB and an AudioContext.
 *
 * Scope, stated so it is not read as more than it is: every assertion here
 * reads `projectStore` or `trackStore`. `resetCrdtProjectAuthority`,
 * `resetAudioGraph` and `ensureTrackStrips` are no-op mocks, so this spec says
 * nothing about whether the previous CRDT authority or audio graph survives an
 * abort — only about the transient flags and the two stores' contents.
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
    mockUnloadLoadedExternalPlugins,
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
    // Mirrors `prepareBuffersFromIdb`: its null is produced by `shouldContinue`
    // and never independently of it (`audioBufferCache.ts:643`, `:647`, `:662`,
    // `:677` — invalid rows are skipped, and the catch returns an object).
    mockPrepareCachedAudioBuffersFromIdb: vi.fn(
        (input: { shouldContinue?: () => boolean }): Promise<{ publish: () => void } | null> => {
            if (input.shouldContinue?.() === false) {
                return Promise.resolve(null);
            }
            return Promise.resolve({ publish: vi.fn() });
        }
    ),
    mockResetAudioGraph: vi.fn(),
    mockClearUndoHistory: vi.fn(),
    mockCompactProject: vi.fn(() => Promise.resolve()),
    mockProjectActionHistoryToStore: vi.fn(),
    mockResetCrdtProjectAuthority: vi.fn(),
    mockStartCrdtAutoSave: vi.fn(() => () => {}),
    mockUnloadLoadedExternalPlugins: vi.fn(() => Promise.resolve()),
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
vi.mock('#/modules/Command/useCases', () => ({ clearUndoHistory: mockClearUndoHistory, executeAppAction: vi.fn() }));
vi.mock('#/modules/CrdtDocument/useCases', () => ({
    compactProject: mockCompactProject,
    projectActionHistoryToStore: mockProjectActionHistoryToStore,
    resetCrdtProjectAuthority: mockResetCrdtProjectAuthority,
    startCrdtAutoSave: mockStartCrdtAutoSave,
}));
vi.mock('#/modules/PluginHost/useCases', () => ({ unloadPlugin: mockUnloadLoadedExternalPlugins }));
vi.mock('#/modules/Transport/useCases', () => ({
    ensureTrackStrips: mockEnsureTrackStrips,
    stopPlayback: mockStopPlayback,
}));
vi.mock('#/utils/Notification/notifyUser', () => ({ notifyUser: mockNotifyUser }));
vi.mock('../../helpers/autoSaveHandle', () => ({ setAutoSaveHandle: mockSetAutoSaveHandle }));
vi.mock('../../helpers/stopActiveAutoSave', () => ({ stopActiveAutoSave: mockStopActiveAutoSave }));

import { defaultTrackState, trackStore } from '#/modules/Arrangement/stores';

import { projectLoadFailureStore } from '../../../../stores/projectLoadFailureStore';
import { defaultProjectStoreState, projectStore } from '../../../../stores/projectStore';
import { replaceProjectData } from '../../helpers/replaceProjectData';
import { initProjectDirtyTracking } from '../initProjectDirtyTracking';

import type { HydratableProjectData } from '../../helpers/isHydratableProjectData';
import type { ProjectLoadTransaction } from '../../helpers/runProjectLoadTransaction';

const OPEN_PROJECT_NAME = 'Session In Progress';
const OPEN_TRACK_ID = 'track-the-user-is-working-on';
const OPEN_TRACK_NAME = 'Vocals';
const INCOMING_PROJECT_NAME = 'Project That Fails To Open';
const INCOMING_TRACK_NAME = 'Never Arrives';
const SUCCESSOR_PROJECT_NAME = 'The Newer Load';

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
    /** A newer transition has claimed the ordering slots. */
    superseded: false,
};

/**
 * `canActivate()` and `isCurrent()` are two predicates and must stay two here.
 * In `runProjectLoadTransaction` they are not interchangeable: `canActivate()`
 * is a `>=` test on the ordering counters alone, while `isCurrent()` also
 * requires that this transition actually won `activate()` and holds both slots
 * exactly. Fusing them erases the window between entry and activation, where a
 * transition may still claim the store but does not yet own it — which is where
 * the entry write lives.
 *
 * The `lost` latch keeps the fake from modelling states production cannot
 * produce. No caller of `replaceProjectData` allocates with `yieldToInFlight`
 * (`applyImportedProjectData` and `loadRecentProject` are the only two, and
 * `loadProject` — the one that does yield — never reaches here), and for a
 * non-yielding transition every way `prepare()` or `activate()` can return
 * false is a lost ordering slot: `prepare()` false means
 * `transitionId < latestPreparedProjectTransitionId`, `activate()` false means
 * a newer transition holds the active or prepared slot. Both drive
 * `canActivate()` false. A fake that let those resolve false while still
 * claiming to be activatable would invite guards asserting a restore that can
 * never happen.
 */
function loadTransaction(): ProjectLoadTransaction {
    let activated = false;
    let lost = false;
    const ownable = (): boolean => !lost && !transactionControls.superseded;
    return {
        prepare: async () => {
            const prepared = await transactionControls.prepare();
            if (!prepared) {
                lost = true;
            }
            return prepared;
        },
        activate: () => {
            activated = ownable() && transactionControls.activate();
            if (!activated) {
                lost = true;
            }
            return activated;
        },
        canActivate: () => ownable(),
        isCurrent: () => activated && ownable(),
    };
}

/**
 * A newer transition takes the ordering slots and writes its own entry state,
 * exactly as `replaceProjectData` and `newProject` do on entry. After this the
 * older transition owns nothing and must leave the store alone.
 */
function takeOverByNewerLoad(): void {
    transactionControls.superseded = true;
    const current = projectStore.value;
    if (current) {
        projectStore.set({ ...current, name: SUCCESSOR_PROJECT_NAME, loading: true, initialized: false });
    }
}

function openProject(name: string, trackId: string, trackName: string) {
    return replaceProjectData({
        context: 'loadRecentProject',
        data: projectData({ name, trackId, trackName }),
        transaction: loadTransaction(),
    });
}

/** The default IndexedDB buffer read, restored between cases. */
function readStoredBuffers(input: { shouldContinue?: () => boolean }): Promise<{ publish: () => void } | null> {
    if (input.shouldContinue?.() === false) {
        return Promise.resolve(null);
    }
    return Promise.resolve({ publish: vi.fn() });
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
 * The five abort returns a transition can reach while it can still activate.
 * Each is a genuine failure rather than a lost race, so the entry write really
 * did happen and really must be undone.
 */
const restoringAborts: Array<{ label: string; arrange: () => void }> = [
    {
        label: 'preparation throws while leaving the collaboration session',
        arrange: () => {
            transactionControls.prepare = () => Promise.reject(new Error('leave session failed'));
        },
    },
    {
        label: 'the embedded audio buffers are unreadable',
        // `importBuffers` returns null on invalid buffer data
        // (`audioBufferCache.ts:1051`, `:1067`), not only on `shouldContinue`,
        // so this one is reachable with the transition still activatable.
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

/**
 * The three abort returns that only a lost race can reach. Production cannot
 * arrive at any of them with `canActivate()` still true — `prepare()` false and
 * `activate()` false both mean a newer transition took the ordering slot, and
 * `prepareBuffersFromIdb` returns null *only* through `shouldContinue`
 * (`audioBufferCache.ts:643`, `:647`, `:662`, `:677`), which is
 * `transaction.isCurrent`. So the correct behaviour on all three is to restore
 * nothing: the successor owns the flags and clears them on its own commit.
 */
const successorOwnedAborts: Array<{ label: string; arrange: () => void }> = [
    {
        label: 'a newer transition takes the prepared slot before this one prepares',
        arrange: () => {
            transactionControls.prepare = () => {
                takeOverByNewerLoad();
                return Promise.resolve(false);
            };
        },
    },
    {
        label: 'a newer transition becomes active before this one activates',
        arrange: () => {
            transactionControls.activate = () => {
                takeOverByNewerLoad();
                return false;
            };
        },
    },
    {
        label: 'a newer transition supersedes this one during the IndexedDB buffer read',
        arrange: () => {
            mockPrepareCachedAudioBuffersFromIdb.mockImplementation((input) => {
                takeOverByNewerLoad();
                // The null comes out of the ordinary read path, via
                // `shouldContinue` — not injected around it.
                return readStoredBuffers(input);
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
        mockPrepareCachedAudioBuffersFromIdb.mockImplementation(readStoredBuffers);
        mockStopPlayback.mockResolvedValue(undefined);
        mockCompactProject.mockResolvedValue(undefined);
        mockResetCrdtProjectAuthority.mockImplementation(() => {});
        mockStartCrdtAutoSave.mockReturnValue(() => {});
        trackStore.set(structuredClone(defaultTrackState));
        projectStore.set({
            ...structuredClone(defaultProjectStoreState),
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
                // Scope: the two stores only. The previous session's arrangement
                // and project metadata are still in place and the transient
                // flags are back, so no loading overlay is wedged and dirty
                // tracking is live.
                //
                // NOT covered here, and deliberately not claimed: whether the
                // previous CRDT authority or audio graph survived.
                // `resetCrdtProjectAuthority`, `resetAudioGraph` and
                // `ensureTrackStrips` are all no-op mocks in this spec, so
                // nothing below could detect a regression in them.
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

        for (const { label, arrange } of successorOwnedAborts) {
            it(`restores nothing when ${label}`, async () => {
                const opened = await openProject(OPEN_PROJECT_NAME, OPEN_TRACK_ID, OPEN_TRACK_NAME);
                expect(opened.status).toBe('committed');

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
                // The successor's entry state stands untouched. Restoring here
                // would clear its `loading` mid-load and mark the project it is
                // hydrating dirty; the successor clears the flags itself when it
                // commits.
                expect(projectStore.value?.name).toBe(SUCCESSOR_PROJECT_NAME);
                expect(projectStore.value?.loading).toBe(true);
                expect(projectStore.value?.initialized).toBe(false);

                // And while the successor is still loading, its hydration writes
                // are not the user's edits.
                editTheArrangement();

                expect(projectStore.value?.dirty).toBe(false);
            });
        }

        it('does not blame the user for the arrangement writes its own teardown made', async () => {
            const opened = await openProject(OPEN_PROJECT_NAME, OPEN_TRACK_ID, OPEN_TRACK_NAME);
            expect(opened.status).toBe('committed');

            // Tearing the previous graph down writes the arrangement — track
            // strips go away with it. That write belongs to the load, which is
            // why the load claims `loading` before anything can go wrong.
            mockResetAudioGraph.mockImplementation(() => {
                const current = trackStore.value ?? defaultTrackState;
                trackStore.set({ ...current, selectedTrackId: null });
            });
            mockResetCrdtProjectAuthority.mockImplementation(() => {
                throw new Error('authority reset failed');
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
            expect(projectStore.value?.dirty).toBe(false);

            editTheArrangement();

            expect(projectStore.value?.dirty).toBe(true);
        });
    });

    describe('an aborted open that a newer load superseded leaves the newer load alone', () => {
        it('does not hand the older load transient flags back over the newer load', async () => {
            const opened = await openProject(OPEN_PROJECT_NAME, OPEN_TRACK_ID, OPEN_TRACK_NAME);
            expect(opened.status).toBe('committed');

            // A second open starts while this one waits on the transport: it
            // takes the transaction and writes its own loading state, exactly
            // as `replaceProjectData` does on entry.
            mockStopPlayback.mockImplementation(() => {
                takeOverByNewerLoad();
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
            expect(projectStore.value?.name).toBe(SUCCESSOR_PROJECT_NAME);
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

        it('claims nothing when it was already superseded before it was entered', async () => {
            // Every caller allocates its transaction before a long await —
            // `loadRecentProject` before the project JSON read,
            // `pickAndImportProjectFile` before `file.text()`. Click a large
            // recent project, click New Project while it reads, and the newer
            // transition has prepared, activated and settled by the time this
            // one finally runs. It never owned the store and must not touch it.
            const settled = await openProject(OPEN_PROJECT_NAME, OPEN_TRACK_ID, OPEN_TRACK_NAME);
            expect(settled.status).toBe('committed');

            transactionControls.superseded = true;
            // What the real transaction returns once a newer transition holds
            // the prepared slot (`runProjectLoadTransaction.ts:91-93`).
            transactionControls.prepare = () => Promise.resolve(false);

            const aborted = await replaceProjectData({
                context: 'loadRecentProject',
                data: projectData({
                    name: INCOMING_PROJECT_NAME,
                    trackId: 'incoming-track',
                    trackName: INCOMING_TRACK_NAME,
                }),
                transaction: loadTransaction(),
            });

            expect(aborted.status).toBe('aborted');
            // Untouched: a load that cannot claim the flags must not set them,
            // because the abort path will correctly refuse to give them back.
            expect(projectStore.value?.name).toBe(OPEN_PROJECT_NAME);
            expect(projectStore.value?.loading).toBe(false);
            expect(projectStore.value?.initialized).toBe(true);

            editTheArrangement();

            expect(projectStore.value?.dirty).toBe(true);
        });
    });

    /**
     * A throw *after* the CRDT authority switch is not an abort: `createProject`
     * has installed a fresh empty root and `resetAutomergeStorageProjections`
     * has replaced every root-doc store's value with its `hydrateMissing()`
     * default, so the previous project is already out of the stores. The seam
     * below reproduces that — the stub empties the stores exactly as the real
     * projection reset does (measured in
     * `CrdtDocument/useCases/__tests__/resetCrdtProjectAuthority.spec.ts`:
     * `trackProjection.get()` → `{ tracks: [] }`) — and then throws the way a
     * full localStorage quota does out of the closing `branchStore.set`.
     */
    describe('a throw after the authority switch', () => {
        function replaceAuthorityThenThrow(): void {
            mockResetCrdtProjectAuthority.mockImplementation(
                (_name: string, onAuthorityReplaced?: () => void): void => {
                    onAuthorityReplaced?.();
                    // What `resetAutomergeStorageProjections` does to every
                    // root-doc projection: the user's project leaves the stores.
                    trackStore.set(structuredClone(defaultTrackState));
                    const project = projectStore.value;
                    if (project) {
                        projectStore.set({ ...project, name: 'Untitled Project' });
                    }
                    throw new DOMException('exceeded the quota', 'QuotaExceededError');
                }
            );
        }

        it('does not schedule the persist that would overwrite the project on disk', async () => {
            const opened = await openProject(OPEN_PROJECT_NAME, OPEN_TRACK_ID, OPEN_TRACK_NAME);
            expect(opened.status).toBe('committed');
            mockStartCrdtAutoSave.mockClear();
            mockSetAutoSaveHandle.mockClear();
            mockCompactProject.mockClear();
            replaceAuthorityThenThrow();

            const result = await replaceProjectData({
                context: 'applyImportedProjectData',
                data: projectData({
                    name: INCOMING_PROJECT_NAME,
                    trackId: 'incoming-track',
                    trackName: INCOMING_TRACK_NAME,
                }),
                transaction: loadTransaction(),
            });

            expect(result.status).toBe('failed');
            // Restarting autosave ends in `scheduleDurabilityAttempt(0)` →
            // `compactProject()` → `saveAllToIdb`, "replace all persisted
            // documents". Against the empty root that overwrites the user's
            // project. The load's `stopActiveAutoSave()` must stay in force.
            expect(mockStartCrdtAutoSave).not.toHaveBeenCalled();
            expect(mockSetAutoSaveHandle).not.toHaveBeenCalled();
            expect(mockCompactProject).not.toHaveBeenCalled();
        });

        it('does not dress the empty project up as a working session', async () => {
            await openProject(OPEN_PROJECT_NAME, OPEN_TRACK_ID, OPEN_TRACK_NAME);
            mockEnsureTrackStrips.mockClear();
            // The seed open above degrades and warns on its own; this assertion
            // is about what the *failure* path says.
            mockNotifyUser.mockClear();
            replaceAuthorityThenThrow();

            const result = await replaceProjectData({
                context: 'applyImportedProjectData',
                data: projectData({
                    name: INCOMING_PROJECT_NAME,
                    trackId: 'incoming-track',
                    trackName: INCOMING_TRACK_NAME,
                }),
                transaction: loadTransaction(),
            });

            expect(result.status).toBe('failed');
            // The shell renders off this store, not the transient flags —
            // `AppShell` latches `launchReady` on the first open, so
            // `{ initialized: false, loading: false }` shows the full editor
            // mid-session. `AppShell.spec.tsx` pins both halves of that.
            expect(projectLoadFailureStore.value).toMatchObject({ projectName: INCOMING_PROJECT_NAME });
            // Deliberately not a toast: the toast host renders inside the shell
            // root, which goes `inert` while this surface is up, so a
            // `role="alert"` there is neither announced nor visible under the
            // opaque overlay. The surface itself is the whole message.
            expect(mockNotifyUser).not.toHaveBeenCalled();
            // `ensureTrackStrips` reads `trackStore.value?.tracks`, which the
            // authority switch just emptied — calling it would only look like a
            // recovery.
            expect(mockEnsureTrackStrips).not.toHaveBeenCalled();
        });

        it('still restores the previous session when the throw came before the switch', async () => {
            await openProject(OPEN_PROJECT_NAME, OPEN_TRACK_ID, OPEN_TRACK_NAME);
            mockStartCrdtAutoSave.mockClear();
            mockEnsureTrackStrips.mockClear();
            // Throws without ever reporting a replacement — `createProject`
            // itself failing.
            mockResetCrdtProjectAuthority.mockImplementation((): void => {
                throw new Error('createProject failed');
            });

            const result = await replaceProjectData({
                context: 'applyImportedProjectData',
                data: projectData({
                    name: INCOMING_PROJECT_NAME,
                    trackId: 'incoming-track',
                    trackName: INCOMING_TRACK_NAME,
                }),
                transaction: loadTransaction(),
            });

            expect(result.status).toBe('aborted');
            // The previous session survived, so everything the recoverable path
            // does is correct here.
            expect(trackStore.value?.tracks.map((track) => track.name)).toContain(OPEN_TRACK_NAME);
            expect(projectStore.value?.name).toBe(OPEN_PROJECT_NAME);
            expect(projectStore.value?.initialized).toBe(true);
            expect(mockStartCrdtAutoSave).toHaveBeenCalled();
            expect(mockEnsureTrackStrips).toHaveBeenCalled();

            editTheArrangement();

            expect(projectStore.value?.dirty).toBe(true);
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
