import {
    type AgentObjectiveDeltaUnit,
    type AgentObjectiveMetricComparison,
    type AgentObjectiveMetricEntry,
    type AgentObjectiveMetricUnit,
    type AgentObjectiveMetricValue,
} from '../../models/AgentObjectiveAnalysisTypes';

/** A difference between two loudness figures is loudness units, not LUFS. */
function deltaUnit(unit: AgentObjectiveMetricUnit): AgentObjectiveDeltaUnit {
    if (unit === 'LUFS') {
        return 'LU';
    }
    if (unit === 'dBFS' || unit === 'dBTP') {
        return 'dB';
    }
    return unit;
}

/**
 * Only a finite number subtracts. NaN and Infinity pass a `typeof` check and
 * then produce a delta that is not a difference between two measurements, so
 * they are refused alongside the shapes that were never scalars.
 */
function isScalar(value: AgentObjectiveMetricValue): value is number {
    return typeof value === 'number' && Number.isFinite(value);
}

/**
 * One metric's link from a baseline measurement to a candidate one: the
 * candidate minus the baseline, or why the two do not subtract.
 *
 * Only scalars subtract. A band profile, an onset list or a flag can differ in
 * ways no single number describes, so those are reported as incomparable rather
 * than reduced to a difference that reads like a measurement. A side that
 * carries no entry for the metric is as unavailable as one that could not
 * measure it.
 */
export function compareAgentObjectiveMetricEntry(
    candidate: AgentObjectiveMetricEntry | undefined,
    baseline: AgentObjectiveMetricEntry | undefined
): AgentObjectiveMetricComparison {
    if (!candidate || candidate.status !== 'measured') {
        return { status: 'incomparable', reason: 'candidate-unavailable' };
    }
    if (!baseline || baseline.status !== 'measured') {
        return { status: 'incomparable', reason: 'baseline-unavailable' };
    }
    // Differing units make the pair no more subtractable than a list does: the
    // two numbers are not the same measurement.
    if (!isScalar(candidate.value) || !isScalar(baseline.value) || candidate.unit !== baseline.unit) {
        return { status: 'incomparable', reason: 'non-scalar' };
    }
    return { status: 'compared', delta: candidate.value - baseline.value, unit: deltaUnit(candidate.unit) };
}
