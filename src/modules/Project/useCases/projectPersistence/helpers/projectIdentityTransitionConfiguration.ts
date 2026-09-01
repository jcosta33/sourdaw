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
};

function createConfiguredBarrier(): ConfiguredBarrier {
    let resolveBarrier = (): void => {};
    const promise = new Promise<void>((resolve) => {
        resolveBarrier = resolve;
    });
    return { promise, resolve: resolveBarrier };
}

let configuredBarrier = createConfiguredBarrier();
let isConfigured = false;

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
        if (isConfigured) {
            return;
        }
        isConfigured = true;
        configuredBarrier.resolve();
    },
    reset(): void {
        projectIdentityTransitionDependencies.leaveCollaborationSession = unconfiguredLeave;
        delete projectIdentityTransitionDependencies.resumeDurableAssetOwnerHandoffsAfterProjectLoad;
        isConfigured = false;
        configuredBarrier = createConfiguredBarrier();
    },
};
