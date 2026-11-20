import { isDeviceReleaseAdmitted } from '#/infra/release/deviceReleaseAdmission';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { RuntimeGraphMutationFailure, RuntimeGraphMutationRejected, type TrackNode } from '../../engine/TrackNode';
import { matchesRuntimeDeviceChainTopology } from '../../services/matchesRuntimeDeviceChainTopology';

import { admitRuntimeGraphDelta, type RuntimeGraphAdmissionPorts } from './admitRuntimeGraphDelta';
import { needsRuntimeGraphReconciliation } from './needsRuntimeGraphReconciliation';
import { rejectRuntimeGraphDelta } from './rejectRuntimeGraphDelta';

import type {
    RuntimeGraphDeltaNode,
    RuntimeGraphDeltaResult,
    RuntimeGraphInitializationOutput,
    RuntimeGraphTrackStripInitializationDelta,
} from '../../models/RuntimeGraphDelta';
import type { RuntimeGraphMutation, RuntimeGraphRevision } from './createRuntimeGraphRevision';
import type { ToasterPadBinding } from './createToasterPadRouting';

export type RuntimeTrackStripInitializationPorts = RuntimeGraphAdmissionPorts &
    Readonly<{
        mutateRuntimeGraph: RuntimeGraphRevision['mutate'];
        isFallback: () => boolean;
        /** The live strip node of a track, read per call. */
        readTrackNode: (trackId: string) => TrackNode | undefined;
        /** The Toaster pad a track's strip is bound to, read per call. */
        readToasterPadBinding: (trackId: string) => ToasterPadBinding | undefined;
        /** Whether an output id names the master, the hardware output or a live track strip. */
        hasOutputDestination: (outputId: string) => boolean;
        /** Builds a private strip node that is not yet part of the live graph. */
        createTrackNode: (trackId: string) => TrackNode;
        registerTrackNode: (trackId: string, node: TrackNode) => void;
        unregisterTrackNode: (trackId: string) => void;
        setTrackOutputTransaction: (
            node: TrackNode,
            outputId: string,
            padBinding: ToasterPadBinding | undefined
        ) => RuntimeGraphMutation<void>;
    }>;

export type RuntimeTrackStripInitialization = {
    apply(delta: RuntimeGraphTrackStripInitializationDelta): RuntimeGraphDeltaResult;
    /** Lets a withheld device type warn again, once, in the next project. */
    forgetWithheldDeviceNotices(): void;
};

function matchesPadBinding(
    existing: ToasterPadBinding | undefined,
    expected: RuntimeGraphInitializationOutput['padBinding']
): boolean {
    if (expected) {
        return (
            existing?.toasterParentTrackId === expected.toasterParentTrackId && existing.padIndex === expected.padIndex
        );
    }
    return !existing;
}

function matchesExistingStrip(
    existing: TrackNode,
    sourcePlan: RuntimeGraphDeltaNode,
    output: RuntimeGraphInitializationOutput,
    padBinding: ToasterPadBinding | undefined
): boolean {
    return (
        matchesRuntimeDeviceChainTopology(existing.strip, sourcePlan) &&
        existing.strip.outputId === output.targetId &&
        matchesPadBinding(padBinding, output.padBinding)
    );
}

function classifyInitializationFailure(
    delta: RuntimeGraphTrackStripInitializationDelta,
    error: unknown,
    runtimeRevision: number
): RuntimeGraphDeltaResult {
    if (error instanceof RuntimeGraphMutationRejected) {
        return rejectRuntimeGraphDelta(error.rejection.reason);
    }
    const typedFailure = error instanceof RuntimeGraphMutationFailure ? error : undefined;
    if (typedFailure) {
        return needsRuntimeGraphReconciliation(
            delta,
            typedFailure.mutation.reason,
            runtimeRevision,
            typedFailure.rollbackError ? 'failed' : 'not-attempted'
        );
    }
    return rejectRuntimeGraphDelta(`Live strip initialization failed before publication: ${String(error)}`);
}

function addPlannedDevices(
    node: TrackNode,
    sourcePlan: RuntimeGraphDeltaNode,
    noticeWithheldDevice: (deviceType: string) => void
): void {
    for (const device of sourcePlan.devices) {
        const added = node.addDevice(device.id, device.type, device.externalInstanceId, undefined, device.parameterIds);
        if (!added && !isDeviceReleaseAdmitted(device.type)) {
            noticeWithheldDevice(device.type);
        }
    }
}

function acceptedInitialization(
    delta: RuntimeGraphTrackStripInitializationDelta,
    runtimeRevision: number
): RuntimeGraphDeltaResult {
    return Object.freeze({
        acceptance: 'accepted' as const,
        application: 'applied' as const,
        correlation: delta.correlation,
        runtimeRevision,
    });
}

/**
 * Creates a missing strip from one compiled project snapshot. The source is
 * kept private until its full ordered chain and output route are valid, so a
 * malformed or stale projection cannot publish a partially-built strip.
 */
export function createRuntimeTrackStripInitialization(
    ports: RuntimeTrackStripInitializationPorts
): RuntimeTrackStripInitialization {
    const withheldDeviceNotices = new Set<string>();

    function noticeWithheldDevice(deviceType: string): void {
        if (withheldDeviceNotices.has(deviceType)) {
            return;
        }
        withheldDeviceNotices.add(deviceType);
        notifyUser(
            `"${deviceType}" is withheld from this build. Its project data is preserved, but it will remain silent.`,
            'warning'
        );
    }

    function buildStrip(
        sourcePlan: RuntimeGraphDeltaNode,
        output: RuntimeGraphInitializationOutput
    ): RuntimeGraphMutation<void> {
        const initializedNode = ports.createTrackNode(sourcePlan.id);
        try {
            addPlannedDevices(initializedNode, sourcePlan, noticeWithheldDevice);
            ports.registerTrackNode(sourcePlan.id, initializedNode);
            ports.setTrackOutputTransaction(initializedNode, output.targetId, output.padBinding);
            return { value: undefined, changed: !ports.isFallback() };
        } catch (error) {
            ports.unregisterTrackNode(sourcePlan.id);
            initializedNode.dispose();
            throw error;
        }
    }

    function apply(delta: RuntimeGraphTrackStripInitializationDelta): RuntimeGraphDeltaResult {
        const refusal = admitRuntimeGraphDelta(ports, delta.correlation, delta.nodes, 'initialization');
        if (refusal) {
            return refusal;
        }

        const sourcePlan = delta.nodes[0];
        if (!sourcePlan) {
            return rejectRuntimeGraphDelta('Compiled runtime graph initialization has no source strip');
        }
        const existing = ports.readTrackNode(sourcePlan.id);
        if (existing) {
            if (matchesExistingStrip(existing, sourcePlan, delta.output, ports.readToasterPadBinding(sourcePlan.id))) {
                return acceptedInitialization(delta, ports.readRevision());
            }
            return rejectRuntimeGraphDelta('Live source strip does not match the compiled initialization snapshot');
        }
        if (!ports.hasOutputDestination(delta.output.targetId)) {
            return needsRuntimeGraphReconciliation(
                delta,
                'Live destination strip does not match the compiled initialization snapshot',
                ports.readRevision()
            );
        }
        const targetPlan = delta.nodes[1];
        if (targetPlan) {
            const target = ports.readTrackNode(targetPlan.id);
            if (!target || !matchesRuntimeDeviceChainTopology(target.strip, targetPlan)) {
                return rejectRuntimeGraphDelta(
                    'Live destination strip does not match the compiled initialization snapshot'
                );
            }
        }

        try {
            const initialization = ports.mutateRuntimeGraph(() => buildStrip(sourcePlan, delta.output));
            return acceptedInitialization(delta, initialization.runtimeRevision);
        } catch (error) {
            return classifyInitializationFailure(delta, error, ports.readRevision());
        }
    }

    return {
        apply,
        forgetWithheldDeviceNotices: () => withheldDeviceNotices.clear(),
    };
}
