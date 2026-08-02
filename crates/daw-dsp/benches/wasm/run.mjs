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
 * to wasm and runs it in a browser worklet, and the original measurement put
 * wasm at 2.17x native. A table that reported only the native figure would
 * understate every row by roughly that factor.
 *
 * **Chrome exposes no `performance` inside an `AudioWorkletGlobalScope`** —
 * probed on Chrome 150, the only clock-shaped globals there are `Date` (1 ms)
 * and `currentTime` (the audio clock, which advances by exactly one quantum per
 * render call however long that call took). The worklet therefore reads a
 * shared-memory tick counter driven by a spinning worker; see `tickClock.js`.
 *
 * It refuses to print a table it cannot stand behind:
 *
 * - if the page is not cross-origin isolated there is no `SharedArrayBuffer`
 *   and so no clock at all — the run aborts;
 * - if the tick calibration drifts enough that a row's summed compute exceeds
 *   its own elapsed wall clock, the run exits non-zero;
 * - if a device's occupancy check fails at either end of the timed run, the run
 *   exits non-zero rather than reporting the cost of an idle voice pool.
 */

import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import os from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright';

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
 * Sparkplug → Maglev → TurboFan ladder. 4000 calls is comfortably past all of
 * them, and the harness does not take that on trust: every row reports the mean
 * of its first and last 500 timed samples, so a row still tiering up during
 * measurement is visible as a falling mean rather than hidden in the average.
 *
 * The warm-up runs the *identical* loop body to the timed pass, clock reads
 * included, and discards its samples. Warming up through a cheaper loop warms
 * the DSP but not the loop.
 */
const DEFAULT_WARMUP_QUANTA = 4_000;

/**
 * Timed quanta per device.
 *
 * The original bench reported a max over ~3000 samples and said plainly that
 * this understates the tail: a session renders on the order of 1.7M quanta an
 * hour, so 3000 samples is about six seconds of one device's life. 20000 is
 * 53 s of rendered audio per row. It is still not a worst case — nothing short
 * of a full session is — and the table says so rather than calling the max a
 * bound.
 */
const DEFAULT_MEASURE_QUANTA = 20_000;

function parseArgs(argv) {
    const options = {
        warmupQuanta: DEFAULT_WARMUP_QUANTA,
        measureQuanta: DEFAULT_MEASURE_QUANTA,
        json: null,
        headed: false,
    };
    for (let i = 0; i < argv.length; i += 1) {
        const flag = argv[i];
        if (flag === '--warmup') {
            options.warmupQuanta = Number(argv[++i]);
        } else if (flag === '--measure') {
            options.measureQuanta = Number(argv[++i]);
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

function summarise(samplesMs) {
    const sorted = Float64Array.from(samplesMs).sort();
    const mean = samplesMs.reduce((total, value) => total + value, 0) / samplesMs.length;
    const head = samplesMs.slice(0, 500);
    const tail = samplesMs.slice(-500);
    const meanOf = (window) => window.reduce((total, value) => total + value, 0) / window.length;
    return {
        n: samplesMs.length,
        mean,
        median: quantile(sorted, 0.5),
        p95: quantile(sorted, 0.95),
        p99: quantile(sorted, 0.99),
        p999: quantile(sorted, 0.999),
        max: sorted[sorted.length - 1],
        min: sorted[0],
        firstFiveHundredMean: meanOf(head),
        lastFiveHundredMean: meanOf(tail),
    };
}

/**
 * Load above which the run refuses to stand behind its own numbers: half the
 * logical cores.
 *
 * Here because the first full run of this table was taken while another agent
 * worktree ran the whole vitest suite — load average 25 on a 12-core machine —
 * and nothing in the output said so. A cost table taken on a contended machine
 * measures the DSP and the scheduler together.
 */
function loadCeiling() {
    return os.cpus().length / 2;
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
        gitDescribe: read('git', ['-C', repoRoot, 'status', '--porcelain']) === '' ? 'clean' : 'dirty',
    };
}

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
        // module imports relative to the document URL, so serving index.html at
        // the root would look for `deviceRecipes.js` beside the repo root.
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

        payload = await page.evaluate(
            (config) => window.runQuantumCostTable(config),
            { warmupQuanta: options.warmupQuanta, measureQuanta: options.measureQuanta }
        );

        payload.browser = browser.version();
    } finally {
        await browser.close();
        await server.close();
    }

    const machine = machineRecord();

    // The tick clock is calibrated against the page's `performance.now()` before
    // and after the run. Using the mean of the two, and printing the drift, is
    // the honest form: a spin rate that moved by more than a percent or so
    // invalidates every figure derived from it, and the reader can see it.
    const ticksPerMs = (payload.ticksPerMsBefore + payload.ticksPerMsAfter) / 2;
    const calibrationDriftPct = (payload.ticksPerMsAfter / payload.ticksPerMsBefore - 1) * 100;

    const rows = payload.results.map((result) => {
        const samplesMs = result.samplesTicks.map((tick) => tick / ticksPerMs);
        const floorMs = result.harnessFloorTicks.map((tick) => tick / ticksPerMs);
        const totalMs = samplesMs.reduce((total, value) => total + value, 0);
        return {
            id: result.id,
            label: result.label,
            note: result.note,
            warmVerify: result.warmVerify,
            lateVerify: result.lateVerify,
            stats: summarise(samplesMs),
            harnessFloor: summarise(floorMs),
            // Independent upper bound: the timed samples are a subset of the
            // worklet's own wall clock across warm-up plus the timed run, so
            // their sum cannot legitimately exceed it. If it does, the tick
            // calibration is wrong and the row is not reportable.
            timedTotalMs: totalMs,
            workletWallMs: result.wallClockMs,
            mainThreadWallMs: result.mainThreadWallMs,
        };
    });

    const failed = rows.filter((row) => !row.warmVerify?.ok || !row.lateVerify?.ok);
    const overrun = rows.filter((row) => row.timedTotalMs > row.workletWallMs);

    // -- report ------------------------------------------------------------
    const pct = (ms) => `${((ms / BUDGET_MS) * 100).toFixed(2)}%`;
    const us = (ms) => (ms * 1000).toFixed(1);

    console.log('');
    console.log('=== Per-quantum device cost — WASM in a real AudioWorkletGlobalScope ===');
    console.log('');
    console.log(`machine        : ${machine.cpu} (${machine.hardwareModel}), ${machine.performanceCores}P+${machine.efficiencyCores}E, ${machine.memoryGb} GB`);
    console.log(`os             : ${machine.os}, ${machine.arch}`);
    console.log(`browser        : ${payload.browser} (Google Chrome stable channel, headless=${!options.headed})`);
    console.log(`user agent     : ${payload.userAgent}`);
    console.log(`measured at    : ${machine.gitSha} (working tree ${machine.gitDescribe})`);
    console.log(`host           : OfflineAudioContext, one per device, 48 kHz, 128-frame quanta`);
    console.log(`clock          : shared-memory tick counter — Chrome exposes no \`performance\` in an AudioWorkletGlobalScope`);
    console.log(`calibration    : ${payload.ticksPerMsBefore.toFixed(0)} ticks/ms before, ${payload.ticksPerMsAfter.toFixed(0)} after (${calibrationDriftPct >= 0 ? '+' : ''}${calibrationDriftPct.toFixed(2)}% drift); 1 tick = ${(1e6 / ticksPerMs).toFixed(1)} ns`);
    console.log(`isolation      : page crossOriginIsolated=${payload.pageCrossOriginIsolated} (required — SharedArrayBuffer is the clock)`);
    console.log(`warm-up        : ${options.warmupQuanta} untimed quanta per device`);
    console.log(`samples        : ${options.measureQuanta} timed quanta per device (${((options.measureQuanta * 128) / 48_000).toFixed(1)} s of rendered audio each)`);
    console.log(`budget         : ${BUDGET_MS.toFixed(4)} ms = 128 frames / 48 kHz`);
    console.log('');
    console.log('device                                          median       p95       p99     p99.9       max  |  median     p95     p99   p99.9     max  (% of 2.667 ms)');
    for (const row of rows) {
        const s = row.stats;
        console.log(
            `${row.label.padEnd(44)} ${us(s.median).padStart(8)}us ${us(s.p95).padStart(7)}us ${us(s.p99).padStart(7)}us ${us(s.p999).padStart(7)}us ${us(s.max).padStart(8)}us | ` +
                `${pct(s.median).padStart(8)} ${pct(s.p95).padStart(7)} ${pct(s.p99).padStart(7)} ${pct(s.p999).padStart(7)} ${pct(s.max).padStart(8)}`
        );
    }
    if (rows.length > 0) {
        const floor = rows[0].harnessFloor;
        console.log(
            `${'(harness floor — two clock reads, no render)'.padEnd(44)} ${us(floor.median).padStart(8)}us ${us(floor.p95).padStart(7)}us ${us(floor.p99).padStart(7)}us ${us(floor.p999).padStart(7)}us ${us(floor.max).padStart(8)}us | ` +
                `${pct(floor.median).padStart(8)} ${pct(floor.p95).padStart(7)} ${pct(floor.p99).padStart(7)} ${pct(floor.p999).padStart(7)} ${pct(floor.max).padStart(8)}`
        );
    }
    console.log('');
    console.log(
        'The far tail is not DSP cost. An OfflineAudioContext render runs on a normal-priority thread,\n' +
            'so a p99.9 or max in the tens of milliseconds is the OS descheduling it mid-render, plus V8\n' +
            'GC. Read median through p99 as the device; read the tail as an upper bound that includes the\n' +
            'scheduler and the runtime.'
    );
    console.log('');
    console.log('per row: stationarity (a mean that is still falling was still tiering up), occupancy, and the wall-clock cross-check');
    for (const row of rows) {
        const s = row.stats;
        const drift = ((s.lastFiveHundredMean / s.firstFiveHundredMean - 1) * 100).toFixed(1);
        console.log(`  ${row.id}`);
        console.log(`      warm-up  : ${row.warmVerify?.ok ? 'ok' : 'FAILED'} — ${row.warmVerify?.detail}`);
        console.log(`      after run: ${row.lateVerify?.ok ? 'ok' : 'FAILED'} — ${row.lateVerify?.detail}`);
        console.log(`      load     : ${row.note}`);
        console.log(`      drift    : first 500 ${us(s.firstFiveHundredMean)}us -> last 500 ${us(s.lastFiveHundredMean)}us (${drift}%)`);
        console.log(
            `      bound    : timed total ${(row.timedTotalMs / 1000).toFixed(2)}s vs worklet wall ${(row.workletWallMs / 1000).toFixed(2)}s ` +
                `vs main-thread wall ${(row.mainThreadWallMs / 1000).toFixed(2)}s ${row.timedTotalMs > row.workletWallMs ? '<-- OVER, calibration is wrong' : ''}`
        );
    }

    if (options.json !== null) {
        const summary = {
            machine,
            browser: payload.browser,
            userAgent: payload.userAgent,
            ticksPerMsBefore: payload.ticksPerMsBefore,
            ticksPerMsAfter: payload.ticksPerMsAfter,
            budgetMs: BUDGET_MS,
            options,
            rows,
        };
        writeFileSync(options.json, `${JSON.stringify(summary, null, 2)}\n`);
        console.log(`\nwrote ${options.json}`);
    }

    if (failed.length > 0) {
        console.error(`\n${failed.length} device(s) failed their occupancy check: ${failed.map((row) => row.id).join(', ')}`);
        process.exitCode = 1;
    }
    const loadAfter = os.loadavg()[0];
    const busiest = Math.max(loadBefore, loadAfter);
    console.log(
        `\nmachine load   : 1-minute average ${loadBefore.toFixed(2)} before, ${loadAfter.toFixed(2)} after, ` +
            `on ${os.cpus().length} logical cores (ceiling ${loadCeiling().toFixed(1)})`
    );
    if (busiest > loadCeiling()) {
        console.error(
            `\nthe machine was not idle: 1-minute load average reached ${busiest.toFixed(2)} against a ceiling of ` +
                `${loadCeiling().toFixed(1)}. The table above measures this DSP *and* whatever else was running, ` +
                'and must not be published. Wait for the machine to go quiet and re-run.'
        );
        process.exitCode = 1;
    }
    if (overrun.length > 0) {
        console.error(`\n${overrun.length} device(s) reported more timed compute than elapsed wall clock — the tick calibration is wrong: ${overrun.map((row) => row.id).join(', ')}`);
        process.exitCode = 1;
    }
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
