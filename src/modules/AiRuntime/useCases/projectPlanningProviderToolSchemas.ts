import { isExecutableAppActionType } from '#/modules/Command/useCases';

import {
    COMMAND_BATCH_PROPOSAL_TOOL_NAME,
    RECIPE_EXPANSION_TOOL_NAME,
    TRANSFORM_COMPILE_TOOL_NAME,
} from '../models/AgentToolCatalogNames';
import { CREATIVE_INTERPRETATION_TOOL_NAME } from '../models/CreativeInterpretation';
import { type PlanningProfile, READONLY_ANSWER_TOOL_NAMES } from '../models/PlanningProfile';
import { type ToolSchema } from '../models/ToolDefinitions';
import { WORKFLOW_CAPABILITY_TOOL_NAME } from '../models/WorkflowCapability';

import { projectAnswerRespondToolSchema } from './projectAnswerRespondToolSchema';
import { projectReadonlyAnswerMeasurementToolSchema } from './projectReadonlyAnswerMeasurementToolSchema';

export type PlanningAnswerPhase = 'planning' | 'intake' | 'answer';
export type WholeRequestIntakePhase = 'pending' | 'admitted' | 'workflow-admitted';

export const WHOLE_REQUEST_PREPARATION_TOOL_NAMES: ReadonlySet<string> = new Set([
    COMMAND_BATCH_PROPOSAL_TOOL_NAME,
    TRANSFORM_COMPILE_TOOL_NAME,
    RECIPE_EXPANSION_TOOL_NAME,
]);

/** Active permission and terminal grammar, consumed by every actual request. */
export function projectPlanningProviderToolSchemas(
    schemas: readonly ToolSchema[],
    phase: PlanningAnswerPhase,
    profile?: PlanningProfile,
    wholeRequestIntake?: WholeRequestIntakePhase
): ToolSchema[] {
    const names = new Set(READONLY_ANSWER_TOOL_NAMES);
    if (profile !== 'readonly-answer') {
        names.add('agent.catalog.discover');
        names.add('analysis.detectTransients');
    }
    return schemas
        .filter((schema) => {
            if (profile === 'readonly-answer' && schema.function.name === WORKFLOW_CAPABILITY_TOOL_NAME) {
                return false;
            }
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
            const name = schema.function.name;
            if (phase === 'planning' && wholeRequestIntake !== undefined) {
                const effectful = isExecutableAppActionType(name) || WHOLE_REQUEST_PREPARATION_TOOL_NAMES.has(name);
                const consumed =
                    (wholeRequestIntake !== 'pending' && name === CREATIVE_INTERPRETATION_TOOL_NAME) ||
                    (wholeRequestIntake === 'workflow-admitted' && name === WORKFLOW_CAPABILITY_TOOL_NAME);
                if ((wholeRequestIntake === 'pending' && effectful) || consumed) {
                    let description =
                        'Unavailable before successful whole-request intake. This empty entry authorizes no preparation, compilation, proposal or action.';
                    if (consumed) {
                        description =
                            'Whole-request intake was consumed. This empty entry cannot repeat or replace its authority.';
                    }
                    return {
                        ...schema,
                        function: {
                            ...schema.function,
                            description,
                            parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
                        },
                    };
                }
                if (wholeRequestIntake === 'pending' && name === 'analysis.measure') {
                    return projectReadonlyAnswerMeasurementToolSchema(schema);
                }
            }
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
