import {
    compileVersionedCommandBatchEnvelope,
    parseVersionedCommandBatchEnvelope,
    serializeVersionedCommandEnvelope,
} from '#/modules/Command/useCases';
import { projectRevisionMatchesLiveIgnoringSaveWrites } from '#/modules/CrdtDocument/useCases';

import { ANALYSIS_MEASURE_MAX_WARNINGS } from '../models/AnalysisMeasureLimits';
import { type AnalysisMeasureRead } from '../models/AnalysisMeasureRead';
import { type ApplicationToolReceipt } from '../models/ApplicationOwnedTool';
import { type MeasurementFailure } from '../models/MeasurementBudget';
import { type ProjectContext } from '../models/ProjectContext';
import { type RetainedCompilation } from '../models/RetainedCompilation';
import { getCloudProviderRuntime } from '../repositories/cloudLlm/getCloudProviderRuntime';
import { getLlmEngine } from '../repositories/webLlm/getLlmEngine';
import { admitTurnReadReceipts, boundReceipt, serializeReceiptContext } from '../services/applicationToolReceiptBudget';
import { aiBackendPreferenceStore } from '../stores/aiBackendPreferenceStore';

import { agentRunLifecycle } from './agentRunLifecycle';
import { agentRunWorkLease } from './agentRunWorkLease';
import { agentWorkBudget } from './agentWorkBudget';
import { APPLICATION_OWNED_TOOL_LOOP_LIMITS } from './applicationOwnedToolLoop';
import { bindMetricGoalsToBatch } from './bindMetricGoalsToBatch';
import { agentRunCancellation } from './cancelAgentRun';
import { collectMetricGoalProof } from './collectMetricGoalProof';
import { digestCommandBatchContent } from './digestCommandBatchContent';
import { measurementFailureReceipt } from './executeAnalysisMeasure';
import { measuredPreviewRead } from './executePreviewMeasurement';
import { measurePreviewUnit, type PreviewUnitRead } from './measurePreviewUnit';
import { type MeasurementUnitProgress } from './measureProjectUnit';
import { type MetricGoal, type MetricGoalState } from './metricGoalContractTypes';
import { planMetricMeasurementRequests, planMetricMeasurementUnits } from './planMetricMeasurementRequests';
import { readGoalPrefix } from './readGoalPrefix';

type PreviewInput = {
    state: MetricGoalState;
    commandBatch: { serialized: string; authority: Parameters<typeof parseVersionedCommandBatchEnvelope>[1] };
    context: ProjectContext;
    prompt: string;
    runId: string;
    /** Called as each render begins, naming its target, document and prefix step. */
    onProgress?: (progress: MetricGoalPreviewProgress) => void;
};

/** Which target renders now, in which document, and for a prefix document the batch step it ends at. */
export type MetricGoalPreviewProgress = MeasurementUnitProgress & {
    /** The step whose prefix document renders; `null` for the live project or the whole batch. */
    stepId: string | null;
};
type PreviewEnvelope = Extract<ReturnType<typeof parseVersionedCommandBatchEnvelope>, { status: 'valid' }>['envelope'];
type Binding = NonNullable<MetricGoalState['binding']>;
type PreviewGoal = MetricGoal & {
    metricId: NonNullable<MetricGoal['metricId']>;
    range: NonNullable<MetricGoal['range']>;
};
type PreviewRequest = {
    hash: string;
    envelope: PreviewEnvelope;
    scope: { kind: 'master' } | { kind: 'tracks' | 'buses'; ids: string[] };
    range: NonNullable<MetricGoal['range']>;
    metrics: NonNullable<MetricGoal['metricId']>[];
};
/** One prefix admission reads a goal at, and the subjects of that goal it reads there. */
type GoalRead = { hash: string; goal: PreviewGoal; ids: readonly string[] };
type PreviewRun = NonNullable<ReturnType<typeof agentRunLifecycle.get>>;
type ProviderSnapshot = {
    cloudRuntime: ReturnType<typeof getCloudProviderRuntime>;
    localEngine: ReturnType<typeof getLlmEngine>;
    backendPreference: typeof aiBackendPreferenceStore.value;
};

function requirePreviewRun(runId: string): PreviewRun {
    const run = agentRunLifecycle.get(runId);
    if (
        run === null ||
        run.cancellation.requestedAt !== null ||
        run.workLeases.some(
            (lease) =>
                lease.ownerKind === 'analysis' &&
                lease.cleanupOwner === 'metric-goal-preview' &&
                lease.terminalState === null
        )
    ) {
        throw new Error('This run cannot begin another metric goal preview.');
    }
    return run;
}

function compilePrefixEnvelope(envelope: PreviewEnvelope, count: number, hash: string): PreviewEnvelope | null {
    const commands = envelope.commands.slice(0, count);
    const commandIds = new Set(commands.map((command) => command.commandId));
    if (commands.length === envelope.commands.length) {
        return envelope;
    }
    const originalEffects = envelope.dynamicEffects;
    let dynamicEffects: Parameters<typeof compileVersionedCommandBatchEnvelope>[0]['dynamicEffects'];
    if (originalEffects !== undefined) {
        if (originalEffects.commandEffects === undefined) {
            // An aggregate cannot prove which bounds belong to this dependency-closed prefix.
            return null;
        }
        const commandEffects = originalEffects.commandEffects.filter((entry) => commandIds.has(entry.commandId));
        dynamicEffects = {
            commandEffects,
            affectedTrackIds: [...new Set(commandEffects.flatMap((entry) => entry.effects.affectedTrackIds ?? []))],
            affectedClipIds: [...new Set(commandEffects.flatMap((entry) => entry.effects.affectedClipIds ?? []))],
            affectedTargetIds: [...new Set(commandEffects.flatMap((entry) => entry.effects.affectedTargetIds ?? []))],
            automationPoints: commandEffects.reduce((total, entry) => total + (entry.effects.automationPoints ?? 0), 0),
            deletedObjects: commandEffects.reduce((total, entry) => total + (entry.effects.deletedObjects ?? 0), 0),
        };
    }
    const compiled = compileVersionedCommandBatchEnvelope({
        commands: commands.map(serializeVersionedCommandEnvelope),
        batchLocalBindings: envelope.batchLocalBindings.filter((binding) => commandIds.has(binding.producerCommandId)),
        dynamicEffects,
        baseRevision: envelope.baseRevision,
        batchId: envelope.batchId,
        projectId: envelope.projectId,
        runId: envelope.runId,
        intent: envelope.intent,
        mode: 'preview',
        protectedTargetIds: envelope.scope.protectedTargetIds,
        protectedRanges: envelope.scope.protectedRanges,
    });
    const prefixBatch = parseVersionedCommandBatchEnvelope(compiled.serialized, compiled.authority);
    if (prefixBatch.status !== 'valid' || digestCommandBatchContent(prefixBatch.envelope) !== hash) {
        return null;
    }
    return prefixBatch.envelope;
}

function currentPreviewGoal(goal: MetricGoal, context: ProjectContext): goal is PreviewGoal {
    if (goal.metricId === null || goal.range === null || goal.relation === 'unsupported') {
        return false;
    }
    return (
        goal.range.sectionId === null ||
        context.sections?.some(
            (section) =>
                section.id === goal.range?.sectionId &&
                section.startBeat === goal.range.startBeat &&
                section.endBeat === goal.range.endBeat
        ) === true
    );
}

/**
 * The batch prefixes admission reads a goal's figures at, and the subjects it reads there
 * (`targetComparison` and `goalReferences` in evaluateMetricGoalAdmission): each target at its
 * step's after (baseline and preview), at its step's before (preview) and at the whole batch
 * (preview), and each reference target at the whole batch alone. An overall goal's step is the
 * whole batch from the live project, so it is read at the whole batch only. A goal whose step the
 * binding lacks (a drifted batch binds no steps) is refused as missing without a read, yet the card
 * still shows what the whole batch measures, so it is measured there.
 */
function goalReads(goal: PreviewGoal, binding: Binding): GoalRead[] {
    const prefix = readGoalPrefix(goal, binding);
    if (prefix === undefined) {
        return subjectReads(goal, [binding.contentHash], binding);
    }
    const hashes = [prefix.after, prefix.before, binding.contentHash].filter((hash) => hash !== null);
    return subjectReads(goal, hashes, binding);
}

/** A goal's targets at each prefix it is read at, and its reference targets at the whole batch. */
function subjectReads(goal: PreviewGoal, hashes: readonly string[], binding: Binding): GoalRead[] {
    const targetReads = hashes.map((hash) => ({ hash, goal, ids: goal.targetIds }));
    return [...targetReads, { hash: binding.contentHash, goal, ids: goal.referenceTargetIds }];
}

function buildPreviewRequests(
    state: MetricGoalState,
    binding: Binding,
    envelope: PreviewEnvelope,
    context: ProjectContext
): PreviewRequest[] {
    const goals = state.authorities.flatMap((authority) => authority.goals);
    const previewGoals = goals.filter((goal) => currentPreviewGoal(goal, context));
    const reads = previewGoals.flatMap((goal) => goalReads(goal, binding));
    const requests: PreviewRequest[] = [];
    const needed = [...binding.prefixes];
    if (!needed.some((prefix) => prefix.after === binding.contentHash)) {
        needed.push({ stepId: 'overall', before: null, after: binding.contentHash });
    }
    let offset = 0;
    for (const prefix of needed) {
        const step = state.steps.find((entry) => entry.stepId === prefix.stepId);
        if (step !== undefined) {
            offset += step.commandCount;
        }
        const count = prefix.stepId === 'overall' ? envelope.commands.length : offset;
        const atPrefix = reads.filter((read) => read.hash === prefix.after);
        if (atPrefix.length === 0 || requests.some((request) => request.hash === prefix.after)) {
            continue;
        }
        const prepared = compilePrefixEnvelope(envelope, count, prefix.after);
        if (prepared === null) {
            continue;
        }
        requests.push(
            ...planMetricMeasurementRequests({
                reads: atPrefix.map(({ hash, goal, ids }) => ({
                    prefix: hash,
                    range: goal.range,
                    metricId: goal.metricId,
                    targetIds: ids,
                })),
                context,
            }).map(({ prefix: hash, ...request }) => ({ hash, envelope: prepared, ...request }))
        );
    }
    return requests;
}

function priorReceiptBytes(priorReceipts: readonly ApplicationToolReceipt[]): number {
    const priorTurns = new Set(priorReceipts.map((receipt) => receipt.turn));
    const byteLength = (value: string) => new TextEncoder().encode(value).byteLength;
    return [...priorTurns].reduce(
        (total, turn) =>
            total +
            byteLength(
                serializeReceiptContext(
                    priorReceipts.filter((receipt) => receipt.turn === turn),
                    turn
                )
            ),
        0
    );
}

type RequestOutcome = { failure: MeasurementFailure | null; reads: Map<string, PreviewUnitRead> };

function previewRequestRead(
    input: PreviewInput,
    envelope: PreviewEnvelope,
    request: PreviewRequest,
    reads: readonly PreviewUnitRead[]
): AnalysisMeasureRead {
    const [first] = reads;
    return measuredPreviewRead({
        callId: `goal-measure-${crypto.randomUUID()}`,
        // turn 0 identifies application verification, not another provider turn or earned allowance.
        turn: 0,
        projectRevision: envelope.baseRevision,
        origin: 'approval-preview',
        runId: input.runId,
        scope: first!.call.scope,
        metrics: first!.call.metrics,
        beats: first!.beats,
        commands: first!.commands,
        batchContentHash: first!.batchContentHash,
        targets: reads.map((read) => read.target),
        renders: reads.map((read) => ({ targetId: read.target.targetId, ...read.renders })),
        baselineSeconds: first!.baselineSeconds,
        previewSeconds: first!.previewSeconds,
        warnings: [...new Set(reads.flatMap((read) => read.warnings))].slice(0, ANALYSIS_MEASURE_MAX_WARNINGS),
    });
}

function requestTargets(request: PreviewRequest): string[] {
    return request.scope.kind === 'master' ? ['master'] : request.scope.ids;
}

/**
 * Renders the requests one target at a time (`planMetricMeasurementUnits`), each target's live render
 * shared by every prefix and range it is read at, then reports each request as the one
 * `analysis.measure` receipt and measured compilation it always was: a request whose target failed
 * carries that failure, and one the stop left unmeasured reports nothing.
 */
async function measurePreviewRequests(
    input: PreviewInput,
    state: MetricGoalState,
    envelope: PreviewEnvelope,
    requests: PreviewRequest[],
    priorBytes: number,
    signal: AbortSignal,
    onProgress: ((progress: MeasurementUnitProgress) => void) | undefined
) {
    const outcomes: RequestOutcome[] = requests.map(() => ({ failure: null, reads: new Map() }));
    const units = planMetricMeasurementUnits({
        requests: requests.map(({ hash, scope, range, metrics }) => ({ prefix: hash, scope, range, metrics })),
        subject: 'preview',
    });
    const envelopes = new Map(requests.map((request) => [request.hash, request.envelope]));
    const measuredRequests = new Set<number>();
    for (const unit of units) {
        if (signal.aborted || !projectRevisionMatchesLiveIgnoringSaveWrites(envelope.baseRevision)) {
            break;
        }
        const measured = await measurePreviewUnit({
            unit,
            envelopes,
            projectRevision: envelope.baseRevision,
            sections: input.context.sections ?? [],
            signal,
            admit: agentWorkBudget.admitMeasurement(input.runId),
            preview: {
                context: input.context,
                prompt: input.prompt,
                runId: input.runId,
                readCreativeAuthority: () =>
                    state.authorities.find((authority) => authority.creativeAuthority !== null)?.creativeAuthority ??
                    undefined,
            },
            onProgress,
        });
        for (const read of unit.reads) {
            measuredRequests.add(read.requestIndex);
        }
        if (measured.status === 'failed') {
            for (const read of unit.reads) {
                outcomes[read.requestIndex]!.failure ??= measured.failure;
            }
            continue;
        }
        for (const read of measured.reads) {
            outcomes[read.requestIndex]!.reads.set(read.target.targetId, read);
        }
    }
    const rawReceipts: ApplicationToolReceipt[] = [];
    const compilations: RetainedCompilation[] = [];
    for (const [index, request] of requests.entries()) {
        const outcome = outcomes[index]!;
        const reads = requestTargets(request).flatMap((targetId) => outcome.reads.get(targetId) ?? []);
        if (
            !measuredRequests.has(index) ||
            (outcome.failure === null && reads.length !== requestTargets(request).length)
        ) {
            continue;
        }
        if (outcome.failure !== null) {
            rawReceipts.push(
                boundReceipt(
                    {
                        ...measurementFailureReceipt(
                            { callId: `goal-measure-${crypto.randomUUID()}`, turn: 0 },
                            outcome.failure
                        ),
                        origin: 'application-verification',
                    },
                    APPLICATION_OWNED_TOOL_LOOP_LIMITS.maxReceiptBytesPerCall
                )
            );
            continue;
        }
        const read = previewRequestRead(input, envelope, request, reads);
        rawReceipts.push(
            boundReceipt(
                { ...read.receipt, origin: 'application-verification' },
                APPLICATION_OWNED_TOOL_LOOP_LIMITS.maxReceiptBytesPerCall
            )
        );
        if (read.commands !== null && read.measuredPreview !== null) {
            compilations.push({
                kind: 'preview',
                callId: read.receipt.callId,
                revision: envelope.baseRevision,
                commands: read.commands,
                measuredPreview: read.measuredPreview,
            });
        }
    }
    const receipts = admitTurnReadReceipts({
        realReceipts: rawReceipts,
        turn: 0,
        totalReceiptBytesSoFar: priorBytes,
        maxReceiptBytesPerTurn: APPLICATION_OWNED_TOOL_LOOP_LIMITS.maxReceiptBytesPerTurn,
        maxTotalReceiptBytes: APPLICATION_OWNED_TOOL_LOOP_LIMITS.maxTotalReceiptBytes,
    });
    return { compilations, receipts };
}

function previewInvalidated(
    input: PreviewInput,
    run: PreviewRun,
    snapshot: ProviderSnapshot,
    signal: AbortSignal,
    revision: string
): boolean {
    return (
        getCloudProviderRuntime() !== snapshot.cloudRuntime ||
        getLlmEngine() !== snapshot.localEngine ||
        aiBackendPreferenceStore.value !== snapshot.backendPreference ||
        signal.aborted ||
        agentRunLifecycle.get(input.runId)?.cancellation.generation !== run.cancellation.generation ||
        !projectRevisionMatchesLiveIgnoringSaveWrites(revision)
    );
}

function claimPreviewWork(runId: string) {
    const workId = `goal-preview-${crypto.randomUUID()}`;
    const claimed = agentRunWorkLease.claim({
        runId,
        workId,
        ownerKind: 'analysis',
        cleanupOwner: 'metric-goal-preview',
        idempotencyKey: workId,
        receiptIdentity: workId,
        idempotent: true,
        retriable: false,
    });
    if (claimed.status !== 'claimed') {
        throw new Error(`Metric preview work could not be claimed: ${claimed.status}`);
    }
    return claimed;
}

/** Explicit Re-preview performs bounded application reads; it never resets or calls a provider loop. */
export async function prepareMetricGoalPreview(
    input: PreviewInput
): Promise<{ state: MetricGoalState; receipts: ApplicationToolReceipt[] }> {
    const state = bindMetricGoalsToBatch({ state: input.state, commandBatch: input.commandBatch });
    if (state.authorities.length === 0 || state.authorities.every((authority) => authority.kind === 'literal')) {
        return { state, receipts: [] };
    }
    const parsed = parseVersionedCommandBatchEnvelope(input.commandBatch.serialized, input.commandBatch.authority);
    if (parsed.status !== 'valid' || state.binding === null) {
        throw new TypeError('The metric preview has no valid prepared batch.');
    }
    const run = requirePreviewRun(input.runId);
    const snapshot = {
        cloudRuntime: getCloudProviderRuntime(),
        localEngine: getLlmEngine(),
        backendPreference: aiBackendPreferenceStore.value,
    };
    const requests = buildPreviewRequests(state, state.binding, parsed.envelope, input.context);
    const priorBytes = priorReceiptBytes(run.plan?.applicationToolReceipts ?? []);
    const claimed = claimPreviewWork(input.runId);
    const controller = new AbortController();
    const release = agentRunCancellation.bindAbortController({
        runId: input.runId,
        lease: claimed.lease,
        controller,
        reason: 'Metric goal preview cancelled.',
    });
    let terminalState: 'completed' | 'failed' | 'cancelled' = 'failed';
    try {
        const binding = state.binding;
        const { receipts, compilations } = await measurePreviewRequests(
            input,
            state,
            parsed.envelope,
            requests,
            priorBytes,
            controller.signal,
            input.onProgress === undefined
                ? undefined
                : (progress) =>
                      input.onProgress?.({
                          ...progress,
                          stepId: binding.prefixes.find((prefix) => prefix.after === progress.prefix)?.stepId ?? null,
                      })
        );
        if (previewInvalidated(input, run, snapshot, controller.signal, parsed.envelope.baseRevision)) {
            terminalState = 'cancelled';
            throw new Error(
                'The project, provider configuration or run changed while metric proof was being refreshed.'
            );
        }
        terminalState = 'completed';
        return {
            state: {
                ...state,
                proofs: collectMetricGoalProof({ authorities: state.authorities, compilations, receipts }),
            },
            receipts,
        };
    } finally {
        release();
        agentRunWorkLease.settle({
            runId: claimed.lease.runId,
            workId: claimed.lease.workId,
            leaseId: claimed.lease.leaseId,
            cancellationGeneration: claimed.lease.cancellationGeneration,
            idempotencyKey: claimed.lease.idempotencyKey,
            receiptIdentity: claimed.lease.receiptIdentity,
            terminalState,
        });
    }
}
