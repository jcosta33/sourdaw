import { beatToSamples } from '../models/TempoMap';

type TempoChangeShape = {
    id: string;
    beat: number;
    tempo: number;
    curve: 'instant' | 'linear';
};

type ProjectPpqEndpointsInput = {
    startPpq: number;
    endPpq: number;
    defaultTempo: number;
    sampleRate: number;
    changes: readonly TempoChangeShape[];
};

export function projectPpqEndpoints(input: ProjectPpqEndpointsInput) {
    const { startPpq, endPpq, defaultTempo, sampleRate, changes } = input;
    const startSamples = beatToSamples(changes, startPpq, defaultTempo, sampleRate);
    const endSamples = beatToSamples(changes, endPpq, defaultTempo, sampleRate);
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
