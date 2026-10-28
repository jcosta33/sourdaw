import { type PlanningProfile, READONLY_ANSWER_TOOL_NAMES } from '../models/PlanningProfile';
import { type ToolSchema } from '../models/ToolDefinitions';

import { projectAnswerRespondToolSchema } from './projectAnswerRespondToolSchema';
import { projectReadonlyAnswerMeasurementToolSchema } from './projectReadonlyAnswerMeasurementToolSchema';

export type PlanningAnswerPhase = 'planning' | 'intake' | 'answer';

/** Active permission and terminal grammar, consumed by every actual request. */
export function projectPlanningProviderToolSchemas(
    schemas: readonly ToolSchema[],
    phase: PlanningAnswerPhase,
    profile?: PlanningProfile
): ToolSchema[] {
    const names = new Set(READONLY_ANSWER_TOOL_NAMES);
    if (profile !== 'readonly-answer') {
        names.add('agent.catalog.discover');
        names.add('analysis.detectTransients');
    }
    return schemas
        .filter((schema) => {
            if (phase === 'planning') {
                return true;
            }
            if (phase === 'intake') {
                return ['selectAnswerInterpretation', 'project.query', 'command.batch.decline'].includes(
                    schema.function.name
                );
            }
            return names.has(schema.function.name);
        })
        .map((schema) => {
            if (schema.function.name === 'answer.respond') {
                return projectAnswerRespondToolSchema(schema, phase === 'answer');
            }
            if (phase !== 'planning' && schema.function.name === 'analysis.measure') {
                const view = projectReadonlyAnswerMeasurementToolSchema(schema);
                return {
                    ...view,
                    function: {
                        ...view.function,
                        description:
                            'Measure the frozen subject using its published startBeat/endBeat. The app retains named-section identity privately. No preview or preparation.',
                        parameters: {
                            ...view.function.parameters,
                            properties: {
                                ...view.function.parameters.properties,
                                range: {
                                    type: 'object',
                                    additionalProperties: false,
                                    properties: {
                                        startBeat: { type: 'number', minimum: 0 },
                                        endBeat: { type: 'number', minimum: 0 },
                                    },
                                    required: ['startBeat', 'endBeat'],
                                },
                            },
                        },
                    },
                };
            }
            return schema;
        });
}
