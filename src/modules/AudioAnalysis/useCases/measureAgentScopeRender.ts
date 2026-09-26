import { AGENT_MEASUREMENT_METRIC_IDS, type AgentMeasurementMetricId } from '../models/AgentMeasurementMetricIds';
import { type AgentObjectiveMetricEntry } from '../models/AgentObjectiveAnalysisTypes';

import { measureAgentObjectiveBuffer } from './measureAgentObjectiveBuffer';

type AgentScopeMeasurements = Partial<Record<AgentMeasurementMetricId, AgentObjectiveMetricEntry>>;

/** The count of an onset series, at the series' own confidence, or the series' own unavailable reason. */
function onsetCountEntry(onsetTimes: AgentObjectiveMetricEntry): AgentObjectiveMetricEntry {
    if (onsetTimes.status === 'unavailable') {
        return onsetTimes;
    }
    if (!Array.isArray(onsetTimes.value)) {
        throw new TypeError('The onsetTimes measurement is not a series.');
    }
    return {
        status: 'measured',
        metricVersion: 1,
        unit: 'count',
        value: onsetTimes.value.length,
        confidence: onsetTimes.confidence,
    };
}

/**
 * The requested agent measurement metrics of one rendered buffer, keyed in
 * `AGENT_MEASUREMENT_METRIC_IDS` order.
 *
 * Every entry except `onsetCount` is the objective analysis's own entry for the
 * same id, unchanged. No series is returned: `onsetCount` replaces `onsetTimes`.
 */
export function measureAgentScopeRender(
    buffer: AudioBuffer,
    metricIds: readonly AgentMeasurementMetricId[]
): AgentScopeMeasurements {
    const { measurements } = measureAgentObjectiveBuffer(buffer);
    const requested = new Set(metricIds);
    const result: AgentScopeMeasurements = {};
    for (const metricId of AGENT_MEASUREMENT_METRIC_IDS) {
        if (!requested.has(metricId)) {
            continue;
        }
        result[metricId] =
            metricId === 'onsetCount' ? onsetCountEntry(measurements.onsetTimes) : measurements[metricId];
    }
    return result;
}
