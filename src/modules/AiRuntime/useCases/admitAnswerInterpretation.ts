import { getAgentMeasurementMetricIds } from '#/modules/AudioAnalysis/useCases';

import {
    ANSWER_KINDS,
    ANSWER_TOPICS,
    createAnswerInterpretationToolSchema,
    type AnswerInterpretationCatalog,
    type AnswerScopeCandidate,
} from '../models/AnswerInterpretation';
import { type ToolCallResult } from '../models/ToolCallResult';
import { matchesJsonSchema } from '../validators/matchesJsonSchema';

import { type AnswerRequestAuthority } from './answerContractTypes';

export type AnswerInterpretationAdmission =
    { status: 'admitted'; authority: AnswerRequestAuthority } | { status: 'clarify' | 'rejected'; reason: string };

function resolveScopes(catalog: AnswerInterpretationCatalog, ids: unknown): AnswerScopeCandidate[] | null {
    const selected = catalog.scopes.filter((scope) => Array.isArray(ids) && ids.includes(scope.candidateId));
    const objectIds = selected.flatMap((scope) => scope.objectIds);
    if (new Set(objectIds).size !== objectIds.length) {
        return null;
    }
    if (selected.some((scope) => scope.kind === 'clips') && selected.some((scope) => scope.kind !== 'clips')) {
        return null;
    }
    const groups = new Map<AnswerScopeCandidate['kind'], AnswerScopeCandidate>();
    for (const scope of selected) {
        const prior = groups.get(scope.kind);
        if (prior === undefined) {
            groups.set(scope.kind, structuredClone(scope));
            continue;
        }
        groups.set(scope.kind, {
            candidateId: `selected-${scope.kind}`,
            kind: scope.kind,
            objectIds: [...prior.objectIds, ...scope.objectIds],
            labels: [...prior.labels, ...scope.labels],
        });
    }
    return [...groups.values()];
}

export function admitAnswerInterpretation(input: {
    catalog: AnswerInterpretationCatalog;
    call: ToolCallResult;
    projectRevision: string;
}): AnswerInterpretationAdmission {
    const { catalog } = input;
    const args = input.call.arguments;
    if (!matchesJsonSchema(args, createAnswerInterpretationToolSchema(catalog).function.parameters)) {
        return { status: 'rejected', reason: 'Answer interpretation does not match the published schema.' };
    }
    const kind = ANSWER_KINDS.find((value) => value === args.kind);
    if (kind === undefined) {
        return { status: 'rejected', reason: 'Answer interpretation selected an unknown kind.' };
    }
    const topics = ANSWER_TOPICS.filter((topic) => Array.isArray(args.topicIds) && args.topicIds.includes(topic));
    if (args.catalogId !== catalog.catalogId || input.projectRevision !== catalog.revision) {
        return { status: 'rejected', reason: 'Answer interpretation refers to a stale or unknown catalog.' };
    }
    const scopes = resolveScopes(catalog, args.scopeCandidateIds);
    if (scopes === null) {
        return { status: 'rejected', reason: 'Answer interpretation selected overlapping or mixed scopes.' };
    }
    const range = catalog.ranges.find((entry) => entry.candidateId === args.rangeCandidateId) ?? null;
    if (range === null && args.rangeCandidateId !== null) {
        return { status: 'rejected', reason: 'Answer interpretation selected an unknown candidate.' };
    }
    if (args.uncertainty !== 'none') {
        return { status: 'clarify', reason: 'Please clarify the question, target or range to analyze.' };
    }
    if (
        (kind === 'measured-audio' &&
            (scopes.length === 0 ||
                scopes.some((scope) => scope.kind === 'clips') ||
                range === null ||
                topics.length === 0)) ||
        (kind === 'source-onsets' &&
            (scopes.length === 0 ||
                scopes.some((scope) => scope.kind !== 'clips') ||
                range !== null ||
                topics.length > 0)) ||
        ((kind === 'project-facts' || kind === 'catalog-knowledge') && (topics.length > 0 || range !== null))
    ) {
        return { status: 'rejected', reason: 'Answer interpretation has contradictory kind, scope, range or topics.' };
    }
    const selectedTopics = ANSWER_TOPICS.filter((topic) => topics.includes(topic));
    return {
        status: 'admitted',
        authority: structuredClone({
            schemaVersion: 1,
            catalogId: catalog.catalogId,
            requestDigest: catalog.requestDigest,
            revision: catalog.revision,
            selection: catalog.selection,
            kind,
            topics: selectedTopics,
            scopes,
            scopeCandidateIds: catalog.scopes
                .filter(
                    (scope) =>
                        Array.isArray(args.scopeCandidateIds) && args.scopeCandidateIds.includes(scope.candidateId)
                )
                .map((scope) => scope.candidateId),
            range,
            requiredMetrics: kind === 'measured-audio' ? getAgentMeasurementMetricIds() : [],
            context: catalog.context,
        }),
    };
}
