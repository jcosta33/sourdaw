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

/** Canonical catalog exposes both real consuming forms; requests expose only their active phase. */
export function createCanonicalAnswerRespondParameters(): ToolSchema['function']['parameters'] {
    const parameters = {
        type: 'object' as const,
        properties: {},
        required: [],
        anyOf: [ANSWER_ENTRY_PARAMETERS, createAnswerRespondParameters(getAgentMeasurementMetricIds())],
    };
    return parameters;
}

export function projectAnswerRespondToolSchema(schema: ToolSchema, complete: boolean): ToolSchema {
    return {
        ...schema,
        function: {
            ...schema.function,
            description: complete
                ? ANSWER_COMPLETION_DESCRIPTION
                : 'Enter read-only answering alone with {}. This publishes no answer and grants no extra turn. Prefer the joint interpretation answer branch for questions.',
            parameters: complete
                ? createAnswerRespondParameters(getAgentMeasurementMetricIds())
                : ANSWER_ENTRY_PARAMETERS,
        },
    };
}
