import { type getAgentMeasurementMetricIds } from '#/modules/AudioAnalysis/useCases';

import {
    type MetricGoal as GenericMetricGoal,
    type MetricGoalState as GenericMetricGoalState,
    type MetricRequestAuthority as GenericMetricRequestAuthority,
} from '../models/MetricGoalAdmission';

export type ObjectiveMetricId = ReturnType<typeof getAgentMeasurementMetricIds>[number];
export type MetricGoal = GenericMetricGoal<ObjectiveMetricId>;
export type MetricGoalState = GenericMetricGoalState<ObjectiveMetricId>;
export type MetricRequestAuthority = GenericMetricRequestAuthority<ObjectiveMetricId>;
