import { type AnswerMetricId } from './AnswerInterpretation';
import { type AnswerEvidenceEntry } from './PlanningOutcome';
import { type ToolSchema } from './ToolDefinitions';

export const ANSWER_RESPOND_MAX_STATEMENTS = 16;
/** Preserve the former answer text ceiling after application composition. */
export const ANSWER_RESPOND_MAX_COMPOSED_CHARACTERS = 4096;
export const ANSWER_RESPOND_MAX_CALL_ID_LENGTH = 256;
export const ANSWER_PROJECT_FACTS = ['summary', 'tempo', 'tracks', 'sections', 'transport', 'settings'] as const;
export const ANSWER_LIMITATIONS = [
    'measurement-unavailable',
    'timing-unavailable',
    'bounded-evidence',
    'perception-not-inferred',
] as const;
export type AnswerMetricReference = { callId: string; targetId: string; metricId: AnswerMetricId; band?: string };
export type AnswerStatement =
    | { kind: 'metric'; reference: AnswerMetricReference }
    | { kind: 'difference'; left: AnswerMetricReference; right: AnswerMetricReference }
    | {
          kind: 'ranking';
          references: AnswerMetricReference[];
          operation: 'ascending' | 'descending' | 'minimum' | 'maximum';
      }
    | { kind: 'project-fact'; fact: (typeof ANSWER_PROJECT_FACTS)[number] }
    | { kind: 'query-page'; callId: string }
    | { kind: 'recipe'; callId: string; recipeId: string }
    | { kind: 'source-onsets'; callId: string }
    | { kind: 'limitation'; code: (typeof ANSWER_LIMITATIONS)[number] };
export type AnswerRespondArguments = { intakeCallId: string; statements: AnswerStatement[] };
/** Existing renderer contract; factual text is composed by the application. */
export type PlanningAnswer = { text: string; evidence: AnswerEvidenceEntry[] };

function createAnswerStatementSchemas(metricIds: readonly AnswerMetricId[]): Record<string, unknown>[] {
    const callId = { type: 'string', minLength: 1, maxLength: ANSWER_RESPOND_MAX_CALL_ID_LENGTH };
    const reference = {
        type: 'object',
        additionalProperties: false,
        properties: { callId, targetId: callId, metricId: { enum: [...metricIds] }, band: callId },
        required: ['callId', 'targetId', 'metricId'],
    };
    const shapes = {
        metric: { reference },
        difference: { left: reference, right: reference },
        ranking: {
            references: { type: 'array', minItems: 1, maxItems: 32, items: reference },
            operation: { enum: ['ascending', 'descending', 'minimum', 'maximum'] },
        },
        'project-fact': { fact: { enum: [...ANSWER_PROJECT_FACTS] } },
        'query-page': { callId },
        'source-onsets': { callId },
        recipe: { callId, recipeId: callId },
        limitation: { code: { enum: [...ANSWER_LIMITATIONS] } },
    };
    return Object.entries(shapes).map(([kind, properties]) => ({
        type: 'object',
        additionalProperties: false,
        properties: { kind: { const: kind }, ...properties },
        required: ['kind', ...Object.keys(properties)],
    }));
}

/** One closed grammar for advertisement and admission, without provider-authored factual text. */
export function createAnswerRespondParameters(
    metricIds: readonly AnswerMetricId[]
): ToolSchema['function']['parameters'] {
    return {
        type: 'object',
        additionalProperties: false,
        properties: {
            intakeCallId: { type: 'string', minLength: 1, maxLength: ANSWER_RESPOND_MAX_CALL_ID_LENGTH },
            statements: {
                type: 'array',
                minItems: 1,
                maxItems: ANSWER_RESPOND_MAX_STATEMENTS,
                items: { oneOf: createAnswerStatementSchemas(metricIds) },
            },
        },
        required: ['intakeCallId', 'statements'],
    };
}
