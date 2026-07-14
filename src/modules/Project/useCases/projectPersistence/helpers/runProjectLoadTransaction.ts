let nextProjectTransitionId = 0;
let activeProjectTransitionId = 0;

export type ProjectLoadTransaction = {
    activate: () => boolean;
    canActivate: () => boolean;
    isCurrent: () => boolean;
};

export const projectLoadEpoch = {
    get current(): number {
        return activeProjectTransitionId;
    },
};

type RunProjectLoadTransactionOutput = ProjectLoadTransaction;

export function runProjectLoadTransaction(): RunProjectLoadTransactionOutput {
    const transitionId = ++nextProjectTransitionId;
    let activated = false;

    return {
        activate: () => {
            if (activated) {
                return transitionId === activeProjectTransitionId;
            }
            if (transitionId < activeProjectTransitionId) {
                return false;
            }
            activeProjectTransitionId = transitionId;
            activated = true;
            return true;
        },
        canActivate: () => transitionId >= activeProjectTransitionId,
        isCurrent: () => activated && transitionId === activeProjectTransitionId,
    };
}
