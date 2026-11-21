export class AppActionNotDispatchedError extends Error {
    constructor(action_type: string) {
        super(`No handler registered for action: ${action_type}`);
        this.name = 'AppActionNotDispatchedError';
    }
}

export class AppActionCommittedError extends Error {
    constructor(action_type: string, cause: unknown) {
        super(`Action committed but post-commit processing failed: ${action_type}`, { cause });
        this.name = 'AppActionCommittedError';
    }
}

export class AppActionConflictError extends Error {
    /** The handler's own refusal reason, so a caller can tell one conflict from another without reading the message. */
    readonly reason: string | undefined;

    constructor(action_type: string, reason?: string) {
        super(
            reason === undefined
                ? `Action conflicts with current project state: ${action_type}`
                : `Action conflicts with current project state: ${action_type}: ${reason}`
        );
        this.name = 'AppActionConflictError';
        this.reason = reason;
    }
}

/**
 * A handler refused because of a transient runtime state (a recording in progress), not because the
 * document diverged from what the action expects. It is a conflict to every caller that only checks
 * for conflicts, so batches and agent commands refuse as before. Undo and redo alone tell it apart:
 * the history entry stays where it was and nothing beneath it is stepped over.
 */
export class AppActionBlockedError extends AppActionConflictError {}

/**
 * The admission gate refused the action (repair required or production brief locked),
 * either at the preflight before any handler ran or at the commit, when the gate
 * started refusing while the handler ran. Handlers report their own conflicts as plain
 * `AppActionConflictError`s, so only this subclass means "the project can't be changed".
 * It keeps the parent's `name` so name-based checks still treat it as a conflict.
 */
export class AppActionAdmissionRefusedError extends AppActionConflictError {}
