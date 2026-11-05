import {
    compileVersionedCommandBatchEnvelope,
    parseVersionedCommandBatchEnvelope,
    serializeVersionedCommandEnvelope,
} from '#/modules/Command/useCases';
import { captureProjectRevision } from '#/modules/CrdtDocument/useCases';

import { ANALYSIS_MEASURE_MAX_TARGETS } from '../models/AnalysisMeasureLimits';
import { type ApplicationToolReceipt } from '../models/ApplicationOwnedTool';
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
import { executeAnalysisMeasure } from './executeAnalysisMeasure';
import { type MetricGoal, type MetricGoalState } from './metricGoalContractTypes';
import { readGoalPrefix } from './readGoalPrefix';

type PreviewInput = {
    state: MetricGoalState;
    commandBatch: { serialized: string; authority: Parameters<typeof parseVersionedCommandBatchEnvelope>[1] };
    context: ProjectContext;
    prompt: string;
    runId: string;
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
/** Subjects of one scope kind and range at one prefix, each with the metrics its goals read. */
type ScopeGroup = {
    kind: PreviewRequest['scope']['kind'];
    range: PreviewGoal['range'];
    metricsById: Map<string, Set<PreviewGoal['metricId']>>;
};
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

function scopeMembers(ids: string[], kind: PreviewRequest['scope']['kind'], context: ProjectContext): string[] {
    return ids.filter((id) => {
        if (id === 'master') {
            return kind === 'master';
        }
        return context.tracks.some((track) => {
            if (track.id !== id) {
                return false;
            }
            if (kind === 'buses') {
                return track.kind === 'bus';
            }
            return kind === 'tracks' && (track.kind === 'audio' || track.kind === 'midi');
        });
    });
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

function readScopeGroup(
    groups: Map<string, ScopeGroup>,
    kind: PreviewRequest['scope']['kind'],
    range: PreviewGoal['range']
): ScopeGroup {
    const key = JSON.stringify([kind, range]);
    const existing = groups.get(key);
    if (existing !== undefined) {
        return existing;
    }
    const created: ScopeGroup = { kind, range, metricsById: new Map<string, Set<PreviewGoal['metricId']>>() };
    groups.set(key, created);
    return created;
}

function addSubjectMetric(group: ScopeGroup, id: string, metricId: PreviewGoal['metricId']): void {
    const metrics = group.metricsById.get(id);
    if (metrics === undefined) {
        group.metricsById.set(id, new Set([metricId]));
        return;
    }
    metrics.add(metricId);
}

/** Every metric a goal reads on any subject of one chunk, in first-read order. */
function chunkMetrics(metricsById: ScopeGroup['metricsById'], chunk: readonly string[]): PreviewGoal['metricId'][] {
    const metrics = new Set<PreviewGoal['metricId']>();
    for (const id of chunk) {
        const subjectMetrics = metricsById.get(id);
        if (subjectMetrics === undefined) {
            continue;
        }
        for (const metricId of subjectMetrics) {
            metrics.add(metricId);
        }
    }
    return [...metrics];
}

/**
 * The measurements one prefix needs. Goals of one scope kind and range share their requests: their
 * subjects are measured once, in chunks of at most `ANALYSIS_MEASURE_MAX_TARGETS`, each chunk with
 * every metric a goal on one of its subjects reads, since admission finds a subject's figure by its
 * target id inside any proof at that prefix and range.
 */
function sharedScopeRequests(
    reads: readonly GoalRead[],
    hash: string,
    envelope: PreviewEnvelope,
    context: ProjectContext
): PreviewRequest[] {
    const groups = new Map<string, ScopeGroup>();
    for (const { goal, ids } of reads) {
        for (const kind of ['master', 'tracks', 'buses'] as const) {
            const members = scopeMembers([...ids], kind, context);
            if (members.length === 0) {
                continue;
            }
            const group = readScopeGroup(groups, kind, goal.range);
            for (const id of members) {
                addSubjectMetric(group, id, goal.metricId);
            }
        }
    }
    return [...groups.values()].flatMap(({ kind, range, metricsById }) => {
        const members = [...metricsById.keys()];
        const requests: PreviewRequest[] = [];
        for (let start = 0; start < members.length; start += ANALYSIS_MEASURE_MAX_TARGETS) {
            const chunk = members.slice(start, start + ANALYSIS_MEASURE_MAX_TARGETS);
            const metrics = chunkMetrics(metricsById, chunk);
            const scope = kind === 'master' ? { kind } : { kind, ids: chunk };
            requests.push({ hash, envelope, scope, range, metrics });
        }
        return requests;
    });
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
        requests.push(...sharedScopeRequests(atPrefix, prefix.after, prepared, context));
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

function measurementCall(
    request: PreviewRequest,
    callId: string
): Parameters<typeof executeAnalysisMeasure>[0]['call'] {
    let range: { startBeat: number; endBeat: number } | { sectionId: string };
    if (request.range.sectionId === null) {
        range = { startBeat: request.range.startBeat, endBeat: request.range.endBeat };
    } else {
        range = { sectionId: request.range.sectionId };
    }
    return {
        id: callId,
        name: 'analysis.measure',
        arguments: {
            subject: 'preview',
            scope: request.scope,
            range,
            metrics: request.metrics,
            proposal: {
                schemaVersion: 1,
                items: request.envelope.commands.map((command, index) => ({
                    id: `prepared-${String(index)}`,
                    name: command.operation,
                    arguments: command.arguments,
                })),
            },
        },
    };
}

async function measurePreviewRequests(
    input: PreviewInput,
    state: MetricGoalState,
    envelope: PreviewEnvelope,
    requests: PreviewRequest[],
    priorBytes: number,
    signal: AbortSignal
) {
    const rawReceipts: ApplicationToolReceipt[] = [];
    const compilations: RetainedCompilation[] = [];
    let receipts: ApplicationToolReceipt[] = [];
    for (const request of requests) {
        if (signal.aborted || captureProjectRevision() !== envelope.baseRevision) {
            break;
        }
        const callId = `goal-measure-${crypto.randomUUID()}`;
        // turn 0 identifies application verification, not another provider turn or earned allowance.
        const read = await executeAnalysisMeasure({
            call: measurementCall(request, callId),
            callId,
            turn: 0,
            projectRevision: envelope.baseRevision,
            sections: input.context.sections ?? [],
            signal,
            admit: agentWorkBudget.admitMeasurement(input.runId),
            preview: {
                context: input.context,
                prompt: input.prompt,
                runId: input.runId,
                origin: 'approval-preview',
                preparedBatch: request.envelope,
                readCreativeAuthority: () =>
                    state.authorities.find((authority) => authority.creativeAuthority !== null)?.creativeAuthority ??
                    undefined,
            },
        });
        rawReceipts.push(
            boundReceipt(
                { ...read.receipt, origin: 'application-verification' },
                APPLICATION_OWNED_TOOL_LOOP_LIMITS.maxReceiptBytesPerCall
            )
        );
        if (read.commands !== null && read.measuredPreview !== null) {
            compilations.push({
                kind: 'preview',
                callId,
                revision: envelope.baseRevision,
                commands: read.commands,
                measuredPreview: read.measuredPreview,
            });
        }
        receipts = admitTurnReadReceipts({
            realReceipts: rawReceipts,
            turn: 0,
            totalReceiptBytesSoFar: priorBytes,
            maxReceiptBytesPerTurn: APPLICATION_OWNED_TOOL_LOOP_LIMITS.maxReceiptBytesPerTurn,
            maxTotalReceiptBytes: APPLICATION_OWNED_TOOL_LOOP_LIMITS.maxTotalReceiptBytes,
        });
    }
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
        captureProjectRevision() !== revision
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
        const { receipts, compilations } = await measurePreviewRequests(
            input,
            state,
            parsed.envelope,
            requests,
            priorBytes,
            controller.signal
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
