export type QuantumMeasurementCalibrationInput = {
    deviceId: string;
    samplesTicks: readonly number[];
    segmentIndex: readonly number[];
    segmentRates: readonly number[];
};

type QuantumMeasurementCalibrationFailureReason =
    'invalid-input' | 'invalid-rate' | 'invalid-segment-index' | 'length-mismatch';

export type QuantumMeasurementCalibrationFailure = {
    deviceId: string;
    sampleIndex: number;
    originalSegmentIndex: number | null;
    originalSegmentRate: number | null;
    ticksEvidence: string;
    indexEvidence: string;
    rateEvidence: string;
    reason: QuantumMeasurementCalibrationFailureReason;
};

type CalibratedQuantumMeasurementRow = {
    deviceId: string;
    samplesMs: number[];
};

export type QuantumMeasurementCalibrationResult =
    | { status: 'calibrated'; rows: CalibratedQuantumMeasurementRow[] }
    | { status: 'refused'; failure: QuantumMeasurementCalibrationFailure };

function evidence(value: number | undefined): string {
    return value === undefined ? '<missing>' : String(value);
}

function malformedInputRefusal(deviceId: string): QuantumMeasurementCalibrationResult {
    return {
        status: 'refused',
        failure: {
            deviceId,
            sampleIndex: -1,
            originalSegmentIndex: null,
            originalSegmentRate: null,
            ticksEvidence: '<invalid>',
            indexEvidence: '<invalid>',
            rateEvidence: '<invalid>',
            reason: 'invalid-input',
        },
    };
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNumberArray(value: unknown): value is number[] {
    return Array.isArray(value) && value.every((item) => typeof item === 'number');
}

function refusal(
    input: QuantumMeasurementCalibrationInput,
    sampleIndex: number,
    reason: QuantumMeasurementCalibrationFailureReason
): QuantumMeasurementCalibrationResult {
    const originalSegmentIndex = input.segmentIndex[sampleIndex];
    const originalSegmentRate =
        originalSegmentIndex !== undefined && Number.isInteger(originalSegmentIndex) && originalSegmentIndex >= 0
            ? input.segmentRates[originalSegmentIndex]
            : undefined;
    return {
        status: 'refused',
        failure: {
            deviceId: input.deviceId,
            sampleIndex,
            originalSegmentIndex: originalSegmentIndex ?? null,
            originalSegmentRate: originalSegmentRate ?? null,
            ticksEvidence: evidence(input.samplesTicks[sampleIndex]),
            indexEvidence: evidence(originalSegmentIndex),
            rateEvidence: evidence(originalSegmentRate),
            reason,
        },
    };
}

/**
 * The producer rates the tail on its own only when it lasted at least one
 * segment target or no segment has closed yet; otherwise its samples point one
 * past the last rate. They are admitted only as a contiguous
 * run at the end of the row that directly follows a sample of the last closed
 * segment, in a row whose indices never decrease; returns the run's first
 * sample index, or undefined when there is none.
 */
function unratedTailStart(input: QuantumMeasurementCalibrationInput): number | undefined {
    const unratedIndex = input.segmentRates.length;
    const { segmentIndex } = input;
    let start = segmentIndex.length;
    while (start > 0 && segmentIndex[start - 1] === unratedIndex) {
        start -= 1;
    }
    if (start === segmentIndex.length || start === 0 || unratedIndex === 0) {
        return undefined;
    }
    if (segmentIndex[start - 1] !== unratedIndex - 1 || !isNonDecreasing(segmentIndex)) {
        return undefined;
    }
    return start;
}

function isNonDecreasing(values: readonly number[]): boolean {
    return values.every((value, index) => index === 0 || value >= values[index - 1]!);
}

function resolveRateIndex(
    input: QuantumMeasurementCalibrationInput,
    sampleIndex: number,
    tailStart: number | undefined
): number | undefined {
    const segmentIndex = input.segmentIndex[sampleIndex];
    if (tailStart !== undefined && sampleIndex >= tailStart) {
        return input.segmentRates.length - 1;
    }
    if (segmentIndex === undefined || !Number.isInteger(segmentIndex) || segmentIndex < 0) {
        return undefined;
    }
    return segmentIndex < input.segmentRates.length ? segmentIndex : undefined;
}

function calibrateRow(input: QuantumMeasurementCalibrationInput): QuantumMeasurementCalibrationResult {
    if (input.samplesTicks.length !== input.segmentIndex.length) {
        return refusal(input, Math.min(input.samplesTicks.length, input.segmentIndex.length), 'length-mismatch');
    }

    const tailStart = unratedTailStart(input);
    const samplesMs: number[] = [];
    for (let sampleIndex = 0; sampleIndex < input.samplesTicks.length; sampleIndex++) {
        const rateIndex = resolveRateIndex(input, sampleIndex, tailStart);
        if (rateIndex === undefined) {
            return refusal(input, sampleIndex, 'invalid-segment-index');
        }
        const rate = input.segmentRates[rateIndex];
        if (rate === undefined || !Number.isFinite(rate) || rate <= 0) {
            return refusal(input, sampleIndex, 'invalid-rate');
        }
        samplesMs.push(input.samplesTicks[sampleIndex]! / rate);
    }
    return { status: 'calibrated', rows: [{ deviceId: input.deviceId, samplesMs }] };
}

export function calibrateQuantumMeasurementRows(
    inputs: readonly QuantumMeasurementCalibrationInput[]
): QuantumMeasurementCalibrationResult {
    const rows: CalibratedQuantumMeasurementRow[] = [];
    for (const input of inputs) {
        const result = calibrateRow(input);
        if (result.status === 'refused') {
            return result;
        }
        rows.push(result.rows[0]!);
    }
    return { status: 'calibrated', rows };
}

export function calibrateQuantumMeasurementPayload(payload: unknown): QuantumMeasurementCalibrationResult {
    if (!isRecord(payload) || !Array.isArray(payload.results)) {
        return malformedInputRefusal('<unknown>');
    }

    const inputs: QuantumMeasurementCalibrationInput[] = [];
    for (const result of payload.results) {
        if (!isRecord(result)) {
            return malformedInputRefusal('<unknown>');
        }
        const deviceId = result.id;
        if (
            typeof deviceId !== 'string' ||
            !isNumberArray(result.samplesTicks) ||
            !isNumberArray(result.segmentIndex) ||
            !isNumberArray(result.segmentRates)
        ) {
            return malformedInputRefusal(typeof deviceId === 'string' ? deviceId : '<unknown>');
        }
        inputs.push({
            deviceId,
            samplesTicks: result.samplesTicks,
            segmentIndex: result.segmentIndex,
            segmentRates: result.segmentRates,
        });
    }
    return calibrateQuantumMeasurementRows(inputs);
}

export function calibrationFailureReport(failure: QuantumMeasurementCalibrationFailure): {
    diagnostic: string;
    failedRun: {
        failures: string[];
        calibrationFailures: QuantumMeasurementCalibrationFailure[];
    };
} {
    const diagnostic =
        `${failure.deviceId}: calibration refusal at sample ${failure.sampleIndex}, ` +
        `original segment ${failure.indexEvidence}, rate ${failure.rateEvidence}, ticks ${failure.ticksEvidence} ` +
        `(${failure.reason})`;
    return {
        diagnostic,
        failedRun: {
            failures: [diagnostic],
            calibrationFailures: [failure],
        },
    };
}
