type ProjectProjectionDependencies = {
    reconcileProjectedProjectState: () => void;
};

export let projectProjectionDependencies: ProjectProjectionDependencies = {
    reconcileProjectedProjectState: () => {
        throw new Error('Project projection dependencies are not configured');
    },
};

export function setProjectProjectionDependencies(dependencies: ProjectProjectionDependencies): void {
    projectProjectionDependencies = dependencies;
}
