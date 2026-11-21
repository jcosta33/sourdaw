type VcaRuntimeProjectionDependencies = {
    reconcileVcaRuntimeGain: (input: { groupIds: readonly string[]; trackIds: readonly string[] }) => void;
};

let registeredDependencies: VcaRuntimeProjectionDependencies | null = null;

/**
 * Arrangement may not import the audio runtime, so the composition root
 * (`#/app/bootstrap`) fills this once at boot, before any command can run.
 */
export function setVcaRuntimeProjectionDependencies(dependencies: VcaRuntimeProjectionDependencies): void {
    registeredDependencies = dependencies;
}

export const vcaRuntimeProjectionDependencies = {
    /**
     * Reading before registration throws rather than skipping: an unfilled
     * reader would let a VCA gain edit commit without ever reaching the audio runtime.
     */
    read(caller: string): VcaRuntimeProjectionDependencies {
        if (registeredDependencies === null) {
            throw new Error(
                `${caller}: the VCA runtime projection is not registered; call setVcaRuntimeProjectionDependencies() from #/app/bootstrap (bootstrap does this)`
            );
        }
        return registeredDependencies;
    },
};
