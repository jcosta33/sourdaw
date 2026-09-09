import { describe, expect, it } from 'vitest';

import {
    calibrateQuantumMeasurementPayload,
    calibrateQuantumMeasurementRows,
    calibrationFailureReport,
    type QuantumMeasurementCalibrationInput,
} from '../quantumMeasurementCalibration';

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
});
