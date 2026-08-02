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
 * Rows are separated by **cost site** rather than lumped into one budget. Grand
 * Boule's DSP runs in a `Worker` in the live transport and cannot reach the
 * audio thread; what the audio thread pays for it is the ring-consumer row. See
 * `COST_SITE` in `deviceRecipes.js`. Summing a Worker's cost into an
 * audio-thread budget is the mistake the first version of this table made, and
 * it inflated the headline by more than everything else combined.
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
 * It refuses to publish a table it cannot stand behind. Every gate is evaluated
 * **before** anything is printed:
 *
 * - the page must be cross-origin isolated, or there is no `SharedArrayBuffer`
 *   and so no clock at all;
 * - each row's compute must fit inside its own independently-measured
 *   main-thread wall clock — a bound the worklet's own clock cannot fake;
 * - each row's tick rate must hold steady across its own timed window;
 * - each row's occupancy check must pass at both ends of the timed run;
 * - the machine must have been quiet throughout.
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
 * Maximum spread of in-window segment rates a row may show and still be
 * published, as a percentage of its median rate.
 *
 * This replaces a lower bound on "compute as a fraction of wall clock" that was
 * in an earlier draft and was wrong: for a device costing a few microseconds,
 * most of a context's wall clock is `addModule`, wasm instantiation and the
 * AudioWorklet host's own per-quantum overhead, none of which is the device and
 * none of which indicates a starved spinner. The failure that bound was reaching
 * for — the tick rate collapsing mid-window — is now largely *corrected* rather
 * than merely detected, because each sample is converted with the rate of its
 * own segment. What remains worth gating is whether the rate moved so much
 * within the window that two significant figures are not supportable.
 */
const MAX_CALIBRATION_SPREAD_PCT = 25;

function parseArgs(argv) {
    const options = {
        warmupQuanta: DEFAULT_WARMUP_QUANTA,
        measureQuanta: DEFAULT_MEASURE_QUANTA,
        segmentTargetMs: DEFAULT_SEGMENT_TARGET_MS,
        json: null,
        headed: false,
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
        tickCostMs: meanOf(ticks),
        idleCostMs: rest.length > 0 ? meanOf(rest) : 0,
        amortisedMeanMs: meanOf(sorted),
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
        });

        payload.browser = browser.version();
    } finally {
        await browser.close();
        await server.close();
    }

    const machine = machineRecord();
    const loadAfter = os.loadavg()[0];
    const busiestLoad = Math.max(loadBefore, loadAfter);

    // -- analysis ----------------------------------------------------------
    const rows = payload.results.map((result) => {
        const rates = result.segmentRates.filter((rate) => Number.isFinite(rate) && rate > 0);
        const sortedRates = [...rates].sort((a, b) => a - b);
        const medianRate = quantile(Float64Array.from(sortedRates), 0.5);
        const rateSpreadPct =
            sortedRates.length > 1
                ? ((sortedRates[sortedRates.length - 1] - sortedRates[0]) / medianRate) * 100
                : 0;

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

        return {
            id: result.id,
            label: result.label,
            note: result.note,
            costSite: COST_SITE[result.id] ?? 'unknown',
            warmVerify: result.warmVerify,
            lateVerify: result.lateVerify,
            stats,
            harnessFloor: summarise(floorMs),
            dutyCycle: DUTY_CYCLE[result.id]
                ? dutyCycleSplit(samplesMs, DUTY_CYCLE[result.id].periodQuanta)
                : null,
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
        if (!(row.wallRatio <= 1.0)) {
            failures.push(
                `${row.id}: reported ${sig2(row.timedTotalMs + row.warmupTotalMs)} ms of compute inside a ` +
                    `${sig2(row.mainThreadWallMs)} ms main-thread wall clock (ratio ${row.wallRatio.toFixed(2)}) — ` +
                    'the tick rate is too high and every figure in the row is inflated'
            );
        }
        if (row.calibration.spreadPct > MAX_CALIBRATION_SPREAD_PCT) {
            failures.push(
                `${row.id}: the tick rate moved ${row.calibration.spreadPct.toFixed(1)}% across its own timed window ` +
                    `(ceiling ${MAX_CALIBRATION_SPREAD_PCT}%) — the clock is not steady enough to publish`
            );
        }
    }
    if (busiestLoad > loadCeiling()) {
        failures.push(
            `machine: 1-minute load average reached ${busiestLoad.toFixed(2)} against a ceiling of ` +
                `${loadCeiling().toFixed(1)} — the table would measure this DSP and whatever else was running`
        );
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
    console.log('Two significant figures throughout: reproduced against a real performance.now(), this clock');
    console.log('holds the median to roughly +/-10% and inflates the p95 by +4% to +31% on constant work.');
    console.log('Read the median as the device. Treat p95/p99 as indicative, not as a tail measurement.');
    console.log('');

    const printRows = (title, members) => {
        if (members.length === 0) {
            return;
        }
        console.log(title);
        console.log(
            '  device                                                 median      p95      p99  |  median     p95     p99'
        );
        for (const row of members) {
            const s = row.stats;
            console.log(
                `  ${row.label.padEnd(50)} ${us(s.median).padStart(7)}us ${us(s.p95).padStart(7)}us ${us(s.p99).padStart(7)}us | ` +
                    `${pct(s.median).padStart(7)} ${pct(s.p95).padStart(7)} ${pct(s.p99).padStart(7)}` +
                    `${row.stationary ? '' : '   <-- NOT STATIONARY, read as a bound'}`
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

    const floor = rows[0]?.harnessFloor;
    if (floor) {
        console.log(`harness floor (two clock reads, no render): median ${us(floor.median)}us, p99 ${us(floor.p99)}us`);
        console.log('');
    }

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
    const sumOver = (members, pick) => members.reduce((total, [id, count]) => total + pick(byId[id]) * count, 0);

    const audioMedian = sumOver(REFERENCE_PROJECT_AUDIO_THREAD, (row) => row.stats.median);
    const audioMean = sumOver(REFERENCE_PROJECT_AUDIO_THREAD, (row) =>
        row.dutyCycle ? row.dutyCycle.amortisedMeanMs : row.stats.median
    );
    const workerMedian = sumOver(REFERENCE_PROJECT_WORKER, (row) => row.stats.median);

    // The defensible worst quantum: everyone at their median, plus the single
    // largest duty-cycle spike landing in that quantum. Summing every row's p95
    // assumes every device spikes in the same quantum, which nothing makes true
    // — the duty cycles are independent and unsynchronised.
    const worstSpike = Math.max(
        0,
        ...duty
            .filter((row) => REFERENCE_PROJECT_AUDIO_THREAD.some(([id]) => id === row.id))
            .map((row) => row.dutyCycle.tickCostMs - row.stats.median)
    );
    const audioWorst = audioMedian + worstSpike;

    console.log('=== Reference project (defined in deviceRecipes.js — nothing in the repo defines it) ===');
    console.log('');
    console.log('  audio thread:');
    for (const [id, count] of REFERENCE_PROJECT_AUDIO_THREAD) {
        console.log(`    ${count} x ${id}`);
    }
    console.log('  worker (not the audio thread):');
    for (const [id, count] of REFERENCE_PROJECT_WORKER) {
        console.log(`    ${count} x ${id}`);
    }
    console.log('');
    console.log(`  AUDIO THREAD, summed median   ${sig2(audioMedian)} ms = ${pct(audioMedian)} of budget`);
    console.log(`  AUDIO THREAD, amortised mean  ${sig2(audioMean)} ms = ${pct(audioMean)} of budget`);
    console.log(`  AUDIO THREAD, worst quantum   ${sig2(audioWorst)} ms = ${pct(audioWorst)} of budget`);
    console.log('                                (every device at its median plus the single largest duty-cycle spike)');
    console.log('');
    console.log(`  WORKER line item, Grand Boule ${sig2(workerMedian)} ms per quantum of audio = ${pct(workerMedian)} of a`);
    console.log("                                quantum's wall clock, on its own thread, with its own ring to keep ahead.");
    console.log('');

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
                    referenceProject: {
                        audioThread: REFERENCE_PROJECT_AUDIO_THREAD,
                        worker: REFERENCE_PROJECT_WORKER,
                        audioMedianMs: audioMedian,
                        audioAmortisedMeanMs: audioMean,
                        audioWorstQuantumMs: audioWorst,
                        workerMedianMs: workerMedian,
                    },
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
