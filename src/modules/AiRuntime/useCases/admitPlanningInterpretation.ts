import { type AnswerInterpretationCatalog } from '../models/AnswerInterpretation';
import {
    isPublicCreativeInterpretation,
    type CreativeInterpretationCatalog,
    type CreativeRequestAuthority,
} from '../models/CreativeInterpretation';
import { type ToolCallResult } from '../models/ToolCallResult';

import { admitAnswerInterpretation } from './admitAnswerInterpretation';
import { admitCreativeInterpretation } from './admitCreativeInterpretation';
import { admitMetricIntent } from './admitMetricIntent';
import { type MetricIntentCatalog } from './prepareMetricIntentCatalog';

const BRIEF_REQUIRES_NON_ACOUSTIC =
    'A brief interpretation classifies the whole request in metricIntent as non-acoustic with no objectives.';
const AGENT_DECIDED_REQUIRES_ACOUSTIC_INTENT =
    'An agent-decided target is admitted only for a request whose metricIntent is perceptual or comparative.';

/**
 * The catalog offers agent-decided targets whenever a request names nothing, because it cannot know
 * the request's metric kind; the provider states that kind here, in the same call. Only a perceptual
 * or comparative request leaves the choice of object to the agent, so every other kind, and a
 * selection with no metric intent at all, may not keep a target the user never pointed at.
 */
function selectsAgentDecidedTarget(authority: CreativeRequestAuthority): boolean {
    return authority.targets.some((target) => target.provenance === 'agent-decided');
}

type PlanningInterpretationInput = {
    creative: CreativeInterpretationCatalog;
    answer: AnswerInterpretationCatalog;
    call: ToolCallResult;
    projectRevision: string;
    metric?: MetricIntentCatalog;
    turn?: number;
};

function admitLiteralInterpretation(
    input: PlanningInterpretationInput,
    legacyArguments: ToolCallResult['arguments'],
    metricIntent: unknown
) {
    if (
        input.metric === undefined ||
        legacyArguments.catalogId !== input.creative.catalogId ||
        legacyArguments.uncertainty !== 'none' ||
        Object.keys(legacyArguments).length !== 7 ||
        !['targetCandidateIds', 'editDimensionCandidateIds', 'constraintCandidateIds', 'creationSlotIds'].every(
            (key) => {
                const entries = legacyArguments[key];
                return Array.isArray(entries) && entries.length === 0;
            }
        )
    ) {
        return {
            status: 'rejected' as const,
            reason: 'Literal metric intake cannot grant creative authority.',
        };
    }
    if (input.metric.unaccountedQualityWord !== null) {
        return {
            status: 'rejected' as const,
            reason: `The request names "${input.metric.unaccountedQualityWord}", a perceptual quality, so it is not a literal request. Interpret it as a perceptual or comparative goal instead.`,
        };
    }
    const admitted = admitMetricIntent({
        catalog: input.metric,
        value: metricIntent,
        creativeAuthority: null,
        callId: input.call.id ?? '',
        turn: input.turn ?? 0,
    });
    if (admitted.status !== 'admitted') {
        return admitted;
    }
    if (admitted.authority.kind !== 'literal') {
        return {
            status: 'rejected' as const,
            reason: 'Literal mode requires positive whole-request literal intent.',
        };
    }
    return { status: 'admitted' as const, kind: 'literal' as const, metricAuthority: admitted.authority };
}

function admitCreativeInterpretationWithMetricIntent(
    input: PlanningInterpretationInput,
    legacyArguments: ToolCallResult['arguments'],
    metricIntent: unknown
) {
    const result = admitCreativeInterpretation({
        catalog: input.creative,
        call: { ...input.call, arguments: legacyArguments },
        projectRevision: input.projectRevision,
    });
    if (result.status !== 'admitted') {
        return result;
    }
    const isBrief = result.authority.mode === 'brief';
    if (isBrief && (metricIntent === undefined || metricIntent === null)) {
        return { status: 'rejected' as const, reason: BRIEF_REQUIRES_NON_ACOUSTIC };
    }
    if (metricIntent === undefined || metricIntent === null) {
        if (selectsAgentDecidedTarget(result.authority)) {
            return { status: 'rejected' as const, reason: AGENT_DECIDED_REQUIRES_ACOUSTIC_INTENT };
        }
        return { ...result, kind: 'creative' as const };
    }
    if (input.metric === undefined) {
        return { status: 'rejected' as const, reason: 'Metric interpretation has no captured catalog.' };
    }
    const admitted = admitMetricIntent({
        catalog: input.metric,
        value: metricIntent,
        creativeAuthority: result.authority,
        callId: input.call.id ?? '',
        turn: input.turn ?? 0,
    });
    if (admitted.status !== 'admitted') {
        return admitted;
    }
    if (
        selectsAgentDecidedTarget(result.authority) &&
        admitted.authority.kind !== 'perceptual' &&
        admitted.authority.kind !== 'comparative'
    ) {
        return { status: 'rejected' as const, reason: AGENT_DECIDED_REQUIRES_ACOUSTIC_INTENT };
    }
    if (admitted.authority.kind === 'literal') {
        return {
            status: 'rejected' as const,
            reason: 'A literal intake must use the isolated literal control mode.',
        };
    }
    // A brief changes no sound, so it can carry no acoustic objective a preview would have to prove.
    if (isBrief && admitted.authority.kind !== 'non-acoustic') {
        return { status: 'rejected' as const, reason: BRIEF_REQUIRES_NON_ACOUSTIC };
    }
    return { ...result, kind: 'creative' as const, metricAuthority: admitted.authority };
}

function admitJointAnswerInterpretation(input: PlanningInterpretationInput, answer: unknown, metricIntent: unknown) {
    if (metricIntent !== undefined && metricIntent !== null) {
        return { status: 'rejected' as const, reason: 'Answer and mutation metric intent cannot be mixed.' };
    }
    if (
        answer === null ||
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
        keys.length !== (Object.hasOwn(input.call.arguments, 'metricIntent') ? 9 : 8) ||
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
                'metricIntent',
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

export function admitPlanningInterpretation(input: PlanningInterpretationInput) {
    const { answer, metricIntent, creativeInterpretation, ...legacyArguments } = input.call.arguments;
    if (creativeInterpretation !== undefined && !isPublicCreativeInterpretation(creativeInterpretation)) {
        return {
            status: 'rejected' as const,
            reason: 'Public creative interpretation must be nonempty and at most 512 UTF-8 bytes.',
        };
    }
    if (
        metricIntent !== undefined &&
        metricIntent !== null &&
        input.metric !== undefined &&
        (input.metric.catalogId !== input.answer.catalogId ||
            input.metric.revision !== input.projectRevision ||
            input.metric.requestDigest !== input.creative.requestDigest ||
            JSON.stringify(input.metric.selection) !== JSON.stringify(input.creative.selection))
    ) {
        return {
            status: 'rejected' as const,
            reason: 'Metric interpretation does not share the captured request, revision and selection.',
        };
    }
    if (answer === undefined || answer === null) {
        if (metricIntent !== undefined && metricIntent !== null && input.metric === undefined) {
            return { status: 'rejected' as const, reason: 'Metric interpretation has no published catalog.' };
        }
        if (legacyArguments.modeId === 'literal') {
            return admitLiteralInterpretation(input, legacyArguments, metricIntent);
        }
        const result = admitCreativeInterpretationWithMetricIntent(input, legacyArguments, metricIntent);
        if (result.status === 'admitted' && creativeInterpretation !== undefined) {
            return { ...result, creativeInterpretation };
        }
        return result;
    }
    return admitJointAnswerInterpretation(input, answer, metricIntent);
}
