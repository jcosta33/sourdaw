import { type AnswerInterpretationCatalog } from '../models/AnswerInterpretation';
import { type CreativeInterpretationCatalog } from '../models/CreativeInterpretation';
import { type ToolCallResult } from '../models/ToolCallResult';

import { admitAnswerInterpretation } from './admitAnswerInterpretation';
import { admitCreativeInterpretation } from './admitCreativeInterpretation';

export function admitPlanningInterpretation(input: {
    creative: CreativeInterpretationCatalog;
    answer: AnswerInterpretationCatalog;
    call: ToolCallResult;
    projectRevision: string;
}) {
    const { answer, ...legacyArguments } = input.call.arguments;
    if (answer === undefined || answer === null) {
        const result = admitCreativeInterpretation({
            catalog: input.creative,
            call: { ...input.call, arguments: legacyArguments },
            projectRevision: input.projectRevision,
        });
        return result.status === 'admitted' ? { ...result, kind: 'creative' as const } : result;
    }
    if (
        typeof answer !== 'object' ||
        Array.isArray(answer) ||
        input.call.arguments.catalogId !== input.creative.catalogId ||
        input.call.arguments.modeId !== 'read-only' ||
        input.call.arguments.uncertainty !== 'none' ||
        !['targetCandidateIds', 'editDimensionCandidateIds', 'constraintCandidateIds', 'creationSlotIds'].every(
            (key) => {
                const values = input.call.arguments[key];
                return Array.isArray(values) && values.length === 0;
            }
        )
    ) {
        return { status: 'rejected' as const, reason: 'Joint answer interpretation cannot grant creative authority.' };
    }
    const keys = Object.keys(input.call.arguments);
    if (
        keys.length !== 8 ||
        !keys.every((key) =>
            [
                'catalogId',
                'modeId',
                'uncertainty',
                'targetCandidateIds',
                'editDimensionCandidateIds',
                'constraintCandidateIds',
                'creationSlotIds',
                'answer',
            ].includes(key)
        ) ||
        Object.hasOwn(answer, 'catalogId')
    ) {
        return {
            status: 'rejected' as const,
            reason: 'Joint answer interpretation does not match its closed contract.',
        };
    }
    const result = admitAnswerInterpretation({
        catalog: input.answer,
        call: { ...input.call, arguments: { ...answer, catalogId: input.answer.catalogId } },
        projectRevision: input.projectRevision,
    });
    return result.status === 'admitted' ? { ...result, kind: 'answer' as const } : result;
}
