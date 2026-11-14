import { type AgentRun } from '../../models/AgentRun';

import { readVibeRunCards } from './readVibeRunCards';

/** The positions of the vibe-run batches the user skipped, which never reached the project. */
export function readSkippedVibeBatchPositions(run: AgentRun | null): number[] {
    const read = run === null ? null : readVibeRunCards(run);
    if (read === null) {
        return [];
    }
    return read.cards
        .filter((entry) =>
            read.run.batches.some((batch) => batch.batchId === entry.batchId && batch.status === 'skipped')
        )
        .map((entry) => entry.position);
}
