import { RuntimeGraphMutationFailure, RuntimeGraphMutationRejected, type TrackNode } from '../../engine/TrackNode';
import { matchesRuntimeDeviceChainTopology } from '../../services/matchesRuntimeDeviceChainTopology';

import { admitRuntimeGraphDelta, type RuntimeGraphAdmissionPorts } from './admitRuntimeGraphDelta';
import { needsRuntimeGraphReconciliation } from './needsRuntimeGraphReconciliation';
import { rejectRuntimeGraphDelta } from './rejectRuntimeGraphDelta';

import type { RuntimeGraphDeltaResult, RuntimeGraphDeviceChainDelta } from '../../models/RuntimeGraphDelta';
import type { RuntimeGraphMutation, RuntimeGraphRevision } from './createRuntimeGraphRevision';

export type RuntimeDeviceChainDeltaPorts = RuntimeGraphAdmissionPorts &
    Readonly<{
        mutateRuntimeGraph: RuntimeGraphRevision['mutate'];
        /** The live strip node of a track, read per call. */
        readTrackNode: (trackId: string) => TrackNode | undefined;
        /** Creates the track's strip when it is missing, without publishing a generation. */
        ensureTrackStripInGraph: (trackId: string) => void;
    }>;

type DeviceChainOutcome =
    | { status: 'applied' }
    | { status: 'rejected'; error: RuntimeGraphMutationRejected }
    | { status: 'needs-reconcile'; reason: string; compensation: 'not-attempted' | 'failed' };

function applyDeviceChain(
    source: TrackNode,
    delta: RuntimeGraphDeviceChainDelta
): RuntimeGraphMutation<DeviceChainOutcome> {
    try {
        return { value: { status: 'applied' as const }, changed: source.applyDeviceChain(delta) };
    } catch (error) {
        if (error instanceof RuntimeGraphMutationRejected) {
            return { value: { status: 'rejected' as const, error }, changed: false };
        }
        const typedFailure = error instanceof RuntimeGraphMutationFailure ? error : undefined;
        return {
            value: {
                status: 'needs-reconcile' as const,
                reason: typedFailure?.mutation.reason ?? `Live device-chain application threw: ${String(error)}`,
                compensation: typedFailure?.rollbackError ? 'failed' : 'not-attempted',
            },
            changed: true,
        };
    }
}

/** Applies one compiled, ordered device-chain transition to a project-owned track's live strip. */
export function createRuntimeDeviceChainDeltaApplication(
    ports: RuntimeDeviceChainDeltaPorts
): (delta: RuntimeGraphDeviceChainDelta) => RuntimeGraphDeltaResult {
    const { mutateRuntimeGraph, readTrackNode, ensureTrackStripInGraph } = ports;

    return (delta) => {
        const refusal = admitRuntimeGraphDelta(ports, delta.correlation, [delta.after], 'delta');
        if (refusal) {
            return refusal;
        }

        let source = readTrackNode(delta.before.id);
        if (!source && delta.before.devices.length === 0) {
            ensureTrackStripInGraph(delta.before.id);
            source = readTrackNode(delta.before.id);
        }
        if (!source || !matchesRuntimeDeviceChainTopology(source.strip, delta.before)) {
            return rejectRuntimeGraphDelta('Live source strip does not match the compiled device-chain delta');
        }

        const liveSource = source;
        const deviceMutation = mutateRuntimeGraph(() => applyDeviceChain(liveSource, delta));
        if (deviceMutation.value.status === 'rejected') {
            return rejectRuntimeGraphDelta(deviceMutation.value.error.rejection.reason);
        }
        if (deviceMutation.value.status === 'needs-reconcile') {
            return needsRuntimeGraphReconciliation(
                delta,
                deviceMutation.value.reason,
                deviceMutation.runtimeRevision,
                deviceMutation.value.compensation
            );
        }
        return Object.freeze({
            acceptance: 'accepted' as const,
            application: 'applied' as const,
            correlation: delta.correlation,
            runtimeRevision: deviceMutation.runtimeRevision,
        });
    };
}
