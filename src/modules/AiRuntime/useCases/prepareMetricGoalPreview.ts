import { parseVersionedCommandBatchEnvelope } from '#/modules/Command/useCases';
import { captureProjectRevision } from '#/modules/CrdtDocument/useCases';

import { ANALYSIS_MEASURE_MAX_TARGETS } from '../models/AnalysisMeasureLimits';
import { type ApplicationToolReceipt } from '../models/ApplicationOwnedTool';
import { type ProjectContext } from '../models/ProjectContext';
import { type RetainedCompilation } from '../models/RetainedCompilation';
import { getCloudProviderRuntime } from '../repositories/cloudLlm/getCloudProviderRuntime';
import { getLlmEngine } from '../repositories/webLlm/getLlmEngine';
import { aiBackendPreferenceStore } from '../stores/aiBackendPreferenceStore';

import { agentRunLifecycle } from './agentRunLifecycle';
import { agentRunWorkLease } from './agentRunWorkLease';
import { agentWorkBudget } from './agentWorkBudget';
import {
    APPLICATION_OWNED_TOOL_LOOP_LIMITS,
    admitTurnReadReceipts,
    boundReceipt,
    serializeReceiptContext,
} from './applicationOwnedToolLoop';
import { bindMetricGoalsToBatch } from './bindMetricGoalsToBatch';
import { agentRunCancellation } from './cancelAgentRun';
import { collectMetricGoalProof } from './collectMetricGoalProof';
import { executeAnalysisMeasure } from './executeAnalysisMeasure';
import { type MetricGoalState } from './metricGoalContractTypes';

/** Explicit Re-preview performs bounded application reads; it never resets or calls a provider loop. */
export async function prepareMetricGoalPreview(input: {
    state: MetricGoalState;
    commandBatch: { serialized: string; authority: Parameters<typeof parseVersionedCommandBatchEnvelope>[1] };
    context: ProjectContext;
    prompt: string;
    runId: string;
}): Promise<{ state: MetricGoalState; receipts: ApplicationToolReceipt[] }> {
    const state = bindMetricGoalsToBatch({ state: input.state, commandBatch: input.commandBatch });
    if (state.authorities.length === 0 || state.authorities.every((authority) => authority.kind === 'literal')) {
        return { state, receipts: [] };
    }
    const parsed = parseVersionedCommandBatchEnvelope(input.commandBatch.serialized, input.commandBatch.authority);
    if (parsed.status !== 'valid' || state.binding === null) {
        throw new TypeError('The metric preview has no valid prepared batch.');
    }
    const run = agentRunLifecycle.get(input.runId);
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
    const cloudRuntime = getCloudProviderRuntime();
    const localEngine = getLlmEngine();
    const backendPreference = aiBackendPreferenceStore.value;
    const goals = state.authorities.flatMap((authority) => authority.goals);
    const requests: Array<{
        hash: string;
        envelope: typeof parsed.envelope;
        scope: { kind: 'master' } | { kind: 'tracks' | 'buses'; ids: string[] };
        range: NonNullable<(typeof goals)[number]['range']>;
        metrics: NonNullable<(typeof goals)[number]['metricId']>[];
    }> = [];
    const needed = [...state.binding.prefixes];
    if (!needed.some((prefix) => prefix.after === state.binding?.contentHash)) {
        needed.push({ stepId: 'overall', before: null, after: state.binding.contentHash });
    }
    let offset = 0;
    for (const prefix of needed) {
        const step = state.steps.find((entry) => entry.stepId === prefix.stepId);
        if (step !== undefined) offset += step.commandCount;
        const count = prefix.stepId === 'overall' ? parsed.envelope.commands.length : offset;
        const commands = parsed.envelope.commands.slice(0, count);
        const commandIds = new Set(commands.map((command) => command.commandId));
        const envelope = {
            ...parsed.envelope,
            commands,
            batchLocalBindings: parsed.envelope.batchLocalBindings.filter((binding) =>
                commandIds.has(binding.producerCommandId)
            ),
        };
        for (const goal of goals) {
            if (goal.metricId === null || goal.range === null || goal.relation === 'unsupported') continue;
            if (
                goal.range.sectionId !== null &&
                !input.context.sections?.some(
                    (section) =>
                        section.id === goal.range?.sectionId &&
                        section.startBeat === goal.range.startBeat &&
                        section.endBeat === goal.range.endBeat
                )
            )
                continue;
            const ids = [...new Set([...goal.targetIds, ...goal.referenceTargetIds])];
            for (const kind of ['master', 'tracks', 'buses'] as const) {
                const members = ids.filter((id) =>
                    id === 'master'
                        ? kind === 'master'
                        : input.context.tracks.some(
                              (track) =>
                                  track.id === id &&
                                  (kind === 'buses'
                                      ? track.kind === 'bus'
                                      : kind === 'tracks' && (track.kind === 'audio' || track.kind === 'midi'))
                          )
                );
                for (let start = 0; start < members.length; start += ANALYSIS_MEASURE_MAX_TARGETS) {
                    const slice = members.slice(start, start + ANALYSIS_MEASURE_MAX_TARGETS);
                    const scope = kind === 'master' ? { kind } : { kind, ids: slice };
                    const existing = requests.find(
                        (request) =>
                            request.hash === prefix.after &&
                            JSON.stringify(request.scope) === JSON.stringify(scope) &&
                            JSON.stringify(request.range) === JSON.stringify(goal.range)
                    );
                    if (existing !== undefined) {
                        if (!existing.metrics.includes(goal.metricId)) existing.metrics.push(goal.metricId);
                    } else {
                        requests.push({
                            hash: prefix.after,
                            envelope,
                            scope,
                            range: goal.range,
                            metrics: [goal.metricId],
                        });
                    }
                }
            }
        }
    }
    const priorReceipts = run.plan?.applicationToolReceipts ?? [];
    const priorTurns = new Set(priorReceipts.map((receipt) => receipt.turn));
    const byteLength = (value: string) => new TextEncoder().encode(value).byteLength;
    const priorBytes = [...priorTurns].reduce(
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
    const rawReceipts: ApplicationToolReceipt[] = [];
    const compilations: RetainedCompilation[] = [];
    const workId = `goal-preview-${crypto.randomUUID()}`;
    const claimed = agentRunWorkLease.claim({
        runId: input.runId,
        workId,
        ownerKind: 'analysis',
        cleanupOwner: 'metric-goal-preview',
        idempotencyKey: workId,
        receiptIdentity: workId,
        idempotent: true,
        retriable: false,
    });
    if (claimed.status !== 'claimed') throw new Error(`Metric preview work could not be claimed: ${claimed.status}`);
    const controller = new AbortController();
    const release = agentRunCancellation.bindAbortController({
        runId: input.runId,
        lease: claimed.lease,
        controller,
        reason: 'Metric goal preview cancelled.',
    });
    let receipts: ApplicationToolReceipt[] = [];
    let terminalState: 'completed' | 'failed' | 'cancelled' = 'failed';
    try {
        for (const request of requests) {
            if (controller.signal.aborted || captureProjectRevision() !== parsed.envelope.baseRevision) break;
            const callId = `goal-measure-${crypto.randomUUID()}`;
            const call = {
                id: callId,
                name: 'analysis.measure',
                arguments: {
                    subject: 'preview',
                    scope: request.scope,
                    range:
                        request.range.sectionId === null
                            ? { startBeat: request.range.startBeat, endBeat: request.range.endBeat }
                            : { sectionId: request.range.sectionId },
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
            // turn 0 identifies application verification, not another provider turn or earned allowance.
            const read = await executeAnalysisMeasure({
                call,
                callId,
                turn: 0,
                projectRevision: parsed.envelope.baseRevision,
                sections: input.context.sections ?? [],
                signal: controller.signal,
                admit: agentWorkBudget.admitMeasurement(input.runId),
                preview: {
                    context: input.context,
                    prompt: input.prompt,
                    runId: input.runId,
                    origin: 'approval-preview',
                    preparedBatch: request.envelope,
                    readCreativeAuthority: () =>
                        state.authorities.find((authority) => authority.creativeAuthority !== null)
                            ?.creativeAuthority ?? undefined,
                },
            });
            rawReceipts.push(boundReceipt(read.receipt, APPLICATION_OWNED_TOOL_LOOP_LIMITS.maxReceiptBytesPerCall));
            if (read.commands !== null && read.measuredPreview !== null) {
                compilations.push({
                    kind: 'preview',
                    callId,
                    revision: parsed.envelope.baseRevision,
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
        if (
            getCloudProviderRuntime() !== cloudRuntime ||
            getLlmEngine() !== localEngine ||
            aiBackendPreferenceStore.value !== backendPreference ||
            controller.signal.aborted ||
            agentRunLifecycle.get(input.runId)?.cancellation.generation !== run.cancellation.generation ||
            captureProjectRevision() !== parsed.envelope.baseRevision
        ) {
            terminalState = 'cancelled';
            return { state: { ...state, proofs: [] }, receipts };
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
        agentRunWorkLease.settle({ ...claimed.lease, terminalState });
    }
}
