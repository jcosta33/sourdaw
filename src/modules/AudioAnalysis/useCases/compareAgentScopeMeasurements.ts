import { AGENT_MEASUREMENT_METRIC_IDS, type AgentMeasurementMetricId } from '../models/AgentMeasurementMetricIds';
import {
    type AgentObjectiveMetricComparison,
    type AgentObjectiveMetricEntry,
} from '../models/AgentObjectiveAnalysisTypes';
import { compareAgentObjectiveMetricEntry } from '../services/agentObjectiveAnalysis/compareAgentObjectiveMetricEntry';

type AgentScopeMeasurements = Partial<Record<AgentMeasurementMetricId, AgentObjectiveMetricEntry>>;

type CompareAgentScopeMeasurementsInput = {
    /** One target's measurements in the live project. */
    readonly baseline: AgentScopeMeasurements;
    /** The same target's measurements in the preview of a proposal. */
    readonly preview: AgentScopeMeasurements;
};

/**
 * Per-metric deltas between two agent scope measurements of one target,
 * `preview − baseline`, for every metric either side reports, keyed in
 * `AGENT_MEASUREMENT_METRIC_IDS` order.
 *
 * Each metric goes through the objective analysis's own comparison law: two
 * measured finite scalars in one unit give a signed delta in that unit (LU for
 * loudness); an unmeasured or missing side, or a per-band map, gives a typed
 * incomparable entry naming why — never a number.
 */
export function compareAgentScopeMeasurements({
    baseline,
    preview,
}: CompareAgentScopeMeasurementsInput): Partial<Record<AgentMeasurementMetricId, AgentObjectiveMetricComparison>> {
    const deltas: Partial<Record<AgentMeasurementMetricId, AgentObjectiveMetricComparison>> = {};
    for (const metricId of AGENT_MEASUREMENT_METRIC_IDS) {
        if (baseline[metricId] === undefined && preview[metricId] === undefined) {
            continue;
        }
        deltas[metricId] = compareAgentObjectiveMetricEntry(preview[metricId], baseline[metricId]);
    }
    return deltas;
}
