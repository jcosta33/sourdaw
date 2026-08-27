import { getLiveEngineSampleRate, reportBridgeRoundTripFrames, reportLatency } from '#/modules/AudioEngine/useCases';
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

        const committedTrackId: string = trackId;
        const beforeTrack = getTrackStoreState()?.tracks.find((track) => track.id === committedTrackId);
        const before = beforeTrack ? structuredClone(beforeTrack) : null;
        const device = addExternalDevice(committedTrackId, plugin.id, plugin.name);
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
        async function applyRuntimeEffect(): Promise<void> {
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
            if (!isCommittedExternalDeviceStillAuthoritative(committedTrackId, committedDevice)) {
                pluginActivationSettled = true;
                return;
            }
            // The live engine's own rate: the plugin is fed audio this engine
            // renders, so it has to run on the same clock. A user cannot reach
            // this handler without an engine to load into, so an absent rate is
            // a broken invariant rather than a state to degrade through —
            // raised here, where the post-commit contract routes it to graph
            // repair, instead of substituted for and never heard about again.
            const engineSampleRate = getLiveEngineSampleRate();
            if (engineSampleRate === undefined) {
                throw new Error(
                    `Cannot activate external plugin ${externalInstanceId}: no live audio engine to state a sample rate`
                );
            }
            const activation = await activateExternalPlugin({
                pluginId: externalPluginId,
                instanceId: externalInstanceId,
                engineSampleRate,
                onLatencyMs: (latencyMs) => reportLatency(committedDevice.id, latencyMs),
                onBridgeRoundTripFrames: (frames) => reportBridgeRoundTripFrames(committedDevice.id, frames),
            });
            if (activation.status === 'failed') {
                throw new Error(activation.reason);
            }
            pluginActivationSettled = true;
        }

        return {
            status: 'written' as const,
            afterCommit: applyRuntimeEffect,
            afterAmbiguousCommit: applyRuntimeEffect,
            postCommitEffect: { kind: 'runtime-graph' as const, remediation: 'repair' as const },
        };
    },
    describe: (alpha) => ({ label: `Load external plugin "${alpha.payload.pluginId}"` }),
    undoable: false,
});
