let currentProjectTransitionId = 0;

export type ProjectLoadTransaction = {
    isCurrent: () => boolean;
};

type RunProjectLoadTransactionOutput = ProjectLoadTransaction;

export function runProjectLoadTransaction(): RunProjectLoadTransactionOutput {
    const transitionId = ++currentProjectTransitionId;
    return {
        isCurrent: () => transitionId === currentProjectTransitionId,
    };
}
