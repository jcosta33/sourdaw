import type { persistDeviceParam, persistDevicePatch } from '#/modules/Arrangement/useCases';
import type { updateDeviceParam, updateDevicePatch } from '#/modules/AudioEngine/useCases';
import type { getAllTracks } from '#/modules/Arrangement/useCases';

export type FermenterDependencies = {
    persistDeviceParam: typeof persistDeviceParam;
    persistDevicePatch?: typeof persistDevicePatch;
    updateDeviceParam: typeof updateDeviceParam;
    updateDevicePatch?: typeof updateDevicePatch;
    getAllTracks: typeof getAllTracks;
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
