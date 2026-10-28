import { getMixRecipeCatalog } from '#/modules/Arrangement/useCases';
import { parseVersionedCommandBatchEnvelope } from '#/modules/Command/useCases';
import { digest } from '#/utils/canonicalDigest';

import { type MeasuredPreview } from '../models/MeasuredPreview';
import { type MetricGoalEvaluation } from '../models/MetricGoalAdmission';

import { bindMetricGoalsToBatch } from './bindMetricGoalsToBatch';
import { digestCommandBatchContent } from './digestCommandBatchContent';
import { type MetricGoal, type MetricGoalState } from './metricGoalContractTypes';
import { objectiveMetricProjection } from './objectiveMetricProjection';

/** Objective success is permission for one bound plan, never evidence of perceived sound quality. */
export function evaluateMetricGoalAdmission(input: {
    state: MetricGoalState | null | undefined;
    commandBatch: { serialized: string; authority: Parameters<typeof parseVersionedCommandBatchEnvelope>[1] };
    currentRevision?: string;
}): MetricGoalEvaluation {
    const criteria: MetricGoalEvaluation['criteria'][number][] = [];
    const blocked = (failure: NonNullable<MetricGoalEvaluation['failure']>, reason: string): MetricGoalEvaluation => ({
        status: 'blocked',
        failure,
        reason,
        criteria,
    });
    const state = input.state;
    if (state === null || state === undefined || state.authorities.length === 0) {
        return blocked(
            'missing',
            'The whole request has no positive metric intent admission. The plan remains unverified.'
        );
    }
    const parsed = parseVersionedCommandBatchEnvelope(input.commandBatch.serialized, input.commandBatch.authority);
    if (parsed.status === 'invalid') {
        return blocked('stale', 'The metric goal has no valid command batch binding.');
    }
    const envelope = parsed.envelope;
    const binding = state.binding;
    if (
        binding === null ||
        binding.contentHash !== digestCommandBatchContent(envelope) ||
        binding.revision !== envelope.baseRevision ||
        binding.projectId !== envelope.projectId ||
        binding.runId !== envelope.runId ||
        binding.batchId !== envelope.batchId ||
        (input.currentRevision !== undefined && input.currentRevision !== binding.revision) ||
        state.authorities.some((authority) => authority.projectId !== binding.projectId)
    ) {
        return blocked('stale', 'The metric goal proof belongs to another project, revision or command batch.');
    }
    const rebound = bindMetricGoalsToBatch({ state, commandBatch: input.commandBatch });
    if (JSON.stringify(rebound.binding?.prefixes) !== JSON.stringify(binding.prefixes)) {
        return blocked('stale', 'The metric logical-step bindings do not match this command batch.');
    }
    if (state.authorities.every((authority) => authority.kind === 'literal' && authority.goals.length === 0)) {
        return { status: 'not-required', failure: null, reason: null, criteria };
    }
    const goals = state.authorities.flatMap((authority) => authority.goals);
    if (
        goals.length === 0 ||
        state.authorities.some((authority) => authority.kind !== 'literal' && authority.goals.length === 0)
    ) {
        return blocked('missing', 'The perceptual request has no compatible frozen objective criterion.');
    }
    if (
        state.steps.length === 0 ||
        binding.prefixes.length !== state.steps.length ||
        binding.prefixes.at(-1)?.after !== binding.contentHash
    ) {
        return blocked('missing', 'The proposal has no complete application-bound logical mixing steps.');
    }
    const catalog = getMixRecipeCatalog();
    for (const goal of goals) {
        if (goal.source.kind === 'recipe') {
            const source = goal.source;
            const recipe = catalog.recipes.find((entry) => entry.id === source.recipeId);
            const expectation = recipe?.metrics[source.expectationIndex];
            if (
                recipe === undefined ||
                recipe.origin !== undefined ||
                source.catalogVersion !== catalog.version ||
                source.recipeDigest !== digest(recipe) ||
                expectation === undefined ||
                (goal.metricId !== null && expectation.metric !== goal.metricId) ||
                (expectation.band ?? null) !== goal.band ||
                expectation.direction !== goal.relation ||
                goal.tolerance !== 0
            ) {
                return blocked('stale', 'The authored recipe criterion no longer matches its frozen catalog source.');
            }
        }
        if (
            goal.source.kind === 'policy' &&
            ((goal.source.policyId === 'integrated-loudness-match-v1' &&
                (goal.metricId !== 'integratedLoudness' ||
                    goal.relation !== 'match-current' ||
                    goal.tolerance !== 0.1 ||
                    goal.band !== null)) ||
                (goal.source.policyId === 'spectral-centroid-comparison-v1' &&
                    (goal.metricId !== 'spectralCentroid' ||
                        !['greater-than-current', 'less-than-current'].includes(goal.relation) ||
                        goal.tolerance !== 0)))
        ) {
            return blocked('incomparable', 'The comparison does not use its versioned application objective policy.');
        }
    }
    for (const left of goals) {
        const sameAxis = (right: MetricGoal) =>
            left.metricId === right.metricId &&
            left.band === right.band &&
            JSON.stringify(left.targetIds) === JSON.stringify(right.targetIds) &&
            JSON.stringify(left.referenceTargetIds) === JSON.stringify(right.referenceTargetIds) &&
            JSON.stringify(left.range) === JSON.stringify(right.range);
        if (
            goals.some(
                (right) =>
                    sameAxis(right) &&
                    ((left.relation === 'increase' && ['decrease', 'hold'].includes(right.relation)) ||
                        (left.relation === 'decrease' && right.relation === 'hold') ||
                        (left.relation === 'greater-than-current' && right.relation === 'less-than-current'))
            )
        ) {
            return blocked(
                'contradictory',
                'The frozen objective criteria contradict each other on the same subjects and range.'
            );
        }
    }
    function observation(goal: MetricGoal, targetId: string, hash: string, side: 'baseline' | 'preview') {
        if (goal.metricId === null || goal.range === null) {
            return null;
        }
        const figures: Array<{ value: number; unit: string }> = [];
        for (const proof of state?.proofs ?? []) {
            const preview = proof.preview;
            const provenance = preview.provenance;
            if (
                provenance === undefined ||
                proof.receiptDigest.length === 0 ||
                preview.batchContentHash !== hash ||
                preview.revision !== binding?.revision ||
                provenance.runId !== binding.runId ||
                provenance.callId.length === 0 ||
                JSON.stringify(preview.range) !== JSON.stringify(goal.range)
            ) {
                continue;
            }
            const target = preview.targets.find((entry) => entry.targetId === targetId);
            const artifacts = provenance.targets.find((entry) => entry.targetId === targetId);
            if (
                target === undefined ||
                artifacts === undefined ||
                preview.targets.length !== provenance.targets.length ||
                new Set(preview.targets.map((entry) => entry.targetId)).size !== preview.targets.length ||
                artifacts.baseline.artifact.contentAddress.length === 0 ||
                artifacts.preview.artifact.contentAddress.length === 0
            ) {
                continue;
            }
            const expectedRoute = target.targetKind === 'master' ? 'mixdown' : 'isolated-subgraph';
            if (
                artifacts.baseline.route !== expectedRoute ||
                artifacts.preview.route !== expectedRoute ||
                !scopeContains(preview, targetId, target.targetKind)
            ) {
                continue;
            }
            const figure = objectiveMetricProjection(goal.metricId, target[side][goal.metricId], goal.band);
            if (figure !== null) {
                figures.push(figure);
            }
        }
        if (
            figures.length === 0 ||
            figures.some((figure) => figure.value !== figures[0]?.value || figure.unit !== figures[0]?.unit)
        ) {
            return null;
        }
        return figures[0] ?? null;
    }
    function scopeContains(
        preview: MeasuredPreview,
        id: string,
        kind: MeasuredPreview['targets'][number]['targetKind']
    ): boolean {
        if (preview.scope.kind === 'master' || preview.scope.kind === 'project') {
            return id === 'master' && kind === 'master' && preview.targets.length === 1;
        }
        const scope = preview.scope;
        return (
            scope.ids.includes(id) &&
            scope.ids.length === preview.targets.length &&
            preview.targets.every(
                (target) =>
                    scope.kind === (target.targetKind === 'track' ? 'tracks' : 'buses') &&
                    scope.ids.includes(target.targetId)
            )
        );
    }
    function satisfies(goal: MetricGoal, before: number, after: number, reference: number | undefined): boolean {
        if (goal.relation === 'increase') {
            return after > before;
        }
        if (goal.relation === 'decrease') {
            return after < before;
        }
        if (goal.relation === 'hold') {
            return after === before;
        }
        if (goal.relation === 'target') {
            return goal.targetValue !== null && Math.abs(after - goal.targetValue) <= goal.tolerance;
        }
        if (reference === undefined) {
            return false;
        }
        if (goal.relation === 'match-current') {
            return Math.abs(after - reference) <= goal.tolerance;
        }
        if (goal.relation === 'greater-than-current') {
            return after > reference;
        }
        if (goal.relation === 'less-than-current') {
            return after < reference;
        }
        return false;
    }
    for (const goal of goals) {
        const baseline: number[] = [];
        const observed: number[] = [];
        const reference: number[] = [];
        let unit: string | null = null;
        const prefix =
            goal.stepId === 'overall'
                ? { stepId: 'overall', before: null, after: binding.contentHash }
                : binding.prefixes.find((entry) => entry.stepId === goal.stepId);
        let failure: MetricGoalEvaluation['failure'] = null;
        if (goal.metricId === null || goal.relation === 'unsupported' || goal.range === null) {
            failure = 'incomparable';
        } else if (prefix === undefined) {
            failure = 'missing';
        } else {
            for (const id of goal.referenceTargetIds) {
                const figure = observation(goal, id, binding.contentHash, 'preview');
                if (figure === null) {
                    failure = 'incomparable';
                    break;
                }
                reference.push(figure.value);
            }
            if (
                goal.referenceTargetIds.length !== 0 &&
                goal.referenceTargetIds.length !== 1 &&
                goal.referenceTargetIds.length !== goal.targetIds.length
            ) {
                failure = 'incomparable';
            }
            for (const [index, id] of goal.targetIds.entries()) {
                const initial = observation(goal, id, prefix.after, 'baseline');
                const before = prefix.before === null ? initial : observation(goal, id, prefix.before, 'preview');
                const after = observation(goal, id, prefix.after, 'preview');
                const final = observation(goal, id, binding.contentHash, 'preview');
                if (
                    initial === null ||
                    before === null ||
                    after === null ||
                    final === null ||
                    before.unit !== after.unit ||
                    after.unit !== final.unit
                ) {
                    failure = 'incomparable';
                    break;
                }
                baseline.push(before.value);
                observed.push(final.value);
                unit = final.unit;
                const referenceValue = reference.length === 1 ? reference[0] : reference[index];
                if (
                    failure === null &&
                    (!satisfies(goal, before.value, after.value, referenceValue) ||
                        !satisfies(goal, initial.value, final.value, referenceValue))
                ) {
                    failure = 'out-of-tolerance';
                }
            }
        }
        criteria.push({
            ...goal,
            baseline,
            observed,
            reference,
            unit,
            status: failure === null ? 'verified' : 'blocked',
        });
        if (failure !== null) {
            return blocked(
                failure,
                failure === 'out-of-tolerance'
                    ? 'Actual preview measurements do not satisfy the frozen objective criterion.'
                    : 'Compatible actual baseline and preview measurements are missing for the frozen subjects, range or logical step.'
            );
        }
    }
    return {
        status: 'verified',
        reason: 'The actual preview satisfies the frozen objective criteria. This does not establish perceived sound quality.',
        failure: null,
        criteria,
    };
}
