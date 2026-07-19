import { type CommitLegacyCommandUndo } from '#/utils/handlerContract';

export type CommitLegacyUndo = CommitLegacyCommandUndo;
export type LegacyCommandMutation<Output> = (commitUndo: CommitLegacyUndo) => Promise<Output> | Output;
