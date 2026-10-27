import { reportLatency, updateDeviceBypass, updateDeviceParam } from '#/modules/AudioEngine/useCases';
import { activateExternalPlugin } from '#/modules/PluginHost/useCases';
import { orderDeviceParametersForReplay } from '#/utils/devicePatchPrecedence';

import { getTrackState } from '../../repositories/track/getTrackState';
import { updateTrack } from '../../repositories/track/updateTrack';
import { getTrackEligibility, shouldCreateLiveTrackStrip } from '../../stores/trackEligibility';
import { projectTrackToLiveStrip } from '../projectTrackToLiveStrip';

import { applyDeviceChainRuntimeDelta } from './applyDeviceChainRuntimeDelta';
import { getRuntimeDeviceDeltaPostCommitFailure } from './runtimeDeviceDeltaPostCommit';

import type { DeviceSnapshot, HandlerValidationContext } from '#/utils/handlerContract';
import type { Device } from '../../models/Track';

type RestoreDeviceInput = {
    trackId: string;
    deviceSnapshot: DeviceSnapshot;
    deviceIndex: number;
};

type RestoreDeviceOptions = {
    deferRuntimeEffects?: boolean;
    batchContext?: Pick<HandlerValidationContext, 'actions' | 'actionIndex'>;
};

type DeferredRestoreDeviceOutput = {
    outcome: 'written';
    afterCommit: () => void;
    afterAmbiguousCommit: () => void;
};

export function restoreDevice(input: RestoreDeviceInput): 'written' | 'conflict';
export function restoreDevice(
    input: RestoreDeviceInput,
    options: RestoreDeviceOptions & { deferRuntimeEffects: true }
): DeferredRestoreDeviceOutput | 'conflict';
export function restoreDevice(
    { trackId, deviceSnapshot, deviceIndex }: RestoreDeviceInput,
    options?: RestoreDeviceOptions
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
    const beforeTrack = structuredClone(track);
    const restoredDevices = [...beforeTrack.devices];
    restoredDevices.splice(deviceIndex, 0, device);
    const afterTrack = { ...beforeTrack, devices: restoredDevices };
    const wasLive = shouldCreateLiveTrackStrip(track);
    const activatesFolderStrip = !wasLive && track.kind === 'folder' && device.type === 'toaster';
    updateTrack(trackId, (current) => {
        const devices = [...current.devices];
        devices.splice(deviceIndex, 0, device);
        return { ...current, devices };
    });

    let postCommitFailure: Error | undefined;

    function projectExactTrack(targetTrackId: string): void {
        const result = projectTrackToLiveStrip({ trackId: targetTrackId, activateDormantExternalPlugins: true });
        const failure = getRuntimeDeviceDeltaPostCommitFailure(
            result ?? {
                acceptance: 'rejected',
                application: 'not-applied',
                reason: `Restored device strip initialization did not produce an outcome for ${targetTrackId}`,
            }
        );
        if (failure) {
            throw failure;
        }
    }

    function reconcileRuntime(): void {
        if (postCommitFailure) {
            throw postCommitFailure;
        }
        const committedState = getTrackState();
        const committedTrack = committedState?.tracks.find((candidate) => candidate.id === trackId);
        if (
            !committedState ||
            !committedTrack ||
            !committedTrack.devices.some((candidate) => candidate.id === device.id) ||
            !shouldCreateLiveTrackStrip(committedTrack)
        ) {
            return;
        }
        try {
            if (wasLive) {
                const result = applyDeviceChainRuntimeDelta({
                    before: beforeTrack,
                    after: afterTrack,
                    operation: 'add-device',
                    batchContext: options?.batchContext,
                });
                if (result.acceptance === 'superseded' && result.application === 'not-applied') {
                    return;
                }
                if (result.acceptance !== 'superseded') {
                    const failure = getRuntimeDeviceDeltaPostCommitFailure(result);
                    if (failure) {
                        throw failure;
                    }
                }
                if (device.type === 'external-plugin' && device.externalInstanceId && device.externalPluginId) {
                    void activateExternalPlugin({
                        pluginId: device.externalPluginId,
                        instanceId: device.externalInstanceId,
                        stateChunk: device.externalStateChunk,
                        onLatencyMs: (latency) => reportLatency(device.id, latency),
                    });
                }
                for (const [parameterId, value] of orderDeviceParametersForReplay(
                    device.type,
                    device.parameterValues
                )) {
                    updateDeviceParam(trackId, device.id, parameterId, value);
                }
                updateDeviceBypass(trackId, device.id, device.bypassed);
            } else {
                projectExactTrack(trackId);
            }
            if (activatesFolderStrip) {
                for (const child of committedState.tracks) {
                    if (child.parentId === trackId && shouldCreateLiveTrackStrip(child)) {
                        projectExactTrack(child.id);
                    }
                }
            }
        } catch (error) {
            postCommitFailure = error instanceof Error ? error : new Error(String(error));
            throw postCommitFailure;
        }
    }
    if (options?.deferRuntimeEffects) {
        return {
            outcome: 'written',
            afterCommit: reconcileRuntime,
            afterAmbiguousCommit: reconcileRuntime,
        };
    }
    reconcileRuntime();
    return 'written';
}
