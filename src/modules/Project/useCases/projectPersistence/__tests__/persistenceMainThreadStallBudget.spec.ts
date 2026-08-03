/**
 * AC-4 — stall budget, save and project-load legs: the parts that are not timing.
 *
 * ## Where the figures are
 *
 * **Not here.** Every AC-4 magnitude for these spans — `buildProjectData`, the
 * stringify, the parse, the store hydrators, both budgets, the convergence
 * gate, the regression ceilings, the inconclusive-grain reporting — lives in
 * `scripts/measureStallBudget.ts`, run as `pnpm audio:stall-budget`. No figure
 * exists in both places.
 *
 * **An assertion whose truth depends on wall-clock time does not belong in the
 * shared suite.** A vitest failure is a claim about the product, and "the
 * machine was too busy to measure" is not one. The script has a third exit code
 * for that (2 = NOT MEASURED, outranking 1 = MEASURED, RED), the way
 * `pnpm audio:deadline` does for AC-3; vitest has no equivalent. This leg
 * happened to pass at 1-minute load 25 where the analysis leg refused, but its
 * gate has the same failure mode and the owner's machine goes higher.
 *
 * What stays here is what reds on a code change and cannot red because a box is
 * busy: the CRDT emptiness pin, the fixture pins behind every published figure,
 * and the census of what this environment cannot measure at all.
 *
 * ## The two budgets the script measures against
 *
 * - **10 ms — `scheduleGrainMs`** (`Transport/models/TransportState.ts:38`).
 *   The scheduler tick period: a responsiveness and automation-resolution
 *   threshold. Overrunning it loses no scheduled audio — each tick schedules a
 *   contiguous range and carries `lastScheduledBeat` forward
 *   (`startPlayheadScheduler.ts:358-359`, `:411`), and `tickInFlight`
 *   (`:159-162`) drops overrunning ticks deliberately.
 * - **100 ms — `SCHEDULE_AHEAD_SECONDS = 0.1`** (`startPlayheadScheduler.ts:40`).
 *   The look-ahead horizon: the audio-correctness threshold. Exhaust it and
 *   `Transport/useCases/scheduling/scheduleAudioClips.ts:203-217` starts the
 *   clip mid-buffer.
 *
 * An earlier revision called 10 ms "one `SCHEDULE_AHEAD_SECONDS` grain" and
 * "the point past which a user hears the stall" — wrong constant by 10x, wrong
 * mechanism. Fixed here, in the script, and at its origin in
 * `.agents/specs/render-parity-instrumentation/spec.md` AC-4.
 */

import { beforeAll, describe, expect, it, vi } from 'vitest';

import { batchStoreUpdates } from '#/infra/store/createStore';
import { trackStore } from '#/modules/Arrangement/stores';
import { createCrdtProject, loadCrdtProject, projectCrdtToStores } from '#/modules/CrdtDocument/useCases';

import { projectStore } from '../../../stores/projectStore';
import { createMyceliumAscendantBlueprint } from '../../demoProjects/myceliumAscendant/createMyceliumAscendantBlueprint';
import { buildProjectData } from '../fileIO/buildProjectData';
import { hydrateArrangementStoreFromProjectData } from '../helpers/hydrateArrangementStoreFromProjectData';
import { hydrateModuleStoresFromProjectData } from '../helpers/hydrateModuleStoresFromProjectData';
import { loadProject } from '../loadProject';
import { setProjectIdentityTransitionDependencies } from '../projectIdentityTransitionDependencies';
import { saveProject } from '../saveProject/saveProject';

// ── An in-memory IndexedDB ───────────────────────────────────────────────────
//
// jsdom ships no IndexedDB and the repository's existing `installFakeIndexedDb`
// double implements only `get`/`put`/`delete` — not the `getAll`/`getAllKeys`/
// `add`/`clear`/`openCursor` surface the CRDT persistence layer uses. This is a
// double for those, deliberately local to this harness.
//
// It still `structuredClone`s on `put`/`add`. Nothing here is timed any more, so
// that is no longer about fidelity to a stall figure; it is kept because the
// clone is what makes `saveAllToIdb`'s read-then-write behave the way the real
// store does, and the fixture pins below depend on the save path completing.

type PendingRequest = {
    run: () => unknown;
    request: { result: unknown; error: unknown; onsuccess: (() => void) | null; onerror: (() => void) | null };
};

class MemoryObjectStore {
    private readonly records: Map<string, unknown>;
    private readonly enqueue: (pending: PendingRequest) => void;

    constructor(records: Map<string, unknown>, enqueue: (pending: PendingRequest) => void) {
        this.records = records;
        this.enqueue = enqueue;
    }

    get(key: string): PendingRequest['request'] {
        return this.request(() => this.records.get(key));
    }

    getAll(): PendingRequest['request'] {
        return this.request(() => [...this.records.values()]);
    }

    getAllKeys(): PendingRequest['request'] {
        return this.request(() => [...this.records.keys()]);
    }

    put(value: unknown, key: string): PendingRequest['request'] {
        const cloned = structuredClone(value);
        return this.request(() => {
            this.records.set(key, cloned);
            return undefined;
        });
    }

    add(value: unknown, key: string): PendingRequest['request'] {
        const cloned = structuredClone(value);
        return this.request(() => {
            if (this.records.has(key)) {
                throw new Error(`ConstraintError: ${key} already exists`);
            }
            this.records.set(key, cloned);
            return undefined;
        });
    }

    delete(key: string): PendingRequest['request'] {
        return this.request(() => {
            this.records.delete(key);
            return undefined;
        });
    }

    clear(): PendingRequest['request'] {
        return this.request(() => {
            this.records.clear();
            return undefined;
        });
    }

    /** Snapshot-based cursor: enough for `loadIncrementalsFromIdb`'s full walk. */
    openCursor(): PendingRequest['request'] {
        const entries = [...this.records].map(([key, value]) => ({ key, value }));
        const cursorRequest: PendingRequest['request'] = {
            result: null,
            error: null,
            onsuccess: null,
            onerror: null,
        };
        let index = 0;
        const advance = (): void => {
            if (index >= entries.length) {
                cursorRequest.result = null;
                cursorRequest.onsuccess?.();
                return;
            }
            const entry = entries[index]!;
            index++;
            cursorRequest.result = {
                key: entry.key,
                value: entry.value,
                continue: () => this.enqueue({ run: advance, request: cursorRequest }),
            };
            cursorRequest.onsuccess?.();
        };
        this.enqueue({ run: advance, request: cursorRequest });
        return cursorRequest;
    }

    private request(run: () => unknown): PendingRequest['request'] {
        const request: PendingRequest['request'] = {
            result: undefined,
            error: null,
            onsuccess: null,
            onerror: null,
        };
        this.enqueue({ run, request });
        return request;
    }
}

function installMemoryIndexedDb(): void {
    const databases = new Map<string, Map<string, unknown>>();

    const indexedDb = {
        open: (name: string) => {
            const records = databases.get(name) ?? new Map<string, unknown>();
            databases.set(name, records);

            const database = {
                objectStoreNames: { contains: () => true },
                createObjectStore: () => undefined,
                close: () => undefined,
                onversionchange: null,
                onclose: null,
                transaction: () => {
                    const queue: PendingRequest[] = [];
                    const transaction: {
                        error: unknown;
                        oncomplete: (() => void) | null;
                        onerror: (() => void) | null;
                        onabort: (() => void) | null;
                        objectStore: () => MemoryObjectStore;
                    } = {
                        error: null,
                        oncomplete: null,
                        onerror: null,
                        onabort: null,
                        objectStore: () => new MemoryObjectStore(records, (pending) => queue.push(pending)),
                    };

                    queueMicrotask(() => {
                        // Drain repeatedly: a handler may issue further requests
                        // against the same transaction, exactly as
                        // `saveAllToIdb` does from its authority read.
                        while (queue.length > 0) {
                            const pending = queue.shift()!;
                            try {
                                pending.request.result = pending.run();
                            } catch (error) {
                                pending.request.error = error;
                                transaction.error = error;
                                pending.request.onerror?.();
                                transaction.onabort?.();
                                return;
                            }
                            pending.request.onsuccess?.();
                        }
                        transaction.oncomplete?.();
                    });

                    return transaction;
                },
            };

            const request: {
                result: unknown;
                error: unknown;
                onsuccess: (() => void) | null;
                onerror: (() => void) | null;
                onblocked: (() => void) | null;
                onupgradeneeded: (() => void) | null;
            } = {
                result: database,
                error: null,
                onsuccess: null,
                onerror: null,
                onblocked: null,
                onupgradeneeded: null,
            };
            queueMicrotask(() => {
                request.onupgradeneeded?.();
                request.onsuccess?.();
            });
            return request;
        },
    };

    vi.stubGlobal('indexedDB', indexedDb);
}

// ── Fixture ──────────────────────────────────────────────────────────────────

const { projectData: referenceProject } = createMyceliumAscendantBlueprint();

/**
 * The reference project's track count, hard-coded so the emptiness pin below
 * compares two independently-sourced numbers (ADR 0015 rule 3) rather than
 * comparing zero against a fixture that could itself have gone empty.
 */
const EXPECTED_FIXTURE_TRACK_COUNT = 43;

/** Far above any plausible run of the save/load paths this file exercises once each. */
const CASE_TIMEOUT_MS = 120_000;

describe('Project persistence main-thread stall budget — non-timing pins', () => {
    beforeAll(() => {
        installMemoryIndexedDb();
        // `runProjectLoadTransaction` ends any collaboration session first; the
        // port is wired in `bootstrap.ts`, which this harness does not run.
        setProjectIdentityTransitionDependencies({ leaveCollaborationSession: () => Promise.resolve() });
    });

    it(
        'the save and open paths move the whole fixture, and the CRDT document stays empty',
        async () => {
            await createCrdtProject('Main-thread stall budget reference');

            const trackCount = referenceProject.arrangement.tracks.length;

            batchStoreUpdates(() => {
                hydrateArrangementStoreFromProjectData({
                    data: referenceProject,
                    preserveSavedArrangements: true,
                });
                hydrateModuleStoresFromProjectData(referenceProject);
                projectStore.set({
                    name: referenceProject.meta.name,
                    createdAt: referenceProject.meta.createdAt,
                    updatedAt: referenceProject.meta.updatedAt,
                    dirty: true,
                    loading: false,
                    initialized: true,
                    keyRoot: referenceProject.meta.keyRoot,
                    scaleName: referenceProject.meta.scaleName,
                    tuning: referenceProject.meta.tuning,
                });
            });

            const built = await buildProjectData({ includeAudioBuffers: false });
            const snapshotJson = JSON.stringify(built?.data);
            const savesSucceeded = [await saveProject(), await saveProject(), await saveProject()];
            const projectOpened = await loadProject();
            const crdtLoadFoundAProject = await loadCrdtProject({ shouldCommit: () => true });

            // Fixture pin. Every figure the script publishes is meaningless if
            // these paths no-opped: `saveProject` returns true on an empty
            // project, and a projection over nothing is instant. The script
            // re-checks the same facts before it reports anything, so the
            // property is pinned on both sides of the split — but only this side
            // reds in CI.
            //
            // Note the scope of `crdtLoadFoundAProject`: it proves a CRDT
            // document exists and decoded, NOT that the document holds the
            // fixture. It does not — see the emptiness pin below.
            //
            // `snapshotJson.length` is UTF-16 code units, not bytes.
            expect({
                snapshotTrackCount: built?.data.arrangement.tracks.length ?? 0,
                snapshotIsSubstantial: snapshotJson.length > 1_000_000,
                savesSucceeded,
                projectOpened,
                crdtLoadFoundAProject,
            }).toEqual({
                snapshotTrackCount: trackCount,
                snapshotIsSubstantial: true,
                savesSucceeded: [true, true, true],
                projectOpened: true,
                crdtLoadFoundAProject: true,
            });

            // Re-hydrate from the fixture so the emptiness pin below reads two
            // adjacent states rather than straddling the save/load calls.
            // `loadProject` above ends with its own reset-and-project and so has
            // already emptied the stores, for exactly the reason the pin is
            // about — which is itself worth noticing: `projectOpened` is true
            // while the arrangement stores come out empty.
            batchStoreUpdates(() => {
                hydrateArrangementStoreFromProjectData({
                    data: referenceProject,
                    preserveSavedArrangements: true,
                });
            });
            // Yield the frame the Automerge storage adapter defers its write to
            // (`createAutomergeStorage.ts:838`). Without this the pin below would
            // pass for two reasons at once — port unwired *and* write not yet
            // flushed — and could no longer tell them apart. Waiting removes the
            // second, so what it asserts is the first.
            await new Promise((resolve) => requestAnimationFrame(resolve));

            const tracksBeforeProjection = trackStore.value?.tracks.length ?? -1;
            projectCrdtToStores({ resetProjections: true });
            const tracksAfterProjection = trackStore.value?.tracks.length ?? -1;

            // ADR 0015 pin for the two CRDT verdicts a previous revision
            // published as passing budget figures (0.19 ms and 0.08 ms).
            //
            // The CRDT document this harness works against is EMPTY, and that is
            // why the script publishes no CRDT figure. The stores hold the
            // fixture — `tracksBeforeProjection` is 43 — but that lives only in
            // each adapter's in-memory cache. `projectCrdtToStores({
            // resetProjections: true })` drops those caches and re-reads every
            // slot from the document, and what comes back is nothing: 43 tracks
            // in, zero out.
            //
            // The cause is not the `requestAnimationFrame` deferral at
            // `src/infra/store/storage/createAutomergeStorage.ts:838`, though
            // that deferral is real in production. It is that the Automerge
            // storage port is never wired here: `registerCrdtStorageRuntime()` is
            // called only from `src/app/bootstrap.ts:151`, which this harness
            // does not run, so `createMutation` returns `null` at
            // `createAutomergeStorage.ts:625-627` before it can build a change
            // and every `set()` updates the cache (`:880-887`) and stops there.
            // Verified by mutation: adding `registerCrdtStorageRuntime()` to this
            // file's `beforeAll` makes the projection return all 43 tracks and
            // reds this assertion — with no change to the rAF path.
            //
            // **When this reds, the path has become real and the two withdrawn
            // verdicts MAY be restored — measured, not assumed. Re-derive them in
            // the script; do not copy the old numbers back.** And note that a
            // populated document still would not make a jsdom figure quotable:
            // the real cost of `loadCrdtProject` is Automerge WASM plus a Worker,
            // and jsdom has neither.
            //
            // Both the pre-projection count and the fixture count are pinned
            // alongside, so this cannot pass by the hydration having no-opped or
            // by the fixture itself going empty.
            expect({
                tracksBeforeProjection,
                tracksAfterProjection,
                fixtureTrackCount: trackCount,
            }).toEqual({
                tracksBeforeProjection: EXPECTED_FIXTURE_TRACK_COUNT,
                tracksAfterProjection: 0,
                fixtureTrackCount: EXPECTED_FIXTURE_TRACK_COUNT,
            });
        },
        CASE_TIMEOUT_MS
    );

    it('records what this environment cannot measure, and why', async ({ annotate }) => {
        const unmeasured = [
            'CRDT decode (loadCrdtProject): unmeasured, and not reported as a figure anywhere. ' +
                'Two reasons, either of which is sufficient. The document this harness works ' +
                'against is empty: registerCrdtStorageRuntime() is called only from ' +
                'bootstrap.ts:151, which this harness does not run, so the Automerge storage port ' +
                'is null, createMutation returns null (createAutomergeStorage.ts:625-627), and ' +
                'every store set() updates the in-memory cache (:880-887) and stops there. And ' +
                'the real cost of the decode is Automerge WASM plus a Worker, neither of which ' +
                'jsdom exercises: the decode here takes AutomergeRepository._parseAllSync, the ' +
                'worker-unavailable fallback. A previous revision published 0.19 ms as a passing ' +
                'budget verdict; it was a measurement of an empty document taking a fallback path.',
            'CRDT -> stores projection (projectCrdtToStores): unmeasured, same reasons. A previous ' +
                'revision published 0.08 ms. For scale, JSON.stringify of the populated snapshot ' +
                'costs ~5.9 ms and hydrate() stringifies every slot it reads, so a populated ' +
                'projection cannot plausibly cost a seventieth of that. The emptiness is pinned in ' +
                'the case above rather than left as an inference: 43 tracks go in and zero come out.',
            'Real IndexedDB commit: unmeasured. jsdom ships no IndexedDB, so the ' +
                'commit is an in-memory double. The synchronous half of a write — the ' +
                "structured clone at put() — is modelled; the browser's own commit " +
                'scheduling, quota checks and disk latency are not, and none of them ' +
                'are main-thread work.',
            'Audio-buffer rehydration: unmeasured. prepareCachedAudioBuffersFromIdb ' +
                "materialises AudioBuffers through the AudioContext, and jsdom's stub " +
                'has no createBuffer. Opening a project with real audio pays that cost ' +
                'on top of every figure the script reports.',
            'The deferred half of the store-hydrator span: unmeasured. In production the rAF ' +
                'flush pays toDocSafe — JSON.parse(JSON.stringify(value)) — over every hydrated ' +
                "slot, on a later frame. The script's hydrator figure is a lower bound that " +
                'excludes it, and is labelled as one there.',
            'All of these need the Playwright rig (tests/e2e) or a manual browser session.',
        ];
        for (const line of unmeasured) {
            await annotate(line, 'notice');
        }

        // Presence pin for the claim above: the stub really does lack
        // `createBuffer`, which is why the audio leg is unmeasured. If jsdom or
        // `setupTests.ts` ever grows one, this reds and the exemption must be
        // re-examined rather than inherited.
        const offlineContext = new OfflineAudioContext(2, 128, 48_000);
        expect({
            hasCreateBuffer: 'createBuffer' in offlineContext,
            hasStartRendering: 'startRendering' in offlineContext,
            hasWorker: 'Worker' in globalThis,
        }).toEqual({ hasCreateBuffer: false, hasStartRendering: false, hasWorker: false });
    });
});
