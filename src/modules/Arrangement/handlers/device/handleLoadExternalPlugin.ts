import { reportLatency } from '#/modules/AudioEngine/useCases';
import { activateExternalPlugin, findSupportedPlugin } from '#/modules/PluginHost/useCases';
import { createHandler } from '#/utils/createHandler';

import { shouldCreateLiveTrackStrip } from '../../stores/trackEligibility';
import { addTrack } from '../../useCases/addTrack';
import { addExternalDevice } from '../../useCases/device/addExternalDevice';
import { applyDeviceChainRuntimeDelta } from '../../useCases/device/applyDeviceChainRuntimeDelta';
import { getTrackStoreState } from '../../useCases/getTrackStoreState';
import { toHandlerExecutionResult } from '../toHandlerExecutionResult';

type RuntimeDeviceDeltaResult = ReturnType<typeof applyDeviceChainRuntimeDelta>;
type RuntimeDeviceDeltaFailure = Exclude<
    RuntimeDeviceDeltaResult,
    Readonly<{ acceptance: 'accepted'; application: 'applied' }>
>;

class RuntimeDeviceDeltaPostCommitError extends Error {
    public readonly outcome: RuntimeDeviceDeltaFailure;
    public readonly remediation: 'retry' | 'repair';

    constructor(outcome: RuntimeDeviceDeltaFailure) {
        const remediation = outcome.acceptance === 'rejected' ? 'retry' : 'repair';
        super(
            outcome.acceptance === 'rejected'
                ? `Device runtime delta was rejected after project commit and requires ${remediation}: ${outcome.reason}`
                : `Device runtime delta requires ${remediation} after project commit: ${outcome.reason}`
        );
        this.name = 'RuntimeDeviceDeltaPostCommitError';
        this.outcome = outcome;
        this.remediation = remediation;
    }
}

function getRuntimeDeviceDeltaPostCommitFailure(
    result: RuntimeDeviceDeltaResult
): RuntimeDeviceDeltaPostCommitError | undefined {
    if (result.acceptance === 'accepted' && result.application === 'applied') {
        return undefined;
    }
    return new RuntimeDeviceDeltaPostCommitError(result);
}

export const handleLoadExternalPlugin = createHandler<'loadExternalPlugin'>({
    execute: (alpha) => {
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
        let pluginActivated = false;
        function applyRuntimeEffect(): void {
            if (postCommitFailure) {
                throw postCommitFailure;
            }
            if (!runtimeDeltaApplied) {
                const result = applyDeviceChainRuntimeDelta({
                    before: committedBefore,
                    after,
                    operation: 'add-device',
                });
                const runtimeFailure = getRuntimeDeviceDeltaPostCommitFailure(result);
                if (runtimeFailure) {
                    postCommitFailure = runtimeFailure;
                    throw postCommitFailure;
                }
                runtimeDeltaApplied = true;
            }
            if (pluginActivated) {
                return;
            }
            if (!externalPluginId || !externalInstanceId) {
                throw new Error(
                    `External device ${committedDevice.id} is missing its plugin host identity after project commit`
                );
            }
            activateExternalPlugin({
                pluginId: externalPluginId,
                instanceId: externalInstanceId,
                onLatencyMs: (latencyMs) => reportLatency(committedDevice.id, latencyMs),
            });
            pluginActivated = true;
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
