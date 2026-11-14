import { type AgentRun } from '../../models/AgentRun';
import { type ScheduledVibeRunBatch } from '../../models/VibeRunPlan';
import { type PendingAppActionConfirmation } from '../../stores/pendingActionConfirmationStore';

import { FIRST_BATCH_POSITION, readVibeRunCards } from './readVibeRunCards';

/** One batch of a vibe run that reached the project, with the undo group its commit wrote. */
export type AppliedVibeRunBatch = {
    readonly position: number;
    readonly confirmation: PendingAppActionConfirmation;
    readonly batch: ScheduledVibeRunBatch;
    /** The revert group of the batch's receipt, or `null` when its commit recorded none. */
    readonly revertGroupId: string | null;
};

/** Every applied batch of a vibe run after its brief, in batch order, each with its revert group. */
export function readAppliedVibeRunBatches(run: AgentRun): AppliedVibeRunBatch[] | null {
    const read = readVibeRunCards(run);
    if (read === null) {
        return null;
    }
    return read.cards
        .filter((entry) => entry.applied)
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
