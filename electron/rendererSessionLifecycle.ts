/** Tracks whether the current renderer is leaving through an approved close or quit path. */
export const createRendererSessionLifecycle = () => {
    let teardownApproved = false;

    return {
        startWindow(): void {
            teardownApproved = false;
        },
        approveTeardown(): void {
            teardownApproved = true;
        },
        cancelTeardown(): void {
            teardownApproved = false;
        },
        shouldRecreateAfterCrash(): boolean {
            return !teardownApproved;
        },
    };
};

/**
 * Whether a webContents navigation replaces the session's renderer: a
 * main-frame, cross-document load. A reload or a page change begins a new
 * renderer session, so every retrospective arm the outgoing renderer left in
 * flight is stale from the moment the navigation starts — before its
 * successor's startup disarm can settle (#4752). A sub-frame navigation or a
 * same-document navigation keeps the running renderer, so it begins no
 * session.
 */
export const isRendererReplacingNavigation = (input: { isInPlace: boolean; isMainFrame: boolean }): boolean =>
    input.isMainFrame && !input.isInPlace;
