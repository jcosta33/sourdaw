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
    constructor(action_type: string) {
        super(`Action conflicts with current project state: ${action_type}`);
        this.name = 'AppActionConflictError';
    }
}
