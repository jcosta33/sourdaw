type ActiveBranchDocumentTransition = {
    completion: Promise<void>;
    docIds: ReadonlySet<string>;
    ownerId: string;
    resolve: () => void;
};

let activeTransition: ActiveBranchDocumentTransition | null = null;

export const branchDocumentTransitionFence = {
    begin({ docIds, ownerId }: { docIds: readonly string[]; ownerId: string }): void {
        if (activeTransition) {
            throw new Error('A branch document transition is already awaiting commit');
        }
        let resolveTransition: (() => void) | undefined;
        const completion = new Promise<void>((resolve) => {
            resolveTransition = resolve;
        });
        activeTransition = {
            completion,
            docIds: new Set(docIds),
            ownerId,
            resolve: () => resolveTransition?.(),
        };
    },
    isBlockedFor(ownerId: string | undefined): boolean {
        return activeTransition !== null && activeTransition.ownerId !== ownerId;
    },
    release(ownerId: string): void {
        if (activeTransition?.ownerId !== ownerId) {
            return;
        }
        const { resolve } = activeTransition;
        activeTransition = null;
        resolve();
    },
    wait(docId: string): Promise<void> | null {
        if (!activeTransition?.docIds.has(docId)) {
            return null;
        }
        return activeTransition.completion;
    },
};
