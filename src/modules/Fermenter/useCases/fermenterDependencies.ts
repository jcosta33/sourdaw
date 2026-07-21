import type { GetAllTracksFn } from '#/utils/createFindDeviceRef';

// Dependency-injection contract for the Fermenter param bridge. The concrete
// functions are supplied by the app composition root (see app/bootstrap.ts);
// their signatures are declared structurally here so this module does not depend
// on the Arrangement / AudioEngine barrels (which would close a value-graph
// cycle back through Arrangement/useCases).
export type FermenterDependencies = {
    persistDeviceParam: (deviceId: string, paramId: string, value: number) => void;
    persistDevicePatch?: (deviceId: string, patch: Record<string, unknown>) => void;
    updateDeviceParam: (trackId: string, deviceId: string, paramId: string, value: number) => void;
    updateDevicePatch?: (trackId: string, deviceId: string, patch: Record<string, unknown>) => void;
    getAllTracks: GetAllTracksFn;
    resolveEligibleDeviceWriteTarget: (
        deviceId: string
    ) => { status: 'eligible'; trackId: string; deviceId: string } | { status: 'missing' | 'ineligible' };
};

export const fermenterDependenciesHolder: { current: FermenterDependencies | null } = {
    current: null,
};

export function setFermenterDependencies(deps: FermenterDependencies): void {
    fermenterDependenciesHolder.current = deps;
}
