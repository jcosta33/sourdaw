import { getAgentMeasurementMetricIds } from '#/modules/AudioAnalysis/useCases';

import { createAnswerRespondParameters } from '../models/AnswerRespond';

import { ANSWER_ENTRY_PARAMETERS } from './projectAnswerRespondToolSchema';

/** Canonical catalog exposes both real consuming forms; requests expose only their active phase. */
export function createCanonicalAnswerRespondParameters() {
    const completion = createAnswerRespondParameters(getAgentMeasurementMetricIds());
    return {
        ...completion,
        required: [],
        anyOf: [ANSWER_ENTRY_PARAMETERS, { required: completion.required }],
    };
}
