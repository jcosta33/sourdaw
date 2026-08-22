import { applyRuntimeGraphDelta, getRuntimeGraphRevision } from '#/modules/AudioEngine/useCases';
import { captureProjectRevision } from '#/modules/CrdtDocument/useCases';

import { runtimeGraphTopology } from '../runtimeGraphTopology';

import { hasLiveProjectHostTrack } from './hasLiveProjectHostTrack';

import type { Track } from '../../stores/trackStore';

type ApplyDeviceChainRuntimeDeltaInput = Readonly<{
    before: Track;
    after: Track;
    operation: 'add-device' | 'remove-device' | 'reorder-device' | 'replace-device-chain';
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

export type ApplyDeviceChainRuntimeDeltaResult =
    ReturnType<typeof applyRuntimeGraphDelta> | DeviceChainRuntimeDeltaSuperseded;

/**
 * Compiles the Arrangement-owned project snapshots into the sole runtime
 * device-topology command. The engine rechecks `after` against current project
 * authority and `before` against the live strip before any AudioNode changes.
 *
 * A delta whose host track is gone from project truth is reported `superseded`
 * instead of being submitted. The runtime end state for a removed track is no
 * strip at all, which the removing action's own deferred teardown owns;
 * submitting the delta anyway makes the engine report a topology mismatch for a
 * removal that already happened. A host track that is still present but no
 * longer matches stays a genuine, loud mismatch.
 */
export function applyDeviceChainRuntimeDelta({
    before,
    after,
    operation,
}: ApplyDeviceChainRuntimeDeltaInput): ApplyDeviceChainRuntimeDeltaResult {
    if (!hasLiveProjectHostTrack(after.id)) {
        return Object.freeze({
            acceptance: 'superseded' as const,
            application: 'not-applied' as const,
            reason: `Track ${after.id} left project truth before its ${operation} delta was submitted`,
        });
    }
    return applyRuntimeGraphDelta({
        schemaVersion: 1,
        command: 'replace-track-device-chain',
        correlation: {
            appRevision: getRuntimeGraphRevision(),
            projectRevision: captureProjectRevision(),
        },
        operation,
        before: runtimeGraphTopology.createNode(before),
        after: runtimeGraphTopology.createNode(after),
        parameters: [],
    });
}
