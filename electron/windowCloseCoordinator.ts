export type ProjectCloseState = {
    readonly title: string;
    readonly dirty: boolean;
    /** A clean replacement is not safe to discard until its identity snapshot persists. */
    readonly durabilityPending?: boolean;
    /** Renderer-owned identity and CRDT revision make close approval specific to project truth. */
    readonly projectId?: string;
    readonly revision?: string;
};

export type SaveResult = {
    readonly requestId: number;
    readonly saved: boolean;
    readonly dirty: boolean;
};

type CloseDecision = 'save' | 'discard' | 'cancel';
type CloseOperation = Extract<CloseDecision, 'save' | 'discard'>;

type CreateWindowCloseCoordinatorInput = {
    readonly ask: (title: string) => Promise<CloseDecision>;
    readonly send: (operation: CloseOperation, requestId: number, expected: ProjectCloseState) => void;
};

/** Main-process state only: a disposable projection of renderer project state. */
export const createWindowCloseCoordinator = ({ ask, send }: CreateWindowCloseCoordinatorInput) => {
    let project: ProjectCloseState = { title: 'Sourdaw', dirty: false, durabilityPending: false };
    let phase: 'idle' | 'deciding' | 'saving' | 'approved' | 'closing' = 'idle';
    let pendingSave: { readonly requestId: number; readonly settle: (result: SaveResult) => void } | undefined;
    let nextRequestId = 1;
    let generation = 0;

    const isCloseBlocking = (state: ProjectCloseState): boolean => state.dirty || state.durabilityPending === true;

    const sameProjectRevision = (left: ProjectCloseState, right: ProjectCloseState): boolean =>
        left.projectId === right.projectId && left.revision === right.revision;

    const updateProject = (next: ProjectCloseState): void => {
        const changedRevision = !sameProjectRevision(project, next);
        project = next;
        if (phase === 'approved' && isCloseBlocking(next)) {
            generation += 1;
            phase = 'idle';
            return;
        }
        // A dialog decision is about a particular piece of project truth. A
        // new project or an edit while it is open needs a fresh decision.
        if (phase === 'deciding' && changedRevision) {
            generation += 1;
            phase = 'idle';
        }
    };

    const resolveSave = (result: SaveResult): void => {
        if (pendingSave?.requestId === result.requestId) {
            pendingSave.settle(result);
        }
    };

    const cancelPending = (): void => {
        if (pendingSave === undefined) {
            return;
        }
        pendingSave.settle({ requestId: pendingSave.requestId, saved: false, dirty: true });
    };

    const invalidateWindowRequests = (): void => {
        generation += 1;
        cancelPending();
        phase = 'idle';
        pendingSave = undefined;
    };

    const clearWindowAuthority = (): void => {
        invalidateWindowRequests();
        project = { title: 'Sourdaw', dirty: false, durabilityPending: false };
    };

    const requestClose = async (): Promise<boolean> => {
        if (phase === 'approved' || phase === 'closing') {
            return true;
        }
        if (phase !== 'idle') {
            return false;
        }
        if (!isCloseBlocking(project)) {
            phase = 'approved';
            return true;
        }
        const requestGeneration = generation;
        const expectedProject = project;
        phase = 'deciding';
        let decision: CloseDecision;
        try {
            decision = await ask(project.title);
        } catch {
            if (requestGeneration !== generation) {
                return false;
            }
            phase = 'idle';
            return false;
        }
        if (requestGeneration !== generation) {
            return false;
        }
        if (decision === 'cancel') {
            phase = 'idle';
            return false;
        }
        const requestId = nextRequestId;
        nextRequestId += 1;
        phase = 'saving';
        let result: SaveResult;
        try {
            result = await new Promise<SaveResult>((resolve, reject) => {
                pendingSave = { requestId, settle: resolve };
                try {
                    send(decision, requestId, expectedProject);
                } catch (error) {
                    pendingSave = undefined;
                    reject(error);
                }
            });
        } catch {
            if (requestGeneration !== generation) {
                return false;
            }
            phase = 'idle';
            pendingSave = undefined;
            return false;
        }
        if (requestGeneration !== generation) {
            return false;
        }
        pendingSave = undefined;
        // A dirty post-save projection means a newer edit raced the save. The
        // original dirty bit is stale until React publishes the result, so the
        // correlated result is authoritative for that exact save request.
        if (!result.saved || result.dirty || result.requestId !== requestId) {
            phase = 'idle';
            return false;
        }
        project = { ...project, dirty: false, durabilityPending: false };
        phase = 'approved';
        return true;
    };

    return {
        updateProject,
        resolveSave,
        requestClose,
        permitsClose: (): boolean => phase === 'approved' || phase === 'closing',
        markClosing: (): void => {
            phase = 'closing';
        },
        // A replacement renderer must not erase the dirty authority it failed
        // to persist before crashing. A successful clean close already clears
        // it above, so a later normal window starts clean without special-case
        // state.
        resetForWindow: invalidateWindowRequests,
        clearForNoWindow: clearWindowAuthority,
        cancelPending,
    };
};
