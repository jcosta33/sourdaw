import { retainAgentMeasurementArtifacts } from './retainAgentMeasurementArtifacts';

type MeasuredRender = {
    contentAddress: string;
    buffer: AudioBuffer;
};

/**
 * Retains the renders a measurement has finished reporting on, and returns one warning line for each
 * distinct render the store does not hold afterwards, whether it was too large to keep or a later
 * render of the same batch evicted it, so a receipt never cites a render that is neither kept nor
 * named. A measurement that stops before it reports never calls this, so its renders are never in
 * the store and the store is as it was before the measurement began.
 */
export function retainAgentMeasurementRenders(input: {
    renders: readonly MeasuredRender[];
    sourceRevision: string;
}): string[] {
    return retainAgentMeasurementArtifacts(input).map(
        (contentAddress) =>
            `Render ${contentAddress} was not retained: it does not fit the measurement retention limit.`
    );
}
