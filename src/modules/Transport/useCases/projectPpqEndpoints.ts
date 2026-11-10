import { beatToSamples, type TempoChange } from '../models/TempoMap';

type ProjectPpqEndpointsInput = {
    startPpq: number;
    endPpq: number;
    defaultTempo: number;
    sampleRate: number;
    changes: readonly TempoChange[];
};

export function projectPpqEndpoints({ startPpq, endPpq, defaultTempo, sampleRate, changes }: ProjectPpqEndpointsInput) {
    const startSamples = beatToSamples(changes, startPpq, defaultTempo, sampleRate);
    // Offline rendering projects single beats through here, millions of times per export.
    const endSamples = endPpq === startPpq ? startSamples : beatToSamples(changes, endPpq, defaultTempo, sampleRate);
    const durationSamples = endSamples - startSamples;

    return {
        startSamples,
        endSamples,
        durationSamples,
        startSeconds: startSamples / sampleRate,
        endSeconds: endSamples / sampleRate,
        durationSeconds: durationSamples / sampleRate,
    };
}
