import { digest } from '#/utils/canonicalDigest';

import { type CreativeRequestAuthority } from '../models/CreativeInterpretation';
import { MAX_LLM_ACTIONS_PER_BATCH } from '../models/LlmActionLimits';

import { type MetricGoal, type MetricRequestAuthority } from './metricGoalContractTypes';
import { type MetricIntentCatalog } from './prepareMetricIntentCatalog';

type MetricIntentInput = {
    catalog: MetricIntentCatalog;
    value: unknown;
    creativeAuthority: CreativeRequestAuthority | null;
    callId: string;
    turn: number;
};
type IntentValue = { kind: string; uncertainty: string; objectives: unknown[] };
type Refusal = { status: 'rejected' | 'clarify'; reason: string };
type SelectionCandidates = {
    candidate: MetricIntentCatalog['objectives'][number];
    scope: MetricIntentCatalog['scopes'][number] | undefined;
    reference: MetricIntentCatalog['scopes'][number] | undefined;
    range: MetricIntentCatalog['ranges'][number] | undefined;
};

function oneOf(entry: unknown, values: readonly string[]): entry is string {
    return typeof entry === 'string' && values.includes(entry);
}

function record(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function intentValue(value: unknown): value is IntentValue {
    return (
        record(value) &&
        Object.keys(value).length === 3 &&
        ['kind', 'objectives', 'uncertainty'].every((key) => Object.hasOwn(value, key)) &&
        oneOf(value.kind, ['literal', 'perceptual', 'comparative']) &&
        Array.isArray(value.objectives) &&
        value.objectives.length <= MAX_LLM_ACTIONS_PER_BATCH &&
        oneOf(value.uncertainty, ['none', 'meaning', 'target', 'range'])
    );
}

function semanticIntentRefusal(value: IntentValue, authority: CreativeRequestAuthority | null): Refusal | null {
    if (value.uncertainty !== 'none') {
        return {
            status: 'clarify',
            reason: 'The whole request needs an unambiguous objective, subject and range before approval.',
        };
    }
    if (value.kind === 'literal' && value.objectives.length !== 0) {
        return { status: 'rejected', reason: 'A literal intake cannot carry acoustic objectives.' };
    }
    if (value.kind !== 'literal' && (value.objectives.length === 0 || authority === null)) {
        return {
            status: 'rejected',
            reason: 'A perceptual intake requires bounded creative authority and a published objective.',
        };
    }
    return null;
}

function resolveMetricSelection(
    catalog: MetricIntentCatalog,
    selection: unknown
): { status: 'resolved'; selection: Record<string, unknown>; candidates: SelectionCandidates } | Refusal {
    if (
        !record(selection) ||
        Object.keys(selection).length !== 4 ||
        !['objectiveId', 'scopeCandidateId', 'referenceScopeCandidateId', 'rangeCandidateId'].every((key) =>
            Object.hasOwn(selection, key)
        )
    ) {
        return { status: 'rejected', reason: 'A metric objective selection has unknown or missing fields.' };
    }
    const candidate = catalog.objectives.find((entry) => entry.id === selection.objectiveId);
    const scope = catalog.scopes.find((entry) => entry.candidateId === selection.scopeCandidateId);
    const reference = catalog.scopes.find((entry) => entry.candidateId === selection.referenceScopeCandidateId);
    const range = catalog.ranges.find((entry) => entry.candidateId === selection.rangeCandidateId);
    if (
        candidate === undefined ||
        (scope === undefined &&
            !(
                candidate.goals.every((goal) => goal.source.kind === 'unsupported') &&
                selection.scopeCandidateId === null
            )) ||
        (scope !== undefined && !candidate.eligibleScopeIds.includes(scope.candidateId)) ||
        (selection.referenceScopeCandidateId !== null && reference === undefined) ||
        (selection.rangeCandidateId !== null && range === undefined)
    ) {
        return { status: 'rejected', reason: 'Metric intent selected an unpublished or incompatible candidate.' };
    }
    return { status: 'resolved', selection, candidates: { candidate, scope, reference, range } };
}

function selectedScopeRefusal(
    input: MetricIntentInput,
    value: IntentValue,
    selected: SelectionCandidates,
    selection: Record<string, unknown>,
    seen: Set<string>
): Refusal | null {
    const { candidate, scope, reference } = selected;
    const key = JSON.stringify(selection);
    if (seen.has(key) || reference?.objectIds.some((id) => scope?.objectIds.includes(id))) {
        return { status: 'rejected', reason: 'Metric intent repeated or overlapped its comparison subjects.' };
    }
    seen.add(key);
    const comparison = candidate.goals.some((goal) =>
        ['match-current', 'greater-than-current', 'less-than-current'].includes(goal.relation)
    );
    if (comparison !== (reference !== undefined) || (comparison && value.kind !== 'comparative')) {
        return {
            status: 'rejected',
            reason: 'The selected metric relation requires two distinct current-preview subjects.',
        };
    }
    const writableIds = input.creativeAuthority?.targets.flatMap((target) => target.objectIds) ?? [];
    if (scope?.objectIds.some((id) => !writableIds.includes(id))) {
        return { status: 'rejected', reason: 'Metric intent cannot widen the creative mutation subjects.' };
    }
    return null;
}

function selectedGoals({ candidate, scope, reference, range }: SelectionCandidates, index: number): MetricGoal[] {
    const goals: MetricGoal[] = [];
    const targetGroups = scope === undefined ? [[]] : scope.objectIds.map((id) => [id]);
    for (const [targetIndex, targetIds] of targetGroups.entries()) {
        for (const [expectationIndex, goal] of candidate.goals.entries()) {
            let stepId = 'overall';
            if (goal.source.kind === 'recipe') {
                stepId = `recipe:${goal.source.recipeId}:${targetIds[0] ?? 'unavailable'}`;
            }
            const { metricName: _metricName, ...frozenGoal } = goal;
            goals.push({
                ...structuredClone(frozenGoal),
                goalId: `${String(index)}:${String(targetIndex)}:${String(expectationIndex)}`,
                stepId,
                targetIds,
                referenceTargetIds: [...(reference?.objectIds ?? [])],
                range:
                    range === undefined
                        ? null
                        : { startBeat: range.startBeat, endBeat: range.endBeat, sectionId: range.sectionId },
            });
        }
    }
    return goals;
}

/** Freeze only published candidates. This authority restricts an edit and grants no mutation. */
export function admitMetricIntent(
    input: MetricIntentInput
): { status: 'admitted'; authority: MetricRequestAuthority } | Refusal {
    const value = input.value;
    if (!intentValue(value)) {
        return { status: 'rejected', reason: 'Metric intent does not match its closed candidate contract.' };
    }
    const semanticRefusal = semanticIntentRefusal(value, input.creativeAuthority);
    if (semanticRefusal !== null) {
        return semanticRefusal;
    }
    const goals: MetricGoal[] = [];
    const seen = new Set<string>();
    for (const [index, selection] of value.objectives.entries()) {
        const resolved = resolveMetricSelection(input.catalog, selection);
        if (resolved.status !== 'resolved') {
            return resolved;
        }
        const refusal = selectedScopeRefusal(input, value, resolved.candidates, resolved.selection, seen);
        if (refusal !== null) {
            return refusal;
        }
        goals.push(...selectedGoals(resolved.candidates, index));
    }
    const kind = value.kind;
    if (kind !== 'literal' && kind !== 'perceptual' && kind !== 'comparative') {
        return { status: 'rejected', reason: 'Metric intent has no semantic kind.' };
    }
    return {
        status: 'admitted',
        authority: {
            schemaVersion: 1,
            authorityId: `metric-${digest({ catalog: input.catalog.catalogId, callId: input.callId, value })}`,
            origin: 'configured-joint-intake',
            callId: input.callId,
            turn: input.turn,
            catalogId: input.catalog.catalogId,
            requestDigest: input.catalog.requestDigest,
            revision: input.catalog.revision,
            projectId: input.catalog.projectId,
            selection: structuredClone(input.catalog.selection),
            kind,
            goals,
            creativeAuthority: structuredClone(input.creativeAuthority),
        },
    };
}
