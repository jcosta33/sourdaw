#!/usr/bin/env node
/**
 * Runner for the wasm leg of the per-quantum device cost table.
 *
 *     node crates/daw-dsp/benches/wasm/run.mjs [--warmup N] [--measure N] [--json out.json]
 *
 * Drives every device's committed wasm build inside a real
 * `AudioWorkletGlobalScope` in Google Chrome and prints the same distribution
 * the native leg in `benches/quantum.rs` prints, so the two columns of the
 * table are comparable line for line.
 *
 * Why this exists as its own runner rather than as part of `cargo bench`: a
 * native number is a lower bound, not the answer. Production compiles this DSP
 * to wasm and runs it in a browser worklet, and the wasm/native ratio is not a
 * constant — it ranges from below 1 to about 1.8 across this table, so it
 * cannot be carried from one device to another.
 *
 * # Where a cost is charged
 *
 * Rows are separated by production **cost site** rather than lumped into one
 * budget. Grand Boule renders on a Worker; this harness times the same kernel
 * in its worklet realm, while the ring consumer carries the audio-thread cost.
 * See `COST_SITE` in `deviceRecipes.js`.
 *
 * # The clock
 *
 * **Chrome exposes no `performance` inside an `AudioWorkletGlobalScope`** —
 * probed on Chrome 150, the only clock-shaped globals there are `Date` (1 ms)
 * and `currentTime` (the audio clock, which advances by exactly one quantum per
 * render call however long that call took). The worklet therefore reads a
 * shared-memory tick counter driven by a spinning worker; see `tickClock.js`.
 *
 * The rate is calibrated **inside** each row's timed window, in segments, and
 * the per-row spread of those segment rates is published. A single before/after
 * pair is not a measure of accuracy: reproduced in Node against a real
 * `performance.now()`, this mechanism reported +0.59% before/after drift on a
 * run whose median was off +8.6% and p95 off +12.4%, and +14.10% drift at a
 * load below the ceiling. Everything published is therefore two significant
 * figures.
 *
 * # The floor is the primary figure
 *
 * This machine is never quiet. The desktop it runs on sustains a load average
 * of 20-45 from ordinary applications, and an earlier version of this harness
 * gated on load and therefore never produced a table at all.
 *
 * The way out is one-directional and it is what makes the result sound:
 * **contention only ever adds time to a sample, it never removes it.** So over
 * enough samples the low end of the distribution is a genuine *lower bound* on
 * the device's cost, obtainable on a busy machine, while the median and the
 * percentiles from the same run are *upper bounds* contaminated by scheduling
 * rather than properties of the DSP. This repository has learned this once
 * already: expensive rows retain a stable low percentile while scheduling
 * contention inflates their medians.
 *
 * There is exactly one mechanism by which a sample can read *shorter* than the
 * truth, and it is counted rather than assumed away: the clock is a counter
 * another thread increments, so if that thread is descheduled for the whole of
 * a render the counter does not move and the sample reads zero. That is why the
 * published floor is the **1st percentile** and not the raw minimum, and why
 * both are reported along with the count of zero-tick samples. If the two agree
 * the mechanism is not biting.
 *
 * What a floor can and cannot decide:
 *
 * - **If the floor exceeds budget, that is decisive** — the device cannot fit,
 *   and no quieter machine will change it.
 * - **If the floor fits, that does not prove the device fits under real load.**
 *   It bounds the compute, not the deadline. The instrument for the deadline
 *   question is AC-3's dropout observation, which takes genuine underruns from
 *   `AudioContext.playbackStats` on a live context and is hardware-independent
 *   enough to run contended. The two answer different questions and neither
 *   substitutes for the other.
 *
 * # Gates
 *
 * Evaluated **before** anything is printed:
 *
 * - the page must be cross-origin isolated, or there is no `SharedArrayBuffer`
 *   and so no clock at all;
 * - each row's compute must fit inside its own independently-measured
 *   main-thread wall clock — a bound the worklet's own clock cannot fake;
 * - each row's tick rate must hold steady across its own timed window;
 * - each row's occupancy check must pass at both ends of the timed run.
 *
 * The machine load is **recorded per row, not gated**. The rate-spread gate is
 * what actually catches a clock that cannot be trusted; the load gate was a
 * proxy for it, and on this machine it blocked the measurement entirely.
 */

import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import os from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright';

import { COST_SITE, DUTY_CYCLE } from './deviceRecipes.js';
import { startServer } from './server.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../../..');

/** 128 frames at 48 kHz, in milliseconds — the deadline every figure is read against. */
const BUDGET_MS = (128 / 48_000) * 1000;

/**
 * Quanta rendered untimed before the timed run, per device.
 *
 * V8 compiles wasm with Liftoff first and re-tiers hot functions to TurboFan in
 * the background; the JS around the call goes through its own Ignition →
 * Sparkplug → Maglev → TurboFan ladder. The warm-up runs the *identical* loop
 * body to the timed pass, clock reads included, and discards its samples:
 * warming up through a cheaper loop warms the DSP but not the loop.
 */
const DEFAULT_WARMUP_QUANTA = 4_000;

/**
 * Timed quanta per device. 20 000 x 128 frames is 53 s of rendered audio.
 * Still not a worst case — a session renders ~1.7M quanta an hour.
 */
const DEFAULT_MEASURE_QUANTA = 20_000;

/**
 * Wall-clock length of a calibration segment, in milliseconds. `Date.now()` has
 * 1 ms granularity, so a segment this long bounds the per-segment rate error at
 * roughly 0.2% — well under the real dispersion of the spin rate.
 */
const DEFAULT_SEGMENT_TARGET_MS = 1_000;

/**
 * A row whose first-500 and last-500 means differ by more than this is not
 * stationary, and its median is a bound rather than a steady state.
 */
const STATIONARITY_TOLERANCE_PCT = 10;

/**
 * The quantile published as the contention-free floor.
 *
 * Not the raw minimum: a render that lands entirely inside a stall of the
 * spinning clock thread reads zero ticks, so the extreme low end can be
 * dragged below the truth by the one mechanism that shortens a sample. Over
 * 20 000 samples the 1st percentile is the 200th smallest, which is robust to
 * that while still sitting far below anything scheduling can inflate. Both this
 * and the raw minimum are reported; if they agree, the stall mechanism is not
 * biting.
 */
const FLOOR_QUANTILE = 0.01;

/**
 * Spread of in-window segment rates above which a row's **median** is not worth
 * reading even as a contaminated upper bound.
 *
 * Soft: it annotates the row, it does not fail the run. The floor is what this
 * harness publishes, and the floor is robust to rate spread in a way the median
 * is not. A segment in which the spinning clock thread was starved measures a
 * *low* rate, so its samples convert to *larger* milliseconds — they inflate the
 * median and cannot touch the floor, which is drawn from the segments where the
 * clock ran cleanly.
 */
const MEDIAN_TRUSTWORTHY_SPREAD_PCT = 25;

/**
 * Spread above which the segmentation itself is meaningless and even a floor is
 * not supportable. Hard gate.
 */
const MAX_CALIBRATION_SPREAD_PCT = 150;

/**
 * Fraction of samples that may read zero ticks before this row's **floor** stops
 * being measurable.
 *
 * A render that lands entirely inside a stall of the spinning clock thread reads
 * zero, and that is the only way contention can make a sample look *shorter*
 * than the truth — the one direction that corrupts a floor. Everything else
 * contention does adds time.
 *
 * Measured on this machine at load 20-45, the zero-tick fraction tracks render
 * length: the shorter the render, the likelier it falls entirely inside a
 * stall. So on a
 * contended machine **the floor is measurable for expensive devices and not for
 * cheap ones**, and pretending otherwise would publish a floor that is really a
 * record of how starved the clock was.
 *
 * A row over this threshold reports no floor. It still reports its contaminated
 * median, which remains a valid *upper* bound — see the note on bounds below.
 */
const MAX_ZERO_TICK_FRACTION = 0.01;

/**
 * Fraction of zero-tick samples above which even the median is unusable,
 * because zeros have reached far enough up the distribution to move it.
 */
const MAX_ZERO_TICK_FRACTION_FOR_MEDIAN = 0.4;

/**
 * Tolerance on "compute must fit inside the elapsed wall clock".
 *
 * A device that dominates its own context legitimately approaches a ratio of
 * 1.0 because almost no wall clock remains outside its own render calls. The
 * clock is known to hold the median to roughly +/-10%,
 * so the gate allows that much overshoot before calling the rate inflated; what
 * it is there to catch is a rate wrong by a factor, not by a percent.
 */
const WALL_RATIO_TOLERANCE = 1.15;

function parseArgs(argv) {
    const options = {
        warmupQuanta: DEFAULT_WARMUP_QUANTA,
        measureQuanta: DEFAULT_MEASURE_QUANTA,
        segmentTargetMs: DEFAULT_SEGMENT_TARGET_MS,
        json: null,
        headed: false,
        // Subset runs are for investigating one question. A partial run is not
        // a table: its rows were taken in a different order, on a different
        // machine state, from the ones already in `quantum-cost-table.md`.
        deviceIds: [],
    };
    for (let i = 0; i < argv.length; i += 1) {
        const flag = argv[i];
        if (flag === '--warmup') {
            options.warmupQuanta = Number(argv[++i]);
        } else if (flag === '--measure') {
            options.measureQuanta = Number(argv[++i]);
        } else if (flag === '--segment-ms') {
            options.segmentTargetMs = Number(argv[++i]);
        } else if (flag === '--json') {
            options.json = argv[++i];
        } else if (flag === '--devices') {
            options.deviceIds = String(argv[++i])
                .split(',')
                .map((id) => id.trim())
                .filter((id) => id.length > 0);
        } else if (flag === '--headed') {
            options.headed = true;
        } else {
            throw new Error(`unknown flag: ${flag}`);
        }
    }
    return options;
}

function quantile(sorted, fraction) {
    if (sorted.length === 0) {
        return Number.NaN;
    }
    const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1));
    return sorted[index];
}

const meanOf = (values) => values.reduce((total, value) => total + value, 0) / values.length;

function summarise(samplesMs) {
    const sorted = Float64Array.from(samplesMs).sort();
    return {
        n: samplesMs.length,
        mean: meanOf(samplesMs),
        floor: quantile(sorted, FLOOR_QUANTILE),
        median: quantile(sorted, 0.5),
        p95: quantile(sorted, 0.95),
        p99: quantile(sorted, 0.99),
        p999: quantile(sorted, 0.999),
        max: sorted[sorted.length - 1],
        min: sorted[0],
        firstFiveHundredMean: meanOf(samplesMs.slice(0, 500)),
        lastFiveHundredMean: meanOf(samplesMs.slice(-500)),
    };
}

/**
 * Split a duty-cycled row into its two modes.
 *
 * The expensive mode fires once per `periodQuanta`, so the top `1/period`
 * fraction of samples *is* the tick. Reporting a period, a tick cost and an
 * amortised mean says what the device does; reporting a p95 says where the duty
 * cycle happens to sit relative to 95%, which is a fact about the percentile
 * and not about the device.
 */
function dutyCycleSplit(samplesMs, periodQuanta) {
    const sorted = Array.from(samplesMs).sort((a, b) => a - b);
    const tickCount = Math.max(1, Math.round(sorted.length / periodQuanta));
    const ticks = sorted.slice(sorted.length - tickCount);
    const rest = sorted.slice(0, sorted.length - tickCount);
    return {
        periodQuanta,
        dutyPct: 100 / periodQuanta,
        // The cheapest tick observed is the tick's own contention-free floor,
        // for the same reason the row floor is: nothing makes a render faster.
        tickFloorMs: ticks[0],
        tickCostMs: meanOf(ticks),
        idleFloorMs: rest.length > 0 ? rest[0] : 0,
        idleCostMs: rest.length > 0 ? meanOf(rest) : 0,
        amortisedMeanMs: meanOf(sorted),
        amortisedFloorMs: rest.length > 0 ? rest[0] + (ticks[0] - rest[0]) / periodQuanta : ticks[0] / periodQuanta,
    };
}

function machineRecord() {
    const read = (bin, args) => {
        try {
            return execFileSync(bin, args, { encoding: 'utf8' }).trim();
        } catch {
            return 'unavailable';
        }
    };
    return {
        cpu: os.cpus()[0]?.model ?? 'unknown',
        logicalCores: os.cpus().length,
        arch: process.arch,
        platform: `${process.platform} ${os.release()}`,
        memoryGb: Number((os.totalmem() / 1024 ** 3).toFixed(1)),
        hardwareModel: read('/usr/sbin/sysctl', ['-n', 'hw.model']),
        performanceCores: read('/usr/sbin/sysctl', ['-n', 'hw.perflevel0.physicalcpu']),
        efficiencyCores: read('/usr/sbin/sysctl', ['-n', 'hw.perflevel1.physicalcpu']),
        os: `${read('/usr/bin/sw_vers', ['-productName'])} ${read('/usr/bin/sw_vers', ['-productVersion'])} (${read('/usr/bin/sw_vers', ['-buildVersion'])})`,
        gitSha: read('git', ['-C', repoRoot, 'rev-parse', 'HEAD']),
        gitBase: read('git', ['-C', repoRoot, 'rev-parse', 'HEAD~1']),
        workingTree: read('git', ['-C', repoRoot, 'status', '--porcelain']) === '' ? 'clean' : 'dirty',
        takenAt: new Date().toISOString(),
    };
}

/**
 * Load above which the run refuses to stand behind its own numbers: half the
 * logical cores.
 *
 * Here because the first full run of this table was taken while another agent
 * worktree ran the whole vitest suite — load average 25 on a 12-core machine —
 * and nothing in the output said so.
 */
function loadCeiling() {
    return os.cpus().length / 2;
}

/** Two significant figures. The mechanism does not sustain more. */
function sig2(value) {
    if (!Number.isFinite(value) || value === 0) {
        return '0';
    }
    return Number(value.toPrecision(2)).toString();
}

/**
 * The reference project, defined here because **nothing in the repository
 * defines it**, split by where each device's cost is actually charged.
 */
const REFERENCE_PROJECT_AUDIO_THREAD = [
    ['grand_boule_ring_consumer', 1],
    ['fermenter', 1],
    ['levain', 1],
    ['toaster', 1],
    ['crumbs', 1],
    ['grinder', 1],
    ['knead', 1],
    ['bacteria', 1],
    ['proof', 1],
    ['gluten', 3],
    ['proof_chamber_plate', 1],
];
const REFERENCE_PROJECT_WORKER = [['grand_boule', 1]];

async function main() {
    const options = parseArgs(process.argv.slice(2));
    const loadBefore = os.loadavg()[0];

    // Sample the load average throughout, so every row can report the
    // contention it was actually measured under. Recorded, not gated: the
    // figures this run publishes are floors, and a floor is valid under load.
    const loadTimeline = [];
    const loadSampler = setInterval(() => {
        loadTimeline.push({ atMs: Date.now(), load: os.loadavg()[0] });
    }, 1000);
    loadTimeline.push({ atMs: Date.now(), load: loadBefore });

    const server = await startServer(repoRoot);

    const browser = await chromium.launch({
        // The shipping target, not Playwright's bundled Chromium build.
        channel: 'chrome',
        headless: !options.headed,
        args: ['--autoplay-policy=no-user-gesture-required'],
    });

    let payload;
    try {
        const page = await browser.newPage();
        page.on('console', (message) => {
            if (message.type() === 'error') {
                process.stderr.write(`[page error] ${message.text()}\n`);
            }
        });
        page.on('pageerror', (error) => process.stderr.write(`[page exception] ${error.message}\n`));

        // The real path, not `/`: the page and the worklet both resolve their
        // module imports relative to the document URL.
        await page.goto(`${server.origin}/crates/daw-dsp/benches/wasm/index.html`, { waitUntil: 'load' });

        const isolated = await page.evaluate(() => self.crossOriginIsolated === true);
        if (!isolated) {
            throw new Error(
                'the page is not cross-origin isolated, so SharedArrayBuffer is unavailable and the ' +
                    'worklet has no clock at all — Chrome exposes no `performance` inside an ' +
                    'AudioWorkletGlobalScope. Fix the COOP/COEP headers in server.mjs rather than ' +
                    'publishing numbers taken some other way.'
            );
        }

        payload = await page.evaluate((config) => window.runQuantumCostTable(config), {
            warmupQuanta: options.warmupQuanta,
            measureQuanta: options.measureQuanta,
            segmentTargetMs: options.segmentTargetMs,
            deviceIds: options.deviceIds,
        });

        payload.browser = browser.version();
    } finally {
        clearInterval(loadSampler);
        await browser.close();
        await server.close();
    }
    loadTimeline.push({ atMs: Date.now(), load: os.loadavg()[0] });

    const machine = machineRecord();
    const loadAfter = os.loadavg()[0];
    const busiestLoad = Math.max(loadBefore, loadAfter);

    // -- analysis ----------------------------------------------------------
    const rows = payload.results.map((result) => {
        const rates = result.segmentRates.filter((rate) => Number.isFinite(rate) && rate > 0);
        const sortedRates = [...rates].sort((a, b) => a - b);
        const medianRate = quantile(Float64Array.from(sortedRates), 0.5);
        const rateSpreadPct =
            sortedRates.length > 1 ? ((sortedRates[sortedRates.length - 1] - sortedRates[0]) / medianRate) * 100 : 0;

        // Each sample is converted with the rate of the segment it was taken
        // in, not with one rate for the whole run.
        const samplesMs = result.samplesTicks.map((ticks, index) => {
            const rate = rates[Math.min(result.segmentIndex[index], rates.length - 1)] ?? medianRate;
            return ticks / rate;
        });
        const floorMs = result.harnessFloorTicks.map((ticks) => ticks / medianRate);

        const timedTotalMs = samplesMs.reduce((total, value) => total + value, 0);
        const warmupTotalMs = result.warmupTotalTicks / medianRate;
        const computeTotalMs = timedTotalMs + warmupTotalMs;
        // The independent reference: `performance.now()` on the main thread
        // around the whole render. The previous cross-check compared the timed
        // sum against a worklet wall clock that also covered the 4000 warm-up
        // quanta, so it tolerated ~20% overstatement and bounded understatement
        // not at all — which is the direction a starved spinner fails in. Both
        // directions are bounded now, against a clock the worklet cannot see.
        const wallRatio = computeTotalMs / result.mainThreadWallMs;

        const stats = summarise(samplesMs);
        const driftPct = (stats.lastFiveHundredMean / stats.firstFiveHundredMean - 1) * 100;

        // The load actually present while this row was being timed.
        const inWindow = loadTimeline.filter(
            (sample) => sample.atMs >= result.timedStartedAtMs && sample.atMs <= result.timedFinishedAtMs
        );
        const loadSamples = inWindow.length > 0 ? inWindow.map((sample) => sample.load) : [os.loadavg()[0]];

        return {
            id: result.id,
            label: result.label,
            note: result.note,
            costSite: COST_SITE[result.id] ?? 'unknown',
            warmVerify: result.warmVerify,
            lateVerify: result.lateVerify,
            stats,
            harnessFloor: summarise(floorMs),
            dutyCycle: DUTY_CYCLE[result.id] ? dutyCycleSplit(samplesMs, DUTY_CYCLE[result.id].periodQuanta) : null,
            dutyCycleSource: DUTY_CYCLE[result.id]?.source ?? null,
            calibration: {
                segments: rates.length,
                medianTicksPerMs: medianRate,
                minTicksPerMs: sortedRates[0],
                maxTicksPerMs: sortedRates[sortedRates.length - 1],
                spreadPct: rateSpreadPct,
            },
            timedTotalMs,
            warmupTotalMs,
            mainThreadWallMs: result.mainThreadWallMs,
            wallRatio,
            driftPct,
            stationary: Math.abs(driftPct) <= STATIONARITY_TOLERANCE_PCT,
            medianTrustworthy: rateSpreadPct <= MEDIAN_TRUSTWORTHY_SPREAD_PCT,
            zeroTickSamples: result.zeroTickSamples,
            zeroFraction: result.zeroTickSamples / stats.n,
            // A floor is only a floor if the clock was awake often enough to
            // have caught this device's cheapest render. A floor of exactly
            // zero is by definition a stall reading and never a measurement,
            // however few stalls the row recorded.
            floorMeasurable: result.zeroTickSamples / stats.n <= MAX_ZERO_TICK_FRACTION && stats.floor > 0,
            load: {
                samples: loadSamples.length,
                mean: meanOf(loadSamples),
                min: Math.min(...loadSamples),
                max: Math.max(...loadSamples),
            },
            samplesMs,
        };
    });

    const byId = Object.fromEntries(rows.map((row) => [row.id, row]));

    // -- gates, all evaluated BEFORE anything is printed --------------------
    const failures = [];
    for (const row of rows) {
        if (!row.warmVerify?.ok || !row.lateVerify?.ok) {
            failures.push(
                `${row.id}: occupancy — warm-up "${row.warmVerify?.detail}"; after run "${row.lateVerify?.detail}"`
            );
        }
        if (!(row.wallRatio <= WALL_RATIO_TOLERANCE)) {
            failures.push(
                `${row.id}: reported ${sig2(row.timedTotalMs + row.warmupTotalMs)} ms of compute inside a ` +
                    `${sig2(row.mainThreadWallMs)} ms main-thread wall clock (ratio ${row.wallRatio.toFixed(2)}, ` +
                    `tolerance ${WALL_RATIO_TOLERANCE}) — the tick rate is wrong by a factor and every figure in the row is inflated`
            );
        }
        if (row.calibration.spreadPct > MAX_CALIBRATION_SPREAD_PCT) {
            failures.push(
                `${row.id}: the tick rate moved ${row.calibration.spreadPct.toFixed(1)}% across its own timed window ` +
                    `(ceiling ${MAX_CALIBRATION_SPREAD_PCT}%) — the segmentation is meaningless, not even a floor survives`
            );
        }
        if (row.zeroFraction > MAX_ZERO_TICK_FRACTION_FOR_MEDIAN) {
            failures.push(
                `${row.id}: ${row.zeroTickSamples} of ${row.stats.n} samples read zero ticks ` +
                    `(${(row.zeroFraction * 100).toFixed(1)}%) — the clock stalled so often that even the median ` +
                    'is dragged down, so the row bounds nothing in either direction'
            );
        }
    }

    if (failures.length > 0) {
        console.error('\nNOT PUBLISHABLE — gates are evaluated before the table is printed, and these failed:\n');
        for (const failure of failures) {
            console.error(`  - ${failure}`);
        }
        console.error('');
        if (options.json !== null) {
            writeFileSync(options.json, `${JSON.stringify({ machine, failures, rows }, null, 2)}\n`);
            console.error(`wrote ${options.json} (failed run — retained so the failure is auditable)`);
        }
        process.exitCode = 1;
        return;
    }

    // -- report ------------------------------------------------------------
    const pct = (ms) => `${sig2((ms / BUDGET_MS) * 100)}%`;
    const us = (ms) => sig2(ms * 1000);

    console.log('');
    console.log('=== Per-quantum device cost — WASM in a real AudioWorkletGlobalScope ===');
    console.log('');
    console.log(
        `machine        : ${machine.cpu} (${machine.hardwareModel}), ${machine.performanceCores}P+${machine.efficiencyCores}E, ${machine.memoryGb} GB`
    );
    console.log(`os             : ${machine.os}, ${machine.arch}`);
    console.log(`browser        : ${payload.browser} (Google Chrome stable channel, headless=${!options.headed})`);
    console.log(`user agent     : ${payload.userAgent}`);
    console.log(`measured at    : ${machine.gitSha} (base ${machine.gitBase}, working tree ${machine.workingTree})`);
    console.log(`taken          : ${machine.takenAt}`);
    console.log('host           : OfflineAudioContext, one per device, 48 kHz, 128-frame quanta');
    console.log(
        `clock          : shared-memory tick counter, calibrated in-window in ~${options.segmentTargetMs} ms segments`
    );
    console.log(
        `isolation      : page crossOriginIsolated=${payload.pageCrossOriginIsolated} (required — SharedArrayBuffer is the clock)`
    );
    console.log(
        `machine load   : 1-minute average ${loadBefore.toFixed(2)} before, ${loadAfter.toFixed(2)} after (ceiling ${loadCeiling().toFixed(1)})`
    );
    console.log(`warm-up        : ${options.warmupQuanta} discarded quanta per device, identical loop body`);
    console.log(
        `samples        : ${options.measureQuanta} timed quanta per device (${((options.measureQuanta * 128) / 48_000).toFixed(1)} s of rendered audio each)`
    );
    console.log(`budget         : ${BUDGET_MS.toFixed(4)} ms = 128 frames / 48 kHz`);
    console.log('');
    console.log('BOTH COLUMNS ARE BOUNDS, IN OPPOSITE DIRECTIONS, AND BOTH ARE VALID ON A BUSY MACHINE.');
    console.log('Contention only ever adds time to a sample, never removes it. So:');
    console.log('  FLOOR  (1st pct) is a LOWER bound on what the device costs.');
    console.log('  MEDIAN taken under load is an UPPER bound on what it costs on a quiet one.');
    console.log('');
    console.log('That makes the upper bound the decisive one here: if the contaminated total already fits the');
    console.log('budget, the true total certainly fits, and no quiet machine is needed to establish it.');
    console.log('');
    console.log("Neither bounds the DEADLINE. They bound compute. Whether quanta are actually missed is AC-3's");
    console.log('observation, which reads genuine underruns from AudioContext.playbackStats on a live context.');
    console.log('');
    console.log('A floor is only reported where the clock was awake often enough to catch the cheapest render:');
    console.log('a stalled clock thread makes a short render read zero, which is the one thing that could drag');
    console.log('a floor below the truth. Rows over the stall threshold report an upper bound only.');
    console.log('');
    console.log('Two significant figures throughout: reproduced against a real performance.now(), this clock');
    console.log('holds the median to roughly +/-10% and inflates the p95 by +4% to +31% on constant work.');
    console.log('');

    const printRows = (title, members) => {
        if (members.length === 0) {
            return;
        }
        console.log(title);
        console.log(
            '  device                                            >= FLOOR |    <= UPPER | upper % | load | stalls'
        );
        for (const row of [...members].sort((a, b) => b.stats.median - a.stats.median)) {
            const st = row.stats;
            const floorCell = row.floorMeasurable ? `${us(st.floor)}us` : 'n/a';
            console.log(
                `  ${row.label.padEnd(48)} ${floorCell.padStart(8)} | ${(us(st.median) + 'us').padStart(11)} | ` +
                    `${pct(st.median).padStart(7)} | ${row.load.mean.toFixed(0).padStart(4)} | ` +
                    `${(row.zeroFraction * 100).toFixed(1)}%` +
                    `${row.stationary ? '' : '  <-- NOT STATIONARY'}`
            );
        }
        console.log('');
    };

    printRows(
        'ON THE AUDIO THREAD — these share the one 2.667 ms deadline:',
        rows.filter((row) => row.costSite === 'audio-thread')
    );
    printRows(
        'NOT ON THE AUDIO THREAD — real cost, different thread, different budget:',
        rows.filter((row) => row.costSite !== 'audio-thread')
    );

    const harness = rows[0]?.harnessFloor;
    if (harness) {
        console.log(
            `harness floor (two clock reads, no render): floor ${us(harness.floor)}us, median ${us(harness.median)}us`
        );
    }
    const stalled = rows.filter((row) => row.zeroTickSamples > 0);
    console.log(
        stalled.length === 0
            ? 'clock stalls (zero-tick samples, the only way a sample can read short): none in any row'
            : `clock stalls (zero-tick samples): ${stalled.map((row) => `${row.id} ${row.zeroTickSamples}`).join(', ')}`
    );
    console.log('  raw minimum vs published 1st-percentile floor, per row (agreement means stalls are not biting):');
    for (const row of rows) {
        console.log(
            `    ${row.id.padEnd(28)} min ${us(row.stats.min).padStart(7)}us  floor(p1) ${us(row.stats.floor).padStart(7)}us` +
                `${row.floorMeasurable ? '' : '   [floor withheld: clock stalled on ' + (row.zeroFraction * 100).toFixed(1) + '% of samples]'}`
        );
    }
    console.log('');

    const duty = rows.filter((row) => row.dutyCycle !== null);
    if (duty.length > 0) {
        console.log('DUTY CYCLES, not tails — a p95 on these describes the percentile, not the device:');
        for (const row of duty) {
            const d = row.dutyCycle;
            console.log(
                `  ${row.id.padEnd(10)} every ${d.periodQuanta} quanta (${sig2(d.dutyPct)}% of them): ` +
                    `tick ${us(d.tickCostMs)}us (${pct(d.tickCostMs)}), idle ${us(d.idleCostMs)}us, ` +
                    `amortised mean ${us(d.amortisedMeanMs)}us (${pct(d.amortisedMeanMs)})`
            );
            console.log(`  ${''.padEnd(10)} period from ${row.dutyCycleSource}`);
        }
        console.log('');
    }

    // -- reference project --------------------------------------------------
    //
    // The project total needs every member row. A `--devices` subset run does
    // not have them, and inventing a total from the rows that happen to be
    // present is exactly the kind of number this instrument exists to refuse:
    // it would read as a project figure while silently omitting devices.
    const referenceMemberIds = [...REFERENCE_PROJECT_AUDIO_THREAD, ...REFERENCE_PROJECT_WORKER].map(([id]) => id);
    const referenceMissing = [...new Set(referenceMemberIds.filter((id) => byId[id] === undefined))];
    let referenceProjectJson = null;
    if (referenceMissing.length > 0) {
        console.log('=== Reference project — NOT COMPUTED ===');
        console.log('');
        console.log(
            `  This was a subset run (--devices). ${referenceMissing.length} member row(s) were not measured: ` +
                `${referenceMissing.join(', ')}.`
        );
        console.log('  A project total from a partial run would omit devices without saying so. Per-row');
        console.log('  figures above stand on their own; the project total needs a full run.');
        console.log('');
    } else {
        const sumOver = (members, pick) => members.reduce((total, [id, count]) => total + pick(byId[id]) * count, 0);

        // A lower bound stays a lower bound if an unmeasurable term is counted as
        // zero, so rows whose floor was withheld simply contribute nothing.
        const audioFloor = sumOver(REFERENCE_PROJECT_AUDIO_THREAD, (row) =>
            row.floorMeasurable ? (row.dutyCycle ? row.dutyCycle.amortisedFloorMs : row.stats.floor) : 0
        );
        const floorRowsMissing = REFERENCE_PROJECT_AUDIO_THREAD.filter(([id]) => !byId[id].floorMeasurable).map(
            ([id]) => id
        );
        const audioMedian = sumOver(REFERENCE_PROJECT_AUDIO_THREAD, (row) => row.stats.median);
        const audioMean = sumOver(REFERENCE_PROJECT_AUDIO_THREAD, (row) =>
            row.dutyCycle ? row.dutyCycle.amortisedMeanMs : row.stats.median
        );
        const workerFloor = sumOver(REFERENCE_PROJECT_WORKER, (row) => row.stats.floor);
        const workerMedian = sumOver(REFERENCE_PROJECT_WORKER, (row) => row.stats.median);
        // The defensible worst quantum: everyone at their median, plus the single
        // largest duty-cycle spike landing in that quantum. Summing every row's p95
        // assumes every device spikes in the same quantum, which nothing makes true
        // — the duty cycles are independent and unsynchronised.
        const worstSpikeUpper = Math.max(
            0,
            ...duty
                .filter((row) => REFERENCE_PROJECT_AUDIO_THREAD.some(([id]) => id === row.id))
                .map((row) => row.dutyCycle.tickCostMs - row.dutyCycle.idleCostMs)
        );
        const audioWorstUpper = audioMean + worstSpikeUpper;

        console.log('=== Reference project (defined in deviceRecipes.js — nothing in the repo defines it) ===');
        console.log('');
        console.log('  audio thread:');
        for (const [id, count] of REFERENCE_PROJECT_AUDIO_THREAD) {
            console.log(`    ${count} x ${id}`);
        }
        console.log('  worker:');
        for (const [id, count] of REFERENCE_PROJECT_WORKER) {
            console.log(`    ${count} x ${id}`);
        }
        console.log('');
        const meanLoad = meanOf(rows.map((row) => row.load.mean));
        console.log(
            `  measured at a mean 1-minute load average of ${meanLoad.toFixed(0)} on ${os.cpus().length} logical cores.`
        );
        console.log('');
        console.log(`  AUDIO THREAD >= ${sig2(audioFloor)} ms  (${pct(audioFloor)} of budget)   lower bound`);
        if (floorRowsMissing.length > 0) {
            console.log(
                `               partial: no floor from ${floorRowsMissing.join(', ')} (counted as zero, so still a lower bound)`
            );
        }
        console.log(
            `  AUDIO THREAD <= ${sig2(audioMean)} ms  (${pct(audioMean)} of budget)   upper bound, taken under load ${meanLoad.toFixed(0)}`
        );
        console.log(
            `  worst quantum <= ${sig2(audioWorstUpper)} ms  (${pct(audioWorstUpper)} of budget)   upper bound, + the largest duty spike`
        );
        console.log('');
        const verdict =
            audioWorstUpper < BUDGET_MS
                ? `  DECIDED: the upper bound already fits. Even measured under load ${meanLoad.toFixed(0)}, the reference\n` +
                  "  project's audio thread does not approach the deadline on compute. A quieter machine can only\n" +
                  '  lower these numbers. Compute is not the obstacle.'
                : audioFloor > BUDGET_MS
                  ? '  DECIDED THE OTHER WAY: the lower bound already exceeds budget. No quieter machine will fix it.'
                  : `  UNDECIDED on this machine: the bounds straddle the budget (${pct(audioFloor)} to ${pct(audioWorstUpper)}).\n` +
                    '  A quiet-machine run would narrow it; AC-3 would answer the deadline question directly.';
        console.log(verdict);
        console.log('');
        console.log(
            `  WORKER, Grand Boule >= ${sig2(workerFloor)} ms (${pct(workerFloor)}), <= ${sig2(workerMedian)} ms per`
        );
        console.log('                       quantum of audio, on its own thread with its own ring.');
        console.log('');
        console.log('  Neither bound is a deadline claim. They bound compute. AC-3 owns the deadline question.');
        console.log('');
        referenceProjectJson = {
            audioThread: REFERENCE_PROJECT_AUDIO_THREAD,
            worker: REFERENCE_PROJECT_WORKER,
            audioFloorMs: audioFloor,
            audioFloorPartialFrom: floorRowsMissing,
            audioUpperBoundMs: audioMean,
            audioWorstQuantumUpperMs: audioWorstUpper,
            audioMedianMs: audioMedian,
            meanLoad: meanOf(rows.map((row) => row.load.mean)),
            workerFloorMs: workerFloor,
            workerMedianMs: workerMedian,
        };
    }

    console.log('per row: cost site, occupancy, in-window calibration spread, stationarity, wall-clock bound');
    for (const row of rows) {
        const c = row.calibration;
        console.log(`  ${row.id}  [${row.costSite}]`);
        console.log(`      warm-up  : ${row.warmVerify?.detail}`);
        console.log(`      after run: ${row.lateVerify?.detail}`);
        console.log(`      load     : ${row.note}`);
        console.log(
            `      clock    : ${c.segments} in-window segments, ${sig2(c.medianTicksPerMs)} ticks/ms median, ` +
                `spread ${c.spreadPct.toFixed(1)}% (${sig2(c.minTicksPerMs)}-${sig2(c.maxTicksPerMs)})`
        );
        console.log(
            `      drift    : first 500 ${us(row.stats.firstFiveHundredMean)}us -> last 500 ${us(row.stats.lastFiveHundredMean)}us ` +
                `(${row.driftPct.toFixed(1)}%)${row.stationary ? '' : ' — NOT STATIONARY, median is a bound'}`
        );
        console.log(
            `      load     : mean ${row.load.mean.toFixed(1)}, range ${row.load.min.toFixed(1)}-${row.load.max.toFixed(1)} ` +
                `over ${row.load.samples} samples; ${row.zeroTickSamples} zero-tick samples`
        );
        console.log(
            `      bound    : ${sig2(row.timedTotalMs + row.warmupTotalMs)} ms compute of ${sig2(row.mainThreadWallMs)} ms ` +
                `main-thread wall (${(row.wallRatio * 100).toFixed(0)}%; the gate is <=100%, the rest is context ` +
                `setup and AudioWorklet host overhead, not the device)`
        );
    }

    if (options.json !== null) {
        writeFileSync(
            options.json,
            `${JSON.stringify(
                {
                    machine,
                    browser: payload.browser,
                    userAgent: payload.userAgent,
                    budgetMs: BUDGET_MS,
                    options,
                    load: { before: loadBefore, after: loadAfter, ceiling: loadCeiling() },
                    // null on a `--devices` subset run: the total needs every
                    // member row, and a partial one is not a project figure.
                    referenceProject: referenceProjectJson,
                    // Per-row summaries and calibration, but not the 20 000 raw
                    // samples per row — that is 40 MB of JSON. `--json-samples`
                    // is deliberately absent; the retained record is the
                    // distribution plus every input needed to re-derive it.
                    rows: rows.map(({ samplesMs, ...row }) => ({ ...row, sampleCount: samplesMs.length })),
                },
                null,
                2
            )}\n`
        );
        console.log(`\nwrote ${options.json}`);
    }
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
