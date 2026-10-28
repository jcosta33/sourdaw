import { getAgentMeasurementMetricIds } from '#/modules/AudioAnalysis/useCases';

import {
    createAnswerRespondParameters,
    type AnswerMetricReference,
    type AnswerRespondArguments,
    type AnswerStatement,
} from '../models/AnswerRespond';
import { matchesJsonSchema } from '../validators/matchesJsonSchema';

function isAnswerDocument(args: Readonly<Record<string, unknown>>): args is AnswerRespondArguments {
    return matchesJsonSchema(args, createAnswerRespondParameters(getAgentMeasurementMetricIds()));
}

function hasCompatibleBand(reference: AnswerMetricReference): boolean {
    return reference.band === undefined || reference.metricId === 'frequencyBandEnergy';
}

function hasCompatibleReferences(statement: AnswerStatement): boolean {
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
export function parseAnswerRespond(
    args: Readonly<Record<string, unknown>>
): { status: 'accepted'; answer: AnswerRespondArguments } | { status: 'rejected'; reason: string } {
    if (
        !isAnswerDocument(args) ||
        args.intakeCallId.trim().length === 0 ||
        !args.statements.every(hasCompatibleReferences)
    ) {
        return { status: 'rejected', reason: 'Provider answer must be a bounded closed factual document.' };
    }
    return { status: 'accepted', answer: structuredClone(args) };
}
