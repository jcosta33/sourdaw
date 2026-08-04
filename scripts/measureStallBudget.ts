/**
 * AC-4 — the main-thread stall budget, measured outside the shared test suite.
 *
 * Every timing figure for AC-4 lives here. The two specs that used to carry
 * them —
 * `src/modules/AudioAnalysis/useCases/__tests__/analysisMainThreadStallBudget.spec.ts`
 * and
 * `src/modules/Project/useCases/projectPersistence/__tests__/persistenceMainThreadStallBudget.spec.ts`
 * — keep everything that reds on a code change and cite this script for the
 * magnitudes. No figure exists in both places.
 *
 * Why this is a script and not a spec
 * -----------------------------------
 * **An assertion whose truth depends on wall-clock time does not belong in the
 * shared suite.** A vitest failure is a claim about the product, and "the
 * machine was too busy to measure" is not one. Run under deliberate load (24
 * spinners, 1-minute load 25) the previous spec form refused correctly and
 * reported it as a test failure:
 *
 *     detectKey:         min 1371.98 ms ... drift 33.97% (NOT CONVERGED)
 *     summarizeFeatures: min 1078.42 ms ... drift 51.40% (NOT CONVERGED)
 *
 * The refusal was right; the exit code was not. Vitest has three outcomes —
 * pass, fail, and a skip that vanishes into an 18,000-test run and reads as
 * coverage — and none of them means "conditions unfit". So AC-4 joins AC-2
 * (`cargo bench`) and AC-3 (`pnpm audio:deadline`) outside the suite, and
 * borrows AC-3's contract:
 *
 *     0  MEASURED, GREEN   — conditions were fit and every verdict passed.
 *     1  MEASURED, RED     — conditions were fit and a verdict failed. This is
 *                            the only code that says anything about the product.
 *     2  NOT MEASURED      — the floor could not be established, or the harness
 *                            could not build its environment. Says nothing
 *                            about the product. Re-run on a quiet machine.
 *
 * Exit 2 outranks exit 1: a run whose figures are not reproducible cannot
 * support a red verdict any more than a green one.
 *
 * ## Two budgets, not one
 *
 * This codebase has two main-thread deadlines and they are an order of
 * magnitude apart. A verdict that does not say which one it asserts is not a
 * verdict, so every claim below names its threshold.
 *
 * **10 ms — `scheduleGrainMs` (`Transport/models/TransportState.ts:38`; the
 * same number is `SCHEDULER_GRAIN_MS` in `Yeast/engine/YeastWorkerClient.ts:42`).
 * The scheduler tick period: a responsiveness and automation-resolution
 * threshold.** Overrunning it does *not* lose scheduled audio. Each tick
 * schedules the contiguous range `lastScheduledBeat -> newPosition +
 * SCHEDULE_AHEAD_SECONDS * beatsPerSecond` and then carries
 * `lastScheduledBeat = scheduleUpTo`
 * (`Transport/useCases/playheadScheduler/startPlayheadScheduler.ts:358-359`,
 * `:411`), so a dropped tick is fully re-covered by the next one with no gap;
 * `tickInFlight` (`:159-162`) drops overrunning ticks on purpose and counts
 * them. What a dropped tick *does* cost is everything the tick applies at
 * `newPosition` rather than scheduling ahead — `applyAutomation`,
 * `applyVcaGains`, `refreshSidechainAlignment`, `applyModulation`,
 * `scheduleAdjustmentLayers` (`:395-407`) — which therefore land late rather
 * than early. `utils/automationSlew.ts:19` already treats this 10 ms grain as
 * the resolution automation smoothing is designed around, and
 * `deliveryDeadlineMisses`
 * (`Transport/useCases/playheadScheduler/schedulerTimingDiagnostics.ts:97-98`)
 * is the only other 10 ms deadline in the tree — also a delivery metric.
 *
 * **100 ms — `SCHEDULE_AHEAD_SECONDS = 0.1`
 * (`startPlayheadScheduler.ts:40`). The look-ahead horizon: the
 * audio-correctness threshold.** `MAX_DELTA_SECONDS = SCHEDULE_AHEAD_SECONDS`
 * (`:105`) absorbs a stall up to that point. Exhaust it and there is nothing
 * left in the graph:
 * `Transport/useCases/scheduling/scheduleAudioClips.ts:203-217` takes the
 * `iterStartTime < now` branch and starts the source mid-buffer. That is the
 * audible failure.
 *
 * An earlier revision called 10 ms "one `SCHEDULE_AHEAD_SECONDS` grain" and
 * "the point past which a user hears the stall". Both were wrong — wrong
 * constant by 10x, and wrong mechanism. The error came in from
 * `.agents/specs/render-parity-instrumentation/spec.md` AC-4 and is fixed
 * there too. Do not reintroduce it, and do not widen either number: if an
 * operation exceeds one, that is a finding about the operation, and the fix is
 * to yield, chunk, or move it off-thread.
 *
 * ## Which statistic decides which claim
 *
 * Wall-clock contention is one-sided — a background task can only make a span
 * look slower — so the conservative statistic is not the same one in both
 * directions, and each is used where it is conservative:
 *
 * - **A breach ("over budget") is asserted on the minimum**, which is a floor
 *   on what the code costs. Contention inflates a minimum, so a narrow breach
 *   could in principle be an artefact of load. Every breach asserted here
 *   therefore clears its threshold by a margin wider than the worst
 *   process-level contention this repository has recorded — **2.45x**, the same
 *   analysis span measured at 781 ms alone and 1913 ms with one other spec file
 *   running beside it.
 * - **A pass ("within budget") is asserted on the 95th percentile against the
 *   10 ms grain and on the maximum against the 100 ms horizon.** The minimum is
 *   the single most favourable sample in the run; asserting a pass on it
 *   asserts the best case, which is the wrong side. A previous revision did
 *   exactly that and called `buildProjectData` "comfortably within budget" on a
 *   min of 0.37 ms in a run whose own max was 18.05 ms.
 * - **A regression ceiling is asserted on the minimum**, because a ceiling asks
 *   "has the floor moved", and the floor is the statistic contention cannot
 *   fake downward.
 *
 * A claim that will not hold on its conservative statistic is not restated on
 * the other one; it is reported as **inconclusive**. Four persistence spans are
 * inconclusive against the 10 ms grain and that is printed per span rather than
 * laundered into a green tick.
 *
 * ## Convergence, and what it cannot do
 *
 * A minimum is only a floor if taking more samples stops lowering it. An
 * earlier revision took three samples of each expensive span and had no way to
 * tell a converged run from a contaminated one: an independent review
 * reproduced `summarizeFeatures` at 41.71, 25.29, 26.29 and 25.09 ms per audio
 * second across four runs of it, and the published magnitudes — taken from the
 * first — were 11-55% high.
 *
 * So the sample count is not fixed. {@link measureSpan} keeps sampling until
 * the floor is **independently reproduced** — until the second-smallest sample
 * is within {@link CONVERGENCE_TOLERANCE} of the smallest — subject to a floor
 * on the sample count and a ceiling on time. A minimum that one sample reached
 * and no other came near is one lucky sample, not a measurement, and it is
 * **NOT MEASURED (exit 2)**, printed with its drift and its span.
 *
 * Two other forms were tried and are worse. A fixed count is what shipped and
 * what the review broke. Comparing the minimum of the first K samples against
 * the minimum of the last K catches a run that drifted, but on the reference
 * machine it refused one run in three because a stretch of contention clearing
 * near the end of a run moves the head and the tail apart without saying
 * anything about the code — and it silently certifies a floor that is still
 * descending, since in that case the run minimum *is* in the tail and the drift
 * is identically zero.
 *
 * What no convergence check can detect is contention that inflates *every*
 * sample in a process equally — nothing measured inside that process can.
 * What covers that case is the direction-of-error rule above plus the margins.
 *
 * ## Fidelity — what this host does and does not model
 *
 * Node + jsdom, no browser. The analysis DSP is pure JavaScript over a
 * `Float32Array` — the meyda hop loop (`audioFeatures.ts:100-120`), the
 * Goertzel chroma loop, and pitchy's MPM (`trackPitch.ts:43-51`) — invoked
 * synchronously from a command handler or a React click handler with no yield
 * between entry and return. That is exactly the shape the budgets are about,
 * and it is the shipping code running on real PCM.
 *
 * - **Faithful.** All five analysis entry points. On the persistence side,
 *   `buildProjectData`, `serializeArrangementTracks`, `JSON.stringify` /
 *   `JSON.parse` and the store hydrators, running on the real reference
 *   project.
 * - **Not stubbed.** Nothing in the measured graph is narrowed or replaced. In
 *   particular the analysis DSP reads its fixture through the real
 *   `#/modules/AudioEngine/useCases` barrel, so `audioBufferCache.get`'s
 *   `refreshAccessTime` (`AudioEngine/stores/audioBufferCache.ts:427`) runs
 *   inside every analysis figure here rather than being mocked out of it, as it
 *   was in the spec form.
 * - **Modelled.** IndexedDB is an in-memory double (jsdom ships none). It
 *   `structuredClone`s on `put`/`add`, which is the one part of an IDB write
 *   that is genuinely synchronous main-thread work; the commit itself is
 *   off-thread in a real browser and is not modelled — nor should it be, for a
 *   stall budget.
 * - **Not measured at all.** The CRDT decode and the CRDT-to-stores projection.
 *   A previous revision published both as passing verdicts; they measured an
 *   empty document. That emptiness is pinned in the persistence spec, which is
 *   also where the full `unmeasured` census for both legs lives — this script
 *   deliberately does not restate it.
 *
 * ## The figures moved when the host moved — this is not a regression
 *
 * These spans are 15-35% cheaper here than the same code measured under vitest,
 * on the same machine, on the same day: `summarizeFeatures` 211-221 ms against
 * 248-257 ms, `detectDominantPitch` 81-83 ms against 109-141 ms,
 * `buildProjectData` 0.40-0.44 ms against 0.24-0.26 ms in the other direction.
 * The persistence serialization spans barely moved (`JSON.stringify`
 * 5.84-6.25 ms here against 5.82-6.22 ms there). Nothing in the product
 * changed between those numbers; the runner did. Anyone comparing a figure
 * quoted before this script existed against one printed by it is comparing two
 * hosts, and this script is the host of record from now on.
 *
 * Usage: `pnpm audio:stall-budget`. A number without its machine is not a
 * measurement, so the report prints the host and the load average it ran under.
 */

import { arch, cpus, loadavg, platform, release, totalmem } from 'node:os';
import { fileURLToPath } from 'node:url';

import { createServer, type ViteDevServer } from 'vite';

/** The scheduler tick period, `scheduleGrainMs`. Responsiveness/automation resolution. */
const GRAIN_BUDGET_MS = 10;
/** The look-ahead horizon, `SCHEDULE_AHEAD_SECONDS = 0.1`. Audio correctness. */
const LOOKAHEAD_BUDGET_MS = 100;

/** Exit codes. Refusing to measure is not the same outcome as measuring a failure. */
const EXIT_MEASURED_RED = 1;
const EXIT_NOT_MEASURED = 2;

/**
 * Load average per logical core above which the report carries a warning.
 *
 * **Advisory only — it does not gate the run.** The convergence check is this
 * harness's authority on whether a run is trustworthy, and unlike a load
 * average it measures contamination directly instead of predicting it from a
 * proxy. Printing the number is still worth it: a reader deserves to know what
 * the box was doing.
 */
const ADVISORY_LOAD_PER_CORE = 0.5;

const SAMPLE_RATE = 48_000;

/**
 * Ten seconds — a real take rather than a test tone, and no longer than it has
 * to be. Every analysis figure is also reported per second of audio, so a
 * longer clip needs arithmetic rather than a re-run: the work is linear in clip
 * length, verified independently at 10 s, 20 s and 40 s to within ~2%.
 */
const FIXTURE_SECONDS = 10;

/**
 * `audioToMidi`'s shipping defaults (`sensitivity = 0.5`, `minInterval = 0.25`
 * beats against the 120 BPM default transport). Measuring the configuration the
 * product runs, rather than one invented here. Scope: this is `mode: 'rhythm'`.
 */
const ONSET_SENSITIVITY = 0.5;
const ONSET_MIN_INTERVAL_SEC = 0.25 / (120 / 60);

/**
 * How far the second-smallest sample may sit above the smallest before the
 * floor counts as unreproduced.
 *
 * 8%, from two directions. Below: on an idle reference machine every span
 * reaches this inside its minimum sample count, and the widest honest gap
 * recorded is `detectKey`'s ~3.6% — its per-pass cost moves by about 4% once
 * the process leaves its opening regime. Above: the error class this exists to
 * catch is the 11-55% overstatement the un-gated revision shipped, and 8% is
 * well inside that. A gap it lets through cannot move a verdict here; the
 * narrowest asserted margin is 2.9x.
 *
 * If a run refuses, the machine was busy. Re-run, or raise a plan's budget.
 * Widening this to make a loaded machine pass is how the previous revision got
 * here.
 */
const CONVERGENCE_TOLERANCE = 0.08;

/**
 * How far a span's 95th percentile may sit above its own minimum before the
 * run's upper tail is treated as a description of the machine rather than of
 * the code.
 *
 * This is the second gate and it exists because the first one is not enough.
 * Convergence protects the statistics contention cannot fake downward — the
 * minimum, which backs every breach and every regression ceiling. It does
 * nothing for the pass claims, which read p95 and max **precisely because
 * those are the conservative side**, and those are the statistics contention
 * destroys first. Measured: under 24 spinners at 1-minute load 21.74 every
 * minimum still converged, and the run reported
 *
 *     ANALYSIS detectOnsets: p95 16.82 ms is at or over the 10 ms grain
 *     PERSISTENCE buildProjectData: max 16.56 ms is at or over the 10 ms grain
 *
 * as exit 1 — two false claims about the product, which is the exact disease
 * moving AC-4 out of the shared suite was meant to cure. A dispersion check is
 * this harness's equivalent of the control leg in `measureRenderDeadline.ts`:
 * it measures contamination directly instead of predicting it from a load
 * average, and an over-dispersed run is **NOT MEASURED (exit 2)**, withholding
 * every verdict rather than reporting the tail as a regression.
 *
 * 5x, from measurement on both sides. Idle, `p95 / min` runs 1.01-1.24 for
 * every span except `buildProjectData`, whose sub-millisecond scale puts it at
 * 2.03; under the load above the same ratio was 24-26x. 5x sits with 2.5x
 * headroom over the worst honest span and an order of magnitude below the
 * contaminated ones. Do not raise it to make a loaded machine pass — refuse
 * earlier and more clearly instead.
 */
const DISPERSION_CEILING = 5;

/**
 * How a span is sampled. Sampling stops at the first of: the floor is
 * reproduced with at least `minSamples` taken, `maxSamples` taken, or
 * `timeBudgetMs` elapsed. The last two exist so a pathologically busy machine
 * cannot make this run forever; when either fires first, the span is NOT
 * MEASURED.
 */
type SamplingPlan = {
    /**
     * Untimed passes before the first timed one, so timing starts in steady
     * state. A 0.5 s warm-up fixture tiers up the JIT but does not put a 10 s
     * take into steady state: the first two or three full-size passes of
     * `detectKey` come in around 158 ms and later ones at 164 ms or above.
     */
    leadIn: number;
    /** Never certify a floor on fewer than this many samples. */
    minSamples: number;
    maxSamples: number;
    timeBudgetMs: number;
};

/**
 * The three expensive detectors: each pass costs a sixth of a second or more,
 * so the minimum count is the smallest that reproduces the floor on an idle
 * machine and the budget is what a contended one may spend catching up.
 * `minSamples` is part of the check, not a knob — lowering it towards the
 * previous revision's three would certify a floor on almost no evidence.
 */
const EXPENSIVE_PLAN: SamplingPlan = { leadIn: 3, minSamples: 8, maxSamples: 24, timeBudgetMs: 8_000 };

/**
 * The two cheap detectors, which are the ones asserted to fit *inside* a
 * budget. A pass verdict reads the 95th percentile, which needs enough samples
 * for that to mean something other than "the largest one"; at ~0.6 ms a pass,
 * hundreds are free.
 */
const CHEAP_PLAN: SamplingPlan = { leadIn: 6, minSamples: 25, maxSamples: 400, timeBudgetMs: 2_000 };

/** The persistence spans: single-digit milliseconds each, so samples are cheap. */
const PERSISTENCE_PLAN: SamplingPlan = { leadIn: 10, minSamples: 60, maxSamples: 400, timeBudgetMs: 6_000 };

/**
 * Recorded analysis breaches.
 *
 * Measurements, not targets. Each entry pins an operation already over
 * `GRAIN_BUDGET_MS` on the reference machine, so the verdict fails in both
 * directions: it reds if the operation regresses past the ceiling, and it reds
 * when the operation is *fixed* — which is the point at which the entry must be
 * deleted and a plain budget verdict put in its place.
 *
 * **Every ceiling is 5x the lowest converged minimum recorded, rounded up.**
 * The multiple is twice the 2.45x worst contention this repository has
 * recorded, so a loaded machine cannot red a ceiling on its own: for the
 * minimum to reach 5x, every sample in the run has to.
 */
const RECORDED_BREACHES = {
    /**
     * The Goertzel chroma loop in `keyDetection.ts`: frames (hop 2048) x 12
     * pitch classes x 6 octaves x a 4096-sample inner recurrence, no yield,
     * invoked synchronously from `handleDetectKey.execute`. Converged minimum
     * 159.5-164.5 ms for a 10 s take across five runs of this script.
     */
    detectKey: { ceilingMs: 800, reason: 'Goertzel chroma: 12 x 6 bins x 4096-tap recurrence per 2048-sample hop' },
    /**
     * The meyda hop loop in `audioFeatures.ts`: ~94 FFT + MFCC + chroma
     * extractions per second of audio at bufferSize 2048 / hopSize 512.
     * Converged minimum 211.1-220.6 ms for a 10 s take.
     */
    summarizeFeatures: { ceilingMs: 1100, reason: 'meyda: 9 features per hop, ~94 hops per second of audio' },
    /** pitchy MPM per hop, via `trackPitch`. Converged minimum 81.1-82.6 ms. */
    detectDominantPitch: { ceilingMs: 450, reason: 'pitchy MPM autocorrelation per hop' },
} as const;

/**
 * Persistence regression ceilings, asserted on the **minimum** of each span.
 *
 * Same 5x rule and same justification as `RECORDED_BREACHES`. What each ceiling
 * guards is the 100 ms look-ahead horizon these four spans are asserted to
 * clear: at 5x the floor they red at roughly a fifth of that horizon, long
 * before the thing they guard is broken, which is ADR 0015 rule 1. They are
 * deliberately *not* presented as guarding the 10 ms grain — against the grain
 * these spans are inconclusive, and a bound cannot guard a verdict nobody is
 * making. A previous revision set all four at a flat 150 ms against ~6 ms
 * observed, so a span could drift to 149 ms — 15x the grain — and stay green.
 */
const PERSISTENCE_CEILINGS = {
    /**
     * `JSON.stringify` of the flat snapshot, ~2.9 M characters for the
     * reference project. The dominant term in the save path, linear in project
     * size, so a project a few times the reference breaches the grain on this
     * span alone. Converged minimum 5.82-6.22 ms across eight runs.
     */
    stringify: { ceilingMs: 30, reason: 'stringify of the multi-megabyte flat snapshot' },
    /**
     * `buildProjectData` immediately followed by that `JSON.stringify` — one
     * uninterrupted task, because the only boundary between them is a
     * microtask. Converged minimum 6.15-6.53 ms.
     */
    snapshotSpan: { ceilingMs: 35, reason: 'serialize every track, arrangement and MIDI note, then stringify' },
    /** `JSON.parse` of the same snapshot. Converged minimum 4.72-4.96 ms. */
    parseSnapshot: { ceilingMs: 25, reason: 'parse of the multi-megabyte flat snapshot' },
    /**
     * The hydrators inside one `batchStoreUpdates` — the commit phase of
     * `replaceProjectData`, shared by the recent-project open path, `.sourdaw`
     * import, templates and demo projects. Converged minimum 3.78-4.14 ms.
     *
     * The cost is rebuilding every track, clip and MIDI note object and
     * assigning the results into each store's in-memory cache. It is **not** a
     * JSON round-trip: `toDocSafe`
     * (`src/infra/store/storage/createAutomergeStorage.ts:617`) is reached only
     * from the deferred flush (`:652`, `:661`), from `resetProjection` (`:862`)
     * and from `hydrate` — never from `set()`, and so never from this span.
     */
    storeHydrators: {
        ceilingMs: 20,
        reason: 'rebuild every track, clip and MIDI note object and assign it into each store cache',
    },
} as const;

// ── Statistics ───────────────────────────────────────────────────────────────

type Measurement = {
    minMs: number;
    /** The smallest sample other than {@link minMs}. The floor's witness. */
    secondMinMs: number;
    medianMs: number;
    p95Ms: number;
    maxMs: number;
    samples: number;
    /** `secondMinMs / minMs - 1`. */
    convergenceDrift: number;
    converged: boolean;
};

function percentileOf(sortedAscending: number[], fraction: number): number {
    const rank = Math.ceil(fraction * sortedAscending.length) - 1;
    const index = Math.min(Math.max(rank, 0), sortedAscending.length - 1);
    return sortedAscending[index] ?? Number.NaN;
}

/**
 * How far the second-smallest sample sits above the smallest, or `Infinity`
 * when the question has no answer: fewer than two samples, or a zero floor,
 * which is a broken measurement rather than a converged one. Both refuse.
 */
function driftOf(sortedAscending: number[]): number {
    const smallest = sortedAscending[0];
    const secondSmallest = sortedAscending[1];
    if (smallest === undefined || secondSmallest === undefined || smallest <= 0) {
        return Number.POSITIVE_INFINITY;
    }
    return secondSmallest / smallest - 1;
}

function summarize(samples: number[], plan: SamplingPlan): Measurement {
    const sorted = [...samples].sort((left, right) => left - right);
    const convergenceDrift = driftOf(sorted);
    return {
        minMs: sorted[0] ?? Number.NaN,
        secondMinMs: sorted[1] ?? Number.NaN,
        medianMs: percentileOf(sorted, 0.5),
        p95Ms: percentileOf(sorted, 0.95),
        maxMs: sorted.at(-1) ?? Number.NaN,
        samples: samples.length,
        convergenceDrift,
        converged: samples.length >= plan.minSamples && convergenceDrift <= CONVERGENCE_TOLERANCE,
    };
}

function hasSettled(samples: number[], plan: SamplingPlan): boolean {
    if (samples.length < plan.minSamples) {
        return false;
    }
    return driftOf([...samples].sort((left, right) => left - right)) <= CONVERGENCE_TOLERANCE;
}

/**
 * `await` on a synchronous span's return value costs one microtask and does not
 * yield the event loop, so timing sync and async spans through one path does not
 * distort either. Both legs use it.
 */
async function measureSpan(operation: () => unknown, plan: SamplingPlan): Promise<Measurement> {
    for (let index = 0; index < plan.leadIn; index++) {
        await operation();
    }
    const samples: number[] = [];
    const samplingStartedAt = performance.now();
    while (samples.length < plan.maxSamples) {
        const startedAt = performance.now();
        await operation();
        samples.push(performance.now() - startedAt);
        if (hasSettled(samples, plan) || performance.now() - samplingStartedAt >= plan.timeBudgetMs) {
            break;
        }
    }
    return summarize(samples, plan);
}

// ── Host environment ─────────────────────────────────────────────────────────

/**
 * The browser globals the measured module graph needs, installed explicitly.
 *
 * This is deliberately a short, named list rather than a copy of
 * `src/setupTests.ts`: anything the graph needs that is missing throws a
 * `ReferenceError` at load, which {@link main} reports as NOT MEASURED rather
 * than letting it look like a product failure. The audio contexts are stubs
 * because nothing measured here touches Web Audio — the analysis DSP reads a
 * `Float32Array` the fixture supplies directly.
 */
const stubAudioNode = { connect: (destination: unknown) => destination, disconnect: (): void => {} };

function stubAudioParam(): Record<string, unknown> {
    return {
        value: 0,
        setValueAtTime: (): void => {},
        linearRampToValueAtTime: (): void => {},
        exponentialRampToValueAtTime: (): void => {},
        setTargetAtTime: (): void => {},
        setValueCurveAtTime: (): void => {},
        cancelScheduledValues: (): void => {},
        cancelAndHoldAtTime: (): void => {},
    };
}

/**
 * Mirrors `createMinimalBaseAudioContext` in `src/setupTests.ts:169-221`.
 *
 * Nothing measured here reads a sample back out of Web Audio: the analysis DSP
 * takes its PCM straight from the fixture's `getChannelData`, and the
 * persistence spans are serialization and store writes. This exists only
 * because the AudioEngine barrel constructs a context when it is imported.
 */
class StubAudioContext {
    state = 'running';
    currentTime = 0;
    sampleRate = SAMPLE_RATE;
    destination = stubAudioNode;
    audioWorklet = { addModule: (): Promise<void> => Promise.resolve() };

    createGain(): Record<string, unknown> {
        return { ...stubAudioNode, gain: stubAudioParam() };
    }

    createAnalyser(): Record<string, unknown> {
        return {
            ...stubAudioNode,
            fftSize: 256,
            frequencyBinCount: 128,
            smoothingTimeConstant: 0.8,
            getFloatTimeDomainData: (data: Float32Array): void => {
                data.fill(0);
            },
            getFloatFrequencyData: (data: Float32Array): void => {
                data.fill(-100);
            },
        };
    }

    resume(): Promise<void> {
        return Promise.resolve();
    }

    suspend(): Promise<void> {
        return Promise.resolve();
    }
}

class StubAudioWorkletNode {
    port = { postMessage: (): void => {}, onmessage: null };
    parameters = new Map<string, unknown>();

    connect(): StubAudioWorkletNode {
        return this;
    }

    disconnect(): void {}
}

function stubWebStorage(): Record<string, unknown> {
    const entries = new Map<string, string>();
    return {
        getItem: (key: string) => entries.get(key) ?? null,
        setItem: (key: string, value: string) => entries.set(key, value),
        removeItem: (key: string) => entries.delete(key),
        clear: () => entries.clear(),
        key: (index: number) => [...entries.keys()][index] ?? null,
        get length() {
            return entries.size;
        },
    };
}

/**
 * The browser globals the measured module graph needs, installed explicitly.
 *
 * **There is no DOM here and no jsdom.** The list below is what the graph
 * actually reaches for, and it turns out to be four things: a frame callback,
 * two Web Storage objects, and Web Audio constructors. Standing up a whole
 * document to supply them would make this host a second, unreviewed copy of
 * `src/setupTests.ts` whose drift from it nobody would notice.
 *
 * Anything the graph needs that is not here throws a `ReferenceError` at load,
 * which {@link main} reports as NOT MEASURED — a missing global is a broken
 * harness, not a product defect, and must not be able to look like one.
 *
 * `requestAnimationFrame` is a `setTimeout` at roughly frame cadence. Nothing
 * measured depends on its timing; the Automerge storage adapter only needs a
 * frame to eventually arrive so its deferred writes flush
 * (`createAutomergeStorage.ts:838`).
 */
function installBrowserGlobals(): void {
    const noop = (): void => {};
    const globals: [string, unknown][] = [
        ['addEventListener', noop],
        ['removeEventListener', noop],
        ['requestAnimationFrame', (callback: (time: number) => void) => setTimeout(() => callback(Date.now()), 16)],
        ['cancelAnimationFrame', (handle: number) => clearTimeout(handle)],
        ['localStorage', stubWebStorage()],
        ['sessionStorage', stubWebStorage()],
        ['AudioContext', StubAudioContext],
        ['OfflineAudioContext', StubAudioContext],
        ['AudioWorkletNode', StubAudioWorkletNode],
    ];
    for (const [key, value] of globals) {
        Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
    }
    // `window` last and pointing at the global object itself, so a module that
    // reaches through it sees the same stubs installed above rather than a
    // second, emptier object.
    Object.defineProperty(globalThis, 'window', { value: globalThis, configurable: true, writable: true });
}

// ── An in-memory IndexedDB ───────────────────────────────────────────────────
//
// jsdom ships no IndexedDB and the repository's `installFakeIndexedDb` double
// implements only `get`/`put`/`delete` — not the `getAll`/`getAllKeys`/`add`/
// `clear`/`openCursor` surface the CRDT persistence layer uses.
//
// Two properties matter for a stall measurement and both are honoured:
//   1. `put`/`add` `structuredClone` their value. That is the synchronous
//      main-thread half of an IDB write, and skipping it would understate save.
//   2. Requests fire `onsuccess` before the transaction commits, and requests
//      issued from inside an `onsuccess` handler are still serviced by the same
//      transaction — which is what `saveAllToIdb`'s read-then-write does.

type PendingRequest = {
    run: () => unknown;
    request: { result: unknown; error: unknown; onsuccess: (() => void) | null; onerror: (() => void) | null };
};

class MemoryObjectStore {
    // Written out longhand rather than as constructor parameter properties:
    // `node --experimental-strip-types` runs in strip-only mode and rejects
    // those outright.
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
            const entry = entries[index];
            index++;
            cursorRequest.result = {
                key: entry?.key,
                value: entry?.value,
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
                            const pending = queue.shift();
                            if (!pending) {
                                break;
                            }
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
    Object.defineProperty(globalThis, 'indexedDB', { value: indexedDb, configurable: true, writable: true });
}

// ── Module loading ───────────────────────────────────────────────────────────

/**
 * The alias graph is declared here rather than inherited from `vite.config.ts`
 * because this host is not the app and most of that config does not apply. Only
 * two entries do. `#/` is the source alias. The `@automerge/automerge` entry
 * mirrors `vite.config.ts:81` and must stay in step with it — v3's `browser`
 * condition resolves to a bundle using ESM Wasm import syntax the loader does
 * not support.
 *
 * Nothing in the measured graph is stubbed or narrowed: both legs import the
 * real modules the app imports, including the full
 * `#/modules/AudioEngine/useCases` barrel. That barrel constructs a
 * `WebAudioEngine` at module scope, which is why {@link wireMinimalDependencies}
 * runs first.
 */
async function startModuleServer(): Promise<ViteDevServer> {
    const src = fileURLToPath(new URL('../src', import.meta.url));
    const automerge = fileURLToPath(
        new URL('../node_modules/@automerge/automerge/dist/mjs/entrypoints/fullfat_base64.js', import.meta.url)
    );
    return createServer({
        configFile: false,
        server: { middlewareMode: true },
        appType: 'custom',
        logLevel: 'error',
        // `@grame/faustwasm` is CJS with an ESM facade the SSR loader cannot
        // read as external. Nothing measured here calls into Faust; it is on
        // the persistence graph only because the PluginHost registry is.
        ssr: { noExternal: ['@grame/faustwasm'] },
        resolve: {
            alias: [
                { find: /^#\//, replacement: `${src}/` },
                { find: '@automerge/automerge', replacement: automerge },
            ],
        },
    });
}

/**
 * The one piece of `src/app/bootstrap.ts` this host has to reproduce.
 *
 * Importing `#/modules/AudioEngine/useCases` constructs a `WebAudioEngine` at
 * module scope (`AudioEngine/repositories/createWebAudioEngine.ts:1408`), whose
 * constructor reports a failure through `notifyUser`. With no notification
 * event bus registered that call throws `eventBus.emit is not a function` and
 * the whole barrel fails to evaluate — so this is a load-time prerequisite, not
 * a convenience.
 *
 * It is deliberately the *only* thing wired. `bootstrap.ts` registers a dozen
 * more buses and every handler map; none of them is on the path of anything
 * measured here, and wiring them would make this host a second, unreviewed copy
 * of the composition root. Anything else the graph turns out to need will throw
 * at load, which {@link main} reports as NOT MEASURED rather than as a product
 * failure.
 */
async function wireMinimalDependencies(server: ViteDevServer): Promise<void> {
    const dependencies = await loadModule<{ eventBus: unknown }>(server, '/src/app/registerDependencies.ts');
    const notifications = await loadModule<{ setNotificationEventBus: (bus: unknown) => void }>(
        server,
        '/src/utils/Notification/notificationEventBus.ts'
    );
    notifications.setNotificationEventBus(dependencies.eventBus);
}

/**
 * The single boundary cast in this file. `ssrLoadModule` cannot know the shape
 * of what it evaluates, so each call site names the shape it needs and the
 * typechecker holds it to that from there on.
 */
async function loadModule<Shape>(server: ViteDevServer, id: string): Promise<Shape> {
    const loaded: unknown = await server.ssrLoadModule(id);
    return loaded as Shape;
}

// ── Fixture ──────────────────────────────────────────────────────────────────

type FixtureBuffer = { sampleRate: number; getChannelData: () => Float32Array };

/**
 * A take, not a test tone. A pure sine makes onset detection return nothing and
 * gives the key detector a single unambiguous bin, so the measurement would be
 * of the early-out rather than of the work. This is a sustained triad plus
 * periodic percussive transients plus broadband noise.
 *
 * Deterministic by construction (a fixed LCG, no `Math.random`), so two runs
 * measure the same signal.
 */
function createTakeFixture(seconds: number): FixtureBuffer {
    const length = Math.floor(seconds * SAMPLE_RATE);
    const data = new Float32Array(length);
    const triad = [261.626, 329.628, 391.995];
    let seed = 0x2545_f491;
    for (let index = 0; index < length; index++) {
        const time = index / SAMPLE_RATE;
        let sample = 0;
        for (const frequency of triad) {
            sample += Math.sin(2 * Math.PI * frequency * time) / triad.length;
        }
        // A transient every 500 ms (120 BPM), decaying over ~40 ms.
        const sinceHit = time % 0.5;
        if (sinceHit < 0.04) {
            sample += Math.exp(-sinceHit * 120) * 0.9 * Math.sin(2 * Math.PI * 90 * sinceHit);
        }
        seed = (seed * 1_103_515_245 + 12_345) & 0x7fff_ffff;
        sample += (seed / 0x7fff_ffff - 0.5) * 0.05;
        data[index] = sample * 0.7;
    }
    return { sampleRate: SAMPLE_RATE, getChannelData: () => data };
}

// ── Reporting ────────────────────────────────────────────────────────────────

type Verdicts = { notMeasured: string[]; failed: string[] };

function describeMachine(): string {
    const cpu = cpus()[0]?.model ?? 'unknown CPU';
    const memoryGiB = Math.round(totalmem() / 1024 ** 3);
    return (
        `${cpu}, ${cpus().length} logical cores, ${memoryGiB} GiB, ` +
        `${platform()} ${release()} ${arch()}, Node ${process.version}, jsdom (no browser)`
    );
}

function reportSpan(name: string, measurement: Measurement, note: string): void {
    const settled = measurement.converged ? 'converged' : 'NOT CONVERGED — lower bound only';
    console.log(
        `  ${name.padEnd(42)} min ${measurement.minMs.toFixed(2).padStart(8)} ms  ` +
            `2nd-min ${measurement.secondMinMs.toFixed(2).padStart(8)}  ` +
            `median ${measurement.medianMs.toFixed(2).padStart(8)}  ` +
            `p95 ${measurement.p95Ms.toFixed(2).padStart(8)}  ` +
            `max ${measurement.maxMs.toFixed(2).padStart(8)}  ` +
            `n=${String(measurement.samples).padStart(3)}  ` +
            `drift ${(measurement.convergenceDrift * 100).toFixed(2).padStart(6)}%  ${settled}`
    );
    if (note.length > 0) {
        console.log(`  ${' '.repeat(42)} ${note}`);
    }
}

/**
 * Prints the outcome and returns the exit code for it. Refusal outranks
 * failure: a run whose floor was never reproduced cannot support a red verdict
 * any more than a green one, so its verdicts are withheld rather than reported
 * as product defects.
 */
function reportVerdicts({ notMeasured, failed }: Verdicts): number {
    if (notMeasured.length > 0) {
        console.error('NOT MEASURED — conditions unfit, no verdict on the product');
        for (const reason of notMeasured) {
            console.error(`  - ${reason}`);
        }
        if (failed.length > 0) {
            console.error('  (verdicts below are withheld because the run cannot be trusted:)');
            for (const failure of failed) {
                console.error(`    · ${failure}`);
            }
        }
        return EXIT_NOT_MEASURED;
    }

    if (failed.length > 0) {
        console.error('FAILED — measured on a machine quiet enough to measure on, and a verdict is red');
        for (const failure of failed) {
            console.error(`  - ${failure}`);
        }
        return EXIT_MEASURED_RED;
    }

    return 0;
}

/**
 * Refuses a run whose upper tail is a description of the machine. Applied to
 * every span, not just the ones backing a pass claim: a load heavy enough to
 * disperse one span's tail inflates every other span's floor too — under the
 * recorded 21.74 run `summarizeFeatures`'s minimum came in 4.0x above its idle
 * value, well past the 2.45x envelope the breach margins rely on.
 */
function refuseOverDispersed(spans: [string, Measurement][], notMeasured: string[]): void {
    for (const [name, measurement] of spans) {
        if (measurement.minMs <= 0) {
            continue;
        }
        const dispersion = measurement.p95Ms / measurement.minMs;
        if (dispersion <= DISPERSION_CEILING) {
            continue;
        }
        notMeasured.push(
            `${name}: p95 ${measurement.p95Ms.toFixed(2)} ms is ${dispersion.toFixed(1)}x its own minimum of ` +
                `${measurement.minMs.toFixed(2)} ms (ceiling ${String(DISPERSION_CEILING)}x). The upper tail of ` +
                'this run describes the machine, not the code, so no pass or breach verdict from it counts. ' +
                'Re-run on a quiet machine.'
        );
    }
}

function refuseUnconverged(spans: [string, Measurement][], notMeasured: string[]): void {
    for (const [name, measurement] of spans) {
        if (measurement.converged) {
            continue;
        }
        const drift = Number.isFinite(measurement.convergenceDrift)
            ? `${(measurement.convergenceDrift * 100).toFixed(2)}%`
            : 'no second sample';
        notMeasured.push(
            `${name}: floor never reproduced — second-smallest sample sits ${drift} above the smallest ` +
                `over ${String(measurement.samples)} samples (tolerance ` +
                `${(CONVERGENCE_TOLERANCE * 100).toFixed(0)}%). min ${measurement.minMs.toFixed(2)} ms is a lower ` +
                'bound, not a measurement. The machine was busy — re-run on a quiet one.'
        );
    }
}

// ── Analysis leg ─────────────────────────────────────────────────────────────

type AnalysisModules = {
    cacheAudioBuffer: (input: { buffer: unknown; bufferId?: string }) => string;
    detectKey: (id: string) => { key: string } | null;
    detectTempo: (id: string) => number | null;
    detectOnsets: (buffer: unknown, sensitivity: number, minIntervalSec: number) => unknown[];
    summarizeFeatures: (id: string) => { frameCount: number } | null;
    detectDominantPitch: (id: string) => { midiPitch: number } | null;
};

async function loadAnalysisModules(server: ViteDevServer): Promise<AnalysisModules> {
    const engine = await loadModule<Pick<AnalysisModules, 'cacheAudioBuffer'>>(
        server,
        '#/modules/AudioEngine/useCases'
    );
    const key = await loadModule<Pick<AnalysisModules, 'detectKey'>>(
        server,
        '/src/modules/AudioAnalysis/useCases/keyDetection.ts'
    );
    const tempo = await loadModule<Pick<AnalysisModules, 'detectTempo'>>(
        server,
        '/src/modules/AudioAnalysis/useCases/tempoDetection.ts'
    );
    const onsets = await loadModule<Pick<AnalysisModules, 'detectOnsets'>>(
        server,
        '/src/modules/AudioAnalysis/useCases/detectOnsets.ts'
    );
    const features = await loadModule<Pick<AnalysisModules, 'summarizeFeatures'>>(
        server,
        '/src/modules/AudioAnalysis/useCases/summarizeFeatures.ts'
    );
    const pitch = await loadModule<Pick<AnalysisModules, 'detectDominantPitch'>>(
        server,
        '/src/modules/AudioAnalysis/useCases/pitchDetection.ts'
    );
    return { ...engine, ...key, ...tempo, ...onsets, ...features, ...pitch };
}

async function runAnalysisLeg(server: ViteDevServer, verdicts: Verdicts): Promise<void> {
    const modules = await loadAnalysisModules(server);
    const take = createTakeFixture(FIXTURE_SECONDS);
    const warmUp = createTakeFixture(0.5);
    modules.cacheAudioBuffer({ buffer: take, bufferId: 'take' });
    modules.cacheAudioBuffer({ buffer: warmUp, bufferId: 'warm-up' });

    // One warm-up pass per code path, untimed, so the figures exclude first-call
    // JIT tier-up rather than attributing it to the operation.
    modules.detectKey('warm-up');
    modules.detectTempo('warm-up');
    modules.detectOnsets(warmUp, ONSET_SENSITIVITY, ONSET_MIN_INTERVAL_SEC);
    modules.summarizeFeatures('warm-up');
    modules.detectDominantPitch('warm-up');

    // Fixture pin. Every timing below is meaningless if the DSP found nothing to
    // do: a detector that early-outs on silence is fast, and a harness that only
    // times early-outs measures itself. The fixture carries one transient every
    // 500 ms, so over 10 s a working onset detector finds roughly twenty, and
    // the meyda hop loop yields ~930 frames over the same span.
    const keyResult = modules.detectKey('take');
    const tempoResult = modules.detectTempo('take');
    const onsetResult = modules.detectOnsets(take, ONSET_SENSITIVITY, ONSET_MIN_INTERVAL_SEC);
    const featureResult = modules.summarizeFeatures('take');
    const pitchResult = modules.detectDominantPitch('take');
    const fixtureFacts: [string, boolean][] = [
        ['detectKey returned a key string', typeof keyResult?.key === 'string'],
        ['detectTempo returned a positive tempo', (tempoResult ?? 0) > 0],
        ['detectOnsets found more than ten onsets', onsetResult.length > 10],
        ['summarizeFeatures produced more than 800 frames', (featureResult?.frameCount ?? 0) > 800],
        ['detectDominantPitch returned a MIDI pitch', typeof pitchResult?.midiPitch === 'number'],
    ];
    for (const [description, holds] of fixtureFacts) {
        if (!holds) {
            verdicts.failed.push(
                `ANALYSIS fixture: ${description} — false. The DSP found nothing to do, so every ` +
                    'figure below times an early-out. Do not report these numbers.'
            );
        }
    }

    const key = await measureSpan(() => modules.detectKey('take'), EXPENSIVE_PLAN);
    const tempo = await measureSpan(() => modules.detectTempo('take'), CHEAP_PLAN);
    const onsets = await measureSpan(
        () => modules.detectOnsets(take, ONSET_SENSITIVITY, ONSET_MIN_INTERVAL_SEC),
        CHEAP_PLAN
    );
    const features = await measureSpan(() => modules.summarizeFeatures('take'), EXPENSIVE_PLAN);
    const pitch = await measureSpan(() => modules.detectDominantPitch('take'), EXPENSIVE_PLAN);

    console.log(`ANALYSIS — ${String(FIXTURE_SECONDS)} s take, ${String(SAMPLE_RATE)} Hz mono`);
    for (const [name, measurement] of [
        ['detectKey', key],
        ['detectTempo', tempo],
        ['detectOnsets', onsets],
        ['summarizeFeatures', features],
        ['detectDominantPitch', pitch],
    ] as const) {
        reportSpan(
            name,
            measurement,
            `${(measurement.minMs / FIXTURE_SECONDS).toFixed(2)} ms per audio second — ` +
                `${(measurement.minMs / GRAIN_BUDGET_MS).toFixed(1)}x the ${String(GRAIN_BUDGET_MS)} ms grain, ` +
                `${(measurement.minMs / LOOKAHEAD_BUDGET_MS).toFixed(2)}x the ` +
                `${String(LOOKAHEAD_BUDGET_MS)} ms look-ahead horizon`
        );
    }

    // The Analyze button in `ClipAudioAiSection` runs these two back-to-back
    // inside one synchronous click handler. `features.minMs + pitch.minMs` is
    // conservative: the minimum of a sum is at least the sum of the minima. That
    // the spinner cannot paint is asserted behaviourally, without a clock, in
    // `ClipAudioAiSection.analyzeStall.spec.tsx`; this is only its magnitude.
    const analyzeButtonMs = features.minMs + pitch.minMs;
    const analyzePerAudioSecond = analyzeButtonMs / FIXTURE_SECONDS;
    console.log('');
    console.log(
        `  ClipAudioAiSection Analyze click handler (summarizeFeatures + detectDominantPitch):\n` +
            `    ${analyzeButtonMs.toFixed(2)} ms for ${String(FIXTURE_SECONDS)} s of audio ` +
            `(${analyzePerAudioSecond.toFixed(2)} ms per audio second)\n` +
            `    ${(analyzeButtonMs / GRAIN_BUDGET_MS).toFixed(1)}x the ${String(GRAIN_BUDGET_MS)} ms grain AND ` +
            `${(analyzeButtonMs / LOOKAHEAD_BUDGET_MS).toFixed(2)}x the ${String(LOOKAHEAD_BUDGET_MS)} ms ` +
            `look-ahead horizon, one uninterrupted task.\n` +
            `    It breaches both thresholds, which is why the finding does not depend on which one you read.\n` +
            `    At the measured rate a 3-minute take freezes the UI for ` +
            `${((analyzePerAudioSecond * 180) / 1000).toFixed(1)} s.`
    );
    console.log('');

    // Only the spans whose minimum backs a verdict have to have converged.
    refuseUnconverged(
        [
            ['ANALYSIS detectKey', key],
            ['ANALYSIS summarizeFeatures', features],
            ['ANALYSIS detectDominantPitch', pitch],
        ],
        verdicts.notMeasured
    );
    refuseOverDispersed(
        [
            ['ANALYSIS detectKey', key],
            ['ANALYSIS detectTempo', tempo],
            ['ANALYSIS detectOnsets', onsets],
            ['ANALYSIS summarizeFeatures', features],
            ['ANALYSIS detectDominantPitch', pitch],
        ],
        verdicts.notMeasured
    );

    // Within budget, on the conservative statistic for a pass claim.
    for (const [name, measurement] of [
        ['detectTempo', tempo],
        ['detectOnsets', onsets],
    ] as const) {
        if (measurement.p95Ms >= GRAIN_BUDGET_MS) {
            verdicts.failed.push(
                `ANALYSIS ${name}: p95 ${measurement.p95Ms.toFixed(2)} ms is at or over the ` +
                    `${String(GRAIN_BUDGET_MS)} ms grain. It used to fit inside it.`
            );
        }
        if (measurement.maxMs >= LOOKAHEAD_BUDGET_MS) {
            verdicts.failed.push(
                `ANALYSIS ${name}: max ${measurement.maxMs.toFixed(2)} ms is at or over the ` +
                    `${String(LOOKAHEAD_BUDGET_MS)} ms look-ahead horizon.`
            );
        }
    }

    // Over the grain today, by 8.1-22.1x. Asserted as breaches so this reds
    // both when they regress and when they are fixed — a fix must delete the
    // entry from RECORDED_BREACHES and move the span into the pass block above.
    for (const [name, measurement, recorded] of [
        ['detectKey', key, RECORDED_BREACHES.detectKey],
        ['summarizeFeatures', features, RECORDED_BREACHES.summarizeFeatures],
        ['detectDominantPitch', pitch, RECORDED_BREACHES.detectDominantPitch],
    ] as const) {
        if (measurement.minMs <= GRAIN_BUDGET_MS) {
            verdicts.failed.push(
                `ANALYSIS ${name}: min ${measurement.minMs.toFixed(2)} ms is inside the ` +
                    `${String(GRAIN_BUDGET_MS)} ms grain. If this operation was fixed, delete its ` +
                    'RECORDED_BREACHES entry and assert the budget plainly instead.'
            );
        }
        if (measurement.minMs >= recorded.ceilingMs) {
            verdicts.failed.push(
                `ANALYSIS ${name}: min ${measurement.minMs.toFixed(2)} ms is at or over its recorded ` +
                    `ceiling of ${String(recorded.ceilingMs)} ms (${recorded.reason}).`
            );
        }
    }

    // The audio-correctness claim, and the one that makes this a product finding
    // rather than a responsiveness one. Asserted only for the Analyze pair,
    // which measures 2.93-3.03x the horizon across five runs. The individual
    // detectors sit at 0.8-2.2x — `detectDominantPitch` is now *under* the
    // horizon on its own — so their ratios are printed above and deliberately
    // not asserted.
    //
    // Be precise about the margin: 2.9x clears the 2.45x contention envelope by
    // only 1.2x, which is thinner than it reads. What actually protects this
    // verdict is not the envelope but the convergence gate above — a run whose
    // floor was never reproduced exits 2 and never reaches this line, so the
    // figure feeding it is one two independent samples agreed on. If the margin
    // narrows further, the honest move is to stop asserting the horizon here
    // and report it, not to keep the verdict on a 1.1x margin.
    if (analyzeButtonMs <= LOOKAHEAD_BUDGET_MS) {
        verdicts.failed.push(
            `ANALYSIS Analyze click handler: ${analyzeButtonMs.toFixed(2)} ms is inside the ` +
                `${String(LOOKAHEAD_BUDGET_MS)} ms look-ahead horizon. The audio-correctness breach is gone — ` +
                'good news, and this verdict has to be rewritten rather than kept green.'
        );
    }
}

// ── Persistence leg ──────────────────────────────────────────────────────────

type ProjectData = { arrangement: { tracks: { clips: unknown[] }[] }; meta: Record<string, unknown> };

type PersistenceModules = {
    batchStoreUpdates: (run: () => void) => void;
    createCrdtProject: (name: string) => Promise<unknown>;
    createMyceliumAscendantBlueprint: () => { projectData: ProjectData };
    buildProjectData: (input: { includeAudioBuffers: boolean }) => Promise<{ data: ProjectData } | null>;
    hydrateArrangementStoreFromProjectData: (input: { data: ProjectData; preserveSavedArrangements: boolean }) => void;
    hydrateModuleStoresFromProjectData: (data: ProjectData) => void;
    loadProject: () => Promise<boolean>;
    projectStore: { set: (value: Record<string, unknown>) => void };
    saveProject: () => Promise<boolean>;
    setProjectIdentityTransitionDependencies: (input: { leaveCollaborationSession: () => Promise<void> }) => void;
};

async function loadPersistenceModules(server: ViteDevServer): Promise<PersistenceModules> {
    const base = '/src/modules/Project/useCases/projectPersistence';
    const store = await loadModule<Pick<PersistenceModules, 'batchStoreUpdates'>>(
        server,
        '/src/infra/store/createStore.ts'
    );
    const crdt = await loadModule<Pick<PersistenceModules, 'createCrdtProject'>>(
        server,
        '/src/modules/CrdtDocument/useCases/index.ts'
    );
    const blueprint = await loadModule<Pick<PersistenceModules, 'createMyceliumAscendantBlueprint'>>(
        server,
        '/src/modules/Project/useCases/demoProjects/myceliumAscendant/createMyceliumAscendantBlueprint.ts'
    );
    const build = await loadModule<Pick<PersistenceModules, 'buildProjectData'>>(
        server,
        `${base}/fileIO/buildProjectData.ts`
    );
    const arrangementHydrator = await loadModule<Pick<PersistenceModules, 'hydrateArrangementStoreFromProjectData'>>(
        server,
        `${base}/helpers/hydrateArrangementStoreFromProjectData.ts`
    );
    const moduleHydrator = await loadModule<Pick<PersistenceModules, 'hydrateModuleStoresFromProjectData'>>(
        server,
        `${base}/helpers/hydrateModuleStoresFromProjectData.ts`
    );
    const load = await loadModule<Pick<PersistenceModules, 'loadProject'>>(server, `${base}/loadProject.ts`);
    const projectStore = await loadModule<Pick<PersistenceModules, 'projectStore'>>(
        server,
        '/src/modules/Project/stores/projectStore.ts'
    );
    const save = await loadModule<Pick<PersistenceModules, 'saveProject'>>(
        server,
        `${base}/saveProject/saveProject.ts`
    );
    const identity = await loadModule<Pick<PersistenceModules, 'setProjectIdentityTransitionDependencies'>>(
        server,
        `${base}/projectIdentityTransitionDependencies.ts`
    );
    return {
        ...store,
        ...crdt,
        ...blueprint,
        ...build,
        ...arrangementHydrator,
        ...moduleHydrator,
        ...load,
        ...projectStore,
        ...save,
        ...identity,
    };
}

async function runPersistenceLeg(server: ViteDevServer, verdicts: Verdicts): Promise<void> {
    const modules = await loadPersistenceModules(server);
    // `runProjectLoadTransaction` ends any collaboration session first; the port
    // is wired in `bootstrap.ts`, which this host does not run.
    modules.setProjectIdentityTransitionDependencies({ leaveCollaborationSession: () => Promise.resolve() });

    const { projectData: referenceProject } = modules.createMyceliumAscendantBlueprint();
    const trackCount = referenceProject.arrangement.tracks.length;
    const clipCount = referenceProject.arrangement.tracks.reduce((total, track) => total + track.clips.length, 0);

    await modules.createCrdtProject('Main-thread stall budget reference');

    // Hydration: the store-side commit phase shared by the recent-project open
    // path, the import path and the demo/template paths.
    //
    // Scope note — this is a LOWER BOUND on the open path's total, and the
    // missing part is not small. What is timed is the in-batch work: rebuilding
    // the track, clip and MIDI note objects and assigning them into each store's
    // in-memory cache. The Automerge-backed stores defer the document write to
    // `requestAnimationFrame` (`createAutomergeStorage.ts:838`), and what that
    // deferred flush pays is `toDocSafe` (`:617`) —
    // `JSON.parse(JSON.stringify(value))` over every hydrated slot, i.e. a full
    // round-trip of substantially the same data the stringify span below takes
    // ~5.9 ms over. The remainder is plausibly comparable to the figure reported
    // here, paid on a later frame, and is not measured.
    const hydrate = await measureSpan(
        () =>
            modules.batchStoreUpdates(() => {
                modules.hydrateArrangementStoreFromProjectData({
                    data: referenceProject,
                    preserveSavedArrangements: true,
                });
                modules.hydrateModuleStoresFromProjectData(referenceProject);
                modules.projectStore.set({
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
            }),
        PERSISTENCE_PLAN
    );

    // Save, the contiguous span. `buildProjectData` is `async`, but with
    // `includeAudioBuffers: false` its body never awaits, so resolving it costs
    // a microtask — and a microtask does not yield the event loop. The
    // serializer and the stringify that follows it are therefore ONE
    // uninterrupted main-thread task in a real browser too, which is why they
    // are timed together as well as apart.
    const built = await modules.buildProjectData({ includeAudioBuffers: false });
    const snapshotJson = JSON.stringify(built?.data);
    const build = await measureSpan(() => modules.buildProjectData({ includeAudioBuffers: false }), PERSISTENCE_PLAN);
    const stringify = await measureSpan(() => JSON.stringify(built?.data), PERSISTENCE_PLAN);
    const snapshotSpan = await measureSpan(async () => {
        const snapshot = await modules.buildProjectData({ includeAudioBuffers: false });
        return JSON.stringify(snapshot?.data);
    }, PERSISTENCE_PLAN);
    const parse = await measureSpan(() => JSON.parse(snapshotJson) as unknown, PERSISTENCE_PLAN);

    const savesSucceeded = [await modules.saveProject(), await modules.saveProject(), await modules.saveProject()];
    const projectOpened = await modules.loadProject();

    console.log(
        `PERSISTENCE — reference project (Mycelium Ascendant blueprint), ${String(trackCount)} tracks, ` +
            `${String(clipCount)} clips, ${String(snapshotJson.length)} UTF-16 code units of snapshot JSON`
    );
    for (const [name, measurement, note] of [
        ['buildProjectData', build, 'sync span'],
        ['JSON.stringify', stringify, 'sync span'],
        ['buildProjectData + JSON.stringify', snapshotSpan, 'ONE contiguous sync span'],
        ['store hydrators', hydrate, 'sync span; open, import and template paths; LOWER BOUND'],
        ['JSON.parse of the saved snapshot', parse, 'sync span'],
    ] as const) {
        reportSpan(
            name,
            measurement,
            `${note} — ${String(Math.round((measurement.minMs / GRAIN_BUDGET_MS) * 100))}%-` +
                `${String(Math.round((measurement.maxMs / GRAIN_BUDGET_MS) * 100))}% of the ` +
                `${String(GRAIN_BUDGET_MS)} ms grain (min-max), ` +
                `${String(Math.round((measurement.maxMs / LOOKAHEAD_BUDGET_MS) * 100))}% of the ` +
                `${String(LOOKAHEAD_BUDGET_MS)} ms horizon at its max`
        );
    }

    const inconclusive = [stringify, snapshotSpan, hydrate, parse];
    const minPercents = inconclusive.map((span) => (span.minMs / GRAIN_BUDGET_MS) * 100);
    const maxPercents = inconclusive.map((span) => (span.maxMs / GRAIN_BUDGET_MS) * 100);
    console.log('');
    console.log(
        `  10 ms grain verdict for JSON.stringify, buildProjectData + JSON.stringify, the store hydrators\n` +
            `  and JSON.parse: INCONCLUSIVE, and deliberately not asserted. On this run their minima span\n` +
            `  ${String(Math.round(Math.min(...minPercents)))}-${String(Math.round(Math.max(...minPercents)))}% ` +
            `of the grain and their maxima ` +
            `${String(Math.round(Math.min(...maxPercents)))}-${String(Math.round(Math.max(...maxPercents)))}%.\n` +
            `  A pass/fail verdict at that margin would be a statement about machine load. What IS asserted\n` +
            `  for these four is the ${String(LOOKAHEAD_BUDGET_MS)} ms horizon, on the maximum, plus a ` +
            `regression ceiling at 5x the converged minimum.`
    );
    console.log('');

    // Fixture pin. Every figure above is meaningless if the paths no-opped:
    // `saveProject` returns true on an empty project, and a projection over
    // nothing is instant.
    const fixtureFacts: [string, boolean][] = [
        ['the built snapshot carries every fixture track', (built?.data.arrangement.tracks.length ?? 0) === trackCount],
        ['the snapshot is over a million code units', snapshotJson.length > 1_000_000],
        ['all three saves succeeded', savesSucceeded.every((succeeded) => succeeded)],
        ['the project opened', projectOpened],
    ];
    for (const [description, holds] of fixtureFacts) {
        if (!holds) {
            verdicts.failed.push(
                `PERSISTENCE fixture: ${description} — false. The path no-opped, so every figure above ` +
                    'times an empty project.'
            );
        }
    }

    refuseUnconverged(
        [
            ['PERSISTENCE JSON.stringify', stringify],
            ['PERSISTENCE buildProjectData + JSON.stringify', snapshotSpan],
            ['PERSISTENCE JSON.parse', parse],
            ['PERSISTENCE store hydrators', hydrate],
        ],
        verdicts.notMeasured
    );
    refuseOverDispersed(
        [
            ['PERSISTENCE buildProjectData', build],
            ['PERSISTENCE JSON.stringify', stringify],
            ['PERSISTENCE buildProjectData + JSON.stringify', snapshotSpan],
            ['PERSISTENCE JSON.parse', parse],
            ['PERSISTENCE store hydrators', hydrate],
        ],
        verdicts.notMeasured
    );

    // Within the 100 ms look-ahead horizon, asserted on the maximum.
    for (const [name, measurement] of [
        ['buildProjectData', build],
        ['JSON.stringify', stringify],
        ['buildProjectData + JSON.stringify', snapshotSpan],
        ['JSON.parse', parse],
        ['store hydrators', hydrate],
    ] as const) {
        if (measurement.maxMs >= LOOKAHEAD_BUDGET_MS) {
            verdicts.failed.push(
                `PERSISTENCE ${name}: max ${measurement.maxMs.toFixed(2)} ms is at or over the ` +
                    `${String(LOOKAHEAD_BUDGET_MS)} ms look-ahead horizon — the audio-correctness threshold.`
            );
        }
    }

    // Within the 10 ms grain, asserted on the maximum. Only `buildProjectData`
    // clears it on the conservative statistic; the other four are inconclusive
    // and are reported as such rather than restated on their minima.
    if (build.maxMs >= GRAIN_BUDGET_MS) {
        verdicts.failed.push(
            `PERSISTENCE buildProjectData: max ${build.maxMs.toFixed(2)} ms is at or over the ` +
                `${String(GRAIN_BUDGET_MS)} ms grain. It used to fit inside it on its worst sample.`
        );
    }

    for (const [name, measurement, ceiling] of [
        ['JSON.stringify', stringify, PERSISTENCE_CEILINGS.stringify],
        ['buildProjectData + JSON.stringify', snapshotSpan, PERSISTENCE_CEILINGS.snapshotSpan],
        ['JSON.parse', parse, PERSISTENCE_CEILINGS.parseSnapshot],
        ['store hydrators', hydrate, PERSISTENCE_CEILINGS.storeHydrators],
    ] as const) {
        if (measurement.minMs >= ceiling.ceilingMs) {
            verdicts.failed.push(
                `PERSISTENCE ${name}: min ${measurement.minMs.toFixed(2)} ms is at or over its regression ` +
                    `ceiling of ${String(ceiling.ceilingMs)} ms (${ceiling.reason}).`
            );
        }
    }
}

// ── Entry point ──────────────────────────────────────────────────────────────

async function main(): Promise<void> {
    const oneMinuteLoad = loadavg()[0] ?? 0;
    const advisoryCeiling = ADVISORY_LOAD_PER_CORE * cpus().length;

    console.log('Main-thread stall budget');
    console.log(`  machine     : ${describeMachine()}`);
    console.log(`  1-min load  : ${oneMinuteLoad.toFixed(2)}`);
    if (oneMinuteLoad > advisoryCeiling) {
        console.log(
            `  NOTE        : load is above ${advisoryCeiling.toFixed(2)} ` +
                `(${String(ADVISORY_LOAD_PER_CORE)} × cores). Advisory only — the convergence check below ` +
                'is what decides whether this run counts, and it measures contamination directly.'
        );
    }
    console.log(`  grain       : ${String(GRAIN_BUDGET_MS)} ms (scheduleGrainMs)`);
    console.log(`  horizon     : ${String(LOOKAHEAD_BUDGET_MS)} ms (SCHEDULE_AHEAD_SECONDS)`);
    console.log('');

    installBrowserGlobals();
    // Both legs need it, not just the persistence one: `audioBufferCache.get`
    // refreshes an IndexedDB access time on every read, so the analysis DSP
    // touches IDB once per call. That path is real in production and is left
    // real here rather than mocked away.
    installMemoryIndexedDb();

    let server: ViteDevServer;
    try {
        server = await startModuleServer();
    } catch (error) {
        console.error('NOT MEASURED — conditions unfit, no verdict on the product');
        console.error(`  - the module server would not start: ${String(error)}`);
        process.exitCode = EXIT_NOT_MEASURED;
        return;
    }

    const verdicts: Verdicts = { notMeasured: [], failed: [] };
    try {
        await wireMinimalDependencies(server);
        await runAnalysisLeg(server, verdicts);
        await runPersistenceLeg(server, verdicts);
    } catch (error) {
        // A load or execution fault is a broken harness, not a product defect,
        // so it withholds verdicts rather than asserting one.
        console.error('NOT MEASURED — conditions unfit, no verdict on the product');
        console.error(`  - the harness could not complete a leg: ${String(error)}`);
        process.exitCode = EXIT_NOT_MEASURED;
        return;
    } finally {
        await server.close();
    }

    const exitCode = reportVerdicts(verdicts);
    if (exitCode !== 0) {
        process.exitCode = exitCode;
        return;
    }
    console.log('MEASURED, GREEN — every verdict held on a run whose floor was reproduced.');
}

await main();
