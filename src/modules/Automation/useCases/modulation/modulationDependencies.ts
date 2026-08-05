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
    /**
     * The parameter's declared contract, or null when the device declares none
     * (Faust, hosted plugins, anything with discovered parameters). Carries
     * `automatable` as well as the range because modulation is one of the
     * routes that reaches a parameter without the lane picker ever being
     * involved, and the flag means nothing unless something enforces it.
     */
    getPluginParamRange: (
        deviceType: string,
        paramId: string
    ) => { min: number; max: number; defaultValue: number; automatable: boolean } | null;
    /**
     * `quantiseDeviceParameterValue`: the declared *type*, applied to the value
     * that leaves for the engine.
     *
     * Modulation is the last writer in a scheduler tick, so it decides what the
     * DSP ends up holding. `applyAutomation` runs first and delivers a rounded
     * index for a stepped parameter — and records that rounded index as the base
     * this pass reads — so a modulation write that skipped the same law simply
     * undid the rounding one line later: base 5 plus a 0.7 offset reached the
     * worklet as 5.7.
     */
    quantiseValue: (input: { deviceType: string; paramId: string; value: number }) => number;
};

export let dependencies: ModulationDependencies | null = null;

export function setModulationDependencies(deps: ModulationDependencies): void {
    dependencies = deps;
}
