import type { GetAllTracksFn } from '#/utils/createFindDeviceRef';

// Dependency-injection contract for the Fermenter param bridge. The concrete
// functions are supplied by the app composition root (see app/bootstrap.ts);
// their signatures are declared structurally here so this module does not depend
// on the Arrangement / AudioEngine barrels (which would close a value-graph
// cycle back through Arrangement/useCases).
export type FermenterDependencies = {
    /**
     * The declared range, resolved on the key the descriptor actually declares.
     *
     * Injected rather than imported for the same reason the two write functions
     * are: the law lives behind `Arrangement/useCases`, and importing that
     * barrel here would close the value-graph cycle this port exists to break.
     *
     * It has to be applied on this side of the DSP-key mapping.
     * `updateDeviceParam` clamps by looking the parameter up on the descriptor,
     * but `FERMENTER_DESCRIPTOR` declares camelCase ids and the engine is
     * handed the snake_case DSP key — which matches no descriptor entry, so
     * every one of Fermenter's parameters slipped the range on the engine side
     * while the store side was held to it.
     */
    clampDeviceParameterValue: (input: { deviceType: string; paramId: string; value: number }) => number;
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
