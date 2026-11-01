import { getAgentMeasurementMetricIds } from '#/modules/AudioAnalysis/useCases';

import { createAnswerRespondParameters } from '../models/AnswerRespond';
import { type ToolSchema } from '../models/ToolDefinitions';

export const ANSWER_COMPLETION_DESCRIPTION =
    'Complete alone from frozen intake and successful reads. Select closed statements referencing receipt callId; the application owns all prose, figures, comparisons and ties. Measured audio requires analysis.measure after intake, matching subject, scope, range and metrics. Recipes are attributed knowledge, never project measurements.';

export const ANSWER_ENTRY_PARAMETERS: ToolSchema['function']['parameters'] = {
    type: 'object',
    properties: {},
    required: [],
    additionalProperties: false,
};

export function projectAnswerRespondToolSchema(schema: ToolSchema, complete: boolean): ToolSchema {
    const view = {
        ...schema,
        function: {
            ...schema.function,
            description:
                'Enter read-only answering alone with {}. This publishes no answer and grants no extra turn. Prefer the joint interpretation answer branch for questions.',
            parameters: ANSWER_ENTRY_PARAMETERS,
        },
    };
    if (complete) {
        view.function.description = ANSWER_COMPLETION_DESCRIPTION;
        view.function.parameters = createAnswerRespondParameters(getAgentMeasurementMetricIds());
    }
    return view;
}
