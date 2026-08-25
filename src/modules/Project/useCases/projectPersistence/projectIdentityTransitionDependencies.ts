type ProjectIdentityTransitionDependencies = {
    leaveCollaborationSession: () => Promise<void>;
    /** Consume durable owner handoffs only after this load proved the persisted root identity. */
    resumeDurableAssetOwnerHandoffsAfterProjectLoad?: () => Promise<void>;
};

export let projectIdentityTransitionDependencies: ProjectIdentityTransitionDependencies = {
    leaveCollaborationSession: async () => {
        throw new Error('Project identity transition dependencies are not configured');
    },
};

export function setProjectIdentityTransitionDependencies(dependencies: ProjectIdentityTransitionDependencies): void {
    projectIdentityTransitionDependencies = dependencies;
}
