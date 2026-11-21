import { rejectRuntimeGraphDelta } from './rejectRuntimeGraphDelta';

import type {
    RuntimeGraphCorrelation,
    RuntimeGraphDeltaNode,
    RuntimeGraphDeltaResult,
    RuntimeGraphProjectRevisionValidator,
    RuntimeGraphTopologyValidator,
} from '../../models/RuntimeGraphDelta';

export type RuntimeGraphAdmissionPorts = Readonly<{
    /** The live-engine revision, read per call. */
    readRevision: () => number;
    readProjectRevisionValidator: () => RuntimeGraphProjectRevisionValidator | null;
    readTopologyValidator: () => RuntimeGraphTopologyValidator | null;
}>;

/** The noun a refusal names the command by: an ordinary delta or a strip initialization. */
export type RuntimeGraphAdmissionSubject = 'delta' | 'initialization';

function refuseStaleProjectRevision(
    validator: RuntimeGraphProjectRevisionValidator,
    projectRevision: string,
    subject: RuntimeGraphAdmissionSubject
): RuntimeGraphDeltaResult | undefined {
    let isCurrentProjectRevision: boolean;
    try {
        isCurrentProjectRevision = validator(projectRevision);
    } catch (error) {
        return rejectRuntimeGraphDelta(`Runtime graph ${subject} project revision validation failed: ${String(error)}`);
    }
    if (!isCurrentProjectRevision) {
        return rejectRuntimeGraphDelta(`Runtime graph ${subject} is stale for the current project revision`);
    }
    return undefined;
}

function refuseForeignTopology(
    validator: RuntimeGraphTopologyValidator,
    nodes: readonly RuntimeGraphDeltaNode[],
    subject: RuntimeGraphAdmissionSubject
): RuntimeGraphDeltaResult | undefined {
    let isCurrentProjectTopology: boolean;
    try {
        isCurrentProjectTopology = validator(nodes);
    } catch (error) {
        return rejectRuntimeGraphDelta(`Runtime graph ${subject} topology validation failed: ${String(error)}`);
    }
    if (!isCurrentProjectTopology) {
        return rejectRuntimeGraphDelta(`Runtime graph ${subject} does not match the current project topology`);
    }
    return undefined;
}

/**
 * Refuses a compiled command that is not current, before any graph edit: first
 * against the live-engine revision, then the registered project-revision
 * validator, then the registered topology validator. An unregistered validator
 * is skipped. Returns the refusal, or undefined when the command is admitted.
 */
export function admitRuntimeGraphDelta(
    ports: RuntimeGraphAdmissionPorts,
    correlation: RuntimeGraphCorrelation,
    nodes: readonly RuntimeGraphDeltaNode[],
    subject: RuntimeGraphAdmissionSubject
): RuntimeGraphDeltaResult | undefined {
    if (correlation.appRevision !== ports.readRevision()) {
        return rejectRuntimeGraphDelta(`Runtime graph ${subject} is stale for the live engine revision`);
    }
    const projectRevisionValidator = ports.readProjectRevisionValidator();
    if (projectRevisionValidator) {
        const refusal = refuseStaleProjectRevision(projectRevisionValidator, correlation.projectRevision, subject);
        if (refusal) {
            return refusal;
        }
    }
    const topologyValidator = ports.readTopologyValidator();
    if (topologyValidator) {
        return refuseForeignTopology(topologyValidator, nodes, subject);
    }
    return undefined;
}
