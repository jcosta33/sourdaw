import { clearReportedLatency, removeTrackStrip } from '#/modules/AudioEngine/useCases';
import { unloadPlugin } from '#/modules/PluginHost/useCases';

import { getTrackState } from '../../repositories/track/getTrackState';
import { mapAllTracks } from '../../repositories/track/mapAllTracks';
import { getTrackEligibility, shouldCreateLiveTrackStrip } from '../../stores/trackEligibility';
import { projectTrackToLiveStrip } from '../projectTrackToLiveStrip';

import { applyDeviceChainRuntimeDelta } from './applyDeviceChainRuntimeDelta';

import type { Device, Track } from '../../models/Track';

type PrepareRemoveDeviceOutcome = 'written' | 'missing' | 'conflict';
type PreparedRemoveDeviceEffects = {
    outcome: 'written';
    afterCommit: () => Promise<void>;
    afterAmbiguousCommit: () => Promise<void>;
};

export function prepareRemoveDevice(deviceId: string): PrepareRemoveDeviceOutcome | PreparedRemoveDeviceEffects {
    const state = getTrackState();
    if (!state) {
        return 'missing';
    }

    let target: { track: Track; device: Device } | null = null;
    for (const track of state.tracks) {
        for (const device of track.devices) {
            if (device.id !== deviceId) {
                continue;
            }
            if (target) {
                return 'conflict';
            }
            target = { track, device };
        }
    }
    if (!target) {
        return 'missing';
    }

    const { track, device } = target;
    const matchingOwners = state.tracks.filter((candidate) => candidate.id === track.id);
    if (matchingOwners.length !== 1) {
        return 'conflict';
    }

    const beforeTrack = structuredClone(track);
    const remainingDevices = track.devices.filter((candidate) => candidate.id !== deviceId);
    const afterTrack = { ...track, devices: remainingDevices };
    const trackEligibility = getTrackEligibility(track.kind);
    const wasLive = shouldCreateLiveTrackStrip(track);
    const remainsLive =
        trackEligibility.createsLiveStrip ||
        (track.kind === 'folder' && remainingDevices.some((candidate) => candidate.type === 'toaster'));
    const deactivatesStrip = wasLive && !remainsLive;
    const isProjectOnlyFolder = track.kind === 'folder' && !wasLive;
    const shouldUnloadRemovedExternal = wasLive || !trackEligibility.acceptsDeviceUpdate;
    // Every external-plugin device whose native instance this removal tears down,
    // keyed by engine device id — the same key the latency registry uses — so the
    // unload set and the registry-clear set cannot drift apart. Deactivating the
    // strip unloads the retained siblings too, and their reported latency has to
    // go with them.
    const unloadedExternalDevices = new Map<string, string>();
    if (deactivatesStrip) {
        for (const retainedDevice of remainingDevices) {
            if (retainedDevice.type === 'external-plugin' && retainedDevice.externalInstanceId) {
                unloadedExternalDevices.set(retainedDevice.id, retainedDevice.externalInstanceId);
            }
        }
    }
    if (device.type === 'external-plugin' && device.externalInstanceId && shouldUnloadRemovedExternal) {
        unloadedExternalDevices.set(device.id, device.externalInstanceId);
    }
    const externalInstanceIds = new Set<string>(unloadedExternalDevices.values());

    mapAllTracks((candidate) => {
        if (candidate.id !== track.id) {
            return candidate;
        }
        return { ...candidate, devices: candidate.devices.filter((item) => item.id !== deviceId) };
    });

    const latencyDeviceIdsToClear = new Set<string>(unloadedExternalDevices.keys());
    if (device.type === 'external-plugin') {
        latencyDeviceIdsToClear.add(deviceId);
    }

    function manualRepairFailure(effect: string, error: unknown): Error {
        return new Error(`${effect}: ${String(error)}; manual repair is required`, { cause: error });
    }

    let deviceRemovalFinalized = false;
    let initialRuntimeGraphFailure: Error | null = null;
    const finalizedLatencyDeviceIds = new Set<string>();
    let stripRemovalFinalized = !deactivatesStrip;
    const finalizedExternalInstanceIds = new Set<string>();

    function finalizeRuntimeRemovalStrict(): void {
        if (isProjectOnlyFolder) {
            return;
        }
        const currentTrack = getTrackState()?.tracks.find((candidate) => candidate.id === track.id);
        if (!currentTrack) {
            deviceRemovalFinalized = true;
            stripRemovalFinalized = true;
        } else if (!deviceRemovalFinalized) {
            try {
                const result = applyDeviceChainRuntimeDelta({
                    before: beforeTrack,
                    after: afterTrack,
                    operation: 'remove-device',
                });
                // A superseded delta is void, not stale: a later action in this
                // same commit removed the host track, so the runtime end state
                // for it is no strip at all and that action's own teardown owns
                // it. The graph obligation is discharged; every other
                // obligation of this removal still runs below, and a host track
                // that is still present but no longer matches stays loud.
                if (result.acceptance === 'rejected') {
                    throw new Error(result.reason);
                }
                if (result.acceptance === 'accepted' && result.application === 'needs-reconcile') {
                    throw new Error(result.reason);
                }
                deviceRemovalFinalized = true;
            } catch (error) {
                const repairFailure = manualRepairFailure(
                    `Runtime graph removal failed for device ${deviceId} on track ${track.id}`,
                    error
                );
                initialRuntimeGraphFailure ??= repairFailure;
                throw repairFailure;
            }
        }

        for (const clearedDeviceId of latencyDeviceIdsToClear) {
            if (finalizedLatencyDeviceIds.has(clearedDeviceId)) {
                continue;
            }
            try {
                clearReportedLatency(clearedDeviceId);
                finalizedLatencyDeviceIds.add(clearedDeviceId);
            } catch (error) {
                throw manualRepairFailure(`Latency cleanup failed for device ${clearedDeviceId}`, error);
            }
        }

        if (!stripRemovalFinalized) {
            try {
                removeTrackStrip(track.id);
                stripRemovalFinalized = true;
            } catch (error) {
                throw manualRepairFailure(`Runtime strip removal failed for track ${track.id}`, error);
            }
        }
    }

    async function finalizeExternalUnloadsStrict(): Promise<void> {
        for (const instanceId of externalInstanceIds) {
            if (finalizedExternalInstanceIds.has(instanceId)) {
                continue;
            }
            try {
                await unloadPlugin(instanceId);
                finalizedExternalInstanceIds.add(instanceId);
            } catch (error) {
                throw manualRepairFailure(`Plugin host teardown failed for instance ${instanceId}`, error);
            }
        }
    }

    async function finalizeRuntimeEffectsStrict(): Promise<void> {
        finalizeRuntimeRemovalStrict();
        await finalizeExternalUnloadsStrict();
    }

    async function reconcileRuntimeEffects(): Promise<void> {
        if (isProjectOnlyFolder) {
            return;
        }
        const currentOwners = (getTrackState()?.tracks ?? []).filter((candidate) =>
            candidate.devices.some((candidateDevice) => candidateDevice.id === deviceId)
        );
        if (currentOwners.length === 0) {
            await finalizeRuntimeEffectsStrict();
        } else if (currentOwners.length === 1) {
            try {
                projectTrackToLiveStrip({ trackId: currentOwners[0]!.id, activateDormantExternalPlugins: true });
            } catch (error) {
                throw manualRepairFailure(`Runtime projection failed for restored device ${deviceId}`, error);
            }
        } else {
            throw new Error(
                `Runtime reconciliation found multiple owners for device ${deviceId}; manual repair is required`
            );
        }

        if (initialRuntimeGraphFailure) {
            throw new Error(
                `Runtime graph removal was reconciled after its initial failure for device ${deviceId}; ` +
                    `retry/repair acknowledgement is still required: ${initialRuntimeGraphFailure.message}`,
                { cause: initialRuntimeGraphFailure }
            );
        }
    }

    return {
        outcome: 'written',
        afterCommit: finalizeRuntimeEffectsStrict,
        afterAmbiguousCommit: reconcileRuntimeEffects,
    };
}
