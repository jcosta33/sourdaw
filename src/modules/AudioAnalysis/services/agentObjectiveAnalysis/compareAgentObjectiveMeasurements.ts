import {
    AGENT_OBJECTIVE_METRIC_IDS,
    type AgentObjectiveDeltaUnit,
    type AgentObjectiveMetricComparison,
    type AgentObjectiveMetricEntry,
    type AgentObjectiveMetricId,
    type AgentObjectiveMetricUnit,
} from '../../models/AgentObjectiveAnalysisTypes';

/**
 * Metric-by-metric link from one receipt to an earlier one.
 *
 * Only scalars subtract. A band profile, an onset list or a flag can differ in
 * ways no single number describes, so those are reported as incomparable rather
 * than reduced to a difference that reads like a measurement.
 */

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

function compareEntries(
    candidate: AgentObjectiveMetricEntry,
    baseline: AgentObjectiveMetricEntry | undefined
): AgentObjectiveMetricComparison {
    if (candidate.status !== 'measured') {
        return { status: 'incomparable', reason: 'candidate-unavailable' };
    }
    if (!baseline || baseline.status !== 'measured') {
        return { status: 'incomparable', reason: 'baseline-unavailable' };
    }
    // Differing units make the pair no more subtractable than a list does: the
    // two numbers are not the same measurement.
    if (typeof candidate.value !== 'number' || typeof baseline.value !== 'number' || candidate.unit !== baseline.unit) {
        return { status: 'incomparable', reason: 'non-scalar' };
    }
    return { status: 'compared', delta: candidate.value - baseline.value, unit: deltaUnit(candidate.unit) };
}

export type CompareAgentObjectiveMeasurementsInput = {
    readonly candidate: Record<AgentObjectiveMetricId, AgentObjectiveMetricEntry>;
    readonly baseline: Record<AgentObjectiveMetricId, AgentObjectiveMetricEntry>;
};

export function compareAgentObjectiveMeasurements({
    candidate,
    baseline,
}: CompareAgentObjectiveMeasurementsInput): Record<AgentObjectiveMetricId, AgentObjectiveMetricComparison> {
    const metrics = {} as Record<AgentObjectiveMetricId, AgentObjectiveMetricComparison>;
    for (const id of AGENT_OBJECTIVE_METRIC_IDS) {
        metrics[id] = compareEntries(candidate[id], baseline[id]);
    }
    return metrics;
}
