/** One command of the committed batch, as the undo history holds it applied. */
export type CommittedCommand = { type: string; payload: Record<string, unknown>; label: string };

/** A receipted batch and the commands in its applied undo group. */
export type CommittedBatch = { runId: string; workId: string; revertGroupId: string; commands: CommittedCommand[] };
