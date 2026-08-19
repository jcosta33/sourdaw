import { applyRuntimeGraphDelta, getRuntimeGraphRevision } from '#/modules/AudioEngine/useCases';
import { captureProjectRevision } from '#/modules/CrdtDocument/useCases';

import { runtimeGraphTopology } from '../runtimeGraphTopology';

import type { Track } from '../../stores/trackStore';

type ApplyDeviceChainRuntimeDeltaInput = Readonly<{
    before: Track;
    after: Track;
    operation: 'add-device' | 'remove-device' | 'reorder-device' | 'replace-device-chain';
}>;

/**
 * Compiles the Arrangement-owned project snapshots into the sole runtime
 * device-topology command. The engine rechecks `after` against current project
 * authority and `before` against the live strip before any AudioNode changes.
 */
export function applyDeviceChainRuntimeDelta({ before, after, operation }: ApplyDeviceChainRuntimeDeltaInput) {
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
