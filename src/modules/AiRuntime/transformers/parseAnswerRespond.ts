import {
    createAnswerRespondParameters,
    type AnswerMetricReference,
    type AnswerRespondArguments,
    type AnswerStatement,
} from '../models/AnswerRespond';
import { matchesJsonSchema } from '../validators/matchesJsonSchema';

function isAnswerDocument<MetricId extends string>(
    args: Readonly<Record<string, unknown>>,
    metricIds: readonly MetricId[]
): args is AnswerRespondArguments<MetricId> {
    return matchesJsonSchema(args, createAnswerRespondParameters(metricIds));
}

function hasCompatibleBand<MetricId extends string>(reference: AnswerMetricReference<MetricId>): boolean {
    return reference.band === undefined || reference.metricId === 'frequencyBandEnergy';
}

function hasCompatibleReferences<MetricId extends string>(statement: AnswerStatement<MetricId>): boolean {
    switch (statement.kind) {
        case 'metric':
            return hasCompatibleBand(statement.reference);
        case 'difference':
            return hasCompatibleBand(statement.left) && hasCompatibleBand(statement.right);
        case 'ranking':
            return statement.references.every(hasCompatibleBand);
        default:
            return true;
    }
}

/** No provider-authored prose, value, unit, winner or arbitrary receipt pointer is admitted. */
export function parseAnswerRespond<MetricId extends string>(
    args: Readonly<Record<string, unknown>>,
    metricIds: readonly MetricId[]
): { status: 'accepted'; answer: AnswerRespondArguments<MetricId> } | { status: 'rejected'; reason: string } {
    if (
        !isAnswerDocument(args, metricIds) ||
        args.intakeCallId.trim().length === 0 ||
        !args.statements.every(hasCompatibleReferences)
    ) {
        return { status: 'rejected', reason: 'Provider answer must be a bounded closed factual document.' };
    }
    return { status: 'accepted', answer: structuredClone(args) };
}
