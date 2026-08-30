import { systemTimers, type TimerHandle, type Timers } from './timers.js';

/** Project persistence may cross CRDT and IndexedDB, but close cannot wait forever. */
export const CLOSE_OPERATION_TIMEOUT_MS = 30_000;

export type ProjectCloseState = {
    readonly title: string;
    readonly dirty: boolean;
    /** A clean replacement is not safe to discard until its identity snapshot persists. */
    readonly durabilityPending?: boolean;
    /** Stable Project snapshot key and CRDT revision make close approval specific to project truth. */
    readonly projectKey?: string;
    readonly revision?: string;
};

export type SaveResult = {
    readonly requestId: number;
    readonly saved: boolean;
    readonly dirty: boolean;
    readonly projectKey?: string;
    readonly revision?: string;
};

type CloseDecision = 'save' | 'discard' | 'cancel';
type CloseOperation = Extract<CloseDecision, 'save' | 'discard'>;

type CreateWindowCloseCoordinatorInput = {
    readonly ask: (title: string) => Promise<CloseDecision>;
    readonly send: (operation: CloseOperation, requestId: number, expected: ProjectCloseState) => void;
    /** Immediately re-open crash recovery when an approved close loses authority. */
    readonly onApprovalRevoked?: () => void;
    readonly timers?: Timers;
};

/** Main-process state only: a disposable projection of renderer project state. */
export const createWindowCloseCoordinator = ({
    ask,
    send,
    onApprovalRevoked,
    timers = systemTimers,
}: CreateWindowCloseCoordinatorInput) => {
    let project: ProjectCloseState = { title: 'Sourdaw', dirty: false, durabilityPending: false };
    let phase: 'idle' | 'deciding' | 'saving' | 'approved' | 'closing' = 'idle';
    let pendingSave:
        | {
              readonly requestId: number;
              readonly expected: ProjectCloseState;
              latestCandidate: ProjectCloseState | undefined;
              readonly timer: TimerHandle;
              readonly settle: (result: SaveResult) => void;
          }
        | undefined;
    let nextRequestId = 1;
    let generation = 0;

    const isCloseBlocking = (state: ProjectCloseState): boolean => state.dirty || state.durabilityPending === true;

    const sameProjectRevision = (left: ProjectCloseState, right: ProjectCloseState): boolean =>
        left.projectKey === right.projectKey && left.revision === right.revision;

    const updateProject = (next: ProjectCloseState): void => {
        const changedRevision = !sameProjectRevision(project, next);
        project = next;
        if (phase === 'approved' && (changedRevision || isCloseBlocking(next))) {
            generation += 1;
            phase = 'idle';
            onApprovalRevoked?.();
            return;
        }
        // A dialog decision is about a particular piece of project truth. A
        // new project or an edit while it is open needs a fresh decision.
        if (phase === 'saving' && changedRevision && pendingSave !== undefined) {
            if (next.projectKey === pendingSave.expected.projectKey) {
                pendingSave.latestCandidate = next;
                return;
            }
        }
        if ((phase === 'deciding' || phase === 'saving') && changedRevision) {
            generation += 1;
            cancelPending();
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
        pendingSave.settle({
            requestId: pendingSave.requestId,
            saved: false,
            dirty: true,
            projectKey: pendingSave.expected.projectKey,
            revision: pendingSave.expected.revision,
        });
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
                let timer: TimerHandle | undefined;
                const settle = (next: SaveResult): void => {
                    timer?.cancel();
                    resolve(next);
                };
                timer = timers.setTimer(
                    () =>
                        settle({
                            requestId,
                            saved: false,
                            dirty: true,
                            projectKey: expectedProject.projectKey,
                            revision: expectedProject.revision,
                        }),
                    CLOSE_OPERATION_TIMEOUT_MS
                );
                pendingSave = {
                    requestId,
                    expected: expectedProject,
                    latestCandidate: undefined,
                    timer,
                    settle,
                };
                try {
                    send(decision, requestId, expectedProject);
                } catch (error) {
                    timer.cancel();
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
        const activeSave = pendingSave;
        pendingSave = undefined;
        // A dirty post-save projection means a newer edit raced the save. The
        // original dirty bit is stale until React publishes the result, so the
        // correlated result is authoritative for that exact save request.
        if (
            !result.saved ||
            result.dirty ||
            result.requestId !== requestId ||
            (result.projectKey !== undefined && result.projectKey !== expectedProject.projectKey) ||
            (result.revision !== undefined &&
                result.revision !== expectedProject.revision &&
                result.revision !== activeSave?.latestCandidate?.revision)
        ) {
            phase = 'idle';
            return false;
        }
        project = {
            ...project,
            projectKey: result.projectKey ?? project.projectKey,
            revision: result.revision ?? project.revision,
            dirty: false,
            durabilityPending: false,
        };
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
