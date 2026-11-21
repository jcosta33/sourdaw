import { RuntimeGraphMutationFailure, RuntimeGraphMutationRejected, type TrackNode } from '../../engine/TrackNode';
import { matchesRuntimeDeviceChainTopology } from '../../services/matchesRuntimeDeviceChainTopology';

import { admitRuntimeGraphDelta, type RuntimeGraphAdmissionPorts } from './admitRuntimeGraphDelta';
import { needsRuntimeGraphReconciliation } from './needsRuntimeGraphReconciliation';
import { rejectRuntimeGraphDelta } from './rejectRuntimeGraphDelta';

import type { RuntimeGraphDeltaResult, RuntimeGraphOutputDelta } from '../../models/RuntimeGraphDelta';
import type { RuntimeGraphMutation, RuntimeGraphRevision } from './createRuntimeGraphRevision';

export type RuntimeOutputDeltaPorts = RuntimeGraphAdmissionPorts &
    Readonly<{
        mutateRuntimeGraph: RuntimeGraphRevision['mutate'];
        /** The live strip node of a track, read per call. */
        readTrackNode: (trackId: string) => TrackNode | undefined;
        /** Whether an output id names the master, the hardware output or a live track strip. */
        hasOutputDestination: (outputId: string) => boolean;
    }>;

type OutputOutcome =
    | { status: 'applied' }
    | { status: 'rejected'; error: RuntimeGraphMutationRejected }
    | { status: 'needs-reconcile'; error: unknown; reason: string; compensation: 'not-attempted' | 'failed' };

function applyOutput(source: TrackNode, targetId: string): RuntimeGraphMutation<OutputOutcome> {
    try {
        return { value: { status: 'applied' as const }, changed: source.setOutput(targetId) };
    } catch (error) {
        if (error instanceof RuntimeGraphMutationRejected) {
            return { value: { status: 'rejected' as const, error }, changed: false };
        }
        // A host-side node operation may have partially taken effect. Do
        // not claim a CRDT rollback restored it: invalidate the current
        // generation and force an owner-led reconcile instead.
        const typedFailure = error instanceof RuntimeGraphMutationFailure ? error : undefined;
        return {
            value: {
                status: 'needs-reconcile' as const,
                error,
                reason: typedFailure?.mutation.reason ?? `Live output application threw: ${String(error)}`,
                compensation: typedFailure?.rollbackError ? 'failed' : 'not-attempted',
            },
            changed: true,
        };
    }
}

/** Applies one compiled track-output edge to the live graph. */
export function createRuntimeOutputDeltaApplication(
    ports: RuntimeOutputDeltaPorts
): (delta: RuntimeGraphOutputDelta) => RuntimeGraphDeltaResult {
    const { readRevision, mutateRuntimeGraph, readTrackNode, hasOutputDestination } = ports;

    return (delta) => {
        const refusal = admitRuntimeGraphDelta(ports, delta.correlation, delta.nodes, 'delta');
        if (refusal) {
            return refusal;
        }

        const edge = delta.edges[0];
        const sourcePlan = delta.nodes[0];
        if (!sourcePlan) {
            return rejectRuntimeGraphDelta('Compiled runtime graph delta has no output source');
        }
        const source = readTrackNode(edge.sourceId);
        if (!source || !matchesRuntimeDeviceChainTopology(source.strip, sourcePlan)) {
            return rejectRuntimeGraphDelta('Live source strip does not match the compiled graph delta');
        }
        if (!hasOutputDestination(edge.targetId)) {
            return needsRuntimeGraphReconciliation(
                delta,
                'Live destination strip does not match the compiled graph delta',
                readRevision()
            );
        }
        const targetPlan = delta.nodes[1];
        if (targetPlan) {
            const target = readTrackNode(targetPlan.id);
            if (!target || !matchesRuntimeDeviceChainTopology(target.strip, targetPlan)) {
                return rejectRuntimeGraphDelta('Live destination strip does not match the compiled graph delta');
            }
        }

        const outputMutation = mutateRuntimeGraph(() => applyOutput(source, edge.targetId));
        if (outputMutation.value.status === 'rejected') {
            return rejectRuntimeGraphDelta(outputMutation.value.error.rejection.reason);
        }
        if (outputMutation.value.status === 'needs-reconcile') {
            return needsRuntimeGraphReconciliation(
                delta,
                outputMutation.value.reason,
                outputMutation.runtimeRevision,
                outputMutation.value.compensation
            );
        }
        return Object.freeze({
            acceptance: 'accepted' as const,
            application: 'applied' as const,
            correlation: delta.correlation,
            runtimeRevision: outputMutation.runtimeRevision,
        });
    };
}
