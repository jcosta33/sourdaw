import { AGENT_MEASUREMENT_METRIC_IDS } from '../models/AgentMeasurementMetricIds';

/** The metric ids an agent measurement can report, in receipt key order. */
export function getAgentMeasurementMetricIds(): typeof AGENT_MEASUREMENT_METRIC_IDS {
    return AGENT_MEASUREMENT_METRIC_IDS;
}
