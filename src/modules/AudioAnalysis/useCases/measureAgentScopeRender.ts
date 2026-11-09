import { AGENT_MEASUREMENT_METRIC_IDS, type AgentMeasurementMetricId } from '../models/AgentMeasurementMetricIds';
import { type AgentObjectiveMetricEntry, type AgentObjectiveMetricId } from '../models/AgentObjectiveAnalysisTypes';
import { buildRequestedAgentObjectiveMeasurements } from '../services/agentObjectiveAnalysis/buildAgentObjectiveMeasurements';
import {
    prepareAgentObjectiveBuffer,
    prepareAgentObjectiveProgramme,
} from '../services/agentObjectiveAnalysis/prepareAgentObjectiveBuffer';

import { readAgentObjectiveOnsetTimes } from './readAgentObjectiveOnsetTimes';
import { measureProgramAudio } from './referenceMixComparison/analyzeMix/measureProgramAudio';

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

function objectiveMetricId(metric: AgentMeasurementMetricId): AgentObjectiveMetricId {
    if (metric === 'onsetCount') {
        return 'onsetTimes';
    }
    return metric;
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
    const requested = new Set(metricIds);
    if (requested.size === 0) {
        return {};
    }
    const objectives = new Set(metricIds.map(objectiveMetricId));
    const prepared = prepareAgentObjectiveBuffer(buffer);
    let dynamicRangeDb: number | null = null;
    if (objectives.has('dynamicRangeEstimate') && prepared.channels.length > 0) {
        dynamicRangeDb = measureProgramAudio([prepareAgentObjectiveProgramme(prepared)])?.dynamicRange ?? null;
    }
    let onsetTimesSec: number[] = [];
    if (objectives.has('onsetTimes') || objectives.has('transientDensity')) {
        onsetTimesSec = readAgentObjectiveOnsetTimes(prepared);
    }
    const measurements = buildRequestedAgentObjectiveMeasurements(
        { ...prepared, onsetTimesSec, dynamicRangeDb },
        objectives
    );
    const result: AgentScopeMeasurements = {};
    for (const metricId of AGENT_MEASUREMENT_METRIC_IDS) {
        if (!requested.has(metricId)) {
            continue;
        }
        const entry = measurements[objectiveMetricId(metricId)];
        if (entry === undefined) {
            throw new TypeError(`Requested objective metric ${metricId} was not measured.`);
        }
        result[metricId] = metricId === 'onsetCount' ? onsetCountEntry(entry) : entry;
    }
    return result;
}
