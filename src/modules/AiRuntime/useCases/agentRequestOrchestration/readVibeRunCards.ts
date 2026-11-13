import { type AgentRun } from '../../models/AgentRun';
import { type ScheduledVibeRunPlan } from '../../models/VibeRunPlan';
import {
    type PendingAppActionConfirmation,
    pendingActionConfirmationStore,
} from '../../stores/pendingActionConfirmationStore';
import { readScheduledVibeRunPlan } from '../../validators/readScheduledVibeRunPlan';

import { readConfirmationBatchId } from './readConfirmationBatchId';

/** The batches after the brief, which holds position 1 of its run. */
export const FIRST_BATCH_POSITION = 2;

type VibeRunCard = {
    readonly position: number;
    readonly batchId: string | null;
    readonly card: PendingAppActionConfirmation;
    /** The batch reached the project: its card executed or its run holds a receipt for its batch. */
    readonly applied: boolean;
};

export type VibeRunCards = {
    readonly run: AgentRun;
    readonly plan: ScheduledVibeRunPlan;
    readonly cards: readonly VibeRunCard[];
};

function isApplied(run: AgentRun, card: PendingAppActionConfirmation, batchId: string | null): boolean {
    return (
        card.status === 'executed' || (batchId !== null && run.receipts.some((receipt) => receipt.workId === batchId))
    );
}

/** The plan a vibe run stored and every batch card it proposed after its brief, or `null` for another run. */
export function readVibeRunCards(run: AgentRun): VibeRunCards | null {
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
        if (card.runId !== run.runId || position < FIRST_BATCH_POSITION) {
            return [];
        }
        const batchId = readConfirmationBatchId(card);
        return [{ position, batchId, card, applied: isApplied(run, card, batchId) }];
    });
    return { run, plan, cards };
}
