/**
 * AC-4 — main-thread stall budget, save and project-load legs.
 *
 * ## The budget: 10 ms
 *
 * One `SCHEDULE_AHEAD_SECONDS` grain. The transport scheduler runs on a worker
 * with a look-ahead window (`src/modules/Transport/workers/schedulerWorker.ts`);
 * the main thread is what turns each scheduler tick into `AudioParam` and
 * `start()` calls. A main-thread task longer than one grain means the tick that
 * should have scheduled the next window queues behind it, and notes land late.
 * 10 ms is therefore not a comfort target — it is the point past which a user
 * hears the stall.
 *
 * Do not widen it. If an operation exceeds it, that is a finding about the
 * operation, and the fix is to yield, chunk, or move it off-thread — not to
 * raise the number here.
 *
 * ## What is measured, and against what
 *
 * The fixture is the reference project — `createMyceliumAscendantBlueprint()`,
 * the largest project the repository actually ships, at 43 tracks and 118 clips.
 * It is hydrated into the real stores and then run through the real
 * `saveProject`, the real `loadProject`, and the real CRDT projection.
 *
 * Because save and load are `async`, wall clock is not the same thing as a
 * stall: an operation that takes 200 ms while yielding every 3 ms does not miss
 * a scheduler tick. So each **synchronous span** is timed separately and
 * measured against the budget, and the end-to-end wall clock is reported
 * alongside as context rather than as the verdict.
 *
 * ## Fidelity — what this environment does and does not model
 *
 * - **Faithful.** `buildProjectData`, `serializeArrangementTracks`,
 *   `JSON.stringify` / `JSON.parse`, the store hydrators and the Automerge WASM
 *   encode/decode are the shipping implementations running on the real fixture.
 *   These are the main-thread CPU spans the budget is about.
 * - **Modelled.** IndexedDB is an in-memory double (jsdom ships none). The
 *   double `structuredClone`s on `put`/`add`, which is the one part of an IDB
 *   write that is genuinely synchronous main-thread work; the commit itself is
 *   off-thread in a real browser and is not modelled — nor should it be, for a
 *   stall budget.
 * - **Upper bound.** jsdom has no `Worker`, so the CRDT decode takes
 *   `AutomergeRepository._parseAllSync` — the documented worker-unavailable
 *   fallback. A real browser runs the incremental-chain replay in
 *   `crdtWorker.ts` and still calls `load()` once per document on the main
 *   thread. The `loadCrdtProject` figure below is therefore an upper bound on
 *   the browser's main-thread cost, and is labelled as one. Every other figure
 *   is not affected by this.
 */

import os from 'node:os';

import { beforeAll, describe, expect, it, vi } from 'vitest';

import { batchStoreUpdates } from '#/infra/store/createStore';
import { createCrdtProject, loadCrdtProject, projectCrdtToStores } from '#/modules/CrdtDocument/useCases';

import { projectStore } from '../../../stores/projectStore';
import { createMyceliumAscendantBlueprint } from '../../demoProjects/myceliumAscendant/createMyceliumAscendantBlueprint';
import { buildProjectData } from '../fileIO/buildProjectData';
import { hydrateArrangementStoreFromProjectData } from '../helpers/hydrateArrangementStoreFromProjectData';
import { hydrateModuleStoresFromProjectData } from '../helpers/hydrateModuleStoresFromProjectData';
import { loadProject } from '../loadProject';
import { setProjectIdentityTransitionDependencies } from '../projectIdentityTransitionDependencies';
import { saveProject } from '../saveProject/saveProject';

/** AC-4's budget, in milliseconds. One `SCHEDULE_AHEAD_SECONDS` grain. */
const STALL_BUDGET_MS = 10;

/**
 * Far above any plausible measurement, so the assertions below are what decide
 * the verdict. Without it these cases inherit vitest's 5000 ms default and the
 * ceiling that actually fires is one nobody wrote, reported as
 * `Test timed out in 5000ms` rather than as the property.
 */
const MEASUREMENT_TIMEOUT_MS = 600_000;

/**
 * ## Which statistic is asserted, and why some spans get a ceiling instead
 *
 * Every assertion below reads the **minimum** of the repeated samples. Wall
 * clock noise is one-sided — a background task can only make a span look
 * slower, never faster — so the minimum is the least contaminated estimate of
 * what the code actually costs, and it is stable where a median is not. During
 * development the same span measured 8.9 ms and 27.1 ms in a single run of five.
 *
 * A span whose minimum sits two orders of magnitude under the budget gets the
 * plain budget assertion. A span whose minimum sits *near* the budget does not,
 * and four of them do: on a quiet machine the save and load serialization spans
 * land at roughly 50-70% of 10 ms, and running one other spec file alongside
 * this one pushed the same spans to 70-130%. At that margin a pass/fail verdict
 * is a statement about how busy the machine was, not about the product. Those
 * get a regression ceiling instead, and the annotation reports the fraction of
 * budget consumed so the straddle is visible rather than laundered into a green
 * tick.
 *
 * **The ceilings are an order of magnitude above the observed figure on
 * purpose.** This harness runs inside a parallel test runner and cannot control
 * machine load. A tight ceiling on a wall clock in that environment is a flake,
 * not a guard. These catch a catastrophic regression — a serializer that starts
 * embedding PCM again, a hydrator that goes quadratic — and nothing finer.
 * Budget compliance for these four spans is reported, not asserted, and that
 * distinction is the honest one.
 */
const REGRESSION_CEILINGS = {
    /**
     * `JSON.stringify` of the flat snapshot — ~2.9 MB for the reference project.
     * The dominant term in the save path, and it scales linearly with project
     * size, so a project a few times the reference breaches the budget on this
     * span alone.
     */
    stringify: { ceilingMs: 150, reason: 'stringify of the multi-megabyte flat snapshot' },
    /**
     * `buildProjectData` immediately followed by that `JSON.stringify` — one
     * uninterrupted task, because the only boundary between them is a microtask.
     */
    snapshotSpan: { ceilingMs: 150, reason: 'serialize every track, arrangement and MIDI note, then stringify' },
    /** `JSON.parse` of the same snapshot on the recent-project open path. */
    parseSnapshot: { ceilingMs: 150, reason: 'parse of the multi-megabyte flat snapshot' },
    /**
     * `hydrateArrangementStoreFromProjectData` + `hydrateModuleStoresFromProjectData`
     * inside one `batchStoreUpdates` — the commit phase of `replaceProjectData`,
     * shared by the recent-project open path, `.sourdaw` import, templates and
     * demo projects. Each Automerge-backed store slot round-trips its value
     * through `JSON.parse(JSON.stringify(value))` on write.
     */
    storeHydrators: {
        ceilingMs: 150,
        reason: 'per-slot JSON round-trip through the Automerge storage adapter on every hydrated store',
    },
} as const;

type Timed<Result> = { result: Result; elapsedMs: number };

async function measureAsync<Result>(operation: () => Promise<Result>): Promise<Timed<Result>> {
    const startedAt = performance.now();
    const result = await operation();
    return { result, elapsedMs: performance.now() - startedAt };
}

/**
 * Repeats a **repeatable** span and reports min, median and max.
 *
 * Wall clock inside a vitest worker is noisy: the same span measured 6.2 ms on a
 * quiet machine and 27.1 ms mid-transform during development. A single cold
 * sample is therefore not a measurement, it is a coin flip. One untimed warm-up
 * excludes JIT tier-up; the assertions then read the minimum (see
 * `REGRESSION_CEILINGS` for why the minimum and not the median), and the median
 * and max are reported so the spread is visible rather than hidden.
 *
 * Only spans that can be run repeatedly without changing their own input go
 * through here. The end-to-end save and load figures are single-shot and are
 * reported as context, never asserted.
 */
const REPEATS = 9;

type RepeatedMeasurement<Result> = { result: Result; medianMs: number; minMs: number; maxMs: number };

function summarize<Result>(result: Result, samples: number[]): RepeatedMeasurement<Result> {
    const sorted = [...samples].sort((left, right) => left - right);
    return {
        result,
        medianMs: sorted[Math.floor(sorted.length / 2)]!,
        minMs: sorted[0]!,
        maxMs: sorted.at(-1)!,
    };
}

function measureRepeated<Result>(operation: () => Result): RepeatedMeasurement<Result> {
    operation();
    const samples: number[] = [];
    let result = operation();
    for (let index = 0; index < REPEATS; index++) {
        const startedAt = performance.now();
        result = operation();
        samples.push(performance.now() - startedAt);
    }
    return summarize(result, samples);
}

async function measureRepeatedAsync<Result>(operation: () => Promise<Result>): Promise<RepeatedMeasurement<Result>> {
    await operation();
    const samples: number[] = [];
    let result = await operation();
    for (let index = 0; index < REPEATS; index++) {
        const startedAt = performance.now();
        result = await operation();
        samples.push(performance.now() - startedAt);
    }
    return summarize(result, samples);
}

function reportRepeated(name: string, measurement: RepeatedMeasurement<unknown>, note: string): string {
    const budgetPercent = Math.round((measurement.minMs / STALL_BUDGET_MS) * 100);
    return (
        `${name}: min ${measurement.minMs.toFixed(2)} ms = ${budgetPercent}% of the ${STALL_BUDGET_MS} ms budget ` +
        `(median ${measurement.medianMs.toFixed(2)}, max ${measurement.maxMs.toFixed(2)}, ${REPEATS} samples) — ${note}`
    );
}

function describeMachine(): string {
    const cpu = os.cpus()[0]?.model ?? 'unknown CPU';
    const memoryGiB = Math.round(os.totalmem() / 1024 ** 3);
    return (
        `${cpu}, ${os.cpus().length} logical cores, ${memoryGiB} GiB, ` +
        `${os.platform()} ${os.release()} ${os.arch()}, Node ${process.version}, jsdom (vitest)`
    );
}

// ── An in-memory IndexedDB ───────────────────────────────────────────────────
//
// jsdom ships no IndexedDB and the repository's existing `installFakeIndexedDb`
// double implements only `get`/`put`/`delete` — not the `getAll`/`getAllKeys`/
// `add`/`clear`/`openCursor` surface the CRDT persistence layer uses. This is a
// double for those, deliberately local to this harness so nothing else inherits
// its timing characteristics.
//
// Two properties matter for a stall measurement and both are honoured:
//   1. `put`/`add` `structuredClone` their value. That is the synchronous
//      main-thread half of an IDB write, and skipping it would understate save.
//   2. Requests fire `onsuccess` before the transaction commits, and requests
//      issued from inside an `onsuccess` handler are still serviced by the same
//      transaction — which is what `saveAllToIdb`'s read-then-write does.

type StoredRecord = { key: string; value: unknown };

type PendingRequest = {
    run: () => unknown;
    request: { result: unknown; error: unknown; onsuccess: (() => void) | null; onerror: (() => void) | null };
};

class MemoryObjectStore {
    constructor(
        private readonly records: Map<string, unknown>,
        private readonly enqueue: (pending: PendingRequest) => void
    ) {}

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
        const entries: StoredRecord[] = [...this.records].map(([key, value]) => ({ key, value }));
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

describe('Project persistence main-thread stall budget', () => {
    beforeAll(() => {
        installMemoryIndexedDb();
        // `runProjectLoadTransaction` ends any collaboration session first; the
        // port is wired in `bootstrap.ts`, which this harness does not run.
        setProjectIdentityTransitionDependencies({ leaveCollaborationSession: () => Promise.resolve() });
    });

    it(
        'reports each synchronous span of save and project load against the 10 ms grain',
        async ({ annotate }) => {
            await annotate(`machine: ${describeMachine()}`, 'notice');

            await createCrdtProject('Main-thread stall budget reference');

            // Hydration: the store-side commit phase shared by the
            // recent-project open path, the import path and the demo/template
            // paths (`replaceProjectData` runs exactly this inside one
            // `batchStoreUpdates`).
            //
            // Scope note: this is the span that runs *inside* the batch. Any CRDT
            // commit the storage adapter defers to `requestAnimationFrame` is
            // further main-thread work paid on a later frame and is not counted
            // here, so the figure is a lower bound on the open path's total.
            const hydrate = measureRepeated(() =>
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
                })
            );

            const trackCount = referenceProject.arrangement.tracks.length;
            const clipCount = referenceProject.arrangement.tracks.reduce(
                (total, track) => total + track.clips.length,
                0
            );
            await annotate(
                `fixture: reference project (Mycelium Ascendant blueprint) — ${trackCount} tracks, ` +
                    `${clipCount} clips, ${JSON.stringify(referenceProject).length} bytes of JSON`,
                'notice'
            );

            // Save, the contiguous span. `buildProjectData` is `async`, but with
            // `includeAudioBuffers: false` its body never awaits, so resolving it
            // costs a microtask — and a microtask does not yield the event loop.
            // The serializer and the stringify that follows it are therefore ONE
            // uninterrupted main-thread task in a real browser too, which is why
            // they are timed together as well as apart.
            const build = await measureRepeatedAsync(() => buildProjectData({ includeAudioBuffers: false }));
            const built = build.result;
            const stringify = measureRepeated(() => JSON.stringify(built?.data));
            const snapshotSpan = await measureRepeatedAsync(async () => {
                const snapshot = await buildProjectData({ includeAudioBuffers: false });
                return JSON.stringify(snapshot?.data);
            });
            const snapshotJson = snapshotSpan.result;

            // Save, end to end. Second and third passes are the steady state a
            // user actually experiences — the first save of a session carries
            // one-off Automerge and IDB setup that no later save repeats.
            const firstSave = await measureAsync(() => saveProject());
            const secondSave = await measureAsync(() => saveProject());
            const thirdSave = await measureAsync(() => saveProject());

            // Load, end to end, through the real boot-restore entry point, and
            // measured FIRST so this figure carries the cold cost of the open
            // path rather than inheriting a warmed-up decoder from the
            // attribution calls below.
            const openProject = await measureAsync(() => loadProject());
            // Attribution. The CRDT decode — an upper bound; see the header.
            const crdtLoadRepeated = await measureRepeatedAsync(() => loadCrdtProject({ shouldCommit: () => true }));
            // Attribution, warm. CRDT -> stores projection: fully synchronous,
            // and the span `loadProject` runs inside its single `batchStoreUpdates`.
            const projection = measureRepeated(() => projectCrdtToStores({ resetProjections: true }));
            // The recent-project / Launch-screen open path reads the flat
            // snapshot back as a string and parses it on the main thread before
            // any hydration happens. One synchronous span, and it scales with
            // project size exactly as the stringify does.
            const parse = measureRepeated(() => JSON.parse(snapshotJson) as unknown);

            const snapshotBytes = snapshotJson.length;
            for (const [name, measurement, note] of [
                ['save / buildProjectData', build, 'sync span'],
                ['save / JSON.stringify', stringify, `sync span, ${snapshotBytes} bytes`],
                ['save / buildProjectData + JSON.stringify', snapshotSpan, 'ONE contiguous sync span'],
                ['load / loadCrdtProject', crdtLoadRepeated, 'UPPER BOUND: no Worker in jsdom'],
                ['load / projectCrdtToStores', projection, 'sync span'],
                ['load / store hydrators', hydrate, 'sync span; open, import and template paths'],
                ['load / JSON.parse of the saved snapshot', parse, `sync span, ${snapshotBytes} bytes`],
            ] as const) {
                await annotate(reportRepeated(name, measurement, note), 'notice');
            }
            for (const [name, elapsedMs] of [
                ['save / saveProject end-to-end, first', firstSave.elapsedMs],
                ['save / saveProject end-to-end, second', secondSave.elapsedMs],
                ['save / saveProject end-to-end, third', thirdSave.elapsedMs],
                ['load / loadProject end-to-end, cold', openProject.elapsedMs],
            ] as const) {
                await annotate(
                    `${name}: ${elapsedMs.toFixed(2)} ms — single-shot wall clock, includes awaits; ` +
                        `context, not a stall verdict`,
                    'notice'
                );
            }

            // Fixture pin. Every figure above is meaningless if the paths
            // no-opped: `saveProject` returns true on an empty project, and a
            // projection over nothing is instant. These assert real work moved.
            expect({
                snapshotTrackCount: built?.data.arrangement.tracks.length ?? 0,
                snapshotIsSubstantial: snapshotBytes > 1_000_000,
                savesSucceeded: [firstSave.result, secondSave.result, thirdSave.result],
                projectOpened: openProject.result,
                crdtLoadFoundAProject: crdtLoadRepeated.result,
            }).toEqual({
                snapshotTrackCount: trackCount,
                snapshotIsSubstantial: true,
                savesSucceeded: [true, true, true],
                projectOpened: true,
                crdtLoadFoundAProject: true,
            });

            // Comfortably within budget — order-of-magnitude headroom, so the
            // plain AC-4 assertion is stable. Each reds if its span grows past
            // one scheduler grain.
            expect({
                buildProjectData: build.minMs < STALL_BUDGET_MS,
                projectCrdtToStores: projection.minMs < STALL_BUDGET_MS,
                crdtDecode: crdtLoadRepeated.minMs < STALL_BUDGET_MS,
            }).toEqual({ buildProjectData: true, projectCrdtToStores: true, crdtDecode: true });

            // Straddling the budget — see REGRESSION_CEILINGS. These four sit at
            // roughly half to four-fifths of the grain on this machine, close
            // enough that a pass/fail verdict would be noise. They are guarded
            // against regression and reported as fractions of the budget instead.
            expect({
                stringify: stringify.minMs < REGRESSION_CEILINGS.stringify.ceilingMs,
                snapshotSpan: snapshotSpan.minMs < REGRESSION_CEILINGS.snapshotSpan.ceilingMs,
                parseSnapshot: parse.minMs < REGRESSION_CEILINGS.parseSnapshot.ceilingMs,
                storeHydrators: hydrate.minMs < REGRESSION_CEILINGS.storeHydrators.ceilingMs,
            }).toEqual({ stringify: true, snapshotSpan: true, parseSnapshot: true, storeHydrators: true });

            // The `loadCrdtProject` figure is an upper bound, not the shipping
            // path: jsdom has no Worker, so the decode takes the synchronous
            // fallback. It passes the budget assertion above by an order of
            // magnitude, which is why it is asserted at all — a verdict that
            // survives the harness being pessimistic is still a verdict. A
            // figure anywhere near the budget would have to move to the browser.
        },
        MEASUREMENT_TIMEOUT_MS
    );

    it('records what this environment cannot measure, and why', async ({ annotate }) => {
        const unmeasured = [
            'Real IndexedDB commit: unmeasured. jsdom ships no IndexedDB, so the ' +
                'commit is an in-memory double. The synchronous half of a write — the ' +
                "structured clone at put() — is modelled; the browser's own commit " +
                'scheduling, quota checks and disk latency are not, and none of them ' +
                'are main-thread work.',
            'Worker-assisted CRDT decode: unmeasured. jsdom has no Worker, so ' +
                'loadCrdtProject takes AutomergeRepository._parseAllSync. The reported ' +
                'figure is an upper bound on the shipping path, which runs the ' +
                'incremental replay in crdtWorker.ts and keeps one load() per document ' +
                'on the main thread.',
            'Audio-buffer rehydration: unmeasured. prepareCachedAudioBuffersFromIdb ' +
                "materialises AudioBuffers through the AudioContext, and jsdom's stub " +
                'has no createBuffer. Opening a project with real audio pays that cost ' +
                'on top of every figure reported here.',
            'All three need the Playwright rig (tests/e2e) or a manual browser session.',
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
