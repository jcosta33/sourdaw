export type ProjectIdentityTransitionDependencies = {
    leaveCollaborationSession: () => Promise<void>;
    /** Consume durable owner handoffs only after this load proved the persisted root identity. */
    resumeDurableAssetOwnerHandoffsAfterProjectLoad?: (authority: {
        ownerId: string;
        isCurrent: () => boolean;
        signal: AbortSignal;
    }) => Promise<void>;
};

const unconfiguredLeave = async (): Promise<void> => {
    throw new Error('Project identity transition dependencies are not configured');
};

type ConfiguredBarrier = {
    promise: Promise<void>;
    resolve: () => void;
    reject: (reason: unknown) => void;
};

function createConfiguredBarrier(): ConfiguredBarrier {
    let resolveBarrier = (): void => {};
    let rejectBarrier = (_reason: unknown): void => {};
    const promise = new Promise<void>((resolve, reject) => {
        resolveBarrier = resolve;
        rejectBarrier = reject;
    });
    void promise.catch(() => undefined);
    return { promise, resolve: resolveBarrier, reject: rejectBarrier };
}

let configuredBarrier = createConfiguredBarrier();
let isConfigured = false;
let isFailed = false;

export const projectIdentityTransitionDependencies: ProjectIdentityTransitionDependencies = {
    leaveCollaborationSession: unconfiguredLeave,
};

export const projectIdentityTransitionConfiguration = {
    when(): Promise<void> {
        return configuredBarrier.promise;
    },
    apply(dependencies: ProjectIdentityTransitionDependencies): void {
        projectIdentityTransitionDependencies.leaveCollaborationSession = dependencies.leaveCollaborationSession;
        projectIdentityTransitionDependencies.resumeDurableAssetOwnerHandoffsAfterProjectLoad =
            dependencies.resumeDurableAssetOwnerHandoffsAfterProjectLoad;
        if (isConfigured || isFailed) {
            return;
        }
        isConfigured = true;
        configuredBarrier.resolve();
    },
    fail(reason: unknown): void {
        if (isConfigured || isFailed) {
            return;
        }
        isFailed = true;
        configuredBarrier.reject(reason);
    },
    reset(): void {
        projectIdentityTransitionDependencies.leaveCollaborationSession = unconfiguredLeave;
        delete projectIdentityTransitionDependencies.resumeDurableAssetOwnerHandoffsAfterProjectLoad;
        isConfigured = false;
        isFailed = false;
        configuredBarrier = createConfiguredBarrier();
    },
};
