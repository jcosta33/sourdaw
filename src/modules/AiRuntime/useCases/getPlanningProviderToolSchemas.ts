import { getExecutableAppActionToolSchemas } from '#/modules/Command/useCases';

import { ANALYSIS_COMPARE_REFERENCE_TOOL_NAME } from '../models/AgentToolCatalogNames';
import { type PlanningProfile, READONLY_ANSWER_TOOL_NAMES } from '../models/PlanningProfile';
import { type ToolSchema } from '../models/ToolDefinitions';
import { WORKFLOW_ACTION_TOOL_NAMES } from '../models/WorkflowCapability';
import { readAgentReference } from '../stores/agentReferenceStore';

import { getPlanningProviderSchemaContract } from './planningProviderSchema';
import { projectAnswerRespondToolSchema } from './projectAnswerRespondToolSchema';

function readonlyMeasurementView(schema: ToolSchema): ToolSchema {
    const { scope, range, metrics } = schema.function.parameters.properties;
    return {
        ...schema,
        function: {
            ...schema.function,
            description:
                'Measure the current project scope and range without preparing or previewing changes. Returns figures and evidence, never audio.',
            parameters: {
                type: 'object',
                properties: { scope, range, metrics },
                required: ['scope', 'range'],
                additionalProperties: false,
            },
        },
    };
}

/**
 * The provider-visible planning list uses Command's published workflow schemas, including their
 * bounds and visibility. An operation its owner stops publishing must disappear here too.
 *
 * `analysis.compareReference` is offered only while the user has a reference loaded. The schema
 * contract the decision-resume identity reads still lists it, so loading or clearing a reference
 * never invalidates a decision that is waiting.
 */
export function getPlanningProviderToolSchemas(profile?: PlanningProfile): readonly ToolSchema[] {
    if (profile === 'readonly-answer') {
        return getPlanningProviderSchemaContract()
            .schemas.filter((schema) => READONLY_ANSWER_TOOL_NAMES.has(schema.function.name))
            .map((schema) => (schema.function.name === 'analysis.measure' ? readonlyMeasurementView(schema) : schema));
    }
    const workflowToolSchemas = getExecutableAppActionToolSchemas().filter((tool) =>
        WORKFLOW_ACTION_TOOL_NAMES.has(tool.function.name)
    );
    const referenceLoaded = readAgentReference() !== null;
    const offeredSchemas = getPlanningProviderSchemaContract().schemas.filter(
        (schema) => referenceLoaded || schema.function.name !== ANALYSIS_COMPARE_REFERENCE_TOOL_NAME
    );
    return [...offeredSchemas, ...workflowToolSchemas];
}

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
                const view = readonlyMeasurementView(schema);
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
