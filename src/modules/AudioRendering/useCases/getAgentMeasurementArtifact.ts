import { getAgentMeasurementArtifacts } from './getAgentMeasurementArtifacts';

/** The retained measurement render with this content address, or null once it was evicted or expired. */
export function getAgentMeasurementArtifact(contentAddress: string, now = Date.now()) {
    return getAgentMeasurementArtifacts(now).find((artifact) => artifact.contentAddress === contentAddress) ?? null;
}
