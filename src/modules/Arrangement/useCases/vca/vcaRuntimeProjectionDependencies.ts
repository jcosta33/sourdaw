type VcaRuntimeProjectionDependencies = {
    reconcileVcaGroupRuntimeGain: (vcaGroupId: string) => void;
};

export let vcaRuntimeProjectionDependencies: VcaRuntimeProjectionDependencies | null = null;

export function setVcaRuntimeProjectionDependencies(dependencies: VcaRuntimeProjectionDependencies | null): void {
    vcaRuntimeProjectionDependencies = dependencies;
}
