/**
 * The last engine-diagnostics read failure reported, so a command failing on
 * every poll logs once per distinct cause instead of once a second for the life
 * of the session.
 *
 * It lives here rather than beside its caller so it can also be cleared from
 * outside a poll: a use-case file exports exactly one function
 * (`sourdaw/no-multiple-function-exports`), which leaves module state there with
 * nothing to reset it — and a latch a spec cannot clear carries a reported cause
 * into the next spec, silencing an identical failure there.
 */
let lastReportedReadFailure: string | null = null;

/**
 * Record a read failure and answer whether this cause still needs reporting.
 *
 * True exactly once per distinct cause, until the latch is cleared.
 */
export function shouldReportEngineDiagnosticsReadFailure(message: string): boolean {
    if (message === lastReportedReadFailure) {
        return false;
    }

    lastReportedReadFailure = message;
    return true;
}

/**
 * Forget the reported cause, so the same fault returning after a recovery is
 * reported again. Called on every successful read.
 */
export function clearEngineDiagnosticsReadFailure(): void {
    lastReportedReadFailure = null;
}
