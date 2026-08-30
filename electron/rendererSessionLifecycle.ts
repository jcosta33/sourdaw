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
        shouldRecreateAfterCrash(): boolean {
            return !teardownApproved;
        },
    };
};
