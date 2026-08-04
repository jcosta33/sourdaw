type VcaRuntimeProjectionDependencies = {
    reconcileVcaRuntimeGain: (input: { groupIds: readonly string[]; trackIds: readonly string[] }) => void;
};

export let vcaRuntimeProjectionDependencies: VcaRuntimeProjectionDependencies | null = null;

export function setVcaRuntimeProjectionDependencies(dependencies: VcaRuntimeProjectionDependencies | null): void {
    vcaRuntimeProjectionDependencies = dependencies;
}
