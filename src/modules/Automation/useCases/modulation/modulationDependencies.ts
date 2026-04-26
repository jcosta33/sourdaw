/**
 * Cross-module writers that the modulation engine needs to push computed
 * modulated values back to the audio engine each scheduler tick. Registered
 * once at app init (`src/app/bootstrap.ts`) with real implementations.
 *
 * Pulling these out of `applyModulationToEngine.ts` into a DI seam breaks the
 * `Automation/useCases → AudioEngine/useCases → ... → Automation/useCases`
 * static cycle. Same pattern as `setMidiLearnDependencies` and
 * `setAutomationRecordingDependencies`.
 */
export type ModulationDependencies = {
    updateDeviceParam: (trackId: string, deviceId: string, paramId: string, value: number) => void;
    getPluginParamRange: (
        deviceType: string,
        paramId: string
    ) => { min: number; max: number; defaultValue: number } | null;
};

let dependencies: ModulationDependencies | null = null;

export function setModulationDependencies(deps: ModulationDependencies): void {
    dependencies = deps;
}

export function getModulationDependencies(): ModulationDependencies {
    if (!dependencies) {
        throw new Error('Modulation dependencies not initialized');
    }
    return dependencies;
}
