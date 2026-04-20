import { getMarkerState, getTrackStoreState } from '#/modules/Arrangement/useCases';
import { getTransportStoreValue, seekPlayhead } from '#/modules/Transport/useCases';
import { getWorkspaceState } from '#/modules/Workspace/useCases';

export const selectionHelpersDependencies = {
    getTrackStoreState,
    getMarkerState,
    getTransportStoreValue,
    seekPlayhead,
    getWorkspaceState,
} as const;
