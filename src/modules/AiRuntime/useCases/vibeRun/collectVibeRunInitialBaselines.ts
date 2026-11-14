import { AGENT_RUN_TERMINAL_PHASES } from '../../models/AgentRun';
import { type ApplicationToolReceipt } from '../../models/ApplicationOwnedTool';
import { type MeasurementAdmitter } from '../../models/MeasurementBudget';
import { type ProjectContext } from '../../models/ProjectContext';
import {
    admitTurnReadReceipts,
    boundReceipt,
    byteLength,
    serializeReceiptContext,
} from '../../services/applicationToolReceiptBudget';
import { readVibeRunInitialReceipt } from '../../validators/readVibeRunInitialReceipt';
import { agentRunLifecycle } from '../agentRunLifecycle';
import { agentRunWorkLease } from '../agentRunWorkLease';
import { ApplicationOwnedToolLoopRequestError, APPLICATION_OWNED_TOOL_LOOP_LIMITS } from '../applicationOwnedToolLoop';
import { agentRunCancellation } from '../cancelAgentRun';
import { measurementFailureReceipt } from '../measurementFailureReceipt';
import { measureProjectUnit, type MeasurementUnitProgress } from '../measureProjectUnit';
import { type planMetricMeasurementRequests } from '../planMetricMeasurementRequests';
import { planMetricMeasurementUnits } from '../planMetricMeasurementUnits';
import { projectMeasurementReceipt } from '../projectMeasurementReceipt';
import { readApplicationVerificationReceiptLimits } from '../readApplicationVerificationReceiptLimits';
import { settledProjectContentMatches } from '../settledProjectContentMatches';

type VibeRunInitialReceipt = NonNullable<ReturnType<typeof readVibeRunInitialReceipt>>;

type Collected =
    | { status: 'collected'; receipts: ApplicationToolReceipt[]; measurements: VibeRunInitialReceipt[] }
    | { status: 'refused'; receipts: ApplicationToolReceipt[]; reason: string };

type CollectionInput = {
    runId: string;
    sourceRevision: string;
    context: ProjectContext;
    signal: AbortSignal;
    admit: MeasurementAdmitter;
    priorReceipts: readonly ApplicationToolReceipt[];
    requests: ReturnType<typeof planMetricMeasurementRequests>;
    /** Called as each render begins, naming the target and the range group it renders. */
    onProgress?: (progress: MeasurementUnitProgress) => void;
};

function priorReceiptBytes(receipts: readonly ApplicationToolReceipt[]): number {
    return [...new Set(receipts.map((receipt) => receipt.turn))].reduce(
        (total, turn) =>
            total +
            byteLength(
                serializeReceiptContext(
                    receipts.filter((receipt) => receipt.turn === turn),
                    turn
                )
            ),
        0
    );
}

function bound(receipt: ApplicationToolReceipt): ApplicationToolReceipt {
    return boundReceipt(
        { ...receipt, origin: 'application-verification' },
        APPLICATION_OWNED_TOOL_LOOP_LIMITS.maxReceiptBytesPerCall
    );
}

/**
 * Each unit renders its targets once over every range and reports one receipt per range it reads,
 * exactly as one `analysis.measure` call per range would, so every exact-range reader is unchanged.
 */
async function measureRequests(
    input: CollectionInput,
    signal: AbortSignal,
    assertCurrent: () => void
): Promise<Collected> {
    const raw: { requestIndex: number; receipt: ApplicationToolReceipt }[] = [];
    let receipts: ApplicationToolReceipt[] = [];
    const priorBytes = priorReceiptBytes(input.priorReceipts);
    try {
        assertCurrent();
        for (const unit of planMetricMeasurementUnits({ requests: input.requests, subject: 'project' })) {
            assertCurrent();
            const measured = await measureProjectUnit(
                {
                    projectRevision: input.sourceRevision,
                    sections: input.context.sections ?? [],
                    signal,
                    admit: input.admit,
                    onProgress: input.onProgress,
                },
                unit
            );
            if (measured.status === 'failed') {
                const [first] = unit.reads;
                raw.push({
                    requestIndex: first?.requestIndex ?? 0,
                    receipt: bound(
                        measurementFailureReceipt(
                            { callId: `vibe-initial-${crypto.randomUUID()}`, turn: 0 },
                            measured.failure
                        )
                    ),
                });
            } else {
                for (const [index, read] of measured.reads.entries()) {
                    raw.push({
                        requestIndex: unit.reads[index]!.requestIndex,
                        receipt: bound(
                            projectMeasurementReceipt(
                                {
                                    callId: `vibe-initial-${crypto.randomUUID()}`,
                                    turn: 0,
                                    projectRevision: input.sourceRevision,
                                },
                                read.call,
                                read.measurement
                            )
                        ),
                    });
                }
            }
            raw.sort((left, right) => left.requestIndex - right.requestIndex);
            const limits = readApplicationVerificationReceiptLimits(raw.length);
            receipts = admitTurnReadReceipts({
                realReceipts: raw.map((entry) => entry.receipt),
                turn: 0,
                totalReceiptBytesSoFar: priorBytes,
                maxReceiptBytesPerTurn: limits.maxBytesPerCollection,
                maxTotalReceiptBytes: limits.maxTotalBytes,
            });
            assertCurrent();
            const failed = receipts.find((receipt) => readVibeRunInitialReceipt(receipt) === null);
            if (failed !== undefined) {
                return {
                    status: 'refused',
                    receipts,
                    reason: `Initial evidence incomplete: ${failed.error?.code ?? 'unreadable-receipt'}: ${failed.summary}`,
                };
            }
        }
        assertCurrent();
        const measurements = receipts.flatMap((receipt) => {
            const read = readVibeRunInitialReceipt(receipt);
            return read === null ? [] : [read];
        });
        return { status: 'collected', receipts, measurements };
    } catch (error) {
        throw new ApplicationOwnedToolLoopRequestError(error, [...input.priorReceipts, ...receipts], 0);
    }
}

/** Sequential read-only work at the original planning revision, under one cancellable run lease. */
export async function collectVibeRunInitialBaselines(input: CollectionInput): Promise<Collected> {
    const run = agentRunLifecycle.get(input.runId);
    if (
        run === null ||
        AGENT_RUN_TERMINAL_PHASES.has(run.phase) ||
        run.cancellation.requestedAt !== null ||
        run.workLeases.some(
            (lease) => lease.cleanupOwner === 'vibe-run-initial-baselines' && lease.terminalState === null
        )
    ) {
        throw new Error('This run cannot collect initial baselines.');
    }
    const workId = `vibe-initial-${crypto.randomUUID()}`;
    const claimed = agentRunWorkLease.claim({
        runId: input.runId,
        workId,
        ownerKind: 'analysis',
        cleanupOwner: 'vibe-run-initial-baselines',
        idempotencyKey: workId,
        receiptIdentity: workId,
        idempotent: true,
        retriable: false,
    });
    if (claimed.status !== 'claimed') {
        throw new Error(`Initial baseline work could not be claimed: ${claimed.status}`);
    }
    const controller = new AbortController();
    const release = agentRunCancellation.bindAbortController({
        runId: input.runId,
        lease: claimed.lease,
        controller,
        reason: 'Initial baseline collection cancelled.',
    });
    const signal = AbortSignal.any([input.signal, controller.signal]);
    const assertCurrent = () => {
        const current = agentRunLifecycle.get(input.runId);
        if (
            signal.aborted ||
            current === null ||
            AGENT_RUN_TERMINAL_PHASES.has(current.phase) ||
            current.cancellation.generation !== run.cancellation.generation ||
            !settledProjectContentMatches(input.sourceRevision)
        ) {
            throw new Error('The project or run changed while initial baselines were being collected.');
        }
    };
    let terminalState: 'completed' | 'failed' | 'cancelled' = 'failed';
    try {
        const collected = await measureRequests(input, signal, assertCurrent);
        assertCurrent();
        terminalState = collected.status === 'collected' ? 'completed' : 'failed';
        return collected;
    } catch (error) {
        terminalState = signal.aborted ? 'cancelled' : 'failed';
        throw error;
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
