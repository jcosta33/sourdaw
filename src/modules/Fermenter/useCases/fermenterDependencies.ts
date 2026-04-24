import type { Track, persistDeviceParam } from '#/modules/Arrangement/stores';
import type { persistDevicePatch } from '#/modules/Arrangement/useCases';
import type { updateDeviceParam, updateDevicePatch } from '#/modules/AudioEngine/useCases';

export type FermenterDependencies = {
    persistDeviceParam: typeof persistDeviceParam;
    persistDevicePatch?: typeof persistDevicePatch;
    updateDeviceParam: typeof updateDeviceParam;
    updateDevicePatch?: typeof updateDevicePatch;
    getAllTracks: () => Track[];
};

let dependencies: FermenterDependencies | null = null;

export function setFermenterDependencies(deps: FermenterDependencies): void {
    dependencies = deps;
}

export function getFermenterDependencies(): FermenterDependencies {
    if (!dependencies) {
        throw new Error('Fermenter dependencies not initialized');
    }
    return dependencies;
}
