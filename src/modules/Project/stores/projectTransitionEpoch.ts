/** Runtime transition authority; only runProjectLoadTransaction writes these slots. */
export const projectTransitionState = {
    active: 0,
    latestPrepared: 0,
    editRevocation: 0,
    pendingEditReplacement: null as number | null,
};

/** Load tickets never regain authority after a later preparation, even when it fails. */
export const projectTransitionEpoch = {
    get current(): number {
        return projectTransitionState.active;
    },
    isCurrent(epoch: number): boolean {
        return epoch > 0 && epoch === projectTransitionState.active && epoch === projectTransitionState.latestPrepared;
    },
    captureEditAuthority() {
        const active = projectTransitionState.active;
        const revocation = projectTransitionState.editRevocation;
        const admitted = active > 0 && projectTransitionState.pendingEditReplacement === null;
        return {
            isCurrent: (): boolean =>
                admitted &&
                active === projectTransitionState.active &&
                revocation === projectTransitionState.editRevocation &&
                projectTransitionState.pendingEditReplacement === null,
        };
    },
};
