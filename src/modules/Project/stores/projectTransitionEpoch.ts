/** Runtime transition authority; only runProjectLoadTransaction writes these slots. */
export const projectTransitionState = {
    active: 0,
    latestPrepared: 0,
};

/** Read contract: preparing a successor revokes the active epoch even if preparation fails. */
export const projectTransitionEpoch = {
    get current(): number {
        return projectTransitionState.active;
    },
    isCurrent(epoch: number): boolean {
        return epoch > 0 && epoch === projectTransitionState.active && epoch === projectTransitionState.latestPrepared;
    },
};
