import { modulationStore, modulationRuntimeStore } from '../../stores/modulationStore';

/**
 * Get the total modulation amount for a specific parameter at the current moment.
 * Aggregates all mapped modulators (LFO, Env, etc.) multiplied by their mapping amounts.
 */
export function getModulationForParam(trackId: string, deviceId: string, paramId: string): number {
    const state = modulationStore.value;
    if (!state) {
        return 0;
    }

    const rtState = modulationRuntimeStore.value;
    let total = 0;
    for (const mod of state.modulators) {
        if (!mod.enabled) {continue;}

        const val = rtState?.runtimeValues[mod.id] ?? 0;
        for (const mapping of mod.mappings) {
            if (
                mapping.targetTrackId === trackId &&
                mapping.targetDeviceId === deviceId &&
                mapping.targetParamId === paramId
            ) {
                total += val * mapping.amount;
            }
        }
    }
    
    // Clamp to -1..1 range for halo rendering
    return Math.max(-1, Math.min(1, total));
}
