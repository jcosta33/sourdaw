export type ProjectCloseState = {
    readonly title: string;
    readonly dirty: boolean;
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
    readonly send: (operation: CloseOperation, requestId: number) => void;
};

/** Main-process state only: a disposable projection of renderer project state. */
export const createWindowCloseCoordinator = ({ ask, send }: CreateWindowCloseCoordinatorInput) => {
    let project: ProjectCloseState = { title: 'Sourdaw', dirty: false };
    let phase: 'idle' | 'deciding' | 'saving' | 'approved' | 'closing' = 'idle';
    let pendingSave: { readonly requestId: number; readonly settle: (result: SaveResult) => void } | undefined;
    let nextRequestId = 1;
    let generation = 0;

    const updateProject = (next: ProjectCloseState): void => {
        project = next;
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

    const requestClose = async (): Promise<boolean> => {
        if (phase === 'approved' || phase === 'closing') {
            return true;
        }
        if (phase !== 'idle') {
            return false;
        }
        if (!project.dirty) {
            phase = 'approved';
            return true;
        }
        const requestGeneration = generation;
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
                    send(decision, requestId);
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
        resetForWindow: (): void => {
            generation += 1;
            cancelPending();
            phase = 'idle';
            pendingSave = undefined;
        },
        cancelPending,
    };
};
