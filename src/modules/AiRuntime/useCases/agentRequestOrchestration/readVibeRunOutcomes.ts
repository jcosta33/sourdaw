import { type AgentRun } from '../../models/AgentRun';
import { type ScheduledVibeRunBatch, type ScheduledVibeRunPlan } from '../../models/VibeRunPlan';
import {
    type PendingAppActionConfirmation,
    pendingActionConfirmationStore,
} from '../../stores/pendingActionConfirmationStore';
import { readScheduledVibeRunPlan } from '../../validators/readScheduledVibeRunPlan';
import { evaluateMetricGoalAdmission } from '../evaluateMetricGoalAdmission';
import { metricGoalStateCodec } from '../metricGoalStateCodec';
import { type VibeBatchOutcome, type VibeRunBatchSummary } from '../vibeRun/describeVibeRunSummary';

import { readConfirmationBatchId } from './readConfirmationBatchId';

/** The batches after the brief, which holds position 1 of its run. */
const FIRST_BATCH_POSITION = 2;

/** One batch of a vibe run that reached the project, with the undo group its commit wrote. */
export type AppliedVibeRunBatch = {
    readonly position: number;
    readonly confirmation: PendingAppActionConfirmation;
    readonly batch: ScheduledVibeRunBatch;
    /** The revert group of the batch's receipt, or `null` when its commit recorded none. */
    readonly revertGroupId: string | null;
};

type VibeRunCards = {
    readonly run: AgentRun;
    readonly plan: ScheduledVibeRunPlan;
    readonly cards: ReadonlyArray<{ position: number; batchId: string | null; card: PendingAppActionConfirmation }>;
};

function readVibeRunCards(run: AgentRun): VibeRunCards | null {
    const schedule = run.plan?.batchSchedule;
    if (schedule?.kind !== 'vibe-run') {
        return null;
    }
    const plan = readScheduledVibeRunPlan(schedule.serializedPlan);
    if (plan === null) {
        return null;
    }
    const cards = (pendingActionConfirmationStore.value?.confirmations ?? []).flatMap((card) => {
        const position = card.approvalSnapshot.batchPosition?.index ?? 0;
        return card.runId === run.runId && position >= FIRST_BATCH_POSITION
            ? [{ position, batchId: readConfirmationBatchId(card), card }]
            : [];
    });
    return { run, plan, cards };
}

/** A batch reached the project when its card executed or its run holds a receipt for its batch. */
function isApplied(run: AgentRun, entry: VibeRunCards['cards'][number]): boolean {
    return (
        entry.card.status === 'executed' ||
        (entry.batchId !== null && run.receipts.some((receipt) => receipt.workId === entry.batchId))
    );
}

/** Every applied batch of a vibe run after its brief, in batch order, each with its revert group. */
export function readAppliedVibeRunBatches(run: AgentRun): AppliedVibeRunBatch[] | null {
    const read = readVibeRunCards(run);
    if (read === null) {
        return null;
    }
    return read.cards
        .filter((entry) => isApplied(run, entry))
        .toSorted((left, right) => left.position - right.position)
        .flatMap((entry) => {
            const batch = read.plan.batches[entry.position - FIRST_BATCH_POSITION];
            if (batch === undefined) {
                return [];
            }
            const receipt = run.receipts.find((candidate) => candidate.workId === entry.batchId);
            return [
                {
                    position: entry.position,
                    confirmation: entry.card,
                    batch,
                    revertGroupId: receipt?.revertGroupId ?? null,
                },
            ];
        });
}

function readOutcome(
    read: VibeRunCards,
    position: number,
    refused: { position: number; reason: string } | undefined
): VibeBatchOutcome {
    const cards = read.cards.filter((entry) => entry.position === position);
    const applied = cards.find((entry) => isApplied(read.run, entry));
    if (applied !== undefined) {
        const commandBatch = applied.card.approvalSnapshot.commandBatch;
        const criteria =
            commandBatch === undefined
                ? []
                : evaluateMetricGoalAdmission({
                      state: metricGoalStateCodec(applied.card.approvalSnapshot.metricGoalState),
                      commandBatch,
                  }).criteria;
        return { kind: 'applied', criteria };
    }
    if (refused?.position === position) {
        return { kind: 'refused', reason: refused.reason };
    }
    const settled = cards.find((entry) => entry.card.status === 'cancelled');
    if (settled === undefined) {
        return { kind: 'not-proposed' };
    }
    const skipped = read.run.batches.some((batch) => batch.batchId === settled.batchId && batch.status === 'skipped');
    return skipped ? { kind: 'skipped' } : { kind: 'stopped' };
}

/**
 * What became of every planned batch of a vibe run, read from its cards, its batches and the plan
 * it stored: a batch the run refused before proposing it is named by `refused`, since it has no card.
 */
export function readVibeRunBatchSummaries(
    run: AgentRun,
    refused?: { position: number; reason: string }
): VibeRunBatchSummary[] | null {
    const read = readVibeRunCards(run);
    if (read === null) {
        return null;
    }
    return read.plan.batches.map((batch, index) => {
        const position = index + FIRST_BATCH_POSITION;
        return { position, batch, outcome: readOutcome(read, position, refused) };
    });
}

/** The positions of the vibe-run batches the user skipped, which never reached the project. */
export function readSkippedVibeBatchPositions(run: AgentRun | null): number[] {
    const read = run === null ? null : readVibeRunCards(run);
    if (read === null) {
        return [];
    }
    return read.cards.flatMap((entry) =>
        read.run.batches.some((batch) => batch.batchId === entry.batchId && batch.status === 'skipped')
            ? [entry.position]
            : []
    );
}
