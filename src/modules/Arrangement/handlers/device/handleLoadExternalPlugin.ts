import { reportLatency } from '#/modules/AudioEngine/useCases';
import { activateExternalPlugin, findSupportedPlugin } from '#/modules/PluginHost/useCases';
import { createHandler } from '#/utils/createHandler';

import { shouldCreateLiveTrackStrip } from '../../stores/trackEligibility';
import { type Device } from '../../stores/trackStore';
import { addTrack } from '../../useCases/addTrack';
import { addExternalDevice } from '../../useCases/device/addExternalDevice';
import { applyDeviceChainRuntimeDelta } from '../../useCases/device/applyDeviceChainRuntimeDelta';
import {
    getRuntimeDeviceDeltaPostCommitFailure,
    type RuntimeDeviceDeltaPostCommitError,
} from '../../useCases/device/runtimeDeviceDeltaPostCommit';
import { getTrackStoreState } from '../../useCases/getTrackStoreState';
import { toHandlerExecutionResult } from '../toHandlerExecutionResult';

function isCommittedExternalDeviceStillAuthoritative(trackId: string, committedDevice: Device): boolean {
    const currentOwners = getTrackStoreState()?.tracks.filter((track) => track.id === trackId) ?? [];
    if (currentOwners.length !== 1) {
        return false;
    }
    const currentTrack = currentOwners[0];
    if (!currentTrack) {
        return false;
    }
    return currentTrack.devices.some(
        (candidate) =>
            candidate.id === committedDevice.id &&
            candidate.type === 'external-plugin' &&
            candidate.externalPluginId === committedDevice.externalPluginId &&
            candidate.externalInstanceId === committedDevice.externalInstanceId
    );
}

export const handleLoadExternalPlugin = createHandler<'loadExternalPlugin'>({
    execute: (alpha, context) => {
        const { pluginId, trackId: providedTrackId } = alpha.payload;
        const plugin = findSupportedPlugin(pluginId);
        if (!plugin) {
            return toHandlerExecutionResult(false);
        }

        let trackId = providedTrackId;
        let didWrite = false;
        if (!trackId) {
            const isInstrument = plugin.category.toLowerCase() === 'instrument';
            const newTrack = addTrack({
                name: plugin.name,
                kind: isInstrument ? 'midi' : 'audio',
            });
            if (!newTrack) {
                return toHandlerExecutionResult(false);
            }
            trackId = newTrack.id;
            didWrite = true;
        }

        const beforeTrack = getTrackStoreState()?.tracks.find((track) => track.id === trackId);
        const before = beforeTrack ? structuredClone(beforeTrack) : null;
        const device = addExternalDevice(trackId, plugin.id, plugin.name);
        if (!device) {
            return toHandlerExecutionResult(didWrite);
        }
        didWrite = true;
        if (!before || !shouldCreateLiveTrackStrip(before)) {
            return toHandlerExecutionResult(didWrite);
        }

        const committedBefore = before;
        const committedDevice = device;
        const after = { ...committedBefore, devices: [...committedBefore.devices, committedDevice] };
        const externalPluginId = committedDevice.externalPluginId;
        const externalInstanceId = committedDevice.externalInstanceId;
        let postCommitFailure: RuntimeDeviceDeltaPostCommitError | undefined;
        let runtimeDeltaApplied = false;
        let pluginActivationSettled = false;
        function applyRuntimeEffect(): void {
            if (postCommitFailure) {
                throw postCommitFailure;
            }
            if (!runtimeDeltaApplied) {
                const result = applyDeviceChainRuntimeDelta({
                    before: committedBefore,
                    after,
                    operation: 'add-device',
                    batchContext: context,
                });
                // A later action in this same commit removed the host track.
                // The chain delta is void, and so is the plugin activation
                // below: activating a native instance onto a strip that is
                // being torn down would leak the instance.
                if (result.acceptance === 'superseded' && result.application === 'not-applied') {
                    return;
                }
                if (result.acceptance !== 'superseded') {
                    const runtimeFailure = getRuntimeDeviceDeltaPostCommitFailure(result);
                    if (runtimeFailure) {
                        postCommitFailure = runtimeFailure;
                        throw postCommitFailure;
                    }
                }
                runtimeDeltaApplied = true;
            }
            if (pluginActivationSettled) {
                return;
            }
            if (!externalPluginId || !externalInstanceId) {
                throw new Error(
                    `External device ${committedDevice.id} is missing its plugin host identity after project commit`
                );
            }
            if (!isCommittedExternalDeviceStillAuthoritative(trackId, committedDevice)) {
                pluginActivationSettled = true;
                return;
            }
            activateExternalPlugin({
                pluginId: externalPluginId,
                instanceId: externalInstanceId,
                onLatencyMs: (latencyMs) => reportLatency(committedDevice.id, latencyMs),
            });
            pluginActivationSettled = true;
        }

        return {
            status: 'written' as const,
            afterCommit: applyRuntimeEffect,
            afterAmbiguousCommit: applyRuntimeEffect,
        };
    },
    describe: (alpha) => ({ label: `Load external plugin "${alpha.payload.pluginId}"` }),
    undoable: false,
});
