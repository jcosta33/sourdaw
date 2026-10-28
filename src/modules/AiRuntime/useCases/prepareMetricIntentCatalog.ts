import { getMixRecipeCatalog } from '#/modules/Arrangement/useCases';
import { getAgentMeasurementMetricIds } from '#/modules/AudioAnalysis/useCases';
import { captureProjectIdentity } from '#/modules/CrdtDocument/useCases';
import { digest } from '#/utils/canonicalDigest';

import { type AnswerInterpretationCatalog } from '../models/AnswerInterpretation';

import { expandMixRecipe } from './expandMixRecipe';
import { type MetricGoal } from './metricGoalContractTypes';

type Objective = {
    id: string;
    label: string;
    eligibleScopeIds: string[];
    defaultScopeIds: string[];
    roles: string[];
    goals: Array<
        { metricName: string } & Pick<
            MetricGoal,
            'metricId' | 'band' | 'relation' | 'targetValue' | 'tolerance' | 'source'
        >
    >;
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
            defaultScopeIds: allScopeIds,
            roles: [],
            goals: [
                {
                    metricId: 'integratedLoudness',
                    metricName: 'integratedLoudness',
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
            defaultScopeIds: allScopeIds,
            roles: [],
            goals: [
                {
                    metricId: 'spectralCentroid',
                    metricName: 'spectralCentroid',
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
            defaultScopeIds: allScopeIds,
            roles: [],
            goals: [
                {
                    metricId: 'spectralCentroid',
                    metricName: 'spectralCentroid',
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
            defaultScopeIds: scopes.map((scope) => scope.candidateId),
            roles: [],
            goals: [
                {
                    metricId: null,
                    metricName: 'unsupported',
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
        const eligibility = new Map<string, { defaultAllowed: boolean; roles: string[] }>();
        for (const targetId of new Set(
            scopes.filter((scope) => scope.kind !== 'clips').flatMap((scope) => scope.objectIds)
        )) {
            const defaultAllowed =
                expandMixRecipe({ recipeId: recipe.id, targetId, role: null, values: [] }, input.answer.context, 1)
                    .status === 'expanded';
            const roles = recipe.roles.filter(
                (role) =>
                    expandMixRecipe({ recipeId: recipe.id, targetId, role, values: [] }, input.answer.context, 1)
                        .status === 'expanded'
            );
            eligibility.set(targetId, { defaultAllowed, roles });
        }
        // The owner admits unknown/overridden roles only with a legal explicit role argument.
        const eligibleScopeIds = scopes
            .filter(
                (scope) =>
                    scope.kind !== 'clips' &&
                    scope.objectIds.every(
                        (id) =>
                            eligibility.get(id)?.defaultAllowed === true || (eligibility.get(id)?.roles.length ?? 0) > 0
                    )
            )
            .map((scope) => scope.candidateId);
        const defaultScopeIds = scopes
            .filter(
                (scope) =>
                    scope.kind !== 'clips' &&
                    scope.objectIds.every((id) => eligibility.get(id)?.defaultAllowed === true)
            )
            .map((scope) => scope.candidateId);
        if (eligibleScopeIds.length === 0) {
            continue;
        }
        objectives.push({
            id: `recipe:${recipe.id}`,
            label: recipe.title,
            eligibleScopeIds,
            defaultScopeIds,
            roles: [...recipe.roles],
            goals: recipe.metrics.map((expectation, expectationIndex) => ({
                metricName: expectation.metric,
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
            defaultScopeIds: allScopeIds,
            roles: [],
            goals: [
                {
                    metricId,
                    metricName: metricId,
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
        // Wire ids are bounded enum members; original source identities remain app-private lookup facts.
        objectives: objectives.map((objective, index) => ({ ...objective, id: `o${String(index)}` })),
    };
}
