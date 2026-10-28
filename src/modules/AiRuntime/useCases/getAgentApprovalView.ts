import { trackStore } from '#/modules/Arrangement/stores';
import { captureProjectRevision } from '#/modules/CrdtDocument/useCases';

import { type ChatActionConfirmationStatus } from '../models/Chat';
import { type MetricGoalEvaluation } from '../models/MetricGoalAdmission';
import {
    type PendingAppActionConfirmation,
    getPendingActionConfirmation,
} from '../stores/pendingActionConfirmationStore';
import { diffProposalCommands } from '../transformers/diffProposalCommands';

import { proposalCommandShape } from './agentReference/proposalCommandShape';
import { evaluateMetricGoalAdmission } from './evaluateMetricGoalAdmission';
import { getProviderRouteView } from './getProviderRouteView';
import { metricGoalStateCodec } from './metricGoalStateCodec';
import { validateAgentRiskApproval } from './validateAgentRiskApproval';

type ApprovalSnapshot = PendingAppActionConfirmation['approvalSnapshot'];
type SemanticDiff = NonNullable<ApprovalSnapshot['semanticDiff']>;
type SemanticIntentGroup = SemanticDiff['intentGroups'][number];
type SemanticDestructiveChange = SemanticDiff['destructiveChanges'][number];
type ProviderRouteView = NonNullable<ReturnType<typeof getProviderRouteView>>;

type ApprovalDestructiveChange = {
    classification: SemanticDestructiveChange['classification'];
    consequence: string;
    recovery: SemanticDestructiveChange['recovery'];
    objectIds: readonly string[];
};

type ApprovalIntentGroup = {
    id: string;
    summary: string;
    commandIds: readonly string[];
    affectedTrackIds: readonly string[];
    affectedTimeRanges: SemanticIntentGroup['affectedTimeRanges'];
    estimatedAudioImpact: SemanticIntentGroup['estimatedAudioImpact'];
    warnings: readonly string[];
    dependsOnGroupIds: readonly string[];
    destructiveChanges: readonly ApprovalDestructiveChange[];
};

type AdoptedRecipe = NonNullable<ApprovalSnapshot['adoptedRecipes']>[number];

/** A recipe the batch adopted, with the name of the track it was expanded onto, or `null` once that track is gone. */
type ApprovalRecipe = AdoptedRecipe & { targetName: string | null };

type MeasuredPreviewEvidence = NonNullable<ApprovalSnapshot['measuredPreview']>;
type MeasuredTarget = MeasuredPreviewEvidence['targets'][number];
type MeasuredEntry = NonNullable<MeasuredTarget['baseline'][string]>;

/** A scalar figure with its unit, or `null` when the side could not measure it or it is not one number. */
type ApprovalMeasuredFigure = { value: number; unit: string } | null;

/** One metric of a measured preview: its figure before and after, and the signed change or why there is none. */
type ApprovalMeasuredMetric = {
    metricId: string;
    baseline: ApprovalMeasuredFigure;
    preview: ApprovalMeasuredFigure;
    delta: { value: number; unit: string } | null;
    incomparableReason: string | null;
};

type ApprovalMeasuredTarget = {
    targetId: string;
    targetKind: MeasuredTarget['targetKind'];
    /** The track or bus name, or `null` for the master mix and for a target no longer in the project. */
    targetName: string | null;
    metrics: readonly ApprovalMeasuredMetric[];
};

type ApprovalMeasuredPreview = {
    scope: MeasuredPreviewEvidence['scope'];
    range: MeasuredPreviewEvidence['range'];
    targets: readonly ApprovalMeasuredTarget[];
};

/** One payload field a command of the previous proposal set to a different value, both rendered. */
type ApprovalChangedField = { field: string; previous: string | null; next: string | null };

/** One command that differs from the proposal this one replaced, under the label each proposal gave it. */
type ApprovalProposalChange =
    | { kind: 'added'; actionType: string; label: string }
    | { kind: 'removed'; actionType: string; label: string }
    | { kind: 'changed'; actionType: string; label: string; fields: readonly ApprovalChangedField[] };

/** What this proposal changes against the one it replaced; commands left as they were are only counted. */
type ApprovalPreviousProposalDiff = {
    previousConfirmationId: string;
    changes: readonly ApprovalProposalChange[];
    unchangedCount: number;
};

type ApprovalFreshness =
    | { status: 'current'; currentRevision: string | null }
    | { status: 'stale'; reason: string; currentRevision: string | null }
    | { status: 'mismatched'; reason: string; currentRevision: string | null }
    | { status: 'settled'; currentRevision: string | null };

export type AgentApprovalView = {
    canConfirm: boolean;
    metricGoals: Omit<MetricGoalEvaluation, 'criteria'> & {
        criteria: ReadonlyArray<MetricGoalEvaluation['criteria'][number] & { criterionText: string }>;
    };
    confirmationId: string;
    runId: string;
    status: ChatActionConfirmationStatus;
    error: string | null;
    prompt: string;
    /** Which of the run's successive batches this proposal is, or `null` when the request fits one batch. */
    batchPosition: { index: number; total: number } | null;
    actionLabels: readonly string[];
    supersedes: string | null;
    supersededBy: string | null;
    /** The per-command diff against the proposal this one replaced, or `null` when it replaced none still held. */
    previousProposalDiff: ApprovalPreviousProposalDiff | null;
    scope: {
        targetIds: readonly string[];
        targetRanges: ReadonlyArray<{ startBeat: number; endBeat: number }>;
        protectedTargetIds: readonly string[];
        protectedRanges: ReadonlyArray<{ startBeat: number; endBeat: number }>;
    };
    risk: {
        level: NonNullable<ApprovalSnapshot['agentApproval']>['policy']['risk'];
        decision: NonNullable<ApprovalSnapshot['agentApproval']>['policy']['decision'];
        reasons: readonly string[];
        requiredTrustMode: NonNullable<ApprovalSnapshot['agentApproval']>['policy']['requiredTrustMode'];
    } | null;
    /** The recipes the proposal adopted, in adoption order; empty when no recipe built any of it. */
    recipes: readonly ApprovalRecipe[];
    /** The isolated preview this exact batch was rendered and measured as, or `null` when it was not. */
    measuredPreview: ApprovalMeasuredPreview | null;
    intentGroups: readonly ApprovalIntentGroup[];
    destructiveChanges: ReadonlyArray<ApprovalDestructiveChange & { groupId: string }>;
    audioImpact: SemanticDiff['estimatedAudioImpact'];
    warnings: readonly string[];
    partialAcceptance: { available: boolean; reason: string | null };
    baseRevision: string;
    freshness: ApprovalFreshness;
    rePreview: { available: boolean; reason: string | null };
    consequences: NonNullable<ApprovalSnapshot['agentApproval']>['consequences'] | null;
    budgets: NonNullable<ApprovalSnapshot['commandBatch']>['authority']['budgets'] | null;
    cost: ProviderRouteView['cost'];
    dataDisclosure: ProviderRouteView['dataDisclosure'];
    actor: { localActorId: string } | null;
    /** Confirmations never expire on a clock; they die with the revision they were bound to. */
    expiry: { kind: 'revision-bound'; revision: string };
    createdAt: number;
    resolvedAt: number | null;
};

type GetAgentApprovalViewInput = {
    confirmationId: string;
};

const NO_SEMANTIC_PREVIEW_REASON = 'No semantic preview is available for this proposal.';
const EMPTY_SCOPE: AgentApprovalView['scope'] = {
    targetIds: [],
    targetRanges: [],
    protectedTargetIds: [],
    protectedRanges: [],
};

function failureReason(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function toApprovalDestructiveChange(change: SemanticDestructiveChange): ApprovalDestructiveChange {
    return {
        classification: change.classification,
        consequence: change.consequence,
        recovery: change.recovery,
        objectIds: change.objectIds,
    };
}

function getFreshness(confirmation: PendingAppActionConfirmation): ApprovalFreshness {
    const { agentApproval, commandBatch } = confirmation.approvalSnapshot;
    let currentRevision: string;
    try {
        currentRevision = captureProjectRevision();
    } catch (error) {
        return { status: 'mismatched', reason: failureReason(error), currentRevision: null };
    }
    if (confirmation.status === 'invalidated') {
        return {
            status: 'stale',
            reason: confirmation.error ?? 'The proposal was invalidated.',
            currentRevision,
        };
    }
    if (confirmation.status !== 'proposed' || !commandBatch || !agentApproval) {
        return { status: 'settled', currentRevision };
    }
    try {
        const validation = validateAgentRiskApproval({ approval: agentApproval, commandBatch, currentRevision });
        const metric = evaluateMetricGoalAdmission({
            state: metricGoalStateCodec(confirmation.approvalSnapshot.metricGoalState),
            commandBatch,
            currentRevision,
        });
        if (
            validation.status === 'valid' ||
            (!validation.stale && metric.status === 'blocked' && validation.reason === metric.reason)
        ) {
            return { status: 'current', currentRevision };
        }
        return { status: validation.stale ? 'stale' : 'mismatched', reason: validation.reason, currentRevision };
    } catch (error) {
        return { status: 'mismatched', reason: failureReason(error), currentRevision: null };
    }
}

/** Re-proposal replaces a live proposal, so a settled or already replaced one says which it is. */
function rePreviewRefusalReason(confirmation: PendingAppActionConfirmation): string {
    const status = `The proposal is already ${confirmation.status}`;
    return confirmation.supersededBy === null ? `${status}.` : `${status} and a newer proposal replaced it.`;
}

function getRePreviewAvailability(
    confirmation: PendingAppActionConfirmation,
    freshness: ApprovalFreshness
): { available: boolean; reason: string | null } {
    if (confirmation.status !== 'proposed' || confirmation.supersededBy !== null) {
        return { available: false, reason: rePreviewRefusalReason(confirmation) };
    }
    if (!confirmation.approvalSnapshot.commandBatch) {
        return { available: false, reason: 'The confirmation has no approved command batch to re-preview.' };
    }
    const batch = confirmation.approvalSnapshot.commandBatch;
    const metric = evaluateMetricGoalAdmission({
        state: metricGoalStateCodec(confirmation.approvalSnapshot.metricGoalState),
        commandBatch: batch,
    });
    if (freshness.status !== 'stale' && freshness.status !== 'mismatched' && metric.status !== 'blocked') {
        return { available: false, reason: 'The proposal still matches the current project.' };
    }
    return { available: true, reason: null };
}

function toApprovalIntentGroup(group: SemanticIntentGroup): ApprovalIntentGroup {
    return {
        id: group.id,
        summary: group.summary,
        commandIds: group.commandIds,
        affectedTrackIds: group.affectedTrackIds,
        affectedTimeRanges: group.affectedTimeRanges,
        estimatedAudioImpact: group.estimatedAudioImpact,
        warnings: group.warnings,
        dependsOnGroupIds: group.dependsOnGroupIds,
        destructiveChanges: group.destructiveChanges.map(toApprovalDestructiveChange),
    };
}

/** What the diff says about the batch, or an explicit absence when nothing previewed it. */
function projectSemanticDiff(semanticDiff: SemanticDiff | undefined) {
    if (!semanticDiff) {
        return {
            intentGroups: [],
            destructiveChanges: [],
            audioImpact: { level: 'none' as const, summary: NO_SEMANTIC_PREVIEW_REASON },
            warnings: [],
            partialAcceptance: { available: false, reason: NO_SEMANTIC_PREVIEW_REASON },
        };
    }
    return {
        intentGroups: semanticDiff.intentGroups.map(toApprovalIntentGroup),
        destructiveChanges: semanticDiff.destructiveChanges.map((change) => ({
            ...toApprovalDestructiveChange(change),
            groupId: change.groupId,
        })),
        audioImpact: semanticDiff.estimatedAudioImpact,
        warnings: semanticDiff.warnings,
        partialAcceptance: semanticDiff.partialAcceptance,
    };
}

function projectRecipes(adoptedRecipes: ApprovalSnapshot['adoptedRecipes']): AgentApprovalView['recipes'] {
    const tracks = trackStore.value?.tracks ?? [];
    return (adoptedRecipes ?? []).map((recipe) => ({
        ...recipe,
        targetName: tracks.find((track) => track.id === recipe.targetId)?.name ?? null,
    }));
}

function measuredFigure(entry: MeasuredEntry | undefined): ApprovalMeasuredFigure {
    if (entry?.status !== 'measured' || typeof entry.value !== 'number') {
        return null;
    }
    return { value: entry.value, unit: entry.unit };
}

function projectMeasuredTarget(
    target: MeasuredTarget,
    tracks: readonly { id: string; name: string }[]
): ApprovalMeasuredTarget {
    const metrics = Object.entries(target.deltas).flatMap(([metricId, delta]) => {
        if (delta === undefined) {
            return [];
        }
        return [
            {
                metricId,
                baseline: measuredFigure(target.baseline[metricId]),
                preview: measuredFigure(target.preview[metricId]),
                delta: delta.status === 'compared' ? { value: delta.delta, unit: delta.unit } : null,
                incomparableReason: delta.status === 'incomparable' ? delta.reason : null,
            },
        ];
    });
    return {
        targetId: target.targetId,
        targetKind: target.targetKind,
        targetName: tracks.find((track) => track.id === target.targetId)?.name ?? null,
        metrics,
    };
}

/** The figures of a preview measured at the revision this confirmation's batch is anchored to; none otherwise. */
function projectMeasuredPreview(
    measuredPreview: ApprovalSnapshot['measuredPreview'],
    projectRevision: string
): ApprovalMeasuredPreview | null {
    if (measuredPreview === undefined || measuredPreview.revision !== projectRevision) {
        return null;
    }
    const tracks = trackStore.value?.tracks ?? [];
    return {
        scope: measuredPreview.scope,
        range: measuredPreview.range,
        targets: measuredPreview.targets.map((target) => projectMeasuredTarget(target, tracks)),
    };
}

/**
 * What this proposal changes against the one it replaced, while the store still holds that one.
 * Each side is read from its own approval snapshot, so the diff compares the two batches exactly as
 * each was put to the user.
 */
function projectPreviousProposalDiff(
    confirmation: PendingAppActionConfirmation
): AgentApprovalView['previousProposalDiff'] {
    if (confirmation.supersedes === null) {
        return null;
    }
    const previous = getPendingActionConfirmation(confirmation.supersedes);
    if (previous === null) {
        return null;
    }
    return {
        previousConfirmationId: previous.id,
        ...diffProposalCommands(
            previous.approvalSnapshot,
            confirmation.approvalSnapshot,
            proposalCommandShape.identity
        ),
    };
}

function projectRisk(agentApproval: ApprovalSnapshot['agentApproval']): AgentApprovalView['risk'] {
    if (!agentApproval) {
        return null;
    }
    return {
        level: agentApproval.policy.risk,
        decision: agentApproval.policy.decision,
        reasons: agentApproval.policy.reasons,
        requiredTrustMode: agentApproval.policy.requiredTrustMode,
    };
}

/**
 * Everything a musician needs to judge one pending proposal: what it changes, what it destroys
 * and how recoverable that is, what it is allowed to touch, whether it still matches the project,
 * what it cost and disclosed, and who approved it. Plain data only — no serialized batch text, no
 * provider reasoning, and no callable the caller could execute the proposal through.
 */
export function getAgentApprovalView(input: GetAgentApprovalViewInput): AgentApprovalView | null {
    const confirmation = getPendingActionConfirmation(input.confirmationId);
    if (!confirmation) {
        return null;
    }
    const { adoptedRecipes, agentApproval, batchPosition, commandBatch, measuredPreview, semanticDiff } =
        confirmation.approvalSnapshot;
    const freshness = getFreshness(confirmation);
    const routeView = getProviderRouteView({ runId: confirmation.runId });
    const recipes = Array.from(adoptedRecipes ?? []);
    if (measuredPreview?.revision === confirmation.projectRevision && measuredPreview.recipeSource !== undefined) {
        recipes.push(measuredPreview.recipeSource);
    }
    let metricEvaluation: MetricGoalEvaluation = {
        status: 'blocked',
        failure: 'missing',
        reason: 'This proposal has no command batch to verify.',
        criteria: [],
    };
    if (commandBatch !== undefined) {
        metricEvaluation = evaluateMetricGoalAdmission({
            state: metricGoalStateCodec(confirmation.approvalSnapshot.metricGoalState),
            commandBatch,
            currentRevision: freshness.currentRevision ?? undefined,
        });
    }
    const metricGoals: AgentApprovalView['metricGoals'] = {
        ...metricEvaluation,
        criteria: metricEvaluation.criteria.map((criterion) => {
            const names = (ids: readonly string[]) =>
                ids
                    .map((id) =>
                        id === 'master'
                            ? 'Master output'
                            : (trackStore.value?.tracks.find((track) => track.id === id)?.name ?? id)
                    )
                    .map((name) => `“${name}”`)
                    .join(', ');
            const unit = criterion.unit ?? 'unavailable';
            const range =
                criterion.range === null
                    ? 'range unavailable'
                    : `beats ${String(criterion.range.startBeat)}–${String(criterion.range.endBeat)}`;
            let source = 'Application objective policy';
            if (criterion.source.kind === 'recipe')
                source = `Recipe ${criterion.source.recipeId}, catalog ${String(criterion.source.catalogVersion)}, expectation ${String(criterion.source.expectationIndex + 1)}`;
            if (criterion.source.kind === 'policy') source = criterion.source.policyId;
            let reference = '';
            if (criterion.referenceTargetIds.length > 0)
                reference = `; current preview reference ${names(criterion.referenceTargetIds)}: ${criterion.reference.map(String).join(', ')} ${unit}`;
            let tolerance = '';
            if (criterion.relation === 'match-current')
                tolerance = `; absolute difference ≤ ${String(criterion.tolerance)} LU (application objective policy)`;
            return {
                ...criterion,
                criterionText: `${source}: ${criterion.metricId ?? 'unsupported metric'}${criterion.band === null ? '' : `, band ${criterion.band}`} on ${names(criterion.targetIds)}, ${range}; criterion ${criterion.relation}${tolerance}; actual baseline ${criterion.baseline.map(String).join(', ') || 'unavailable'} ${unit}; actual preview ${criterion.observed.map(String).join(', ') || 'unavailable'} ${unit}${reference}. ${criterion.status}.`,
            };
        }),
    };
    return {
        canConfirm:
            confirmation.status === 'proposed' &&
            freshness.status === 'current' &&
            metricGoals.status !== 'blocked' &&
            agentApproval !== undefined,
        metricGoals,
        confirmationId: confirmation.id,
        runId: confirmation.runId,
        status: confirmation.status,
        error: confirmation.error,
        prompt: confirmation.prompt,
        batchPosition: batchPosition ?? null,
        actionLabels: confirmation.actionLabels,
        supersedes: confirmation.supersedes,
        supersededBy: confirmation.supersededBy,
        previousProposalDiff: projectPreviousProposalDiff(confirmation),
        scope: commandBatch ? commandBatch.authority.scope : EMPTY_SCOPE,
        risk: projectRisk(agentApproval),
        recipes: projectRecipes(recipes),
        measuredPreview: projectMeasuredPreview(measuredPreview, confirmation.projectRevision),
        ...projectSemanticDiff(semanticDiff),
        baseRevision: confirmation.projectRevision,
        freshness,
        rePreview: getRePreviewAvailability(confirmation, freshness),
        consequences: agentApproval?.consequences ?? null,
        budgets: commandBatch?.authority.budgets ?? null,
        cost: routeView?.cost ?? [],
        dataDisclosure: routeView?.dataDisclosure ?? null,
        actor: agentApproval ? { localActorId: agentApproval.localActorId } : null,
        expiry: { kind: 'revision-bound', revision: confirmation.projectRevision },
        createdAt: confirmation.createdAt,
        resolvedAt: confirmation.resolvedAt,
    };
}
