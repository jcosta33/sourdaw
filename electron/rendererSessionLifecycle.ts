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
 * flight is stale from the moment the navigation commits — before its
 * successor's module evaluation and startup disarm can settle (#4752). A
 * sub-frame navigation or a same-document navigation keeps the running
 * renderer, so it begins no session.
 *
 * The caller is Electron's `did-navigate`, whose firing conditions are the
 * classification, so no payload field re-derives it: the event reports only a
 * committed main-frame navigation, and a navigation any earlier event vetoed
 * never commits — `did-start-navigation` fires first and cannot be cancelled,
 * so bumping there armed a navigation the shell then vetoed, and the punch
 * stayed on over a renderer that was never replaced. Sub-frame completions
 * report through `did-frame-navigate` and same-document completions through
 * `did-navigate-in-page`, so those classes have no payload here. The payload
 * still fixes one boundary: commit decides, not load success — the event
 * carries no success guarantee, and an error page replaces the renderer all
 * the same.
 */
export const isRendererReplacingNavigation = (_navigation: {
    url: string;
    httpResponseCode: number;
    httpStatusText: string;
}): boolean => true;
