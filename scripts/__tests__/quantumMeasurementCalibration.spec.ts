import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import {
    calibrateQuantumMeasurementPayload,
    calibrateQuantumMeasurementRows,
    calibrationFailureReport,
    type QuantumMeasurementCalibrationInput,
} from '../quantumMeasurementCalibration';

const repositoryRoot = resolve(import.meta.dirname, '../..');
const runnerPath = resolve(repositoryRoot, 'crates/daw-dsp/benches/wasm/run.mjs');
const helperUrl = pathToFileURL(resolve(repositoryRoot, 'scripts/quantumMeasurementCalibration.ts')).href;
const temporaryDirectories: string[] = [];

afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
        rmSync(directory, { recursive: true, force: true });
    }
});

function extractBetween(source: string, start: string, end: string): string {
    const startIndex = source.indexOf(start);
    const endIndex = source.indexOf(end, startIndex);
    if (startIndex < 0 || endIndex < 0) {
        throw new Error(`Missing runner source boundary: ${start} ... ${end}`);
    }
    return source.slice(startIndex, endIndex);
}

function runnerFixtureSource(): string {
    const source = readFileSync(runnerPath, 'utf8');
    const reporter = extractBetween(
        source,
        'function reportFailedRun(',
        '/**\n * The reference project, defined here because'
    );
    const admission = extractBetween(
        source,
        '    const calibration = calibrateQuantumMeasurementPayload(payload);',
        '    let calibratedRowIndex = 0;'
    );
    return `
import { writeFileSync } from 'node:fs';
import {
    calibrateQuantumMeasurementPayload,
    calibrationFailureReport,
} from ${JSON.stringify(helperUrl)};

${reporter}

async function exercise() {
    const payload = {
        results: [{
            id: 'grand_boule',
            samplesTicks: [20000],
            segmentIndex: [1],
            segmentRates: [100000, 0, 200000],
        }],
    };
    const machine = { platform: 'fixture' };
    const options = { json: process.argv[2] };
${admission}
    console.log('SUCCESS TABLE');
}

await exercise();
`;
}

function successfulRunnerFixtureSource(): string {
    const source = readFileSync(runnerPath, 'utf8');
    const statisticalHelpers = extractBetween(source, 'function quantile(', 'function machineRecord(');
    const reporter = extractBetween(
        source,
        'function reportFailedRun(',
        '/**\n * The reference project, defined here because'
    );
    const analysis = extractBetween(
        source,
        '    const calibration = calibrateQuantumMeasurementPayload(payload);',
        '    const byId = Object.fromEntries(rows.map((row) => [row.id, row]));'
    );
    return `
import { writeFileSync } from 'node:fs';
import {
    calibrateQuantumMeasurementPayload,
    calibrationFailureReport,
} from ${JSON.stringify(helperUrl)};

const FLOOR_QUANTILE = 0.01;
const STATIONARITY_TOLERANCE_PCT = 10;
const MEDIAN_TRUSTWORTHY_SPREAD_PCT = 25;
const MAX_ZERO_TICK_FRACTION = 0.01;
const COST_SITE = { grand_boule: 'fixture' };
const DUTY_CYCLE = {};
const os = { loadavg: () => [1] };

${statisticalHelpers}
${reporter}

async function exercise() {
    const sampleCount = 20_000;
    const payload = {
        results: [{
            id: 'grand_boule',
            label: 'Grand Boule',
            note: 'fixture',
            samplesTicks: Array.from({ length: sampleCount }, () => 20_000),
            segmentIndex: Array.from({ length: sampleCount }, () => 2),
            segmentRates: [100_000, 0, 200_000, 400_000],
            harnessFloorTicks: [20_000],
            warmupTotalTicks: 80_000_000,
            mainThreadWallMs: 2_400,
            timedStartedAtMs: 0,
            timedFinishedAtMs: 20,
            warmVerify: { ok: true, detail: 'fixture' },
            lateVerify: { ok: true, detail: 'fixture' },
            zeroTickSamples: 0,
        }],
    };
    const machine = { platform: 'fixture' };
    const options = { json: null };
    const loadTimeline = [{ atMs: 10, load: 1 }];
    const calibrationAttempts = [2];
${analysis}
    const row = rows[0];
    console.log(JSON.stringify({
        id: row.id,
        calibrationAttempts: row.calibration.attempts,
        sampleCount: row.samplesMs.length,
        firstSampleMs: row.samplesMs[0],
        stats: {
            n: row.stats.n,
            floor: row.stats.floor,
            median: row.stats.median,
            p95: row.stats.p95,
        },
        medianTicksPerMs: row.calibration.medianTicksPerMs,
        timedTotalMs: row.timedTotalMs,
    }));
}

await exercise();
`;
}

/**
 * Drives the runner's own re-measure loop and spread gate over one row whose
 * attempt N measures the spread `attemptSpreads[N - 1]`, and prints what the
 * gate admitted or refused.
 */
function remeasureFixtureSource(): string {
    const source = readFileSync(runnerPath, 'utf8');
    const ceilings = extractBetween(
        source,
        'const MAX_CALIBRATION_SPREAD_PCT = ',
        '/**\n * Fraction of samples that may read zero ticks'
    );
    const statisticalHelpers = extractBetween(source, 'function quantile(', 'function machineRecord(');
    return `
const FLOOR_QUANTILE = 0.01;
${ceilings}
${statisticalHelpers}

const attemptSpreads = JSON.parse(process.argv[2]);
const rowFor = (attempt) => {
    const spread = attemptSpreads[attempt - 1];
    if (spread === undefined) {
        throw new Error('no fixture spread for attempt ' + attempt);
    }
    return { id: 'bacteria_smudge', attempt, segmentRates: [100_000, 100_000, 100_000 * (1 + spread / 100)] };
};
const remeasured = [];
const { row, attempts } = await measureWithinCalibrationCeiling(rowFor(1), async (previous, attempt) => {
    remeasured.push({ previousAttempt: previous.attempt, attempt });
    return rowFor(attempt);
});
const spreadPct = calibrationSpreadPct(row.segmentRates);
console.log(JSON.stringify({
    maxAttempts: MAX_CALIBRATION_ATTEMPTS,
    measuredAttempt: row.attempt,
    attempts,
    remeasured,
    spreadPct,
    refusal: calibrationSpreadRefusal({ id: row.id, calibration: { spreadPct, attempts } }),
}));
`;
}

function runRemeasure(attemptSpreads: readonly number[]): unknown {
    const directory = mkdtempSync(join(tmpdir(), 'sourdaw-quantum-remeasure-'));
    temporaryDirectories.push(directory);
    const programPath = join(directory, 'runner-remeasure.mjs');
    writeFileSync(programPath, remeasureFixtureSource());

    const result = spawnSync(process.execPath, [programPath, JSON.stringify(attemptSpreads)], { encoding: 'utf8' });

    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    const outcome: unknown = JSON.parse(result.stdout);
    return outcome;
}

/**
 * Drives the runner's own post-measurement wiring — `remeasureDriftingRows`
 * against a stub page, the substitution into `payload.results` and
 * `calibrationAttempts`, the row analysis and the gates loop — over a
 * three-row first pass in non-alphabetical order:
 *
 * - `toaster` is within the ceiling, with unsorted rates whose median differs
 *   from their minimum (spread 80% against the median, 160% against the min);
 * - `bacteria_smudge` is over the ceiling on its first pass and then follows
 *   the variant's re-measure queue;
 * - `gluten` sits exactly at the ceiling, so it is neither re-measured nor
 *   refused.
 *
 * The stub serves a re-measure only from that row's queue, answering an empty
 * `deviceIds` with every row as the page does, so re-measuring the wrong rows
 * throws.
 */
function runnerWiringFixtureSource(): string {
    const source = readFileSync(runnerPath, 'utf8');
    const constants = extractBetween(source, 'const STATIONARITY_TOLERANCE_PCT = ', '/**\n * @param {string[]} argv');
    const statisticalHelpers = extractBetween(source, 'function quantile(', 'function machineRecord(');
    const reporting = extractBetween(source, 'function sig2(', '/**\n * The reference project, defined here because');
    const wiring = extractBetween(
        source,
        '        const admitted = await remeasureDriftingRows(',
        '        payload.browser = browser.version();'
    );
    const analysis = extractBetween(
        source,
        '    const calibration = calibrateQuantumMeasurementPayload(payload);',
        '    const byId = Object.fromEntries(rows.map((row) => [row.id, row]));'
    );
    const gates = extractBetween(
        source,
        '    // -- gates, all evaluated BEFORE anything is printed',
        '    if (failures.length > 0) {'
    );
    return `
import { writeFileSync } from 'node:fs';
import {
    calibrateQuantumMeasurementPayload,
    calibrationFailureReport,
} from ${JSON.stringify(helperUrl)};

const COST_SITE = {};
const DUTY_CYCLE = {};
const os = { loadavg: () => [1] };

${constants}
${statisticalHelpers}
${reporting}

const ROW_IDS = ['toaster', 'bacteria_smudge', 'gluten'];
const DRIFTING_REMEASURES = {
    settles: [[100_000, 100_000, 140_000]],
    stuck: [
        [100_000, 100_000, 270_000],
        [100_000, 100_000, 280_000],
        [100_000, 100_000, 290_000],
    ],
}[process.argv[2]];

const pageRow = (id, segmentRates, attempt) => ({
    id,
    label: id,
    note: id + ' attempt ' + attempt,
    samplesTicks: [20_000, 20_000, 20_000],
    segmentIndex: [0, 1, 2],
    segmentRates,
    harnessFloorTicks: [1_000],
    warmupTotalTicks: 0,
    mainThreadWallMs: 1_000,
    timedStartedAtMs: 0,
    timedFinishedAtMs: 20,
    warmVerify: { ok: true, detail: 'fixture' },
    lateVerify: { ok: true, detail: 'fixture' },
    zeroTickSamples: 0,
});

const remeasureQueues = {
    bacteria_smudge: DRIFTING_REMEASURES.map((segmentRates, index) => ({ segmentRates, attempt: index + 2 })),
};
const calls = [];
const page = {
    evaluate: async (_pageFunction, config) => {
        calls.push(config);
        const ids = config.deviceIds.length > 0 ? config.deviceIds : ROW_IDS;
        return {
            results: ids.map((id) => {
                const next = remeasureQueues[id]?.shift();
                if (next === undefined) {
                    throw new Error('unexpected re-measure of ' + id);
                }
                return pageRow(id, next.segmentRates, next.attempt);
            }),
        };
    },
};

async function exercise() {
    const tableConfig = { warmupQuanta: 4_000, measureQuanta: 20_000, segmentTargetMs: 1_000, deviceIds: [] };
    const payload = {
        pageCrossOriginIsolated: true,
        userAgent: 'fixture',
        results: [
            pageRow('toaster', [260_000, 100_000, 200_000], 1),
            pageRow('bacteria_smudge', [100_000, 100_000, 260_000], 1),
            pageRow('gluten', [100_000, 250_000, 100_000], 1),
        ],
    };
    let calibrationAttempts;
    const machine = { platform: 'fixture' };
    const options = { json: null };
    const loadTimeline = [{ atMs: 10, load: 1 }];
${wiring}
${analysis}
${gates}
    console.log(JSON.stringify({
        calls,
        calibrationAttempts,
        rows: rows.map((row) => ({
            id: row.id,
            note: row.note,
            spreadPct: row.calibration.spreadPct,
            attempts: row.calibration.attempts,
        })),
        failures,
    }));
}

await exercise();
`;
}

function runRunnerWiring(variant: 'settles' | 'stuck'): { log: string[]; outcome: unknown } {
    const directory = mkdtempSync(join(tmpdir(), 'sourdaw-quantum-wiring-'));
    temporaryDirectories.push(directory);
    const programPath = join(directory, 'runner-wiring.mjs');
    writeFileSync(programPath, runnerWiringFixtureSource());

    const result = spawnSync(process.execPath, [programPath, variant], { encoding: 'utf8' });

    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    const lines = result.stdout.trim().split('\n');
    const outcome: unknown = JSON.parse(lines.at(-1) ?? '');
    return { log: lines.slice(0, -1), outcome };
}

function input(overrides: Partial<QuantumMeasurementCalibrationInput> = {}): QuantumMeasurementCalibrationInput {
    return {
        deviceId: 'grand_boule',
        samplesTicks: [10_000, 20_000, 60_000],
        segmentIndex: [0, 1, 2],
        segmentRates: [100_000, 200_000, 300_000],
        ...overrides,
    };
}

function expectRefusal(overrides: Partial<QuantumMeasurementCalibrationInput>) {
    const result = calibrateQuantumMeasurementRows([input(overrides)]);
    expect(result.status).toBe('refused');
    if (result.status !== 'refused') {
        throw new TypeError('Expected calibration refusal');
    }
    return result.failure;
}

describe('quantum harness scoped type-aware lint', () => {
    it('passes the scoped oxlint pass over the typed harness files (#4398)', () => {
        // The census-pinned files (deviceRecipes.js, quantumCostProcessor.js) are
        // deliberately excluded: typing them moves recorded digests and forces a
        // reference-machine re-measurement — a sequencing decision the issue keeps
        // separate. run.mjs and pageHarness.d.mts join the set because tsgolint
        // resolves this directory's node: imports through the project the runner's
        // annotations establish; linting a file alone reports the imports as
        // error-typed, which is an artifact of the standalone parse, not the code.
        const result = spawnSync(
            process.execPath,
            [
                'node_modules/oxlint/bin/oxlint',
                '--config',
                '.oxlintrc.json',
                'crates/daw-dsp/benches/wasm/run.mjs',
                'crates/daw-dsp/benches/wasm/measurementCensus.mjs',
                'crates/daw-dsp/benches/wasm/renderTable.mjs',
                'crates/daw-dsp/benches/wasm/server.mjs',
                'crates/daw-dsp/benches/wasm/pageHarness.d.mts',
            ],
            { cwd: repositoryRoot, encoding: 'utf8' }
        );
        expect(result.status).toBe(0);
    });
});

describe('quantum measurement re-measure of a drifting row (#5110)', () => {
    it('re-measures a row over the ceiling and admits its first attempt within it', () => {
        const outcome = runRemeasure([160, 40, 40]);

        expect(outcome).toEqual({
            maxAttempts: 3,
            measuredAttempt: 2,
            attempts: 2,
            remeasured: [{ previousAttempt: 1, attempt: 2 }],
            spreadPct: expect.closeTo(40),
            refusal: null,
        });
    });

    it('refuses a row over the ceiling on every attempt and names the attempt count', () => {
        const outcome = runRemeasure([160, 170, 180, 190]);

        expect(outcome).toEqual({
            maxAttempts: 3,
            measuredAttempt: 3,
            attempts: 3,
            remeasured: [
                { previousAttempt: 1, attempt: 2 },
                { previousAttempt: 2, attempt: 3 },
            ],
            spreadPct: expect.closeTo(180),
            refusal:
                'bacteria_smudge: the tick rate moved 180.0% across its own timed window (ceiling 150%) — ' +
                'the segmentation is meaningless, not even a floor survives ' +
                '(over the ceiling on every one of 3 attempts)',
        });
    });

    it('never re-measures a row within the ceiling on its first attempt', () => {
        const outcome = runRemeasure([40, 160]);

        expect(outcome).toEqual({
            maxAttempts: 3,
            measuredAttempt: 1,
            attempts: 1,
            remeasured: [],
            spreadPct: expect.closeTo(40),
            refusal: null,
        });
    });
});

describe('quantum runner re-measure wiring (#5110)', () => {
    const singleRowCall = {
        warmupQuanta: 4_000,
        measureQuanta: 20_000,
        segmentTargetMs: 1_000,
        deviceIds: ['bacteria_smudge'],
    };

    it('re-measures only the drifting row and substitutes its admitted attempt in row order', () => {
        const { log, outcome } = runRunnerWiring('settles');

        expect(log).toEqual([
            're-measuring bacteria_smudge alone: its tick rate moved 160.0% across its own timed window ' +
                '(ceiling 150%), attempt 2 of 3',
        ]);
        expect(outcome).toEqual({
            calls: [singleRowCall],
            calibrationAttempts: [1, 2, 1],
            rows: [
                { id: 'toaster', note: 'toaster attempt 1', spreadPct: expect.closeTo(80), attempts: 1 },
                {
                    id: 'bacteria_smudge',
                    note: 'bacteria_smudge attempt 2',
                    spreadPct: expect.closeTo(40),
                    attempts: 2,
                },
                { id: 'gluten', note: 'gluten attempt 1', spreadPct: 150, attempts: 1 },
            ],
            failures: [],
        });
    });

    it('refuses the run through the gates when the drifting row stays over the ceiling', () => {
        const { outcome } = runRunnerWiring('stuck');

        expect(outcome).toEqual({
            calls: [singleRowCall, singleRowCall],
            calibrationAttempts: [1, 3, 1],
            rows: [
                { id: 'toaster', note: 'toaster attempt 1', spreadPct: expect.closeTo(80), attempts: 1 },
                {
                    id: 'bacteria_smudge',
                    note: 'bacteria_smudge attempt 3',
                    spreadPct: expect.closeTo(180),
                    attempts: 3,
                },
                { id: 'gluten', note: 'gluten attempt 1', spreadPct: 150, attempts: 1 },
            ],
            failures: [
                'bacteria_smudge: the tick rate moved 180.0% across its own timed window (ceiling 150%) — ' +
                    'the segmentation is meaningless, not even a floor survives ' +
                    '(over the ceiling on every one of 3 attempts)',
            ],
        });
    });
});

describe('quantum measurement calibration', () => {
    it('converts every sample with its original segment rate', () => {
        expect(calibrateQuantumMeasurementRows([input()])).toEqual({
            status: 'calibrated',
            rows: [{ deviceId: 'grand_boule', samplesMs: [0.1, 0.1, 0.2] }],
        });
    });

    it('does not renumber samples after an invalid middle calibration segment', () => {
        expect(
            calibrateQuantumMeasurementRows([
                input({ samplesTicks: [20_000], segmentIndex: [2], segmentRates: [100_000, 0, 200_000, 400_000] }),
            ])
        ).toEqual({
            status: 'calibrated',
            rows: [{ deviceId: 'grand_boule', samplesMs: [0.1] }],
        });
    });

    it('calibrates the producer payload through the runner boundary', () => {
        expect(
            calibrateQuantumMeasurementPayload({
                results: [
                    {
                        id: 'grand_boule',
                        samplesTicks: [20_000],
                        segmentIndex: [2],
                        segmentRates: [100_000, 0, 200_000, 400_000],
                    },
                ],
            })
        ).toEqual({
            status: 'calibrated',
            rows: [{ deviceId: 'grand_boule', samplesMs: [0.1] }],
        });
    });

    it.each([
        ['first zero', [0, 200_000, 300_000], 0],
        ['middle negative', [100_000, -1, 300_000], 1],
        ['last nonfinite', [100_000, 200_000, Number.NaN], 2],
    ] as const)('refuses a referenced %s rate', (_label, segmentRates, originalSegmentIndex) => {
        const failure = expectRefusal({ samplesTicks: [20_000], segmentIndex: [originalSegmentIndex], segmentRates });
        expect(failure).toMatchObject({
            deviceId: 'grand_boule',
            sampleIndex: 0,
            originalSegmentIndex,
            reason: 'invalid-rate',
        });
    });

    it.each([
        ['missing', [], '<missing>'],
        ['fractional', [0.5], '0.5'],
        ['negative', [-1], '-1'],
        ['out of range', [3], '3'],
    ] as const)('refuses a %s sample segment index', (_label, segmentIndex, indexEvidence) => {
        const failure = expectRefusal({ samplesTicks: [20_000], segmentIndex });
        expect(failure).toMatchObject({
            deviceId: 'grand_boule',
            sampleIndex: 0,
            indexEvidence,
        });
    });

    it('refuses mismatched sample and index lengths in either direction', () => {
        expect(expectRefusal({ samplesTicks: [10_000, 20_000], segmentIndex: [0] }).reason).toBe('length-mismatch');
        expect(expectRefusal({ samplesTicks: [10_000], segmentIndex: [0, 1] }).reason).toBe('length-mismatch');
    });

    it('tolerates an unused invalid trailing segment but refuses a sample that references it', () => {
        expect(
            calibrateQuantumMeasurementRows([
                input({ samplesTicks: [10_000], segmentIndex: [0], segmentRates: [100_000, 0] }),
            ])
        ).toEqual({
            status: 'calibrated',
            rows: [{ deviceId: 'grand_boule', samplesMs: [0.1] }],
        });
        expectRefusal({ samplesTicks: [10_000], segmentIndex: [1], segmentRates: [100_000, 0] });
    });

    it('keeps original segment identity across a mixed long population', () => {
        const sampleCount = 20_000;
        const segmentRates = [100_000, 0, 200_000, 400_000];
        const samplesTicks = Array.from({ length: sampleCount }, (_, index) => (index % 2 === 0 ? 20_000 : 40_000));
        const segmentIndex = Array.from({ length: sampleCount }, (_, index) => (index % 2 === 0 ? 2 : 3));

        const result = calibrateQuantumMeasurementRows([input({ samplesTicks, segmentIndex, segmentRates })]);

        expect(result.status).toBe('calibrated');
        if (result.status !== 'calibrated') {
            throw new TypeError('Expected calibrated population');
        }
        expect(result.rows[0]?.samplesMs).toHaveLength(sampleCount);
        expect(new Set(result.rows[0]?.samplesMs)).toEqual(new Set([0.1]));
    });

    it('builds the runner failure diagnostic and failed JSON without successful rows', () => {
        const failure = expectRefusal({
            samplesTicks: [20_000],
            segmentIndex: [1],
            segmentRates: [100_000, 0, 300_000],
        });
        const report = calibrationFailureReport(failure);

        expect(report.diagnostic).toContain('grand_boule');
        expect(report.diagnostic).toContain('sample 0');
        expect(report.diagnostic).toContain('original segment 1');
        expect(report.diagnostic).toContain('rate 0');
        expect(report.failedRun).toEqual({
            failures: [report.diagnostic],
            calibrationFailures: [failure],
        });
        expect(report.failedRun).not.toHaveProperty('rows');
    });

    it('executes the actual runner refusal before statistics or successful output', () => {
        const directory = mkdtempSync(join(tmpdir(), 'sourdaw-quantum-calibration-'));
        temporaryDirectories.push(directory);
        const programPath = join(directory, 'runner-admission.mjs');
        const jsonPath = join(directory, 'failed.json');
        writeFileSync(programPath, runnerFixtureSource());

        const result = spawnSync(process.execPath, [programPath, jsonPath], { encoding: 'utf8' });

        expect(result.status).toBe(1);
        expect(result.stderr).toContain('NOT PUBLISHABLE');
        expect(result.stderr).toContain('grand_boule');
        expect(result.stderr).toContain('original segment 1, rate 0, ticks 20000');
        expect(result.stdout).not.toContain('SUCCESS TABLE');
        const failedRun: unknown = JSON.parse(readFileSync(jsonPath, 'utf8'));
        expect(failedRun).toMatchObject({
            machine: { platform: 'fixture' },
            failures: [expect.stringContaining('calibration refusal')],
            calibrationFailures: [
                {
                    deviceId: 'grand_boule',
                    sampleIndex: 0,
                    originalSegmentIndex: 1,
                    originalSegmentRate: 0,
                    reason: 'invalid-rate',
                },
            ],
        });
        expect(failedRun).not.toHaveProperty('rows');
    });

    it('executes actual runner row analysis with original sparse segment identity', () => {
        const directory = mkdtempSync(join(tmpdir(), 'sourdaw-quantum-calibration-'));
        temporaryDirectories.push(directory);
        const programPath = join(directory, 'runner-analysis.mjs');
        writeFileSync(programPath, successfulRunnerFixtureSource());

        const result = spawnSync(process.execPath, [programPath], { encoding: 'utf8' });

        expect(result.status).toBe(0);
        expect(result.stderr).toBe('');
        const summary: unknown = JSON.parse(result.stdout);
        expect(summary).toEqual({
            id: 'grand_boule',
            calibrationAttempts: 2,
            sampleCount: 20_000,
            firstSampleMs: 0.1,
            stats: {
                n: 20_000,
                floor: 0.1,
                median: 0.1,
                p95: 0.1,
            },
            medianTicksPerMs: 200_000,
            timedTotalMs: expect.closeTo(2_000),
        });
    });
});
