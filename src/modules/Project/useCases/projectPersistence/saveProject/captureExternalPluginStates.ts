import { trackStore } from '#/modules/Arrangement/stores';
import { executeAppActionBatch } from '#/modules/Command/useCases';
import { captureProjectMutationAuthorization, captureProjectRevision } from '#/modules/CrdtDocument/useCases';
import {
    hasUnresolvedExternalPluginRestoreFailure,
    readExternalPluginStateForCapture,
    shouldWarnExternalPluginRestoreFailure,
} from '#/modules/PluginHost/useCases';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { capturedNativePluginStateCache } from './capturedNativePluginStateCache';
import { warnedExternalPluginCaptureRejections } from './warnedExternalPluginCaptureRejections';

export type ExternalPluginCaptureOutcome = {
    /**
     * Plugins whose capture command was rejected before any project write
     * landed, so their live edit is NOT in project truth. The caller must not
     * treat the save as a clean success for those edits.
     */
    readonly rejectedPlugins: readonly string[];
};

type RejectedCapture = {
    readonly instanceId: string;
    readonly pluginName: string;
    readonly authorityToken: object;
};

type DeviceWitness = {
    readonly deviceId: string;
    readonly deviceType: string;
    readonly instanceId: string;
    readonly stateChunk: string | null;
};

function hasExactDeviceWitness(witness: DeviceWitness): boolean {
    const state = trackStore.value;
    if (!state) {
        return false;
    }
    for (const track of state.tracks) {
        const device = track.devices.find((candidate) => candidate.id === witness.deviceId);
        if (!device) {
            continue;
        }
        return (
            device.type === witness.deviceType &&
            device.externalInstanceId === witness.instanceId &&
            (device.externalStateChunk ?? null) === witness.stateChunk
        );
    }
    return false;
}

function recordAcceptedCapture(instanceId: string, stateChunk: string, authorityToken: object): void {
    capturedNativePluginStateCache.set(instanceId, { stateChunk, authorityToken });
    warnedExternalPluginCaptureRejections.delete(instanceId);
}

function wasCaptureAccepted(instanceId: string, stateChunk: string, authorityToken: object): boolean {
    const accepted = capturedNativePluginStateCache.get(instanceId);
    return accepted?.stateChunk === stateChunk && accepted.authorityToken === authorityToken;
}

function addPreservationWarning(instanceId: string, pluginName: string, preservedPlugins: string[]): void {
    if (shouldWarnExternalPluginRestoreFailure(instanceId)) {
        preservedPlugins.push(pluginName);
    }
}

function rejectOrPreserve(
    rejection: RejectedCapture,
    preservedPlugins: string[],
    rejectedCaptures: RejectedCapture[]
): void {
    if (hasUnresolvedExternalPluginRestoreFailure(rejection.instanceId)) {
        addPreservationWarning(rejection.instanceId, rejection.pluginName, preservedPlugins);
        return;
    }
    rejectedCaptures.push(rejection);
}

function warnOncePerEpisode(rejectedCaptures: readonly RejectedCapture[]): void {
    const unwarned = rejectedCaptures.filter(
        ({ instanceId, authorityToken }) => warnedExternalPluginCaptureRejections.get(instanceId) !== authorityToken
    );
    for (const { instanceId, authorityToken } of unwarned) {
        warnedExternalPluginCaptureRejections.set(instanceId, authorityToken);
    }
    if (unwarned.length === 0) {
        return;
    }
    notifyUser(
        `The latest state of ${unwarned.map((rejection) => rejection.pluginName).join(', ')} could not be saved — the project still reports unsaved changes, so save again to retry.`,
        'warning'
    );
}

function warnPreservedPlugins(preservedPlugins: readonly string[]): void {
    if (preservedPlugins.length === 0) {
        return;
    }
    notifyUser(
        `Saved state was preserved for ${preservedPlugins.join(', ')} after a failed restore — edits made in the plugin since were not captured.`,
        'warning'
    );
}

function isAcceptedBatchStatus(status: string): boolean {
    return status === 'committed' || status === 'committed-with-warning' || status === 'ambiguous';
}

/**
 * Capture every loaded native plugin through a revision-, device-, and
 * native-generation-bound Command commit.
 */
export async function captureExternalPluginStates(): Promise<ExternalPluginCaptureOutcome> {
    const openingState = trackStore.value;
    if (!openingState) {
        return { rejectedPlugins: [] };
    }

    const preservedPlugins: string[] = [];
    const rejectedCaptures: RejectedCapture[] = [];

    for (const track of openingState.tracks) {
        for (const openingDevice of track.devices) {
            const instanceId = openingDevice.externalInstanceId;
            if (openingDevice.type !== 'external-plugin' || !instanceId) {
                continue;
            }

            const pluginName = openingDevice.externalPluginId ?? openingDevice.name;
            const witness: DeviceWitness = {
                deviceId: openingDevice.id,
                deviceType: openingDevice.type,
                instanceId,
                stateChunk: openingDevice.externalStateChunk ?? null,
            };
            const originalRevision = captureProjectRevision();
            const mutationIsAuthorized = captureProjectMutationAuthorization();
            const read = await readExternalPluginStateForCapture(instanceId);

            if (read.status === 'preserve') {
                if (read.reason === 'restore-failed') {
                    addPreservationWarning(instanceId, pluginName, preservedPlugins);
                }
                continue;
            }
            if (read.status === 'stale') {
                rejectOrPreserve(
                    { instanceId, pluginName, authorityToken: read.authorityToken },
                    preservedPlugins,
                    rejectedCaptures
                );
                continue;
            }

            const rejection = { instanceId, pluginName, authorityToken: read.authorityToken };
            if (!read.isCurrent() || captureProjectRevision() !== originalRevision || !hasExactDeviceWitness(witness)) {
                rejectOrPreserve(rejection, preservedPlugins, rejectedCaptures);
                continue;
            }

            if (wasCaptureAccepted(instanceId, read.stateChunk, read.authorityToken)) {
                continue;
            }

            if (read.stateChunk === witness.stateChunk) {
                recordAcceptedCapture(instanceId, read.stateChunk, read.authorityToken);
                continue;
            }

            let ownerBound = false;
            const result = await executeAppActionBatch(
                [
                    {
                        type: 'setExternalPluginState',
                        payload: {
                            intent: 'capture',
                            deviceId: witness.deviceId,
                            stateChunk: read.stateChunk,
                            expectedInstanceId: witness.instanceId,
                            expectedStateChunk: witness.stateChunk,
                        },
                    },
                ],
                {
                    groupLabel: 'Capture plugin state',
                    skipMacroRecording: true,
                    authorizeFirstHandler: () => {
                        ownerBound = true;
                        if (!mutationIsAuthorized()) {
                            return 'Project changed while plugin state was captured';
                        }
                        if (captureProjectRevision() !== originalRevision) {
                            return 'Project revision changed while plugin state was captured';
                        }
                        if (!hasExactDeviceWitness(witness)) {
                            return 'Plugin device changed while its state was captured';
                        }
                        if (!read.isCurrent()) {
                            return 'Plugin runtime changed while its state was captured';
                        }
                        return null;
                    },
                    shouldExecute: () => !ownerBound || (mutationIsAuthorized() && read.isCurrent()),
                }
            );

            if (isAcceptedBatchStatus(result.status)) {
                recordAcceptedCapture(instanceId, read.stateChunk, read.authorityToken);
                continue;
            }
            rejectOrPreserve(rejection, preservedPlugins, rejectedCaptures);
        }
    }

    warnPreservedPlugins(preservedPlugins);
    warnOncePerEpisode(rejectedCaptures);
    return { rejectedPlugins: rejectedCaptures.map((rejection) => rejection.pluginName) };
}
