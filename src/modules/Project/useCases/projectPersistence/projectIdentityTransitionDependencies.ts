type ProjectIdentityTransitionDependencies = {
    leaveCollaborationSession: () => Promise<void>;
};

export let projectIdentityTransitionDependencies: ProjectIdentityTransitionDependencies = {
    leaveCollaborationSession: async () => {
        throw new Error('Project identity transition dependencies are not configured');
    },
};

export function setProjectIdentityTransitionDependencies(dependencies: ProjectIdentityTransitionDependencies): void {
    projectIdentityTransitionDependencies = dependencies;
}
