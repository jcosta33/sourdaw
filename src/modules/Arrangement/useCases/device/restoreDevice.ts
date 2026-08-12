import { getTrackState } from '../../repositories/track/getTrackState';
import { updateTrack } from '../../repositories/track/updateTrack';
import { getTrackEligibility, shouldCreateLiveTrackStrip } from '../../stores/trackEligibility';
import { projectTrackToLiveStrip } from '../projectTrackToLiveStrip';

import type { DeviceSnapshot } from '#/utils/handlerContract';
import type { Device } from '../../models/Track';

type RestoreDeviceInput = {
    trackId: string;
    deviceSnapshot: DeviceSnapshot;
    deviceIndex: number;
};

type DeferredRestoreDeviceOutput = {
    outcome: 'written';
    afterCommit: () => void;
    afterAmbiguousCommit: () => void;
};

export function restoreDevice(input: RestoreDeviceInput): 'written' | 'conflict';
export function restoreDevice(
    input: RestoreDeviceInput,
    options: { deferRuntimeEffects: true }
): DeferredRestoreDeviceOutput | 'conflict';
export function restoreDevice(
    { trackId, deviceSnapshot, deviceIndex }: RestoreDeviceInput,
    options?: { deferRuntimeEffects?: boolean }
): DeferredRestoreDeviceOutput | 'written' | 'conflict' {
    const state = getTrackState();
    if (!state || !Number.isInteger(deviceIndex)) {
        return 'conflict';
    }
    const matchingTracks = state.tracks.filter((track) => track.id === trackId);
    const track = matchingTracks.length === 1 ? matchingTracks[0] : undefined;
    if (!track || !getTrackEligibility(track.kind).acceptsDeviceAdd) {
        return 'conflict';
    }
    if (deviceIndex < 0 || deviceIndex > track.devices.length) {
        return 'conflict';
    }
    if (state.tracks.some((candidate) => candidate.devices.some((device) => device.id === deviceSnapshot.id))) {
        return 'conflict';
    }

    const device: Device = {
        id: deviceSnapshot.id,
        name: deviceSnapshot.name,
        type: deviceSnapshot.type,
        bypassed: deviceSnapshot.bypassed,
        parameterValues: { ...deviceSnapshot.parameterValues },
        ...(deviceSnapshot.externalPluginId !== undefined ? { externalPluginId: deviceSnapshot.externalPluginId } : {}),
        ...(deviceSnapshot.externalInstanceId !== undefined
            ? { externalInstanceId: deviceSnapshot.externalInstanceId }
            : {}),
        ...(deviceSnapshot.externalStateChunk !== undefined
            ? { externalStateChunk: deviceSnapshot.externalStateChunk }
            : {}),
        // Undoing a device removal has to bring its state back with it, or the
        // restored device reads as one that never wrote state and silently resets to
        // its module default — losing the kit the removal was supposed to be undoing.
        ...(deviceSnapshot.deviceState !== undefined ? { deviceState: deviceSnapshot.deviceState } : {}),
    };
    const wasLive = shouldCreateLiveTrackStrip(track);
    const activatesFolderStrip = !wasLive && track.kind === 'folder' && device.type === 'toaster';
    updateTrack(trackId, (current) => {
        const devices = [...current.devices];
        devices.splice(deviceIndex, 0, device);
        return { ...current, devices };
    });

    function reconcileRuntime(): void {
        const committedState = getTrackState();
        const committedTrack = committedState?.tracks.find((candidate) => candidate.id === trackId);
        if (
            !committedState ||
            !committedTrack ||
            !committedTrack.devices.some((candidate) => candidate.id === device.id)
        ) {
            return;
        }
        const isLive = shouldCreateLiveTrackStrip(committedTrack);
        const activatesCommittedFolderStrip =
            !isLive &&
            committedTrack.kind === 'folder' &&
            committedTrack.devices.some((candidate) => candidate.type === 'toaster');
        if (isLive || activatesCommittedFolderStrip) {
            projectTrackToLiveStrip({ trackId, activateDormantExternalPlugins: true });
        }
        if (activatesCommittedFolderStrip) {
            for (const child of committedState.tracks) {
                if (child.parentId === trackId && shouldCreateLiveTrackStrip(child)) {
                    projectTrackToLiveStrip({ trackId: child.id, activateDormantExternalPlugins: true });
                }
            }
        }
    }
    if (options?.deferRuntimeEffects) {
        return {
            outcome: 'written',
            afterCommit: reconcileRuntime,
            afterAmbiguousCommit: reconcileRuntime,
        };
    }
    if (wasLive || activatesFolderStrip) {
        projectTrackToLiveStrip({ trackId, activateDormantExternalPlugins: true });
    }
    if (activatesFolderStrip) {
        for (const child of state.tracks) {
            if (child.parentId === trackId && shouldCreateLiveTrackStrip(child)) {
                projectTrackToLiveStrip({ trackId: child.id, activateDormantExternalPlugins: true });
            }
        }
    }
    return 'written';
}
