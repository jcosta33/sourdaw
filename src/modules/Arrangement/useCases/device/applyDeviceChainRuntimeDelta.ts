import { logger } from '#/infra/logger/appLogger';
import {
    applyRuntimeGraphDelta,
    getRuntimeGraphRevision,
    getTrackStrip,
    matchesRuntimeDeviceChainTopology,
    mirrorDeviceChainDelta,
} from '#/modules/AudioEngine/useCases';
import { captureProjectRevision } from '#/modules/CrdtDocument/useCases';
import { type AppAction, type HandlerValidationContext } from '#/utils/handlerContract';

import { getAllTracks } from '../../repositories/track/getAllTracks';
import { projectTrackToLiveStrip } from '../projectTrackToLiveStrip';
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

/** A compiled step whose Web Audio obligation is satisfied; its native mirror is still owed. */
export type DeviceChainRuntimeDeltaDischarged = Readonly<{
    acceptance: 'superseded';
    application: 'discharged';
    reason: string;
}>;

export type ApplyDeviceChainRuntimeDeltaResult =
    ReturnType<typeof applyRuntimeGraphDelta> | DeviceChainRuntimeDeltaSuperseded | DeviceChainRuntimeDeltaDischarged;

/**
 * Send the same chain to the rolling native engine, and wait for none of it.
 *
 * A native session is a second carrier, not a second authority: the Web Audio
 * chain is already applied or proven exact by the time this runs. A change the
 * native engine declines is deferred to the next play and said out loud there (#3575).
 * Awaiting it would put a bridge round trip inside a project mutation, and
 * letting it throw would report a runtime-graph failure for a graph that is
 * intact — which is what `postCommitEffect: 'repair'` would then try to fix.
 */
function mirrorNativeDeviceChain(before: Track, after: Track): void {
    void mirrorDeviceChainDelta({ before, after }).catch((error: unknown) => {
        logger.warn(`[Arrangement] the native device-chain mirror for track ${after.id} failed: ${String(error)}`);
    });
}

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
 * A Web Audio step is discharged only when AudioEngine proves the persistent
 * chain already equals that authoritative target. Its complete native chain
 * still needs the existing apply-or-defer mirror, including note-scheduled devices.
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
    const authoritativeTrack = compiledAfterIsCurrent || mayComposeGroupedFinal ? currentTrack : undefined;

    if (authoritativeTrack !== undefined && matchesRuntimeDeviceChainTopology(authoritativeAfter)) {
        mirrorNativeDeviceChain(before, authoritativeTrack);
        return Object.freeze({
            acceptance: 'superseded' as const,
            application: 'discharged' as const,
            reason: `Live Web Audio already matches the authoritative final device chain for track ${after.id}`,
        });
    }

    // Imports can publish a device-bearing track after the app's initial strip
    // projection. Only an absent strip may bootstrap from current final truth;
    // an existing strip still has to prove the delta's exact before-chain.
    const initializeMissingStrip =
        currentTrack !== undefined &&
        (compiledAfterIsCurrent || mayComposeGroupedFinal) &&
        getTrackStrip(currentTrack.id) === undefined;
    let result: ReturnType<typeof applyRuntimeGraphDelta>;
    if (initializeMissingStrip) {
        result = projectTrackToLiveStrip({ trackId: currentTrack.id }) ?? {
            acceptance: 'rejected' as const,
            application: 'not-applied' as const,
            reason: `Cannot initialize device runtime strip for track ${currentTrack.id}`,
        };
    } else {
        result = applyRuntimeGraphDelta({
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
    // Only a delta Web Audio actually applied: a rejected or half-applied one
    // leaves the two carriers to be reconciled by the repair the result already
    // asks for, and mirroring it would put a chain on the native engine that
    // the Web Audio graph does not have.
    if (result.acceptance === 'accepted' && result.application === 'applied' && authoritativeTrack !== undefined) {
        mirrorNativeDeviceChain(before, authoritativeTrack);
    }
    return result;
}
