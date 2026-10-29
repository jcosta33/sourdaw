import { trackStore } from '#/modules/Arrangement/stores';
import { getMixRecipeCatalog } from '#/modules/Arrangement/useCases';
import { getExecutableAppActionEffect, parseVersionedCommandBatchEnvelope } from '#/modules/Command/useCases';
import { digest } from '#/utils/canonicalDigest';

import { type MeasuredPreview } from '../models/MeasuredPreview';
import { type MetricGoalEvaluation, type MetricGoalProof } from '../models/MetricGoalAdmission';

import { bindMetricGoalsToBatch } from './bindMetricGoalsToBatch';
import { normalizeAgentReferenceText } from './agentReference/normalizeAgentReferenceText';
import { escapeRegExp } from './agentReference/groundingStrategies/escapeRegExp';
import { digestCommandBatchContent } from './digestCommandBatchContent';
import { type MetricGoal, type MetricGoalState } from './metricGoalContractTypes';
import { objectiveMetricProjection } from './objectiveMetricProjection';
import { readRequestMetricNumbers, type RequestMetricNumber } from './readRequestMetricNumbers';
import { getPromptClauses } from './agentReference/groundingStrategies/getPromptClauses';

type AdmissionInput = {
    state: MetricGoalState | null | undefined;
    commandBatch: { serialized: string; authority: Parameters<typeof parseVersionedCommandBatchEnvelope>[1] };
    currentRevision?: string;
};
type Binding = NonNullable<MetricGoalState['binding']>;
type Envelope = Extract<ReturnType<typeof parseVersionedCommandBatchEnvelope>, { status: 'valid' }>['envelope'];
type Failure = NonNullable<MetricGoalEvaluation['failure']>;
type Refusal = { failure: Failure; reason: string };
type Criterion = MetricGoalEvaluation['criteria'][number];
type ObservationContext = { state: MetricGoalState; binding: Binding };
type Figure = { value: number; unit: string };
type ObservableMetric = Pick<MetricGoal, 'band'> & {
    metricId: NonNullable<MetricGoal['metricId']>;
    range: NonNullable<MetricGoal['range']>;
};

function coversToken(request: string, name: string, candidate: RequestMetricNumber): boolean {
    if (name.length === 0 || !name.includes(candidate.token)) {
        return false;
    }
    for (const match of request.matchAll(new RegExp(escapeRegExp(name), 'giu'))) {
        if (
            candidate.start >= match.index &&
            candidate.start + candidate.token.length <= match.index + match[0].length
        ) {
            return true;
        }
    }
    return false;
}

function numericLiteralWitness(
    candidate: RequestMetricNumber,
    envelope: Envelope,
    usedArguments: Set<string>
): boolean {
    const tracks = trackStore.value?.tracks ?? [];
    const namedObjects = tracks.flatMap((track) => [
        { id: track.id, name: track.name },
        ...track.clips.map((clip) => ({ id: clip.id, name: clip.name })),
        ...track.devices.map((device) => ({ id: device.id, name: device.name ?? '' })),
    ]);
    for (const command of envelope.commands) {
        const referencedIds = new Set(command.objectReferences.map((reference) => reference.id));
        if (
            namedObjects.some(
                (object) => referencedIds.has(object.id) && coversToken(envelope.intent, object.name, candidate)
            )
        ) {
            return true;
        }
        const newName = command.arguments.name;
        if (typeof newName === 'string' && coversToken(envelope.intent, newName, candidate)) {
            return true;
        }
        const clause = getPromptClauses(envelope.intent, envelope.intent).find(
            (entry) => candidate.start >= entry.start && candidate.start < entry.end
        );
        const names = tracks.flatMap((track) => {
            if (
                referencedIds.has(track.id) ||
                track.devices.some((device) => referencedIds.has(device.id)) ||
                track.clips.some((clip) => referencedIds.has(clip.id))
            ) {
                return [
                    track.name,
                    ...namedObjects.filter((object) => referencedIds.has(object.id)).map((object) => object.name),
                ];
            }
            return [];
        });
        if (clause === undefined) {
            continue;
        }
        const normalizedClause = ` ${normalizeAgentReferenceText(clause.text)} `;
        const namedTarget = names.some((name) => {
            const normalizedName = normalizeAgentReferenceText(name);
            return normalizedName.length > 0 && normalizedClause.includes(` ${normalizedName} `);
        });
        if (!namedTarget) {
            continue;
        }
        const argumentKey = `${command.commandId}:${candidate.unit}`;
        if (usedArguments.has(argumentKey)) {
            continue;
        }
        if (
            candidate.unit === 'LUFS' &&
            command.operation === 'normalizeClip' &&
            command.arguments.mode === 'lufs' &&
            command.arguments.targetDb === candidate.value
        ) {
            usedArguments.add(argumentKey);
            return true;
        }
        if (
            candidate.unit === 'Hz' &&
            command.operation === 'setDeviceParameter' &&
            command.arguments.value === candidate.value &&
            command.parameterUnits.some((entry) => entry.argument === 'value' && entry.unit === 'Hz')
        ) {
            usedArguments.add(argumentKey);
            return true;
        }
    }
    return false;
}

function unaccountedNumericRefusal(state: MetricGoalState, envelope: Envelope): Refusal | null {
    const selected = state.authorities.flatMap((authority) => authority.goals);
    const usedArguments = new Set<string>();
    for (const candidate of readRequestMetricNumbers(envelope.intent)) {
        const selectedGoal = selected.find(
            (goal) =>
                goal.source.kind === 'request-number' &&
                goal.source.candidateId === candidate.candidateId &&
                goal.source.token === candidate.token &&
                goal.metricId === candidate.metricId &&
                goal.targetValue === candidate.value &&
                goal.relation === 'target' &&
                goal.tolerance === 0
        );
        if (selectedGoal === undefined && !numericLiteralWitness(candidate, envelope, usedArguments)) {
            return {
                failure: 'missing',
                reason: `The request's ${candidate.token} candidate has no selected metric goal or grounded literal use.`,
            };
        }
    }
    return null;
}

function nonAcousticScopeRefusal(state: MetricGoalState, envelope: Envelope): Refusal | null {
    if (!state.authorities.some((authority) => authority.kind === 'non-acoustic')) {
        return null;
    }
    const invalidAuthority = state.authorities.some(
        (authority) =>
            authority.kind === 'non-acoustic' &&
            (authority.creativeAuthority === null || authority.creativeAuthority.editDimensions.includes('processing'))
    );
    const acousticEffect = envelope.commands.some((command) => {
        const effect = getExecutableAppActionEffect(command.operation);
        return (
            effect === null ||
            effect.dimensions.some((dimension) =>
                ['processing', 'clip-audio', 'master', 'monitoring'].includes(dimension)
            )
        );
    });
    if (invalidAuthority || acousticEffect) {
        return {
            failure: 'missing',
            reason: 'A non-acoustic creative intake cannot exempt an acoustic processing plan from measured goals.',
        };
    }
    return null;
}

function blocked(criteria: Criterion[], refusal: Refusal): MetricGoalEvaluation {
    return { status: 'blocked', ...refusal, criteria };
}

function readGoalBinding(
    input: AdmissionInput,
    state: MetricGoalState,
    envelope: Envelope
): { status: 'bound'; binding: Binding } | { status: 'refused'; refusal: Refusal } {
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
        return {
            status: 'refused',
            refusal: {
                failure: 'stale',
                reason: 'The metric goal proof belongs to another project, revision or command batch.',
            },
        };
    }
    const rebound = bindMetricGoalsToBatch({ state, commandBatch: input.commandBatch });
    if (JSON.stringify(rebound.binding?.prefixes) !== JSON.stringify(binding.prefixes)) {
        return {
            status: 'refused',
            refusal: { failure: 'stale', reason: 'The metric logical-step bindings do not match this command batch.' },
        };
    }
    return { status: 'bound', binding };
}

function completeGoalsRefusal(state: MetricGoalState, binding: Binding, goals: MetricGoal[]): Refusal | null {
    if (
        goals.length === 0 ||
        state.authorities.some((authority) => authority.kind !== 'literal' && authority.goals.length === 0)
    ) {
        return { failure: 'missing', reason: 'The perceptual request has no compatible frozen objective criterion.' };
    }
    if (
        state.steps.length === 0 ||
        binding.prefixes.length !== state.steps.length ||
        binding.prefixes.at(-1)?.after !== binding.contentHash
    ) {
        return { failure: 'missing', reason: 'The proposal has no complete application-bound logical mixing steps.' };
    }
    return null;
}

function recipeCriterionMatches(goal: MetricGoal, catalog: ReturnType<typeof getMixRecipeCatalog>): boolean {
    if (goal.source.kind !== 'recipe') {
        return true;
    }
    const source = goal.source;
    const recipe = catalog.recipes.find((entry) => entry.id === source.recipeId);
    const expectation = recipe?.metrics[source.expectationIndex];
    return (
        recipe !== undefined &&
        recipe.origin === undefined &&
        source.catalogVersion === catalog.version &&
        source.recipeDigest === digest(recipe) &&
        expectation !== undefined &&
        (goal.metricId === null || expectation.metric === goal.metricId) &&
        (expectation.band ?? null) === goal.band &&
        expectation.direction === goal.relation &&
        goal.tolerance === 0
    );
}

function policyCriterionMatches(goal: MetricGoal): boolean {
    if (goal.source.kind !== 'policy') {
        return true;
    }
    return !(
        (goal.source.policyId === 'integrated-loudness-match-v1' &&
            (goal.metricId !== 'integratedLoudness' ||
                goal.relation !== 'match-current' ||
                goal.tolerance !== 0.1 ||
                goal.band !== null)) ||
        (goal.source.policyId === 'spectral-centroid-comparison-v1' &&
            (goal.metricId !== 'spectralCentroid' ||
                !['greater-than-current', 'less-than-current'].includes(goal.relation) ||
                goal.tolerance !== 0))
    );
}

function criterionSourceRefusal(goals: MetricGoal[]): Refusal | null {
    const catalog = getMixRecipeCatalog();
    for (const goal of goals) {
        if (!recipeCriterionMatches(goal, catalog)) {
            return {
                failure: 'stale',
                reason: 'The authored recipe criterion no longer matches its frozen catalog source.',
            };
        }
        if (!policyCriterionMatches(goal)) {
            return {
                failure: 'incomparable',
                reason: 'The comparison does not use its versioned application objective policy.',
            };
        }
    }
    return null;
}

function contradictoryCriteria(goals: MetricGoal[]): boolean {
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
            return true;
        }
    }
    return false;
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
    if (scope.kind !== 'tracks' && scope.kind !== 'buses') {
        return false;
    }
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

function compatibleProofTarget(
    preview: MeasuredPreview,
    provenance: NonNullable<MeasuredPreview['provenance']>,
    targetId: string
) {
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
        return null;
    }
    const expectedRoute = target.targetKind === 'master' ? 'mixdown' : 'isolated-subgraph';
    if (
        artifacts.baseline.route !== expectedRoute ||
        artifacts.preview.route !== expectedRoute ||
        !scopeContains(preview, targetId, target.targetKind)
    ) {
        return null;
    }
    return target;
}

function proofFigure(
    proof: MetricGoalProof,
    metric: ObservableMetric,
    targetId: string,
    hash: string,
    side: 'baseline' | 'preview',
    binding: Binding
): Figure | null {
    const preview = proof.preview;
    const provenance = preview.provenance;
    if (
        provenance === undefined ||
        proof.receiptDigest.length === 0 ||
        preview.batchContentHash !== hash ||
        preview.revision !== binding.revision ||
        provenance.runId !== binding.runId ||
        provenance.callId.length === 0 ||
        JSON.stringify(preview.range) !== JSON.stringify(metric.range)
    ) {
        return null;
    }
    const target = compatibleProofTarget(preview, provenance, targetId);
    if (target === null) {
        return null;
    }
    return objectiveMetricProjection(metric.metricId, target[side][metric.metricId], metric.band);
}

function observation(
    goal: MetricGoal,
    targetId: string,
    hash: string,
    side: 'baseline' | 'preview',
    context: ObservationContext
): Figure | null {
    if (goal.metricId === null || goal.range === null) {
        return null;
    }
    const metric = { metricId: goal.metricId, range: goal.range, band: goal.band };
    const figures: Figure[] = [];
    for (const proof of context.state.proofs) {
        const figure = proofFigure(proof, metric, targetId, hash, side, context.binding);
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

function goalReferences(
    goal: MetricGoal,
    context: ObservationContext
): { reference: number[]; failure: Failure | null } {
    const reference: number[] = [];
    let failure: Failure | null = null;
    for (const id of goal.referenceTargetIds) {
        const figure = observation(goal, id, context.binding.contentHash, 'preview', context);
        if (figure === null) {
            failure = 'incomparable';
            break;
        }
        reference.push(figure.value);
    }
    if (
        goal.referenceTargetIds.length > 0 &&
        goal.referenceTargetIds.length !== 1 &&
        goal.referenceTargetIds.length !== goal.targetIds.length
    ) {
        failure = 'incomparable';
    }
    return { reference, failure };
}

function targetComparison(
    goal: MetricGoal,
    id: string,
    prefix: Binding['prefixes'][number],
    context: ObservationContext
) {
    const initial = observation(goal, id, prefix.after, 'baseline', context);
    const before = prefix.before === null ? initial : observation(goal, id, prefix.before, 'preview', context);
    const after = observation(goal, id, prefix.after, 'preview', context);
    const final = observation(goal, id, context.binding.contentHash, 'preview', context);
    if (
        initial === null ||
        before === null ||
        after === null ||
        final === null ||
        before.unit !== after.unit ||
        after.unit !== final.unit
    ) {
        return null;
    }
    return { initial, before, after, final };
}

function criterionTargets(
    goal: MetricGoal,
    prefix: Binding['prefixes'][number],
    context: ObservationContext,
    reference: number[],
    initialFailure: Failure | null
) {
    const baseline: number[] = [];
    const observed: number[] = [];
    let unit: string | null = null;
    let failure = initialFailure;
    for (const [index, id] of goal.targetIds.entries()) {
        const figures = targetComparison(goal, id, prefix, context);
        if (figures === null) {
            failure = 'incomparable';
            break;
        }
        const { initial, before, after, final } = figures;
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
    return { baseline, observed, reference, unit, failure };
}

function evaluateCriterion(
    goal: MetricGoal,
    context: ObservationContext
): { criterion: Criterion; failure: Failure | null } {
    const { binding } = context;
    let prefix: Binding['prefixes'][number] | undefined = binding.prefixes.find(
        (entry) => entry.stepId === goal.stepId
    );
    if (goal.stepId === 'overall') {
        prefix = { stepId: 'overall', before: null, after: binding.contentHash };
    }
    let values: {
        baseline: number[];
        observed: number[];
        reference: number[];
        unit: string | null;
        failure: Failure | null;
    } = {
        baseline: [],
        observed: [],
        reference: [],
        unit: null,
        failure: null,
    };
    if (goal.metricId === null || goal.relation === 'unsupported' || goal.range === null) {
        values.failure = 'incomparable';
    } else if (prefix === undefined) {
        values.failure = 'missing';
    } else {
        const { reference, failure } = goalReferences(goal, context);
        values = criterionTargets(goal, prefix, context, reference, failure);
    }
    const { failure, ...figures } = values;
    return { criterion: { ...goal, ...figures, status: failure === null ? 'verified' : 'blocked' }, failure };
}

/** Objective success is permission for one bound plan, never evidence of perceived sound quality. */
export function evaluateMetricGoalAdmission(input: AdmissionInput): MetricGoalEvaluation {
    const criteria: Criterion[] = (input.state?.authorities ?? []).flatMap((authority) =>
        authority.goals.map((goal) => ({
            ...goal,
            baseline: [],
            observed: [],
            reference: [],
            unit: null,
            status: 'blocked',
        }))
    );
    const state = input.state;
    if (state === null || state === undefined || state.authorities.length === 0) {
        return blocked(criteria, {
            failure: 'missing',
            reason: 'The whole request has no positive metric intent admission. The plan remains unverified.',
        });
    }
    const parsed = parseVersionedCommandBatchEnvelope(input.commandBatch.serialized, input.commandBatch.authority);
    if (parsed.status === 'invalid') {
        return blocked(criteria, { failure: 'stale', reason: 'The metric goal has no valid command batch binding.' });
    }
    const bound = readGoalBinding(input, state, parsed.envelope);
    if (bound.status === 'refused') {
        return blocked(criteria, bound.refusal);
    }
    const binding = bound.binding;
    const unaccounted = unaccountedNumericRefusal(state, parsed.envelope);
    if (unaccounted !== null) {
        return blocked(criteria, unaccounted);
    }
    const nonAcousticScope = nonAcousticScopeRefusal(state, parsed.envelope);
    if (nonAcousticScope !== null) {
        return blocked(criteria, nonAcousticScope);
    }
    if (
        state.authorities.every(
            (authority) =>
                (authority.kind === 'literal' || authority.kind === 'non-acoustic') && authority.goals.length === 0
        )
    ) {
        return { status: 'not-required', failure: null, reason: null, criteria };
    }
    const goals = state.authorities.flatMap((authority) => authority.goals);
    const incomplete = completeGoalsRefusal(state, binding, goals);
    if (incomplete !== null) {
        return blocked(criteria, incomplete);
    }
    const sourceRefusal = criterionSourceRefusal(goals);
    if (sourceRefusal !== null) {
        return blocked(criteria, sourceRefusal);
    }
    if (contradictoryCriteria(goals)) {
        return blocked(criteria, {
            failure: 'contradictory',
            reason: 'The frozen objective criteria contradict each other on the same subjects and range.',
        });
    }
    for (const [goalIndex, goal] of goals.entries()) {
        const result = evaluateCriterion(goal, { state, binding });
        criteria[goalIndex] = result.criterion;
        if (result.failure !== null) {
            return blocked(criteria, {
                failure: result.failure,
                reason:
                    result.failure === 'out-of-tolerance'
                        ? 'Actual preview measurements do not satisfy the frozen objective criterion.'
                        : 'Compatible actual baseline and preview measurements are missing for the frozen subjects, range or logical step.',
            });
        }
    }
    return {
        status: 'verified',
        reason: 'The actual preview satisfies the frozen objective criteria. This does not establish perceived sound quality.',
        failure: null,
        criteria,
    };
}
