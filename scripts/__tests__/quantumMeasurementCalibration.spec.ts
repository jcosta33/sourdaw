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
${analysis}
    const row = rows[0];
    console.log(JSON.stringify({
        id: row.id,
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
