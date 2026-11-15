import { getMixRecipeCatalog } from '#/modules/Arrangement/useCases';
import { getAgentMeasurementMetricIds } from '#/modules/AudioAnalysis/useCases';
import { captureProjectIdentity } from '#/modules/CrdtDocument/useCases';
import { digest } from '#/utils/canonicalDigest';

import { type AnswerInterpretationCatalog } from '../models/AnswerInterpretation';

import { expandMixRecipe } from './expandMixRecipe';
import { type MetricGoal } from './metricGoalContractTypes';
import { readRecipeExpectationTolerance } from './metricHoldTolerances';
import { type ComparedQuality, readComparedQualities } from './readComparedQualities';
import { readRequestMetricNumbers } from './readRequestMetricNumbers';
import { readUnaccountedQualityWord } from './readUnaccountedQualityWord';

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

type RecipeCatalog = ReturnType<typeof getMixRecipeCatalog>;
type MetricIds = ReturnType<typeof getAgentMeasurementMetricIds>;
type AnswerScopes = AnswerInterpretationCatalog['scopes'];

type OrderingPolicy = {
    quality: ComparedQuality;
    idPrefix: string;
    metricId: 'integratedLoudness' | 'spectralCentroid' | 'sideEnergyFraction' | 'crestFactor';
    policyId: Extract<
        Extract<MetricGoal['source'], { kind: 'policy' }>['policyId'],
        | 'integrated-loudness-comparison-v1'
        | 'spectral-centroid-comparison-v1'
        | 'side-energy-fraction-comparison-v1'
        | 'crest-factor-comparison-v1'
    >;
    description: string;
};

/**
 * Punch is judged by crest factor beside dynamics: five of the seven authored `*-punchy` recipes move it up,
 * while `transientDensity` is only held in them and counts transients rather than how hard they land.
 */
const ORDERING_POLICIES: readonly OrderingPolicy[] = [
    {
        quality: 'loudness',
        idPrefix: 'loudness',
        metricId: 'integratedLoudness',
        policyId: 'integrated-loudness-comparison-v1',
        description: 'actual preview integrated loudness than the reference',
    },
    {
        quality: 'brightness',
        idPrefix: 'centroid',
        metricId: 'spectralCentroid',
        policyId: 'spectral-centroid-comparison-v1',
        description: 'actual preview spectral centroid; objective brightness proxy only',
    },
    {
        quality: 'width',
        idPrefix: 'side-energy',
        metricId: 'sideEnergyFraction',
        policyId: 'side-energy-fraction-comparison-v1',
        description: 'actual preview side energy fraction than the reference; stereo width proxy',
    },
    {
        quality: 'dynamics',
        idPrefix: 'crest',
        metricId: 'crestFactor',
        policyId: 'crest-factor-comparison-v1',
        description: 'actual preview crest factor than the reference; dynamics and punch proxy',
    },
];

function policyObjective(input: {
    id: string;
    label: string;
    allScopeIds: string[];
    goal: Objective['goals'][number];
}): Objective {
    return {
        id: input.id,
        label: input.label,
        eligibleScopeIds: input.allScopeIds,
        defaultScopeIds: input.allScopeIds,
        roles: [],
        goals: [input.goal],
    };
}

function orderingObjectives(policy: OrderingPolicy, allScopeIds: string[]): Objective[] {
    return (
        [
            ['higher', 'Higher', 'greater-than-current'],
            ['lower', 'Lower', 'less-than-current'],
        ] as const
    ).map(([direction, word, relation]) =>
        policyObjective({
            id: `${policy.idPrefix}-${direction}`,
            label: `${word} ${policy.description}`,
            allScopeIds,
            goal: {
                metricId: policy.metricId,
                metricName: policy.metricId,
                band: null,
                relation,
                targetValue: null,
                tolerance: 0,
                source: { kind: 'policy', policyId: policy.policyId },
            },
        })
    );
}

/**
 * The loudness match and the spectral-centroid pair were published for every request on main, and stay so:
 * no reading of the request's wording, which depends on quote heuristics that misread elisions, may withdraw
 * them. The orderings added since cost planner text (#6706), so each is published only when the request
 * names its quality outside track names and quotations.
 */
function policyObjectives(
    scopes: AnswerScopes,
    allScopeIds: string[],
    named: ReadonlySet<ComparedQuality>
): Objective[] {
    const objectives: Objective[] = [];
    objectives.push(
        policyObjective({
            id: 'loudness-match',
            label: 'Match actual preview integrated loudness; app policy integrated-loudness-match-v1 (0.1 LU)',
            allScopeIds,
            goal: {
                metricId: 'integratedLoudness',
                metricName: 'integratedLoudness',
                band: null,
                relation: 'match-current',
                targetValue: null,
                tolerance: 0.1,
                source: { kind: 'policy', policyId: 'integrated-loudness-match-v1' },
            },
        })
    );
    for (const policy of ORDERING_POLICIES) {
        const published = policy.quality === 'brightness' || named.has(policy.quality);
        if (published) {
            objectives.push(...orderingObjectives(policy, allScopeIds));
        }
    }
    objectives.push({
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
    });
    return objectives;
}

/**
 * The metric and tolerance a recipe expectation compiles with. A metric the application cannot measure,
 * or a hold on one with no versioned tolerance, compiles unsupported with no metric: admission blocks it
 * as incomparable, and no hold is ever compiled at a zero that rounding would break.
 */
function readRecipeGoalMetric(
    expectation: { metric: string; direction: MetricGoal['relation'] },
    metricIds: MetricIds
): Pick<Objective['goals'][number], 'metricName' | 'metricId' | 'tolerance'> {
    const metricId = metricIds.find((metric) => metric === expectation.metric) ?? null;
    const tolerance = metricId === null ? null : readRecipeExpectationTolerance(metricId, expectation.direction);
    if (metricId === null || tolerance?.status !== 'read') {
        return { metricName: expectation.metric, metricId: null, tolerance: 0 };
    }
    return { metricName: expectation.metric, metricId, tolerance: tolerance.tolerance };
}

function recipeObjectives(
    answer: AnswerInterpretationCatalog,
    catalog: RecipeCatalog,
    metricIds: MetricIds
): Objective[] {
    const scopes = answer.scopes;
    const objectives: Objective[] = [];
    for (const recipe of catalog.recipes) {
        if (recipe.origin !== undefined || recipe.metrics.length === 0) {
            continue;
        }
        const eligibility = new Map<string, { defaultAllowed: boolean; roles: string[] }>();
        for (const targetId of new Set(
            scopes.filter((scope) => scope.kind !== 'clips').flatMap((scope) => scope.objectIds)
        )) {
            const defaultAllowed =
                expandMixRecipe({ recipeId: recipe.id, targetId, role: null, values: [] }, answer.context, 1, catalog)
                    .status === 'expanded';
            const roles = recipe.roles.filter(
                (role) =>
                    expandMixRecipe({ recipeId: recipe.id, targetId, role, values: [] }, answer.context, 1, catalog)
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
                ...readRecipeGoalMetric(expectation, metricIds),
                band: expectation.band ?? null,
                relation: expectation.direction,
                targetValue: null,
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
    return objectives;
}

function numericObjectives(prompt: string, allScopeIds: string[]): Objective[] {
    const objectives: Objective[] = [];
    for (const number of readRequestMetricNumbers(prompt)) {
        const id = number.candidateId;
        objectives.push({
            id,
            label: number.token,
            eligibleScopeIds: allScopeIds,
            defaultScopeIds: allScopeIds,
            roles: [],
            goals: [
                {
                    metricId: number.metricId,
                    metricName: number.metricId,
                    band: null,
                    relation: 'target',
                    targetValue: number.value,
                    tolerance: 0,
                    source: { kind: 'request-number', candidateId: id, token: number.token },
                },
            ],
        });
    }
    return objectives;
}

/** Lexical numeric candidates and authored policies, never a second semantic classifier. */
export function prepareMetricIntentCatalog(input: { prompt: string; answer: AnswerInterpretationCatalog }) {
    const catalog = getMixRecipeCatalog();
    const metricIds = getAgentMeasurementMetricIds();
    const scopes = input.answer.scopes;
    const allScopeIds = scopes.filter((scope) => scope.kind !== 'clips').map((scope) => scope.candidateId);
    const objectives = [
        ...policyObjectives(scopes, allScopeIds, readComparedQualities(input.prompt, input.answer.context)),
        ...recipeObjectives(input.answer, catalog, metricIds),
        ...numericObjectives(input.prompt, allScopeIds),
    ];
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
        unaccountedQualityWord: readUnaccountedQualityWord(input.prompt, input.answer.context),
        objectives: objectives.map((objective, index) => ({ ...objective, id: `o${String(index)}` })),
    };
}
