export type BranchDocumentTransitionOutcome = 'aborted' | 'committed';

type ActiveBranchDocumentTransition = {
    completion: Promise<BranchDocumentTransitionOutcome>;
    docIds: ReadonlySet<string>;
    ownerId: string;
    resolve: (outcome: BranchDocumentTransitionOutcome) => void;
};

let activeTransition: ActiveBranchDocumentTransition | null = null;

export const branchDocumentTransitionFence = {
    begin({ docIds, ownerId }: { docIds: readonly string[]; ownerId: string }): void {
        if (activeTransition) {
            throw new Error('A branch document transition is already awaiting commit');
        }
        let resolveTransition: ((outcome: BranchDocumentTransitionOutcome) => void) | undefined;
        const completion = new Promise<BranchDocumentTransitionOutcome>((resolve) => {
            resolveTransition = resolve;
        });
        activeTransition = {
            completion,
            docIds: new Set(docIds),
            ownerId,
            resolve: (outcome) => resolveTransition?.(outcome),
        };
    },
    isBlockedFor(ownerId: string | undefined): boolean {
        return activeTransition !== null && activeTransition.ownerId !== ownerId;
    },
    release(ownerId: string, outcome: BranchDocumentTransitionOutcome): void {
        if (activeTransition?.ownerId !== ownerId) {
            return;
        }
        const { resolve } = activeTransition;
        activeTransition = null;
        resolve(outcome);
    },
    wait(docId: string): Promise<BranchDocumentTransitionOutcome> | null {
        if (!activeTransition?.docIds.has(docId)) {
            return null;
        }
        return activeTransition.completion;
    },
};
