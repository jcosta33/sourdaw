import {
    applyRuntimeGraphDelta,
    getRuntimeGraphRevision,
    matchesRuntimeDeviceChainTopology,
} from '#/modules/AudioEngine/useCases';
import { captureProjectRevision } from '#/modules/CrdtDocument/useCases';
import { type AppAction, type HandlerValidationContext } from '#/utils/handlerContract';

import { getAllTracks } from '../../repositories/track/getAllTracks';
import { runtimeGraphTopology } from '../runtimeGraphTopology';

import { hasLiveProjectHostTrack } from './hasLiveProjectHostTrack';

import type { Track } from '../../stores/trackStore';

type ApplyDeviceChainRuntimeDeltaInput = Readonly<{
    before: Track;
    after: Track;
    operation: 'add-device' | 'remove-device' | 'reorder-device' | 'replace-device-chain';
    batchContext?: Pick<HandlerValidationContext, 'actions' | 'actionIndex'>;
}>;

/**
 * A compiled delta whose subject left project truth before the delta was
 * submitted. It is void rather than stale: no runtime work is owed for it, and
 * none was attempted.
 */
export type DeviceChainRuntimeDeltaSuperseded = Readonly<{
    acceptance: 'superseded';
    application: 'not-applied';
    reason: string;
}>;

/** A compiled step whose exact runtime obligation is already satisfied. */
export type DeviceChainRuntimeDeltaDischarged = Readonly<{
    acceptance: 'superseded';
    application: 'discharged';
    reason: string;
}>;

export type ApplyDeviceChainRuntimeDeltaResult =
    ReturnType<typeof applyRuntimeGraphDelta> | DeviceChainRuntimeDeltaSuperseded | DeviceChainRuntimeDeltaDischarged;

function getDeviceChainMutationTrackId(action: AppAction, currentStep: Track): string | undefined {
    switch (action.type) {
        case 'addDevice':
        case 'restoreDevice':
        case 'reorderDevices':
        case 'loadPreset':
        case 'restorePresetDeviceChain':
            return action.payload.trackId;
        case 'removeDevice':
            return (
                action.payload.expectedTrackId ??
                (currentStep.devices.some((device) => device.id === action.payload.deviceId)
                    ? currentStep.id
                    : undefined)
            );
        case 'loadExternalPlugin':
            return action.payload.trackId;
        default:
            return undefined;
    }
}

function hasLaterSameTrackDeviceChainMutation(
    context: ApplyDeviceChainRuntimeDeltaInput['batchContext'],
    currentStep: Track
): boolean {
    return (
        context?.actions
            .slice(context.actionIndex + 1)
            .some((action) => getDeviceChainMutationTrackId(action, currentStep) === currentStep.id) ?? false
    );
}

/**
 * Compiles the Arrangement-owned project snapshots into the sole runtime
 * device-topology command. The engine rechecks `after` against current project
 * authority and `before` against the live strip before any AudioNode changes.
 *
 * A delta whose host track is gone from project truth is reported `superseded`
 * instead of being submitted. The runtime end state for a removed track is no
 * strip at all, which the removing action's own deferred teardown owns;
 * submitting the delta anyway makes the engine report a topology mismatch for a
 * removal that already happened. Consecutive same-track mutations in one batch
 * compose the earliest live `before` directly to final project truth. Any
 * project divergence without that batch proof stays a genuine, loud mismatch.
 * A step is discharged only when AudioEngine proves the live chain already
 * equals that authoritative target.
 */
export function applyDeviceChainRuntimeDelta({
    before,
    after,
    operation,
    batchContext,
}: ApplyDeviceChainRuntimeDeltaInput): ApplyDeviceChainRuntimeDeltaResult {
    if (!hasLiveProjectHostTrack(after.id)) {
        return Object.freeze({
            acceptance: 'superseded' as const,
            application: 'not-applied' as const,
            reason: `Track ${after.id} left project truth before its ${operation} delta was submitted`,
        });
    }

    const currentOwners = getAllTracks().filter((track) => track.id === after.id);
    const currentTrack = currentOwners.length === 1 ? currentOwners[0] : undefined;
    const compiledAfter = runtimeGraphTopology.createNode(after);
    const compiledAfterIsCurrent = currentTrack ? runtimeGraphTopology.matchesNode(currentTrack, compiledAfter) : false;
    const mayComposeGroupedFinal =
        currentTrack !== undefined &&
        !compiledAfterIsCurrent &&
        hasLaterSameTrackDeviceChainMutation(batchContext, after);
    const authoritativeAfter = mayComposeGroupedFinal ? runtimeGraphTopology.createNode(currentTrack) : compiledAfter;

    if (
        currentTrack !== undefined &&
        (compiledAfterIsCurrent || mayComposeGroupedFinal) &&
        matchesRuntimeDeviceChainTopology(authoritativeAfter)
    ) {
        return Object.freeze({
            acceptance: 'superseded' as const,
            application: 'discharged' as const,
            reason: `Live runtime already matches the authoritative final device chain for track ${after.id}`,
        });
    }

    return applyRuntimeGraphDelta({
        schemaVersion: 1,
        command: 'replace-track-device-chain',
        correlation: {
            appRevision: getRuntimeGraphRevision(),
            projectRevision: captureProjectRevision(),
        },
        operation: mayComposeGroupedFinal ? 'replace-device-chain' : operation,
        before: runtimeGraphTopology.createNode(before),
        after: authoritativeAfter,
        parameters: [],
    });
}
