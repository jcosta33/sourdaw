import {
    type compareAgentScopeMeasurements,
    type getAgentMeasurementMetricIds,
} from '#/modules/AudioAnalysis/useCases';

import { type AnalysisMeasureRead as BaseAnalysisMeasureRead } from '../models/AnalysisMeasureRead';
import { type AnswerMeasurement as GenericAnswerMeasurement } from '../models/AnswerEvidence';
import { type AnswerRequestAuthority as GenericAnswerRequestAuthority } from '../models/AnswerInterpretation';
import {
    type AnswerMetricReference as GenericAnswerMetricReference,
    type AnswerRespondArguments as GenericAnswerRespondArguments,
    type AnswerStatement as GenericAnswerStatement,
} from '../models/AnswerRespond';

export type AnswerMetricId = ReturnType<typeof getAgentMeasurementMetricIds>[number];
type Measurements = Parameters<typeof compareAgentScopeMeasurements>[0]['baseline'];
export type AnswerRequestAuthority = GenericAnswerRequestAuthority<AnswerMetricId>;
export type AnswerMeasurement = GenericAnswerMeasurement<AnswerMetricId, Measurements>;
export type AnswerMetricReference = GenericAnswerMetricReference<AnswerMetricId>;
export type AnswerStatement = GenericAnswerStatement<AnswerMetricId>;
export type AnswerRespondArguments = GenericAnswerRespondArguments<AnswerMetricId>;
export type AnalysisMeasureRead = BaseAnalysisMeasureRead & { answerMeasurement?: AnswerMeasurement };
