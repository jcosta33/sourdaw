import { getMixRecipeCatalog } from '#/modules/Arrangement/useCases';
import { getAgentMeasurementMetricIds } from '#/modules/AudioAnalysis/useCases';
import { captureProjectIdentity } from '#/modules/CrdtDocument/useCases';
import { digest } from '#/utils/canonicalDigest';

import { type AnswerInterpretationCatalog } from '../models/AnswerInterpretation';

import { type MetricGoal } from './metricGoalContractTypes';
import { resolveRecipeTarget } from './resolveRecipeTarget';

type Objective = {
    id: string;
    label: string;
    eligibleScopeIds: string[];
    goals: Array<Pick<MetricGoal, 'metricId' | 'band' | 'relation' | 'targetValue' | 'tolerance' | 'source'>>;
};
export type MetricIntentCatalog = ReturnType<typeof prepareMetricIntentCatalog>;

/** Lexical numeric candidates and authored policies, never a second semantic classifier. */
export function prepareMetricIntentCatalog(input: { prompt: string; answer: AnswerInterpretationCatalog }) {
    const catalog = getMixRecipeCatalog();
    const metricIds = getAgentMeasurementMetricIds();
    const scopes = input.answer.scopes;
    const allScopeIds = scopes.filter((scope) => scope.kind !== 'clips').map((scope) => scope.candidateId);
    const objectives: Objective[] = [
        {
            id: 'loudness-match',
            label: 'Match actual preview integrated loudness; app policy integrated-loudness-match-v1 (0.1 LU)',
            eligibleScopeIds: allScopeIds,
            goals: [
                {
                    metricId: 'integratedLoudness',
                    band: null,
                    relation: 'match-current',
                    targetValue: null,
                    tolerance: 0.1,
                    source: { kind: 'policy', policyId: 'integrated-loudness-match-v1' },
                },
            ],
        },
        {
            id: 'centroid-higher',
            label: 'Higher actual preview spectral centroid; objective brightness proxy only',
            eligibleScopeIds: allScopeIds,
            goals: [
                {
                    metricId: 'spectralCentroid',
                    band: null,
                    relation: 'greater-than-current',
                    targetValue: null,
                    tolerance: 0,
                    source: { kind: 'policy', policyId: 'spectral-centroid-comparison-v1' },
                },
            ],
        },
        {
            id: 'centroid-lower',
            label: 'Lower actual preview spectral centroid; objective brightness proxy only',
            eligibleScopeIds: allScopeIds,
            goals: [
                {
                    metricId: 'spectralCentroid',
                    band: null,
                    relation: 'less-than-current',
                    targetValue: null,
                    tolerance: 0,
                    source: { kind: 'policy', policyId: 'spectral-centroid-comparison-v1' },
                },
            ],
        },
        {
            id: 'unsupported',
            label: 'No compatible authored objective metric; keep plan unverified',
            eligibleScopeIds: scopes.map((scope) => scope.candidateId),
            goals: [
                {
                    metricId: null,
                    band: null,
                    relation: 'unsupported',
                    targetValue: null,
                    tolerance: 0,
                    source: { kind: 'unsupported' },
                },
            ],
        },
    ];
    for (const recipe of catalog.recipes) {
        if (recipe.origin !== undefined || recipe.metrics.length === 0) {
            continue;
        }
        const eligibleScopeIds = scopes
            .filter((scope) =>
                scope.objectIds.every((targetId) => {
                    const resolved = resolveRecipeTarget({
                        catalog,
                        tracks: input.answer.context.tracks,
                        targetId,
                        roleArgument: null,
                    });
                    return (
                        resolved.status === 'resolved' &&
                        resolved.target !== null &&
                        resolved.target.kind !== 'folder' &&
                        !resolved.target.frozen &&
                        (resolved.role.recipeRole === null || recipe.roles.includes(resolved.role.recipeRole))
                    );
                })
            )
            .map((scope) => scope.candidateId);
        if (eligibleScopeIds.length === 0) {
            continue;
        }
        objectives.push({
            id: `recipe:${recipe.id}`,
            label: recipe.title,
            eligibleScopeIds,
            goals: recipe.metrics.map((expectation, expectationIndex) => ({
                metricId: metricIds.find((metric) => metric === expectation.metric) ?? null,
                band: expectation.band ?? null,
                relation: expectation.direction,
                targetValue: null,
                tolerance: 0,
                source: {
                    kind: 'recipe',
                    recipeId: recipe.id,
                    catalogVersion: catalog.version,
                    recipeDigest: digest(recipe),
                    expectationIndex,
                },
            })),
        });
    }
    const numericMetrics = new Map([
        ['LUFS', 'integratedLoudness'],
        ['dBTP', 'truePeak'],
        ['dBFS', 'rms'],
        ['Hz', 'spectralCentroid'],
    ] as const);
    for (const match of input.prompt.matchAll(/(?<![\w.])(-?\d+(?:\.\d+)?)\s*(LUFS|dBTP|dBFS|Hz)\b/gu)) {
        const value = Number(match[1]);
        const metricId = [...numericMetrics].find(([unit]) => unit === match[2])?.[1];
        if (!Number.isFinite(value) || metricId === undefined) {
            continue;
        }
        const id = `number:${String(match.index)}`;
        objectives.push({
            id,
            label: match[0],
            eligibleScopeIds: allScopeIds,
            goals: [
                {
                    metricId,
                    band: null,
                    relation: 'target',
                    targetValue: value,
                    tolerance: 0,
                    source: { kind: 'request-number', candidateId: id, token: match[0] },
                },
            ],
        });
    }
    return {
        schemaVersion: 1 as const,
        catalogId: input.answer.catalogId,
        requestDigest: input.answer.requestDigest,
        revision: input.answer.revision,
        projectId: captureProjectIdentity(),
        selection: structuredClone(input.answer.selection),
        scopes,
        ranges: input.answer.ranges,
        objectives,
    };
}
