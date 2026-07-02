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

export const fermenterDependenciesHolder: { current: FermenterDependencies | null } = {
    current: null,
};

export function setFermenterDependencies(deps: FermenterDependencies): void {
    fermenterDependenciesHolder.current = deps;
}
