import { retainAgentMeasurementArtifacts } from './retainAgentMeasurementArtifacts';

type MeasuredRender = {
    contentAddress: string;
    buffer: AudioBuffer;
};

/**
 * Retains the renders a measurement has finished reporting on, and returns one warning line for each
 * distinct render too large to keep. A measurement that stops before it reports never calls this, so
 * its renders are never in the store and the store is as it was before the measurement began.
 */
export function retainAgentMeasurementRenders(input: {
    renders: readonly MeasuredRender[];
    sourceRevision: string;
}): string[] {
    const oversized = new Set(retainAgentMeasurementArtifacts(input));
    return Array.from(
        oversized,
        (contentAddress) => `Render ${contentAddress} exceeds the measurement retention limit and was not retained.`
    );
}
