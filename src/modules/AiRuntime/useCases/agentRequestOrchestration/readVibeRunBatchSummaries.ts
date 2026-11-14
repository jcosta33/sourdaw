import { type AgentRun } from '../../models/AgentRun';
import { evaluateMetricGoalAdmission } from '../evaluateMetricGoalAdmission';
import { metricGoalStateCodec } from '../metricGoalStateCodec';
import { type VibeBatchOutcome, type VibeRunBatchSummary } from '../vibeRun/describeVibeRunSummary';

import { FIRST_BATCH_POSITION, type VibeRunCards, readVibeRunCards } from './readVibeRunCards';

function readOutcome(
    read: VibeRunCards,
    position: number,
    refused: { position: number; reason: string } | undefined
): VibeBatchOutcome {
    const cards = read.cards.filter((entry) => entry.position === position);
    const applied = cards.find((entry) => entry.applied);
    if (applied !== undefined) {
        const commandBatch = applied.card.approvalSnapshot.commandBatch;
        if (commandBatch === undefined) {
            return { kind: 'applied', criteria: [] };
        }
        const { criteria } = evaluateMetricGoalAdmission({
            state: metricGoalStateCodec(applied.card.approvalSnapshot.metricGoalState),
            commandBatch,
        });
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
