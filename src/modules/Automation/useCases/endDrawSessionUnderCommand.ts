import { commitEndDrawSession, type CommitAutomationDrawUndo } from './commitEndDrawSession';

/** Complete a draw gesture while its caller already owns the Command lease. */
export function endDrawSessionUnderCommand(commitUndo: CommitAutomationDrawUndo): void {
    commitEndDrawSession(commitUndo);
}
