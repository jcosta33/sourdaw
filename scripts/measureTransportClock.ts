/**
 * How precisely can this target place a scheduled event, and what does the
 * current transport clock actually lose?
 *
 * Phase 3 of the remediation programme ("one clock") has to choose between
 * re-deriving the playhead from `AudioContext.currentTime` every tick and
 * keeping the present integrator with a reconciliation step. The programme
 * forbids arguing that before the numbers exist, for a stated reason: a prior
 * campaign argued from Rust source line count that a DSP was cheap to relocate
 * and was wrong by roughly fifty times. `crates/daw-dsp/benches/quantum.rs`
 * records both the number and the lesson. This harness is the instrument that
 * lesson demands, for the clock instead of the DSP.
 *
 * The budget it measures against is already stated by the programme and is not
 * this file's to invent: **scheduled-event placement error <= 1 sample against
 * the tempo-map integral, and inter-track skew for the same beat = 0 samples.**
 * One sample at 48 kHz is 20.833 us.
 *
 * Why jsdom cannot answer any of this
 * -----------------------------------
 * Two of the three quantities are properties of the browser, not of our source.
 * `AudioContext.currentTime` is quantised by Chrome to the render quantum and
 * jsdom has no AudioContext at all; worker `setInterval` delivery latency is a
 * property of the real event loop under real contention, and a Vitest
 * `performance.now()` figure measures the harness. So this runs in installed
 * stable Chrome through Playwright, and refuses rather than guesses when it
 * cannot.
 *
 * The worker under test is the product's own
 * ------------------------------------------
 * `src/modules/Transport/workers/schedulerWorker.ts` is read off disk and type-
 * stripped with `node:module`'s `stripTypeScriptTypes` — no transpiler, no
 * rewrite, no second copy to drift. If the product's worker changes, this
 * measures the changed one. A harness that measures a paraphrase of the code is
 * measuring the paraphrase.
 *
 * What each leg establishes
 * -------------------------
 * GRANULARITY — the floor. Polls `currentTime` in a tight loop and reports the
 *   smallest non-zero step it ever advances by, across latency hints and sample
 *   rates. No scheme can place an event more precisely than the clock it reads
 *   resolves, so this number bounds every design under discussion equally.
 *   Chrome is expected to quantise to 128 frames; the leg measures rather than
 *   assumes it, and prints the frame count it implies.
 *
 * TICK — the distribution. Runs the real scheduler worker at the product's
 *   default grain and records, on the main thread, per delivered message:
 *   inter-arrival interval, delivery lateness against the worker's own
 *   `scheduledAtMs`, the sequence jump (the worker coalesces missed intervals
 *   into one message), and the `ctx.currentTime` delta the scheduler's
 *   `runTick` would have computed from that message. p50/p95/p99/max, under
 *   three named load conditions. An idle-machine figure answers nothing, so
 *   IDLE is reported only as the control that makes the loaded figures legible.
 *
 * CLAMP — the loss. `startPlayheadScheduler.ts:195` is
 *   `Math.max(0, Math.min(rawDeltaSec, MAX_DELTA_SECONDS))` with
 *   `MAX_DELTA_SECONDS = SCHEDULE_AHEAD_SECONDS = 0.1`. Every second of real
 *   time beyond 100 ms in one tick is discarded and never recovered — the
 *   integrator has no reconciliation against `currentTime`, only this delta.
 *   The leg induces main-thread stalls of known length and reports the measured
 *   `rawDeltaSec` and the measured shortfall `rawDeltaSec - clamped`. The
 *   shortfall is observed, not predicted from reading the clamp.
 *
 * What it does not establish. It says nothing about Yeast generator phase
 * drift, which has no wall clock in it at all and is measured deterministically
 * by `scripts/measureYeastGeneratorDrift.ts` instead. It also does not observe
 * inter-track skew; that needs the events themselves, not the clock.
 *
 * Exit codes follow `scripts/measureRenderDeadline.ts`, for the same reason:
 * "I could not measure this" and "I measured it and it is outside budget" are
 * different claims and must not share a code.
 *
 *   0  MEASURED   — conditions were fit; the report is the result.
 *   2  NOT MEASURED — installed stable Chrome was unavailable, or the control
 *                     leg found the box too contended to attribute anything to
 *                     the product.
 *
 * There is deliberately no exit 1. This harness reports a distribution and a
 * margin against a budget; it does not own the verdict on whether the transport
 * is acceptable, because that verdict belongs to the design decision it feeds.
 *
 * Usage: `pnpm transport:clock` (add `--headed` to watch it, `--json` for the
 * raw sample arrays). A number without its machine is not a measurement, so the
 * report prints the host CPU, the load average, the browser build, and the
 * sample rate it actually got.
 */

import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { arch, cpus, loadavg, platform, release } from 'node:os';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium, type Browser, type Page } from 'playwright';

import { launchRenderDeadlineBrowser } from './renderDeadlineBrowser.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCHEDULER_WORKER_SOURCE = resolve(HERE, '../src/modules/Transport/workers/schedulerWorker.ts');

/** `TransportState.ts:38` — the grain the product actually ships. */
const DEFAULT_SCHEDULE_GRAIN_MS = 10;
/** `startPlayheadScheduler.ts:40-111` — look-ahead, and the delta clamp reusing it. */
const MAX_DELTA_SECONDS = 0.1;
/** The rate every sample-domain figure is expressed in when the device differs. */
const REFERENCE_SAMPLE_RATE = 48_000;
/** The programme's placement budget. One sample at 48 kHz, in milliseconds. */
const PLACEMENT_BUDGET_MS = (1 / REFERENCE_SAMPLE_RATE) * 1000;

/** How long each tick-jitter condition runs. 6 s at a 10 ms grain is ~600 ticks. */
const TICK_MEASURE_MS = 6_000;
/** How long the granularity poll spins per context configuration. */
const GRANULARITY_POLL_MS = 1_200;

/**
 * The synthetic UI load. A rAF-driven spin of this length every frame is the
 * shape of a DAW main thread doing timeline redraw plus meter updates: it never
 * blocks longer than a frame, but it leaves the event loop busy most of the
 * time. Named and printed with every figure, because "under UI load" without
 * the load stated is not a measurement.
 */
const UI_LOAD_SPIN_MS = 12;
/** The periodic longer burst layered on top — a layout/GC-shaped hitch. */
const UI_LOAD_BURST_MS = 50;
const UI_LOAD_BURST_PERIOD_MS = 500;

/** Stall lengths for the CLAMP leg. All are over the 100 ms clamp. */
const STALL_LENGTHS_MS = [150, 250, 500, 1_000];
const STALL_PERIOD_MS = 1_200;

/**
 * Control-leg ceiling on idle inter-arrival p99, in milliseconds above grain.
 * A box that cannot deliver a 10 ms worker tick within this while doing nothing
 * cannot support any claim about what UI load costs. Do not widen it to make a
 * contended machine produce a number; the point of the control is to refuse.
 */
const CONTROL_MAX_IDLE_P99_EXCESS_MS = 8;

/** Advisory only — printed and warned about, never a gate. See measureRenderDeadline.ts. */
const ADVISORY_LOAD_PER_CORE = 1.5;

const EXIT_NOT_MEASURED = 2;

const PROBE_ORIGIN = 'https://transport-clock-probe.invalid';

type Percentiles = {
    samples: number;
    p50: number;
    p95: number;
    p99: number;
    max: number;
    min: number;
    mean: number;
};

function percentiles(values: readonly number[]): Percentiles {
    if (values.length === 0) {
        return { samples: 0, p50: 0, p95: 0, p99: 0, max: 0, min: 0, mean: 0 };
    }
    const sorted = [...values].sort((a, b) => a - b);
    const at = (fraction: number): number => {
        const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1));
        return sorted[index] ?? 0;
    };
    const total = sorted.reduce((sum, value) => sum + value, 0);
    return {
        samples: sorted.length,
        p50: at(0.5),
        p95: at(0.95),
        p99: at(0.99),
        max: sorted[sorted.length - 1] ?? 0,
        min: sorted[0] ?? 0,
        mean: total / sorted.length,
    };
}

function formatMs(value: number): string {
    return `${value.toFixed(3)} ms`;
}

type TickSample = {
    interArrivalMs: number;
    deliveryLatenessMs: number;
    workerWakeLatenessMs: number;
    sequenceJump: number;
    currentTimeDeltaSec: number;
};

type TickRun = {
    condition: string;
    loadDescription: string;
    sampleRate: number;
    baseLatencySec: number;
    outputLatencySec: number;
    samples: TickSample[];
};

type GranularityRun = {
    label: string;
    requestedSampleRate: number | null;
    latencyHint: string | number;
    actualSampleRate: number;
    baseLatencySec: number;
    outputLatencySec: number;
    /** Smallest non-zero advance ever observed in `currentTime`. */
    minStepSec: number;
    /** The advance that occurred most often — the quantum, when there is one. */
    modalStepSec: number;
    distinctSteps: number;
    polls: number;
    advances: number;
};

/**
 * The probe page. Everything it does is driven from Node by `page.evaluate`;
 * the document only exists so there is a realtime `AudioContext` and a same-
 * origin place to construct a module worker from a blob.
 */
const PROBE_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><title>transport clock probe</title></head>
<body><h1>transport clock probe</h1></body></html>`;

async function measureGranularity(page: Page): Promise<GranularityRun[]> {
    return page.evaluate(async (pollMs: number) => {
        type Config = {
            label: string;
            sampleRate: number | null;
            latencyHint: AudioContextLatencyCategory | number;
        };
        const configs: Config[] = [
            { label: 'product default (interactive, device rate)', sampleRate: null, latencyHint: 'interactive' },
            { label: 'highCapacity profile (playback, device rate)', sampleRate: null, latencyHint: 'playback' },
            { label: 'explicit 44100 / interactive', sampleRate: 44_100, latencyHint: 'interactive' },
            { label: 'explicit 48000 / interactive', sampleRate: 48_000, latencyHint: 'interactive' },
            { label: 'explicit 96000 / interactive', sampleRate: 96_000, latencyHint: 'interactive' },
            { label: 'explicit 48000 / latencyHint 0.001', sampleRate: 48_000, latencyHint: 0.001 },
        ];

        const results = [];
        for (const config of configs) {
            const options: AudioContextOptions = { latencyHint: config.latencyHint };
            if (config.sampleRate !== null) {
                options.sampleRate = config.sampleRate;
            }
            let ctx: AudioContext;
            try {
                ctx = new AudioContext(options);
            } catch {
                continue;
            }
            await ctx.resume();
            // Let the render thread actually start before sampling, or the
            // first observed step is a startup artefact rather than a quantum.
            await new Promise((resolve) => setTimeout(resolve, 200));

            const stepCounts = new Map<number, number>();
            let polls = 0;
            let advances = 0;
            let previous = ctx.currentTime;
            const deadline = performance.now() + pollMs;
            while (performance.now() < deadline) {
                const now = ctx.currentTime;
                polls++;
                if (now > previous) {
                    // Round to nanoseconds so float noise does not shatter the
                    // histogram into thousands of one-off buckets.
                    const step = Math.round((now - previous) * 1e9) / 1e9;
                    stepCounts.set(step, (stepCounts.get(step) ?? 0) + 1);
                    advances++;
                    previous = now;
                }
            }

            let minStep = Infinity;
            let modalStep = 0;
            let modalCount = 0;
            for (const [step, count] of stepCounts) {
                if (step < minStep) {
                    minStep = step;
                }
                if (count > modalCount) {
                    modalCount = count;
                    modalStep = step;
                }
            }

            results.push({
                label: config.label,
                requestedSampleRate: config.sampleRate,
                latencyHint: config.latencyHint,
                actualSampleRate: ctx.sampleRate,
                baseLatencySec: ctx.baseLatency,
                outputLatencySec: ctx.outputLatency,
                minStepSec: Number.isFinite(minStep) ? minStep : 0,
                modalStepSec: modalStep,
                distinctSteps: stepCounts.size,
                polls,
                advances,
            });
            await ctx.close();
        }
        return results;
    }, GRANULARITY_POLL_MS);
}

type LoadCondition = 'idle' | 'ui-load' | 'stall';

async function measureTicks(
    page: Page,
    condition: LoadCondition,
    loadDescription: string,
    stallMs: number
): Promise<TickRun> {
    const samples = await page.evaluate(
        async (input: {
            condition: string;
            durationMs: number;
            stallMs: number;
            stallPeriodMs: number;
            spinMs: number;
            burstMs: number;
            burstPeriodMs: number;
        }) => {
            const candidate: unknown = Reflect.get(globalThis, '__clockProbe');
            if (typeof candidate !== 'object' || candidate === null) {
                throw new TypeError('probe globals absent — addInitScript did not run');
            }
            if (!('workerSource' in candidate) || !('grainMs' in candidate)) {
                throw new TypeError('probe globals malformed');
            }
            const { workerSource, grainMs } = candidate;
            if (typeof workerSource !== 'string' || typeof grainMs !== 'number') {
                throw new TypeError('probe globals have the wrong shape');
            }
            const probe = { workerSource, grainMs };
            const ctx = new AudioContext({ latencyHint: 'interactive' });
            await ctx.resume();

            const blob = new Blob([probe.workerSource], { type: 'text/javascript' });
            const url = URL.createObjectURL(blob);
            const worker = new Worker(url, { type: 'module' });

            const epochNow = (): number => performance.timeOrigin + performance.now();
            const spin = (ms: number): void => {
                const until = performance.now() + ms;
                // A deliberate synchronous burn. `while` on the clock is the
                // only portable way to hold the main thread for a known span.
                while (performance.now() < until) {
                    /* hold the thread */
                }
            };

            const collected: {
                interArrivalMs: number;
                deliveryLatenessMs: number;
                workerWakeLatenessMs: number;
                sequenceJump: number;
                currentTimeDeltaSec: number;
            }[] = [];
            let previousReceived = 0;
            let previousSequence = 0;
            let previousCurrentTime = 0;

            worker.onmessage = (event: MessageEvent<unknown>) => {
                const receivedAtMs = epochNow();
                const currentTime = ctx.currentTime;
                const data = event.data;
                if (typeof data !== 'object' || data === null || !('type' in data) || data.type !== 'tick') {
                    return;
                }
                if (!('sequence' in data) || !('scheduledAtMs' in data) || !('sentAtMs' in data)) {
                    return;
                }
                const { sequence, scheduledAtMs, sentAtMs } = data;
                if (typeof sequence !== 'number' || typeof scheduledAtMs !== 'number' || typeof sentAtMs !== 'number') {
                    return;
                }
                const tick = { sequence, scheduledAtMs, sentAtMs };
                if (previousReceived !== 0) {
                    collected.push({
                        interArrivalMs: receivedAtMs - previousReceived,
                        deliveryLatenessMs: receivedAtMs - tick.scheduledAtMs,
                        workerWakeLatenessMs: tick.sentAtMs - tick.scheduledAtMs,
                        sequenceJump: tick.sequence - previousSequence,
                        currentTimeDeltaSec: currentTime - previousCurrentTime,
                    });
                }
                previousReceived = receivedAtMs;
                previousSequence = tick.sequence;
                previousCurrentTime = currentTime;
            };

            worker.postMessage({ type: 'start', interval: probe.grainMs, generation: 1 });

            let rafHandle = 0;
            let stallTimer: ReturnType<typeof setInterval> | null = null;
            if (input.condition === 'ui-load') {
                let lastBurst = performance.now();
                const frame = (): void => {
                    spin(input.spinMs);
                    if (performance.now() - lastBurst >= input.burstPeriodMs) {
                        lastBurst = performance.now();
                        spin(input.burstMs);
                    }
                    rafHandle = requestAnimationFrame(frame);
                };
                rafHandle = requestAnimationFrame(frame);
            }
            if (input.condition === 'stall') {
                stallTimer = setInterval(() => spin(input.stallMs), input.stallPeriodMs);
            }

            await new Promise((resolve) => setTimeout(resolve, input.durationMs));

            if (rafHandle !== 0) {
                cancelAnimationFrame(rafHandle);
            }
            if (stallTimer !== null) {
                clearInterval(stallTimer);
            }
            worker.postMessage({ type: 'stop' });
            worker.terminate();
            URL.revokeObjectURL(url);

            const meta = {
                sampleRate: ctx.sampleRate,
                baseLatencySec: ctx.baseLatency,
                outputLatencySec: ctx.outputLatency,
            };
            await ctx.close();
            return { collected, meta };
        },
        {
            condition,
            durationMs: TICK_MEASURE_MS,
            stallMs,
            stallPeriodMs: STALL_PERIOD_MS,
            spinMs: UI_LOAD_SPIN_MS,
            burstMs: UI_LOAD_BURST_MS,
            burstPeriodMs: UI_LOAD_BURST_PERIOD_MS,
        }
    );

    return {
        condition,
        loadDescription,
        sampleRate: samples.meta.sampleRate,
        baseLatencySec: samples.meta.baseLatencySec,
        outputLatencySec: samples.meta.outputLatencySec,
        samples: samples.collected,
    };
}

function reportTickRun(run: TickRun): Percentiles {
    const interArrival = percentiles(run.samples.map((sample) => sample.interArrivalMs));
    const lateness = percentiles(run.samples.map((sample) => sample.deliveryLatenessMs));
    const wake = percentiles(run.samples.map((sample) => sample.workerWakeLatenessMs));
    const coalesced = run.samples.filter((sample) => sample.sequenceJump > 1).length;

    process.stdout.write(`\n  ${run.condition.toUpperCase()} — ${run.loadDescription}\n`);
    process.stdout.write(`    ticks observed              ${interArrival.samples}\n`);
    process.stdout.write(
        `    inter-arrival interval      p50 ${formatMs(interArrival.p50)}  p95 ${formatMs(interArrival.p95)}  p99 ${formatMs(interArrival.p99)}  worst ${formatMs(interArrival.max)}\n`
    );
    process.stdout.write(
        `    main-thread delivery late   p50 ${formatMs(lateness.p50)}  p95 ${formatMs(lateness.p95)}  p99 ${formatMs(lateness.p99)}  worst ${formatMs(lateness.max)}\n`
    );
    process.stdout.write(
        `    worker wake lateness        p50 ${formatMs(wake.p50)}  p95 ${formatMs(wake.p95)}  p99 ${formatMs(wake.p99)}  worst ${formatMs(wake.max)}\n`
    );
    process.stdout.write(
        `    coalesced messages          ${coalesced} of ${interArrival.samples} carried more than one grain\n`
    );
    return interArrival;
}

function reportClamp(run: TickRun, stallMs: number): void {
    const overBudget = run.samples.filter((sample) => sample.currentTimeDeltaSec > MAX_DELTA_SECONDS);
    const shortfalls = overBudget.map((sample) => sample.currentTimeDeltaSec - MAX_DELTA_SECONDS);
    const rawDeltas = overBudget.map((sample) => sample.currentTimeDeltaSec);
    const totalLostSec = shortfalls.reduce((sum, value) => sum + value, 0);
    const raw = percentiles(rawDeltas);
    const lost = percentiles(shortfalls);

    process.stdout.write(`\n  STALL ${stallMs} ms every ${STALL_PERIOD_MS} ms\n`);
    process.stdout.write(
        `    ticks whose currentTime delta exceeded the ${MAX_DELTA_SECONDS * 1000} ms clamp: ${overBudget.length}\n`
    );
    if (overBudget.length === 0) {
        process.stdout.write('    no clamped tick observed — the stall did not reach the scheduler\n');
        return;
    }
    process.stdout.write(
        `    measured raw delta          p50 ${formatMs(raw.p50 * 1000)}  worst ${formatMs(raw.max * 1000)}\n`
    );
    process.stdout.write(
        `    wall time discarded / tick  p50 ${formatMs(lost.p50 * 1000)}  worst ${formatMs(lost.max * 1000)}\n`
    );
    process.stdout.write(
        `    total discarded over ${(TICK_MEASURE_MS / 1000).toFixed(0)} s   ${formatMs(totalLostSec * 1000)}` +
            ` (${((totalLostSec / (TICK_MEASURE_MS / 1000)) * 100).toFixed(2)}% of elapsed)\n`
    );
    process.stdout.write(
        `    at 120 BPM that is         ${(totalLostSec * 2).toFixed(4)} beats the playhead never advanced\n`
    );
}

async function main(): Promise<void> {
    const headed = process.argv.includes('--headed');
    const emitJson = process.argv.includes('--json');

    const cores = cpus().length;
    const [load1] = loadavg();
    const loadPerCore = (load1 ?? 0) / Math.max(1, cores);

    process.stdout.write('Transport clock measurement\n');
    process.stdout.write('===========================\n');
    process.stdout.write(`host              ${platform()} ${release()} ${arch()}, ${cores} logical cores\n`);
    process.stdout.write(`load average (1m) ${(load1 ?? 0).toFixed(2)} (${loadPerCore.toFixed(2)} per core)\n`);
    if (loadPerCore > ADVISORY_LOAD_PER_CORE) {
        process.stdout.write('WARNING: the box is contended. Tick figures below include that contention.\n');
    }
    process.stdout.write(`grain under test  ${DEFAULT_SCHEDULE_GRAIN_MS} ms (TransportState.ts:38)\n`);
    process.stdout.write(
        `placement budget  ${PLACEMENT_BUDGET_MS.toFixed(5)} ms (1 sample at ${REFERENCE_SAMPLE_RATE} Hz)\n`
    );

    const launched = await launchRenderDeadlineBrowser<Browser>({
        headed,
        launchBrowser: (options) => chromium.launch(options),
    });
    if (launched.status === 'not-measured') {
        process.stdout.write('\nNOT MEASURED: installed stable Chrome is unavailable.\n');
        process.exitCode = EXIT_NOT_MEASURED;
        return;
    }
    const browser = launched.browser;

    try {
        process.stdout.write(`browser           ${browser.version()}\n`);

        const workerSource = stripTypeScriptTypes(readFileSync(SCHEDULER_WORKER_SOURCE, 'utf8'), {
            mode: 'strip',
        });

        const page = await browser.newPage();
        await page.route(`${PROBE_ORIGIN}/**`, (route) =>
            route.fulfill({ status: 200, contentType: 'text/html', body: PROBE_HTML })
        );
        await page.addInitScript(
            (input: { workerSource: string; grainMs: number }) => {
                Reflect.set(globalThis, '__clockProbe', input);
            },
            { workerSource, grainMs: DEFAULT_SCHEDULE_GRAIN_MS }
        );
        await page.goto(`${PROBE_ORIGIN}/`);

        process.stdout.write('\n--- LEG 1: AudioContext.currentTime granularity ---\n');
        process.stdout.write('The floor. No scheme places an event finer than the clock it reads resolves.\n');
        const granularity = await measureGranularity(page);
        for (const run of granularity) {
            const frames = run.modalStepSec * run.actualSampleRate;
            process.stdout.write(`\n  ${run.label}\n`);
            process.stdout.write(
                `    actual rate ${run.actualSampleRate} Hz   baseLatency ${(run.baseLatencySec * 1000).toFixed(3)} ms   outputLatency ${(run.outputLatencySec * 1000).toFixed(3)} ms\n`
            );
            process.stdout.write(
                `    modal step  ${formatMs(run.modalStepSec * 1000)}  = ${frames.toFixed(1)} frames   (min step ${formatMs(run.minStepSec * 1000)}, ${run.distinctSteps} distinct, ${run.advances} advances in ${run.polls} polls)\n`
            );
            process.stdout.write(
                `    vs 1-sample budget: ${((run.modalStepSec * 1000) / PLACEMENT_BUDGET_MS).toFixed(0)}x coarser\n`
            );
        }

        process.stdout.write('\n--- LEG 2: worker tick jitter ---\n');
        process.stdout.write(`The real ${basename(SCHEDULER_WORKER_SOURCE)}, type-stripped, at the shipped grain.\n`);

        const idle = await measureTicks(page, 'idle', 'no main-thread work beyond the probe itself', 0);
        const idleStats = reportTickRun(idle);

        const uiLoad = await measureTicks(
            page,
            'ui-load',
            `${UI_LOAD_SPIN_MS} ms synchronous spin every animation frame, plus a ${UI_LOAD_BURST_MS} ms burst every ${UI_LOAD_BURST_PERIOD_MS} ms`,
            0
        );
        reportTickRun(uiLoad);

        process.stdout.write('\n--- LEG 3: the delta clamp, and what it discards ---\n');
        process.stdout.write(
            'startPlayheadScheduler.ts:195 clamps the per-tick advance to 100 ms and never reconciles.\n'
        );
        const stallRuns: TickRun[] = [];
        for (const stallMs of STALL_LENGTHS_MS) {
            const run = await measureTicks(page, 'stall', `${stallMs} ms block every ${STALL_PERIOD_MS} ms`, stallMs);
            stallRuns.push(run);
            reportClamp(run, stallMs);
        }

        process.stdout.write('\n--- CONTROL ---\n');
        const idleExcess = idleStats.p99 - DEFAULT_SCHEDULE_GRAIN_MS;
        process.stdout.write(
            `idle inter-arrival p99 exceeds grain by ${formatMs(idleExcess)} (ceiling ${formatMs(CONTROL_MAX_IDLE_P99_EXCESS_MS)})\n`
        );
        if (idleExcess > CONTROL_MAX_IDLE_P99_EXCESS_MS) {
            process.stdout.write(
                'NOT MEASURED: the box could not deliver an idle 10 ms tick. Nothing above is attributable to the product.\n'
            );
            process.exitCode = EXIT_NOT_MEASURED;
            return;
        }
        process.stdout.write('control passed — the loaded figures are attributable to the load, not the box.\n');

        if (emitJson) {
            process.stdout.write(`\n${JSON.stringify({ granularity, runs: [idle, uiLoad, ...stallRuns] }, null, 2)}\n`);
        }
    } finally {
        await browser.close();
    }
}

await main();
