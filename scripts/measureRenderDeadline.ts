/**
 * Does the web target miss the audio render deadline, and can we catch it in the act?
 *
 * The budget an `AudioWorkletProcessor` has to render 128 frames at 48 kHz is
 * 128 / 48_000 = 2.667 ms of wall clock. `crates/daw-dsp/benches/quantum.rs`
 * measures what a quantum of device DSP *costs* against that budget. This
 * harness measures something different and strictly stronger: whether the
 * deadline is actually *missed*, observed from outside the render thread.
 *
 * "Its compute exceeds the budget" and "it misses the deadline" are different
 * claims. quantum.rs establishes the first. This establishes the second.
 *
 * `AudioContext.renderCapacity` does not exist on this target — do not re-probe
 * ---------------------------------------------------------------------------
 * The spec's `AudioRenderCapacity` interface (`peakLoad`, `averageLoad`,
 * `underrunRatio`) is the obvious instrument for this, and it is not available.
 * Measured 2026-08-02, all on macOS 15 / arm64:
 *
 *   Playwright 1.61.1 bundled Chromium 149.0.7827.55, headless   — absent
 *   ... same build, headed                                       — absent
 *   ... + `--enable-blink-features=AudioContextRenderCapacity`   — absent
 *   ... + `--enable-blink-features=WebAudioRenderCapacity`       — absent
 *   ... + `--enable-blink-features=AudioRenderCapacity`          — absent
 *   ... + `--enable-experimental-web-platform-features`          — absent
 *   Google Chrome 150 stable, headed and headless                — absent
 *   ... + every flag above                                       — absent
 *
 * Absent means: no `AudioRenderCapacity` global, no `AudioRenderCapacityEvent`
 * global, and no `renderCapacity` property on `AudioContext.prototype` or on a
 * constructed instance, in both secure and insecure contexts. The experimental
 * flags do move the surface — they add `renderQuantumSize` and `playoutStats` —
 * so the probe is sensitive; `renderCapacity` simply is not there. Chromium
 * carries `third_party/blink/renderer/modules/webaudio/audio_render_capacity.cc`
 * in tree, but nothing in a shipping build exposes it to script.
 *
 * What we use instead, and what it means
 * --------------------------------------
 * `AudioContext.playbackStats` (Chrome's `AudioPlaybackStats`) is present and
 * stable on every configuration above. It reports, cumulatively for the
 * lifetime of the context:
 *
 *   underrunEvents    — how many times the output sink asked for frames the
 *                       render thread had not produced
 *   underrunDuration  — total seconds of output the sink had to cover itself
 *   totalDuration     — total seconds of output the sink has requested
 *
 * A non-zero `underrunEvents` is a *deadline observation*, not a cost estimate:
 * the sink pulled on the real-time clock and the render thread was not ready.
 * That is the claim quantum.rs could not make.
 *
 * What it does NOT establish. It does not prove a specific loudspeaker audibly
 * glitched. Chromium reports these counters whether the sink is a hardware
 * device or its own silent fallback, and this harness does not distinguish them
 * (`outputLatency` reads 0 under Playwright headed as well as headless, so a
 * hardware sink is not confirmed even when a window is open). What is
 * established is that the render thread missed a real-time deadline and the
 * output path recorded the shortfall. An audibility claim needs a listener, not
 * a counter.
 *
 * Because the accounting does not depend on hardware, the observation is
 * reproducible headless, which is why this harness runs headless by default.
 *
 * The second, independent witness
 * -------------------------------
 * `AudioContext.currentTime` advances only as fast as the render thread
 * actually renders, so comparing it against `performance.now()` gives a
 * realtime ratio that needs no sink accounting at all. Both legs report it, and
 * it corroborates `playbackStats` rather than restating it: under overload the
 * ratio collapses towards the reciprocal of the overload factor, which is what
 * a render thread falling behind wall clock looks like.
 *
 * Three exit codes, because there are three outcomes
 * --------------------------------------------------
 * "I cannot measure this right now" and "I measured it and the product misses
 * its deadline" are different claims and must not share an exit code. A busy
 * CI box would otherwise report what looks like a product defect.
 *
 *   0  MEASURED, GREEN   — conditions were fit and every verdict passed.
 *   1  MEASURED, RED     — conditions were fit and a verdict failed. This is
 *                          the only code that says anything about the product
 *                          or the instrument.
 *   2  NOT MEASURED      — installed stable Chrome was unavailable, or the
 *                          control leg found the machine too busy to measure
 *                          on. Says nothing about the product. Correct the
 *                          environment and re-run.
 *
 * Exit 2 wins over exit 1: a contaminated run cannot support a failure claim
 * any more than it can support a pass.
 *
 * **Once stable Chrome launches, the control leg is the sole authority on whether a run is trustworthy.**
 * The load average is reported alongside the result and warned about when it is
 * high (`ADVISORY_LOAD_PER_CORE`), but it does not gate anything, because it is
 * the wrong proxy for this instrument — see the next section.
 *
 * Why a loaded machine does not invalidate this harness
 * -----------------------------------------------------
 * This measurement is load-robust in a way its sibling is not, and the
 * difference is structural rather than a difference in care.
 *
 * `crates/daw-dsp/benches/quantum.rs` and the cost table time a spinning worker
 * at normal thread priority, so contention lands directly in the number: that
 * harness published a 17.9 ms p99 against a 1.1 ms median at 1-minute load 25.
 * This harness instead reads the sink's own frame accounting, driven by the
 * render thread, which the OS schedules at real-time priority — a run here at
 * load 22.10 produced a control leg at 1.0001 of real time, zero underruns, and
 * 929 overload events, indistinguishable from an idle-machine run.
 *
 * Same machine, opposite load-sensitivity, for a structural reason. Do not
 * conclude from the cost table's load guard that this one is missing a guard,
 * or vice versa; the control leg below is this harness's equivalent, and it
 * measures contamination directly instead of predicting it from a proxy.
 *
 * Verdicts, and the mutation that reds each one
 * ---------------------------------------------
 * CONTROL leg — `CONTROL_ITERATIONS` of spin per quantum, far inside budget:
 *   expects `underrunEvents === 0` and `realtimeRatio >= 0.9`.
 *   Reds if you set `CONTROL_ITERATIONS = OVERLOAD_ITERATIONS`.
 *   Classified NOT MEASURED (exit 2): microseconds of work per quantum cannot
 *   miss a 2.667 ms deadline on an idle machine, so a control-leg miss means
 *   the machine, not the code. **Do not widen 0.9 to make a loaded machine
 *   pass.** The control leg is the overload leg's mutation — a harness that
 *   cannot fail control is one that certifies anything. Refuse earlier and more
 *   clearly; do not assert less.
 *
 * OVERLOAD leg — `OVERLOAD_ITERATIONS` of spin per quantum, far over budget:
 *   expects `underrunEvents > 0`, `underrunDuration > 0`, `realtimeRatio < 0.5`.
 *   Reds if you set `OVERLOAD_ITERATIONS = CONTROL_ITERATIONS`.
 *   Classified MEASURED, RED (exit 1): extra machine load only makes a dropout
 *   *more* likely, so failing to see one under deliberate overload is a real
 *   finding about the instrument, not an artefact of a busy box.
 *
 * The two legs are each other's mutation: same code, opposite expected outcome.
 * A harness gone blind fails the overload leg; one that cries dropout
 * unconditionally fails the control leg. Neither verdict survives alone.
 *
 * PLATFORM leg — pins `playbackStats` present and `renderCapacity` absent.
 *   The presence pin is what keeps the absence assertion honest (ADR 0015 §4):
 *   if Chrome renames `playbackStats` this reds instead of quietly passing. If
 *   Chrome ever ships `renderCapacity` it also reds — the signal to throw this
 *   harness away and use the better instrument.
 *
 * Usage: `pnpm audio:deadline` (add `--headed` to watch it). A number without
 * its machine is not a measurement, so the report prints the host CPU, the load
 * average it ran under, the browser build, and the sample rate it actually got.
 */

import { arch, cpus, loadavg, platform, release } from 'node:os';

import { chromium, type Browser, type Page } from 'playwright';

import { launchRenderDeadlineBrowser } from './renderDeadlineBrowser.ts';

const QUANTUM_FRAMES = 128;
const REFERENCE_SAMPLE_RATE = 48_000;
/** 128 frames at 48 kHz. The number every device is measured against. */
const RENDER_BUDGET_MS = (QUANTUM_FRAMES / REFERENCE_SAMPLE_RATE) * 1000;

/** Spin iterations per quantum for the in-budget control leg — microseconds of work. */
const CONTROL_ITERATIONS = 1_000;
/** Spin iterations per quantum for the overload leg — an order of magnitude over budget. */
const OVERLOAD_ITERATIONS = 3_000_000;

/** How long each leg renders before its counters are read. */
const MEASURE_MS = 5_000;
/** Settling time after the node is connected, before the baseline snapshot. */
const WARMUP_MS = 1_000;

const CONTROL_MAX_UNDERRUN_EVENTS = 0;
const CONTROL_MIN_REALTIME_RATIO = 0.9;
const OVERLOAD_MAX_REALTIME_RATIO = 0.5;

/**
 * Load average per logical core above which the report carries a warning.
 *
 * **Advisory only — it does not gate the run.** It was a refusing pre-flight
 * for one revision, at half a core, by analogy with the cost-table harness.
 * That was the wrong proxy: at this ceiling of 6.00 it rejected a run at load
 * 22.10 that went on to produce a control leg at 1.0001 of real time with zero
 * underruns and 929 overload events. The render thread is scheduled at
 * real-time priority, so this instrument does not degrade with load the way a
 * spinning-worker clock does — see the header.
 *
 * So the number is worth printing (a reader deserves to know what the box was
 * doing) and worth flagging, but `CONTROL_MIN_REALTIME_RATIO` is what decides
 * whether a run counts. Do not turn this back into a gate, and do not widen the
 * control threshold to compensate for anything.
 */
const ADVISORY_LOAD_PER_CORE = 0.5;

/** Exit codes. Refusing to measure is not the same outcome as measuring a failure. */
const EXIT_MEASURED_RED = 1;
const EXIT_NOT_MEASURED = 2;

/**
 * The origin the probe page is served from. It must be a secure context:
 * `BaseAudioContext.audioWorklet` is `[SecureContext]`, and on a plain http
 * origin it reads `undefined` rather than throwing, which looks exactly like a
 * missing feature and cost an hour the first time. Requests are answered by a
 * route handler, so nothing leaves the machine and no dev server is needed.
 */
const PROBE_ORIGIN = 'https://render-deadline-probe.invalid';
const PROBE_HTML = '<!doctype html><meta charset="utf-8"><title>render deadline probe</title><body></body>';

/**
 * The load generator, as worklet source.
 *
 * Deliberately parameterised in iterations rather than milliseconds:
 * `performance` does not exist in `AudioWorkletGlobalScope`, so a processor
 * that tries to self-time throws on its first `process()` call, is replaced by
 * Chromium's silent passthrough, and then reports a beautifully clean zero
 * dropouts forever. A fixed iteration count cannot fail that way. The
 * `hasPerformanceClock` reply keeps that trap in the output, not just in this
 * comment, and `processorErrors` catches the fault if it happens anyway.
 */
const LOAD_WORKLET_SOURCE = `
class DeadlineLoadProcessor extends AudioWorkletProcessor {
    constructor(options) {
        super();
        this.iterations = options.processorOptions.iterations;
        this.quantaRendered = 0;
        this.port.postMessage({ hasPerformanceClock: typeof performance !== 'undefined' });
    }

    process(inputs, outputs) {
        let accumulator = 0.5;
        for (let index = 0; index < this.iterations; index++) {
            accumulator = accumulator + Math.sin(accumulator) * 1e-9;
        }
        const output = outputs[0];
        for (let channel = 0; channel < output.length; channel++) {
            const samples = output[channel];
            for (let index = 0; index < samples.length; index++) {
                // The accumulator term keeps the spin loop observable so the
                // optimiser cannot delete the work this harness is timing.
                samples[index] = Math.sin((this.quantaRendered * 128 + index) * 0.01) * 0.02 + accumulator * 1e-12;
            }
        }
        this.quantaRendered++;
        return true;
    }
}
registerProcessor('deadline-load', DeadlineLoadProcessor);
`;

type LegMeasurement = {
    iterations: number;
    sampleRate: number;
    hasPerformanceClock: boolean;
    processorErrors: number;
    underrunEvents: number;
    underrunDuration: number;
    totalDuration: number;
    wallElapsed: number;
    contextElapsed: number;
    realtimeRatio: number;
};

type PlatformSupport = {
    userAgent: string;
    isSecureContext: boolean;
    hasPlaybackStats: boolean;
    hasRenderCapacityOnInstance: boolean;
    hasRenderCapacityGlobal: boolean;
    hasRenderCapacityEventGlobal: boolean;
    playbackStatsFields: string[];
};

type RunLegInput = {
    page: Page;
    iterations: number;
};

async function openProbePage(browser: Browser): Promise<Page> {
    const page = await browser.newPage();
    await page.route(`${PROBE_ORIGIN}/**`, (route) =>
        route.fulfill({ status: 200, contentType: 'text/html', body: PROBE_HTML })
    );
    await page.goto(`${PROBE_ORIGIN}/`);
    return page;
}

async function readPlatformSupport(page: Page): Promise<PlatformSupport> {
    return page.evaluate(() => {
        const context = new AudioContext();
        const stats: unknown = Reflect.get(context, 'playbackStats');
        const hasPlaybackStats = typeof stats === 'object' && stats !== null;
        const playbackStatsFields: string[] = [];
        if (typeof stats === 'object' && stats !== null) {
            // The interesting members live on AudioPlaybackStats.prototype, not
            // on the instance, so the shape check has to walk one level up.
            const prototype: unknown = Object.getPrototypeOf(stats);
            if (typeof prototype === 'object' && prototype !== null) {
                for (const name of Object.getOwnPropertyNames(prototype)) {
                    if (name !== 'constructor') {
                        playbackStatsFields.push(name);
                    }
                }
            }
        }
        const support: PlatformSupport = {
            userAgent: navigator.userAgent,
            isSecureContext: globalThis.isSecureContext,
            hasPlaybackStats,
            hasRenderCapacityOnInstance: 'renderCapacity' in context,
            hasRenderCapacityGlobal: 'AudioRenderCapacity' in globalThis,
            hasRenderCapacityEventGlobal: 'AudioRenderCapacityEvent' in globalThis,
            playbackStatsFields,
        };
        void context.close();
        return support;
    });
}

/**
 * One leg runs entirely inside the page: setup, warm-up, measurement window and
 * teardown. Keeping it in a single `evaluate` means no state is parked on
 * `globalThis` between round-trips, and the wall clock the ratio is computed
 * against is the same clock throughout.
 */
async function runLeg({ page, iterations }: RunLegInput): Promise<LegMeasurement> {
    return page.evaluate(
        async ([workletSource, spinIterations, warmupMs, measureMs]: [string, number, number, number]) => {
            type UnderrunCounters = { underrunEvents: number; underrunDuration: number; totalDuration: number };

            function isUnderrunCounters(value: unknown): value is UnderrunCounters {
                if (typeof value !== 'object' || value === null) {
                    return false;
                }
                return (
                    'underrunEvents' in value &&
                    typeof value.underrunEvents === 'number' &&
                    'underrunDuration' in value &&
                    typeof value.underrunDuration === 'number' &&
                    'totalDuration' in value &&
                    typeof value.totalDuration === 'number'
                );
            }

            function readCounters(source: AudioContext): UnderrunCounters {
                const stats: unknown = Reflect.get(source, 'playbackStats');
                if (!isUnderrunCounters(stats)) {
                    throw new Error(
                        'AudioContext.playbackStats is missing or has changed shape; ' +
                            'this target no longer supports the dropout observation.'
                    );
                }
                return {
                    underrunEvents: stats.underrunEvents,
                    underrunDuration: stats.underrunDuration,
                    totalDuration: stats.totalDuration,
                };
            }

            const wait = (ms: number): Promise<void> =>
                new Promise((resolve) => {
                    setTimeout(resolve, ms);
                });

            const context = new AudioContext({ latencyHint: 'interactive' });
            await context.resume();

            const moduleUrl = URL.createObjectURL(new Blob([workletSource], { type: 'text/javascript' }));
            await context.audioWorklet.addModule(moduleUrl);
            URL.revokeObjectURL(moduleUrl);

            let processorErrors = 0;
            let hasPerformanceClock = false;

            const node = new AudioWorkletNode(context, 'deadline-load', {
                processorOptions: { iterations: spinIterations },
            });
            node.onprocessorerror = () => {
                processorErrors++;
            };
            node.port.onmessage = (event: MessageEvent<{ hasPerformanceClock: boolean }>) => {
                hasPerformanceClock = event.data.hasPerformanceClock;
            };
            node.connect(context.destination);

            await wait(warmupMs);

            const before = readCounters(context);
            const wallBefore = performance.now();
            const contextBefore = context.currentTime;

            await wait(measureMs);

            const after = readCounters(context);
            const wallElapsed = (performance.now() - wallBefore) / 1000;
            const contextElapsed = context.currentTime - contextBefore;
            const sampleRate = context.sampleRate;

            node.disconnect();
            await context.close();

            return {
                iterations: spinIterations,
                sampleRate,
                hasPerformanceClock,
                processorErrors,
                underrunEvents: after.underrunEvents - before.underrunEvents,
                underrunDuration: after.underrunDuration - before.underrunDuration,
                totalDuration: after.totalDuration - before.totalDuration,
                wallElapsed,
                contextElapsed,
                realtimeRatio: contextElapsed / wallElapsed,
            };
        },
        [LOAD_WORKLET_SOURCE, iterations, WARMUP_MS, MEASURE_MS] as [string, number, number, number]
    );
}

function describeMachine(): string {
    const cores = cpus();
    const first = cores[0];
    const model = first ? first.model : 'unknown CPU';
    return `${model} · ${String(cores.length)} logical cores · ${platform()} ${release()} ${arch()}`;
}

type LoadReading = {
    oneMinuteLoad: number;
    advisoryCeiling: number;
    isHigh: boolean;
};

/**
 * What the box was doing, for the record. Advisory: `isHigh` drives a warning,
 * never a refusal. The control leg decides whether the run counts.
 */
function readLoad(): LoadReading {
    const cores = cpus().length;
    const advisoryCeiling = cores * ADVISORY_LOAD_PER_CORE;
    const oneMinuteLoad = loadavg()[0] ?? 0;
    return { oneMinuteLoad, advisoryCeiling, isHigh: oneMinuteLoad > advisoryCeiling };
}

function reportLeg(label: string, measurement: LegMeasurement): void {
    console.log(`  ${label}`);
    console.log(`    spin iterations/quantum : ${String(measurement.iterations)}`);
    console.log(`    sample rate             : ${String(measurement.sampleRate)} Hz`);
    console.log(`    processor errors        : ${String(measurement.processorErrors)}`);
    console.log(`    underrun events         : ${String(measurement.underrunEvents)}`);
    console.log(`    underrun duration       : ${measurement.underrunDuration.toFixed(3)} s`);
    console.log(`    sink-requested output   : ${measurement.totalDuration.toFixed(3)} s`);
    console.log(
        `    currentTime vs wall     : ${measurement.contextElapsed.toFixed(3)} s / ` +
            `${measurement.wallElapsed.toFixed(3)} s = ${measurement.realtimeRatio.toFixed(4)}`
    );
}

type CollectFailuresInput = {
    support: PlatformSupport;
    control: LegMeasurement;
    overload: LegMeasurement;
};

/**
 * `notMeasured` means the run was contaminated and certifies nothing either
 * way; `failed` means the run was sound and a verdict is red. Keeping them in
 * separate lists is what keeps a busy CI box from reporting a product defect.
 */
type Verdicts = {
    notMeasured: string[];
    failed: string[];
};

function collectVerdicts({ support, control, overload }: CollectFailuresInput): Verdicts {
    const notMeasured: string[] = [];
    const failed: string[] = [];

    if (!support.hasPlaybackStats) {
        failed.push(
            'PLATFORM: AudioContext.playbackStats is gone. The dropout instrument this harness ' +
                'depends on no longer exists — find its replacement before trusting any leg below.'
        );
    }
    if (support.hasRenderCapacityOnInstance || support.hasRenderCapacityGlobal) {
        failed.push(
            'PLATFORM: AudioContext.renderCapacity now EXISTS on this target. Good news: replace ' +
                'this harness with AudioRenderCapacity, which reports peakLoad and underrunRatio ' +
                'directly, and rewrite the header above.'
        );
    }
    if (control.processorErrors > 0) {
        failed.push(
            `CONTROL: ${String(control.processorErrors)} processor error(s) — the load generator was ` +
                'replaced by silent passthrough, so its zero-dropout result means nothing.'
        );
    }
    // The control leg's two conditions say "this machine was not quiet enough
    // to measure on", not "the audio thread is broken": microseconds of work
    // per quantum cannot miss a 2.667 ms deadline unless something else is
    // eating the box.
    if (control.underrunEvents > CONTROL_MAX_UNDERRUN_EVENTS) {
        notMeasured.push(
            `CONTROL: ${String(control.underrunEvents)} underrun(s) from a leg doing microseconds of ` +
                `work against a ${RENDER_BUDGET_MS.toFixed(3)} ms budget. The machine was busy — this ` +
                'run measures the machine, not the product.'
        );
    }
    if (control.realtimeRatio < CONTROL_MIN_REALTIME_RATIO) {
        notMeasured.push(
            `CONTROL: the in-budget leg rendered at ${control.realtimeRatio.toFixed(4)} of real time ` +
                `(needs ${String(CONTROL_MIN_REALTIME_RATIO)}). Something else was using the CPU, so ` +
                'the overload leg below certifies nothing either way.'
        );
    }
    if (overload.processorErrors > 0) {
        failed.push(
            `OVERLOAD: ${String(overload.processorErrors)} processor error(s) — the load generator ` +
                'faulted rather than overran, so no deadline was missed by DSP work.'
        );
    }
    // Extra machine load only makes a dropout more likely, so these three stay
    // real findings even on a slightly loaded box.
    if (overload.underrunEvents <= 0) {
        failed.push(
            'OVERLOAD: no underrun observed under a deliberately over-budget processor. The ' +
                'instrument is blind — do not report a dropout inferred from cost figures.'
        );
    }
    if (overload.underrunEvents > 0 && overload.underrunDuration <= 0) {
        failed.push(
            'OVERLOAD: underrunEvents fired but underrunDuration stayed at zero. The counters ' +
                'disagree — one of them is no longer measuring what its name says.'
        );
    }
    if (overload.realtimeRatio >= OVERLOAD_MAX_REALTIME_RATIO) {
        failed.push(
            `OVERLOAD: currentTime tracked wall clock at ${overload.realtimeRatio.toFixed(4)}, at or ` +
                `above ${String(OVERLOAD_MAX_REALTIME_RATIO)}. The render thread kept up, so the ` +
                'overload leg did not overload anything.'
        );
    }
    return { notMeasured, failed };
}

/**
 * Prints the outcome and returns the exit code for it. Refusal outranks
 * failure: a contaminated run cannot support a red verdict any more than it can
 * support a green one, so a control-leg miss withholds the overload verdict
 * rather than reporting it as a product defect.
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
        console.error('FAILED — measured on a quiet machine, and a verdict is red');
        for (const failure of failed) {
            console.error(`  - ${failure}`);
        }
        return EXIT_MEASURED_RED;
    }

    return 0;
}

async function main(): Promise<void> {
    const load = readLoad();
    const headed = process.argv.includes('--headed');
    const launchResult = await launchRenderDeadlineBrowser({
        headed,
        launchBrowser: (options) => chromium.launch(options),
    });
    if (launchResult.status === 'not-measured') {
        console.error('NOT MEASURED — required installed stable Chrome is unavailable');
        console.error(`  - ${String(launchResult.error)}`);
        process.exitCode = EXIT_NOT_MEASURED;
        return;
    }
    const { browser } = launchResult;

    try {
        const page = await openProbePage(browser);
        const support = await readPlatformSupport(page);

        console.log('Render deadline observation');
        console.log(`  machine        : ${describeMachine()}`);
        console.log(`  1-min load     : ${load.oneMinuteLoad.toFixed(2)}`);
        if (load.isHigh) {
            console.log(
                `  NOTE           : load is above ${load.advisoryCeiling.toFixed(2)} (${String(ADVISORY_LOAD_PER_CORE)} × cores).` +
                    ' Advisory only — the render thread runs at real-time priority, so this' +
                    ' instrument tolerates load. The CONTROL leg below is what decides whether' +
                    ' this run is trustworthy.'
            );
        }
        console.log(`  browser        : ${support.userAgent}`);
        console.log(`  secure context : ${String(support.isSecureContext)}`);
        console.log(`  quantum budget : ${RENDER_BUDGET_MS.toFixed(3)} ms (128 frames @ 48 kHz)`);
        console.log('');
        console.log(`  AudioContext.renderCapacity : ${support.hasRenderCapacityOnInstance ? 'PRESENT' : 'ABSENT'}`);
        console.log(`  AudioRenderCapacity global  : ${support.hasRenderCapacityGlobal ? 'PRESENT' : 'ABSENT'}`);
        console.log(`  AudioRenderCapacityEvent    : ${support.hasRenderCapacityEventGlobal ? 'PRESENT' : 'ABSENT'}`);
        console.log(`  AudioContext.playbackStats  : ${support.hasPlaybackStats ? 'PRESENT' : 'ABSENT'}`);
        console.log(`  playbackStats fields        : ${support.playbackStatsFields.join(', ')}`);
        console.log('');

        const control = await runLeg({ page, iterations: CONTROL_ITERATIONS });
        reportLeg('CONTROL (in budget)', control);
        console.log('');

        const overload = await runLeg({ page, iterations: OVERLOAD_ITERATIONS });
        reportLeg('OVERLOAD (deliberately over budget)', overload);
        console.log('');
        console.log(`  performance in AudioWorkletGlobalScope : ${String(overload.hasPerformanceClock)}`);
        console.log('');

        const verdicts = collectVerdicts({ support, control, overload });
        const exitCode = reportVerdicts(verdicts);
        if (exitCode !== 0) {
            process.exitCode = exitCode;
            return;
        }

        console.log(
            `OBSERVED: ${String(overload.underrunEvents)} real deadline misses ` +
                `(${overload.underrunDuration.toFixed(3)} s of output the sink had to cover itself) ` +
                'under an over-budget worklet, and none under an in-budget one.'
        );
    } finally {
        await browser.close();
    }
}

await main();
